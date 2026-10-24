"""The neural networks RVC voice models use - inference only, trimmed down.

Adapted from RVC-Project/Retrieval-based-Voice-Conversion-WebUI (MIT License, Copyright (c) 2023 liujing04,
源文雨, Ftps). Training-only parts (discriminators, posterior encoder) are left out, and weight-norm layers are
plain layers: rvc.py folds the saved weight_g / weight_v pairs into one weight when it loads a model.
"""
import math

import numpy as np
import torch
from torch import nn
from torch.nn import functional as F

LRELU_SLOPE = 0.1


def get_padding(kernel_size, dilation=1):
    return int((kernel_size * dilation - dilation) / 2)


def sequence_mask(length, max_length=None):
    if max_length is None:
        max_length = length.max()
    x = torch.arange(max_length, dtype=length.dtype, device=length.device)
    return x.unsqueeze(0) < length.unsqueeze(1)


def fused_add_tanh_sigmoid_multiply(input_a, input_b, n_channels):
    in_act = input_a + input_b
    return torch.tanh(in_act[:, :n_channels, :]) * torch.sigmoid(in_act[:, n_channels:, :])


# ---------------- building blocks ----------------
class LayerNorm(nn.Module):
    def __init__(self, channels, eps=1e-5):
        super().__init__()
        self.channels, self.eps = channels, eps
        self.gamma = nn.Parameter(torch.ones(channels))
        self.beta = nn.Parameter(torch.zeros(channels))

    def forward(self, x):
        x = x.transpose(1, -1)
        x = F.layer_norm(x, (self.channels,), self.gamma, self.beta, self.eps)
        return x.transpose(1, -1)


class MultiHeadAttention(nn.Module):
    def __init__(self, channels, out_channels, n_heads, window_size=None):
        super().__init__()
        self.n_heads, self.window_size = n_heads, window_size
        self.k_channels = channels // n_heads
        self.conv_q = nn.Conv1d(channels, channels, 1)
        self.conv_k = nn.Conv1d(channels, channels, 1)
        self.conv_v = nn.Conv1d(channels, channels, 1)
        self.conv_o = nn.Conv1d(channels, out_channels, 1)
        if window_size is not None:
            self.emb_rel_k = nn.Parameter(torch.zeros(1, window_size * 2 + 1, self.k_channels))
            self.emb_rel_v = nn.Parameter(torch.zeros(1, window_size * 2 + 1, self.k_channels))

    def forward(self, x, c, attn_mask=None):
        q, k, v = self.conv_q(x), self.conv_k(c), self.conv_v(c)
        return self.conv_o(self.attention(q, k, v, attn_mask))

    def attention(self, query, key, value, mask=None):
        b, d, t_s = key.size()
        t_t = query.size(2)
        query = query.view(b, self.n_heads, self.k_channels, t_t).transpose(2, 3)
        key = key.view(b, self.n_heads, self.k_channels, t_s).transpose(2, 3)
        value = value.view(b, self.n_heads, self.k_channels, t_s).transpose(2, 3)
        scores = torch.matmul(query / math.sqrt(self.k_channels), key.transpose(-2, -1))
        if self.window_size is not None:
            rel_k = self._relative_embeddings(self.emb_rel_k, t_s)
            rel_logits = torch.matmul(query / math.sqrt(self.k_channels), rel_k.unsqueeze(0).transpose(-2, -1))
            scores = scores + self._rel_to_abs(rel_logits)
        if mask is not None:
            scores = scores.masked_fill(mask == 0, -1e4)
        p_attn = F.softmax(scores, dim=-1)
        output = torch.matmul(p_attn, value)
        if self.window_size is not None:
            rel_v = self._relative_embeddings(self.emb_rel_v, t_s)
            output = output + torch.matmul(self._abs_to_rel(p_attn), rel_v.unsqueeze(0))
        return output.transpose(2, 3).contiguous().view(b, d, t_t)

    def _relative_embeddings(self, emb, length):
        pad_length = max(length - (self.window_size + 1), 0)
        start = max((self.window_size + 1) - length, 0)
        if pad_length > 0:
            emb = F.pad(emb, [0, 0, pad_length, pad_length, 0, 0])
        return emb[:, start:start + 2 * length - 1]

    @staticmethod
    def _rel_to_abs(x):
        batch, heads, length, _ = x.size()
        x = F.pad(x, [0, 1, 0, 0, 0, 0, 0, 0])
        x_flat = F.pad(x.view([batch, heads, length * 2 * length]), [0, int(length) - 1, 0, 0, 0, 0])
        return x_flat.view([batch, heads, length + 1, 2 * length - 1])[:, :, :length, length - 1:]

    @staticmethod
    def _abs_to_rel(x):
        batch, heads, length, _ = x.size()
        x = F.pad(x, [0, int(length) - 1, 0, 0, 0, 0, 0, 0])
        x_flat = x.view([batch, heads, int(length ** 2) + int(length * (length - 1))])
        x_flat = F.pad(x_flat, [length, 0, 0, 0, 0, 0])
        return x_flat.view([batch, heads, length, 2 * length])[:, :, :, 1:]


class FFN(nn.Module):
    def __init__(self, in_channels, out_channels, filter_channels, kernel_size):
        super().__init__()
        self.kernel_size = kernel_size
        self.conv_1 = nn.Conv1d(in_channels, filter_channels, kernel_size)
        self.conv_2 = nn.Conv1d(filter_channels, out_channels, kernel_size)

    def _pad(self, x):
        if self.kernel_size == 1:
            return x
        return F.pad(x, [(self.kernel_size - 1) // 2, self.kernel_size // 2, 0, 0, 0, 0])

    def forward(self, x, x_mask):
        x = torch.relu(self.conv_1(self._pad(x * x_mask)))
        return self.conv_2(self._pad(x * x_mask)) * x_mask


class Encoder(nn.Module):
    def __init__(self, hidden_channels, filter_channels, n_heads, n_layers, kernel_size=1, window_size=10):
        super().__init__()
        self.attn_layers, self.norm_layers_1 = nn.ModuleList(), nn.ModuleList()
        self.ffn_layers, self.norm_layers_2 = nn.ModuleList(), nn.ModuleList()
        for _ in range(int(n_layers)):
            self.attn_layers.append(MultiHeadAttention(hidden_channels, hidden_channels, n_heads, window_size))
            self.norm_layers_1.append(LayerNorm(hidden_channels))
            self.ffn_layers.append(FFN(hidden_channels, hidden_channels, filter_channels, kernel_size))
            self.norm_layers_2.append(LayerNorm(hidden_channels))

    def forward(self, x, x_mask):
        attn_mask = x_mask.unsqueeze(2) * x_mask.unsqueeze(-1)
        x = x * x_mask
        for attn, norm1, ffn, norm2 in zip(self.attn_layers, self.norm_layers_1, self.ffn_layers, self.norm_layers_2):
            x = norm1(x + attn(x, x, attn_mask))
            x = norm2(x + ffn(x, x_mask))
        return x * x_mask


class WN(nn.Module):
    def __init__(self, hidden_channels, kernel_size, dilation_rate, n_layers, gin_channels=0):
        super().__init__()
        self.hidden_channels, self.n_layers = hidden_channels, n_layers
        self.in_layers, self.res_skip_layers = nn.ModuleList(), nn.ModuleList()
        if gin_channels:
            self.cond_layer = nn.Conv1d(gin_channels, 2 * hidden_channels * n_layers, 1)
        for i in range(n_layers):
            dilation = dilation_rate ** i
            self.in_layers.append(nn.Conv1d(hidden_channels, 2 * hidden_channels, kernel_size, dilation=dilation,
                                            padding=int((kernel_size * dilation - dilation) / 2)))
            res_skip = 2 * hidden_channels if i < n_layers - 1 else hidden_channels
            self.res_skip_layers.append(nn.Conv1d(hidden_channels, res_skip, 1))

    def forward(self, x, x_mask, g=None):
        output = torch.zeros_like(x)
        if g is not None:
            g = self.cond_layer(g)
        for i, (in_layer, res_skip_layer) in enumerate(zip(self.in_layers, self.res_skip_layers)):
            x_in = in_layer(x)
            off = i * 2 * self.hidden_channels
            g_l = g[:, off:off + 2 * self.hidden_channels, :] if g is not None else torch.zeros_like(x_in)
            acts = res_skip_layer(fused_add_tanh_sigmoid_multiply(x_in, g_l, self.hidden_channels))
            if i < self.n_layers - 1:
                x = (x + acts[:, :self.hidden_channels, :]) * x_mask
                output = output + acts[:, self.hidden_channels:, :]
            else:
                output = output + acts
        return output * x_mask


class ResBlock1(nn.Module):
    def __init__(self, channels, kernel_size=3, dilation=(1, 3, 5)):
        super().__init__()
        self.convs1 = nn.ModuleList([nn.Conv1d(channels, channels, kernel_size, 1, dilation=d,
                                               padding=get_padding(kernel_size, d)) for d in dilation])
        self.convs2 = nn.ModuleList([nn.Conv1d(channels, channels, kernel_size, 1, dilation=1,
                                               padding=get_padding(kernel_size, 1)) for _ in dilation])

    def forward(self, x):
        for c1, c2 in zip(self.convs1, self.convs2):
            xt = c2(F.leaky_relu(c1(F.leaky_relu(x, LRELU_SLOPE)), LRELU_SLOPE))
            x = xt + x
        return x


class ResBlock2(nn.Module):
    def __init__(self, channels, kernel_size=3, dilation=(1, 3)):
        super().__init__()
        self.convs = nn.ModuleList([nn.Conv1d(channels, channels, kernel_size, 1, dilation=d,
                                              padding=get_padding(kernel_size, d)) for d in dilation])

    def forward(self, x):
        for c in self.convs:
            x = c(F.leaky_relu(x, LRELU_SLOPE)) + x
        return x


class Flip(nn.Module):
    def forward(self, x, *args, **kwargs):
        return torch.flip(x, [1])


class ResidualCouplingLayer(nn.Module):
    def __init__(self, channels, hidden_channels, kernel_size, dilation_rate, n_layers, gin_channels=0):
        super().__init__()
        self.half_channels = channels // 2
        self.pre = nn.Conv1d(self.half_channels, hidden_channels, 1)
        self.enc = WN(hidden_channels, kernel_size, dilation_rate, n_layers, gin_channels=gin_channels)
        self.post = nn.Conv1d(hidden_channels, self.half_channels, 1)      # mean only

    def forward(self, x, x_mask, g=None):                                   # reverse direction (inference)
        x0, x1 = torch.split(x, [self.half_channels] * 2, 1)
        h = self.enc(self.pre(x0) * x_mask, x_mask, g=g)
        m = self.post(h) * x_mask
        return torch.cat([x0, (x1 - m) * x_mask], 1)


class ResidualCouplingBlock(nn.Module):
    def __init__(self, channels, hidden_channels, kernel_size, dilation_rate, n_layers, n_flows=4, gin_channels=0):
        super().__init__()
        self.flows = nn.ModuleList()
        for _ in range(n_flows):
            self.flows.append(ResidualCouplingLayer(channels, hidden_channels, kernel_size, dilation_rate, n_layers,
                                                    gin_channels=gin_channels))
            self.flows.append(Flip())

    def forward(self, x, x_mask, g=None):
        for flow in self.flows[::-1]:
            x = flow(x, x_mask, g=g)
        return x


class TextEncoder(nn.Module):
    def __init__(self, in_channels, out_channels, hidden_channels, filter_channels, n_heads, n_layers, kernel_size,
                 f0=True):
        super().__init__()
        self.out_channels, self.hidden_channels = out_channels, hidden_channels
        self.emb_phone = nn.Linear(in_channels, hidden_channels)
        if f0:
            self.emb_pitch = nn.Embedding(256, hidden_channels)
        self.encoder = Encoder(hidden_channels, filter_channels, n_heads, n_layers, kernel_size)
        self.proj = nn.Conv1d(hidden_channels, out_channels * 2, 1)

    def forward(self, phone, pitch, lengths):
        x = self.emb_phone(phone) if pitch is None else self.emb_phone(phone) + self.emb_pitch(pitch)
        x = F.leaky_relu(x * math.sqrt(self.hidden_channels), 0.1).transpose(1, -1)
        x_mask = sequence_mask(lengths, x.size(2)).unsqueeze(1).to(x.dtype)
        x = self.encoder(x * x_mask, x_mask)
        m, logs = torch.split(self.proj(x) * x_mask, self.out_channels, dim=1)
        return m, logs, x_mask


# ---------------- vocoders ----------------
class _Upsampler(nn.Module):
    def _build(self, initial_channel, resblock, resblock_kernel_sizes, resblock_dilation_sizes, upsample_rates,
               upsample_initial_channel, upsample_kernel_sizes, gin_channels):
        self.num_kernels = len(resblock_kernel_sizes)
        self.num_upsamples = len(upsample_rates)
        self.conv_pre = nn.Conv1d(initial_channel, upsample_initial_channel, 7, 1, padding=3)
        block = ResBlock1 if str(resblock) == "1" else ResBlock2
        self.ups = nn.ModuleList()
        for i, (u, k) in enumerate(zip(upsample_rates, upsample_kernel_sizes)):
            self.ups.append(nn.ConvTranspose1d(upsample_initial_channel // (2 ** i),
                                               upsample_initial_channel // (2 ** (i + 1)), k, u, padding=(k - u) // 2))
        self.resblocks = nn.ModuleList()
        for i in range(len(self.ups)):
            ch = upsample_initial_channel // (2 ** (i + 1))
            for k, d in zip(resblock_kernel_sizes, resblock_dilation_sizes):
                self.resblocks.append(block(ch, k, d))
        self.conv_post = nn.Conv1d(ch, 1, 7, 1, padding=3, bias=False)
        if gin_channels:
            self.cond = nn.Conv1d(gin_channels, upsample_initial_channel, 1)

    def _res(self, i, x):
        xs = None
        for j in range(self.num_kernels):
            y = self.resblocks[i * self.num_kernels + j](x)
            xs = y if xs is None else xs + y
        return xs / self.num_kernels


class Generator(_Upsampler):
    def __init__(self, *args, gin_channels=0):
        super().__init__()
        self._build(*args, gin_channels)

    def forward(self, x, g=None):
        x = self.conv_pre(x)
        if g is not None:
            x = x + self.cond(g)
        for i in range(self.num_upsamples):
            x = self._res(i, self.ups[i](F.leaky_relu(x, LRELU_SLOPE)))
        return torch.tanh(self.conv_post(F.leaky_relu(x)))


class SineGen(nn.Module):
    def __init__(self, samp_rate, harmonic_num=0, sine_amp=0.1, noise_std=0.003, voiced_threshold=0):
        super().__init__()
        self.sine_amp, self.noise_std = sine_amp, noise_std
        self.dim = harmonic_num + 1
        self.sampling_rate, self.voiced_threshold = samp_rate, voiced_threshold

    def _f02sine(self, f0, upp):
        rad = f0 / self.sampling_rate * torch.arange(1, upp + 1, device=f0.device)
        rad2 = torch.fmod(rad[..., -1:].float() + 0.5, 1.0) - 0.5
        rad_acc = rad2.cumsum(dim=1).fmod(1.0).to(f0)
        rad += F.pad(rad_acc, (0, 0, 1, -1))
        rad = rad.reshape(f0.shape[0], -1, 1)
        rad = rad * torch.arange(1, self.dim + 1, device=f0.device).reshape(1, 1, -1)
        rand_ini = torch.rand(1, 1, self.dim, device=f0.device)
        rand_ini[..., 0] = 0
        return torch.sin(2 * np.pi * (rad + rand_ini))

    def forward(self, f0, upp):
        with torch.no_grad():
            f0 = f0[:, None].transpose(1, 2)
            sine_waves = self._f02sine(f0, upp) * self.sine_amp
            uv = (f0 > self.voiced_threshold).float()
            uv = F.interpolate(uv.transpose(2, 1), scale_factor=float(upp), mode="nearest").transpose(2, 1)
            noise_amp = uv * self.noise_std + (1 - uv) * self.sine_amp / 3
            return sine_waves * uv + noise_amp * torch.randn_like(sine_waves)


class SourceModuleHnNSF(nn.Module):
    def __init__(self, sampling_rate, harmonic_num=0):
        super().__init__()
        self.l_sin_gen = SineGen(sampling_rate, harmonic_num)
        self.l_linear = nn.Linear(harmonic_num + 1, 1)

    def forward(self, x, upp=1):
        sine = self.l_sin_gen(x, upp).to(dtype=self.l_linear.weight.dtype)
        return torch.tanh(self.l_linear(sine))


class GeneratorNSF(_Upsampler):
    def __init__(self, initial_channel, resblock, resblock_kernel_sizes, resblock_dilation_sizes, upsample_rates,
                 upsample_initial_channel, upsample_kernel_sizes, gin_channels, sr):
        super().__init__()
        self.m_source = SourceModuleHnNSF(sampling_rate=sr)
        self._build(initial_channel, resblock, resblock_kernel_sizes, resblock_dilation_sizes, upsample_rates,
                    upsample_initial_channel, upsample_kernel_sizes, gin_channels)
        self.noise_convs = nn.ModuleList()
        for i in range(len(upsample_rates)):
            c_cur = upsample_initial_channel // (2 ** (i + 1))
            if i + 1 < len(upsample_rates):
                stride_f0 = math.prod(upsample_rates[i + 1:])
                self.noise_convs.append(nn.Conv1d(1, c_cur, kernel_size=stride_f0 * 2, stride=stride_f0,
                                                  padding=stride_f0 // 2))
            else:
                self.noise_convs.append(nn.Conv1d(1, c_cur, kernel_size=1))
        self.upp = math.prod(upsample_rates)

    def forward(self, x, f0, g=None):
        har_source = self.m_source(f0, self.upp).transpose(1, 2)
        x = self.conv_pre(x)
        if g is not None:
            x = x + self.cond(g)
        for i in range(self.num_upsamples):
            x = self.ups[i](F.leaky_relu(x, LRELU_SLOPE))
            x = self._res(i, x + self.noise_convs[i](har_source))
        return torch.tanh(self.conv_post(F.leaky_relu(x)))


SR = {"32k": 32000, "40k": 40000, "48k": 48000}


class Synthesizer(nn.Module):
    """Any RVC model: v1 (256 features) or v2 (768), with or without pitch (f0)."""

    def __init__(self, spec_channels, segment_size, inter_channels, hidden_channels, filter_channels, n_heads,
                 n_layers, kernel_size, p_dropout, resblock, resblock_kernel_sizes, resblock_dilation_sizes,
                 upsample_rates, upsample_initial_channel, upsample_kernel_sizes, spk_embed_dim, gin_channels, sr,
                 feat_dim=768, f0=True):
        super().__init__()
        sr = SR.get(sr, sr) if isinstance(sr, str) else sr
        self.f0 = f0
        self.enc_p = TextEncoder(feat_dim, inter_channels, hidden_channels, filter_channels, n_heads, n_layers,
                                 kernel_size, f0=f0)
        vocoder = (inter_channels, resblock, resblock_kernel_sizes, resblock_dilation_sizes, upsample_rates,
                   upsample_initial_channel, upsample_kernel_sizes)
        self.dec = GeneratorNSF(*vocoder, gin_channels, int(sr)) if f0 else Generator(*vocoder, gin_channels=gin_channels)
        self.flow = ResidualCouplingBlock(inter_channels, hidden_channels, 5, 1, 3, gin_channels=gin_channels)
        self.emb_g = nn.Embedding(spk_embed_dim, gin_channels)

    def infer(self, phone, phone_lengths, pitch, nsff0, sid):
        g = self.emb_g(sid).unsqueeze(-1)
        m_p, logs_p, x_mask = self.enc_p(phone, pitch if self.f0 else None, phone_lengths)
        z_p = (m_p + torch.exp(logs_p) * torch.randn_like(m_p) * 0.66666) * x_mask
        z = self.flow(z_p, x_mask, g=g)
        return self.dec(z * x_mask, nsff0, g=g) if self.f0 else self.dec(z * x_mask, g=g)


# ---------------- RMVPE pitch finder ----------------
class _ConvBlockRes(nn.Module):
    def __init__(self, in_channels, out_channels, momentum=0.01):
        super().__init__()
        self.conv = nn.Sequential(
            nn.Conv2d(in_channels, out_channels, (3, 3), (1, 1), (1, 1), bias=False),
            nn.BatchNorm2d(out_channels, momentum=momentum), nn.ReLU(),
            nn.Conv2d(out_channels, out_channels, (3, 3), (1, 1), (1, 1), bias=False),
            nn.BatchNorm2d(out_channels, momentum=momentum), nn.ReLU())
        if in_channels != out_channels:
            self.shortcut = nn.Conv2d(in_channels, out_channels, (1, 1))

    def forward(self, x):
        return self.conv(x) + (self.shortcut(x) if hasattr(self, "shortcut") else x)


class _ResEncoderBlock(nn.Module):
    def __init__(self, in_channels, out_channels, kernel_size, n_blocks=1, momentum=0.01):
        super().__init__()
        self.conv = nn.ModuleList([_ConvBlockRes(in_channels, out_channels, momentum)]
                                  + [_ConvBlockRes(out_channels, out_channels, momentum) for _ in range(n_blocks - 1)])
        self.kernel_size = kernel_size
        if kernel_size is not None:
            self.pool = nn.AvgPool2d(kernel_size=kernel_size)

    def forward(self, x):
        for conv in self.conv:
            x = conv(x)
        return (x, self.pool(x)) if self.kernel_size is not None else x


class _Encoder(nn.Module):
    def __init__(self, in_channels, in_size, n_encoders, kernel_size, n_blocks, out_channels=16, momentum=0.01):
        super().__init__()
        self.bn = nn.BatchNorm2d(in_channels, momentum=momentum)
        self.layers = nn.ModuleList()
        for _ in range(n_encoders):
            self.layers.append(_ResEncoderBlock(in_channels, out_channels, kernel_size, n_blocks, momentum=momentum))
            in_channels, out_channels = out_channels, out_channels * 2
        self.out_channel = out_channels

    def forward(self, x):
        concat = []
        x = self.bn(x)
        for layer in self.layers:
            t, x = layer(x)
            concat.append(t)
        return x, concat


class _Intermediate(nn.Module):
    def __init__(self, in_channels, out_channels, n_inters, n_blocks, momentum=0.01):
        super().__init__()
        self.layers = nn.ModuleList([_ResEncoderBlock(in_channels, out_channels, None, n_blocks, momentum)]
                                    + [_ResEncoderBlock(out_channels, out_channels, None, n_blocks, momentum)
                                       for _ in range(n_inters - 1)])

    def forward(self, x):
        for layer in self.layers:
            x = layer(x)
        return x


class _ResDecoderBlock(nn.Module):
    def __init__(self, in_channels, out_channels, stride, n_blocks=1, momentum=0.01):
        super().__init__()
        out_padding = (0, 1) if stride == (1, 2) else (1, 1)
        self.conv1 = nn.Sequential(
            nn.ConvTranspose2d(in_channels, out_channels, (3, 3), stride, (1, 1), output_padding=out_padding,
                               bias=False),
            nn.BatchNorm2d(out_channels, momentum=momentum), nn.ReLU())
        self.conv2 = nn.ModuleList([_ConvBlockRes(out_channels * 2, out_channels, momentum)]
                                   + [_ConvBlockRes(out_channels, out_channels, momentum) for _ in range(n_blocks - 1)])

    def forward(self, x, concat_tensor):
        x = torch.cat((self.conv1(x), concat_tensor), dim=1)
        for conv in self.conv2:
            x = conv(x)
        return x


class _Decoder(nn.Module):
    def __init__(self, in_channels, n_decoders, stride, n_blocks, momentum=0.01):
        super().__init__()
        self.layers = nn.ModuleList()
        for _ in range(n_decoders):
            self.layers.append(_ResDecoderBlock(in_channels, in_channels // 2, stride, n_blocks, momentum))
            in_channels //= 2

    def forward(self, x, concat):
        for i, layer in enumerate(self.layers):
            x = layer(x, concat[-1 - i])
        return x


class _DeepUnet(nn.Module):
    def __init__(self, kernel_size, n_blocks, en_de_layers=5, inter_layers=4, in_channels=1, en_out_channels=16):
        super().__init__()
        self.encoder = _Encoder(in_channels, 128, en_de_layers, kernel_size, n_blocks, en_out_channels)
        self.intermediate = _Intermediate(self.encoder.out_channel // 2, self.encoder.out_channel, inter_layers,
                                          n_blocks)
        self.decoder = _Decoder(self.encoder.out_channel, en_de_layers, kernel_size, n_blocks)

    def forward(self, x):
        x, concat = self.encoder(x)
        return self.decoder(self.intermediate(x), concat)


class _BiGRU(nn.Module):
    def __init__(self, input_features, hidden_features, num_layers):
        super().__init__()
        self.gru = nn.GRU(input_features, hidden_features, num_layers=num_layers, batch_first=True, bidirectional=True)

    def forward(self, x):
        return self.gru(x)[0]


class E2E(nn.Module):
    """The RMVPE network (rmvpe.pt): log-mel spectrogram in, 360 pitch bins per 10 ms frame out."""

    def __init__(self, n_blocks=4, n_gru=1, kernel_size=(2, 2), en_de_layers=5, inter_layers=4, in_channels=1,
                 en_out_channels=16):
        super().__init__()
        self.unet = _DeepUnet(kernel_size, n_blocks, en_de_layers, inter_layers, in_channels, en_out_channels)
        self.cnn = nn.Conv2d(en_out_channels, 3, (3, 3), padding=(1, 1))
        self.fc = nn.Sequential(_BiGRU(3 * 128, 256, n_gru), nn.Linear(512, 360), nn.Dropout(0.25), nn.Sigmoid())

    def forward(self, mel):
        mel = mel.transpose(-1, -2).unsqueeze(1)
        x = self.cnn(self.unet(mel)).transpose(1, 2).flatten(-2)
        return self.fc(x)
