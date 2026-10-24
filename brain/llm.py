"""
llm.py - the AI connection. Groq (online, fast) is the main AI; Ollama (on YOUR computer) is the automatic backup.

How the automatic switch works ("auto" mode, the default):
  1. Every request goes to Groq first (needs GROQ_API_KEY in .env / env).
  2. If Groq says the tokens / rate limit are used up (error 429), or Groq can't be reached,
     the SAME request is sent to Ollama, so you still get a reply.
  3. Groq tells us when it's available again ("try again in 13m36s"); until then everything goes
     straight to Ollama, then it switches back to Groq by itself.
Modes (Settings → AI, saved in data/local_models.json "provider"): auto | groq | local

Ollama: free app from https://ollama.com. setup_local.py installs the right models for your PC.

It looks like the old Groq client, so the rest of the code didn't need to change much:
    client = llm.get_client()
    r = client.chat.completions.create(model="chat", messages=[...], tools=[...])
    r.choices[0].message.content / .tool_calls

Model names can be roles, picked in data/local_models.json (written by setup_local.py):
    "chat"   - everyday talking + using tools (fast)
    "smart"  - studying, research, think tools, coding helper (bigger)
    "vision" - looking through the camera / at the screen
"""
import json
import os
import re
import uuid
from types import SimpleNamespace

import requests

from paths import data_file

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
MODELS_FILE = data_file("local_models.json")
DEFAULT_MODELS = {"chat": "qwen3:8b", "smart": "qwen3:8b", "vision": "qwen2.5vl:7b"}
TIMEOUT = int(os.environ.get("LLM_TIMEOUT", "300"))       # local models can be slow on the first call


class LocalAIError(RuntimeError):
    pass


def models():
    try:
        with open(MODELS_FILE, encoding="utf-8") as f:
            saved = json.load(f)
    except (OSError, json.JSONDecodeError):
        saved = {}
    # only the AI model roles - the file also stores other settings (whisper size, setup size, cpu_only)
    m = {**DEFAULT_MODELS, **{k: v for k, v in saved.items() if k in DEFAULT_MODELS and isinstance(v, str) and v}}
    for role in DEFAULT_MODELS:                        # .env can override: CHAT_MODEL=qwen3:4b
        m[role] = os.environ.get(f"{role.upper()}_MODEL", m[role])
    return m


def _saved():
    try:
        with open(MODELS_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}


def cpu_only():
    """True = don't use the graphics card (set automatically if it crashes, or LLM_CPU_ONLY=1 in .env)."""
    return os.environ.get("LLM_CPU_ONLY") == "1" or bool(_saved().get("cpu_only"))


def set_cpu_only(on):
    data = _saved()
    data["cpu_only"] = bool(on)
    try:
        with open(MODELS_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    except OSError:
        pass


def resolve(model):
    m = models()
    return m.get(model, model or m["chat"])


def status():
    """{'running': bool, 'installed': [...], 'missing': [...], 'models': {...}}"""
    want = models()
    try:
        r = requests.get(f"{OLLAMA_URL}/api/tags", timeout=3)
        r.raise_for_status()
        installed = [m["name"] for m in r.json().get("models", [])]
    except Exception:
        return {"running": False, "installed": [], "missing": sorted(set(want.values())), "models": want}
    have = set(installed) | {n.removesuffix(":latest") for n in installed}
    return {"running": True, "installed": installed, "models": want,
            "missing": sorted({v for v in want.values() if v not in have and f"{v}:latest" not in have})}


# Ollama inside the project folder (like Kokoro): tools/ollama/ollama.exe, models in tools/ollama/models.
# scripts\setup_ollama.bat puts it there. Vermeil starts it hidden when she needs it and closes it when she exits,
# so the Ollama app never has to be opened. A normal Ollama install still works as a fallback.
PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUNDLED_OLLAMA = os.path.join(PROJECT, "tools", "ollama", "ollama.exe")
BUNDLED_MODELS = os.path.join(PROJECT, "tools", "ollama", "models")
_server = None                 # the 'ollama serve' process Vermeil started (stopped again by stop_ollama)


def ollama_exe():
    import shutil
    for p in (os.environ.get("OLLAMA_EXE"), BUNDLED_OLLAMA):
        if p and os.path.exists(p):
            return p
    return shutil.which("ollama") or next((p for p in (os.path.expandvars(r"%LOCALAPPDATA%\Programs\Ollama\ollama.exe"),
                                                       r"C:\Program Files\Ollama\ollama.exe") if os.path.exists(p)), None)


def ollama_env():
    """the environment for 'ollama serve' / 'ollama pull'. Models live in tools/ollama/models when they're there already,
    or on a fresh PC using the bundled Ollama; models you downloaded before (~/.ollama/models) keep working where they are."""
    env = dict(os.environ)
    old = os.path.join(os.path.expanduser("~"), ".ollama", "models", "manifests")
    if not env.get("OLLAMA_MODELS") and (os.path.isdir(os.path.join(BUNDLED_MODELS, "manifests")) or
                                         (os.path.exists(BUNDLED_OLLAMA) and not os.path.isdir(old))):
        os.makedirs(BUNDLED_MODELS, exist_ok=True)
        env["OLLAMA_MODELS"] = BUNDLED_MODELS
    env.setdefault("OLLAMA_HOST", OLLAMA_URL.split("//", 1)[-1])
    return env


def start_ollama(wait=0):
    """Start Ollama hidden in the background if it isn't running. wait = seconds to wait until it answers."""
    import subprocess
    import sys
    import time as _t
    global _server
    if status()["running"]:
        return True
    exe = ollama_exe()
    if not exe:
        return False
    if _server is None or _server.poll() is not None:
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if sys.platform == "win32" else 0
        _server = subprocess.Popen([exe, "serve"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=flags,
                                   env=ollama_env(), cwd=os.path.dirname(exe))
        print(f"[AI] started the local AI in the background ({exe})")
    end = _t.time() + wait
    while _t.time() < end:
        if status()["running"]:
            return True
        _t.sleep(0.5)
    return True


def stop_ollama():
    """Close the Ollama server Vermeil started (one you started yourself is left alone)."""
    global _server
    if _server is not None and _server.poll() is None:
        try:
            _server.terminate()
            _server.wait(timeout=5)
        except Exception:
            try:
                _server.kill()
            except Exception:
                pass
    _server = None


# ------------------------------------------------------------------ OpenAI-style messages -> Ollama
def _to_ollama(messages):
    out = []
    for m in messages:
        m = dict(m)
        role, content = m.get("role"), m.get("content")
        msg = {"role": role, "content": ""}
        if isinstance(content, list):                       # text + images
            texts, images = [], []
            for part in content:
                if part.get("type") == "text":
                    texts.append(part.get("text", ""))
                elif part.get("type") == "image_url":
                    url = part["image_url"]["url"] if isinstance(part.get("image_url"), dict) else part.get("image_url", "")
                    images.append(url.split(",", 1)[1] if url.startswith("data:") else url)
            msg["content"] = "\n".join(texts)
            if images:
                msg["images"] = images
        else:
            msg["content"] = content or ""
        if m.get("tool_calls"):
            msg["tool_calls"] = []
            for c in m["tool_calls"]:
                fn = c["function"] if isinstance(c, dict) else c.function
                name = fn["name"] if isinstance(fn, dict) else fn.name
                args = fn["arguments"] if isinstance(fn, dict) else fn.arguments
                if isinstance(args, str):
                    try:
                        args = json.loads(args or "{}")
                    except json.JSONDecodeError:
                        args = {}
                msg["tool_calls"].append({"function": {"name": name, "arguments": args}})
        if role == "tool":
            msg["tool_name"] = m.get("name", "")
        out.append(msg)
    return out


_THINK = re.compile(r"<think>.*?</think>\s*", re.S)


class _ThinkFilter:
    """Hides <think>...</think> while text streams in piece by piece."""
    def __init__(self, on_text):
        self.on_text, self.inside, self.buf = on_text, False, ""

    def feed(self, piece):
        self.buf += piece or ""
        out = ""
        while self.buf:
            if self.inside:
                end = self.buf.find("</think>")
                if end < 0:
                    self.buf = self.buf[-8:]
                    break
                self.buf, self.inside = self.buf[end + 8:].lstrip(), False
            else:
                start = self.buf.find("<think>")
                if start < 0:
                    keep = 7 if "<" in self.buf[-7:] else 0          # maybe the start of a tag
                    out += self.buf[:len(self.buf) - keep] if keep else self.buf
                    self.buf = self.buf[len(self.buf) - keep:] if keep else ""
                    break
                out += self.buf[:start]
                self.buf, self.inside = self.buf[start + 7:], True
        if out and self.on_text:
            self.on_text(out)
        return out

    def flush(self):
        rest, self.buf = ("" if self.inside else self.buf), ""
        if rest and self.on_text:
            self.on_text(rest)
        return rest


def _from_ollama(data):
    msg = data.get("message", {})
    calls = []
    for c in msg.get("tool_calls") or []:
        fn = c.get("function", {})
        args = fn.get("arguments", {})
        calls.append(SimpleNamespace(id=f"call_{uuid.uuid4().hex[:8]}", type="function",
                                     function=SimpleNamespace(name=fn.get("name", ""),
                                                              arguments=args if isinstance(args, str) else json.dumps(args))))
    content = _THINK.sub("", msg.get("content") or "").strip()
    message = SimpleNamespace(role="assistant", content=content, tool_calls=calls or None)
    return SimpleNamespace(choices=[SimpleNamespace(message=message, finish_reason=data.get("done_reason"))],
                           model=data.get("model"))


def _ollama_stream(r, on_text):
    """Read Ollama's streamed answer line by line; hand the text out as it arrives."""
    filt = _ThinkFilter(on_text)
    content, calls, last = [], [], {}
    for line in r.iter_lines():
        if not line:
            continue
        chunk = json.loads(line)
        msg = chunk.get("message") or {}
        if msg.get("content"):
            content.append(filt.feed(msg["content"]))
        calls += msg.get("tool_calls") or []
        last = chunk
        if chunk.get("done"):
            break
    content.append(filt.flush())
    return _from_ollama({"message": {"content": "".join(content), "tool_calls": calls},
                         "done_reason": last.get("done_reason"), "model": last.get("model")})


def _ollama_create(model=None, messages=None, tools=None, tool_choice=None, response_format=None,
                   temperature=None, max_tokens=None, think=False, on_text=None, **_ignored):
    stream = bool(on_text) and not response_format
    body = {"model": resolve(model), "messages": _to_ollama(messages or []), "stream": stream,
            "think": bool(think), "keep_alive": "30m", "options": {}}
    if tools and tool_choice != "none":
        body["tools"] = [t for t in tools if t.get("type") == "function"]
        if not body["tools"]:
            body.pop("tools")
    if response_format and response_format.get("type") == "json_object":
        body["format"] = "json"
    if temperature is not None:
        body["options"]["temperature"] = temperature
    if max_tokens:
        body["options"]["num_predict"] = max_tokens
    body["options"].setdefault("num_ctx", int(os.environ.get("LLM_CONTEXT", "8192")))
    if cpu_only():
        body["options"]["num_gpu"] = 0                 # 0 layers on the graphics card = CPU only
    try:
        r = requests.post(f"{OLLAMA_URL}/api/chat", json=body, timeout=TIMEOUT, stream=stream)
    except requests.ConnectionError:
        # not running: start it ourselves (hidden) and try once more
        if not (start_ollama(wait=20) and status()["running"]):
            raise LocalAIError("The local AI (Ollama) couldn't start. Run scripts\\setup_ollama.bat once to put it in the "
                               "tools\\ollama folder.")
        r = requests.post(f"{OLLAMA_URL}/api/chat", json=body, timeout=TIMEOUT, stream=stream)
    if r.status_code == 404:
        raise LocalAIError(f"The model '{body['model']}' isn't installed yet. Run: python scripts/setup_local.py")
    if r.status_code == 400 and "think" in r.text:            # model without thinking support
        body.pop("think")
        r = requests.post(f"{OLLAMA_URL}/api/chat", json=body, timeout=TIMEOUT, stream=stream)
    if r.status_code == 400 and "tools" in r.text and "tools" in body:   # model without tool support
        body.pop("tools")
        r = requests.post(f"{OLLAMA_URL}/api/chat", json=body, timeout=TIMEOUT, stream=stream)
    if r.status_code == 500 and re.search(r"CUDA|cuda|GPU|0xc0000409", r.text) and body["options"].get("num_gpu") != 0:
        print("[AI] The graphics card crashed Ollama - running on the CPU instead (slower). "
              "Updating your NVIDIA driver usually fixes this.")
        set_cpu_only(True)
        body["options"]["num_gpu"] = 0
        r = requests.post(f"{OLLAMA_URL}/api/chat", json=body, timeout=TIMEOUT, stream=stream)
    if not r.ok:
        raise LocalAIError(f"Local AI error {r.status_code}: {r.text[:300]}")
    if stream:
        return _ollama_stream(r, on_text)
    return _from_ollama(r.json())


# ====================================================================== Groq (main AI)
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODELS = {"chat": "openai/gpt-oss-20b", "smart": "openai/gpt-oss-120b",
               "vision": "qwen/qwen3.8-27b"}
PROVIDERS = ("auto", "groq", "local")


class GroqLimitError(RuntimeError):
    """Groq's tokens / rate limit are used up for now."""
    def __init__(self, msg, wait_seconds):
        super().__init__(msg)
        self.wait_seconds = wait_seconds


class GroqError(RuntimeError):
    pass


_state = {"groq_blocked_until": 0.0, "last": "", "reason": "", "bad_key": False}
on_switch = None          # app.py: function(text) - tells the window when the AI switches


def provider():
    p = os.environ.get("AI_PROVIDER") or _saved().get("provider") or "auto"
    return p if p in PROVIDERS else "auto"


def set_provider(p):
    if p not in PROVIDERS:
        return False
    data = _saved()
    data["provider"] = p
    with open(MODELS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    if p != "local":
        _state["groq_blocked_until"] = 0.0      # give Groq a fresh try
        _state["bad_key"] = False
    return True


def groq_models():
    saved = _saved().get("groq", {}) if isinstance(_saved().get("groq"), dict) else {}
    m = {**GROQ_MODELS, **{k: v for k, v in saved.items() if k in GROQ_MODELS and isinstance(v, str) and v}}
    for role in GROQ_MODELS:                      # .env can override: GROQ_CHAT_MODEL=...
        m[role] = os.environ.get(f"GROQ_{role.upper()}_MODEL", m[role])
    return m


def groq_key():
    return os.environ.get("GROQ_API_KEY", "").strip()


def _wait_seconds(text, headers):
    """'Please try again in 13m36.048s' / '2.5s' / '1h2m' / retry-after header -> seconds."""
    m = re.search(r"try again in\s*((?:\d+(?:\.\d+)?[hms]\s*)+)", text or "")
    if m:
        total = 0.0
        for num, unit in re.findall(r"(\d+(?:\.\d+)?)([hms])", m.group(1)):
            total += float(num) * {"h": 3600, "m": 60, "s": 1}[unit]
        return max(total, 1.0)
    try:
        return max(float((headers or {}).get("retry-after", 60)), 1.0)
    except ValueError:
        return 60.0


def _ns(obj):
    """JSON dicts -> objects with attributes (like the official SDK returns)."""
    if isinstance(obj, dict):
        return SimpleNamespace(**{k: _ns(v) for k, v in obj.items()})
    if isinstance(obj, list):
        return [_ns(v) for v in obj]
    return obj


_THINK_GROQ = re.compile(r"<think>.*?</think>\s*", re.S)


def _groq_stream(r, on_text):
    """Read Groq's server-sent events; text goes to on_text as it arrives, tool calls are put together."""
    filt = _ThinkFilter(on_text)
    content, calls, finish, model = [], {}, None, None
    for raw in r.iter_lines():
        line = raw.decode("utf-8", "replace") if isinstance(raw, bytes) else raw
        if not line.startswith("data:"):
            continue
        data = line[5:].strip()
        if data == "[DONE]":
            break
        chunk = json.loads(data)
        model = chunk.get("model", model)
        if chunk.get("error"):
            raise GroqError(str(chunk["error"])[:300])
        for ch in chunk.get("choices") or []:
            delta = ch.get("delta") or {}
            if delta.get("content"):
                content.append(filt.feed(delta["content"]))
            for tc in delta.get("tool_calls") or []:
                c = calls.setdefault(tc.get("index", 0), {"id": None, "name": "", "arguments": ""})
                c["id"] = tc.get("id") or c["id"]
                fn = tc.get("function") or {}
                c["name"] += fn.get("name") or ""
                c["arguments"] += fn.get("arguments") or ""
            finish = ch.get("finish_reason") or finish
    content.append(filt.flush())
    tool_calls = [SimpleNamespace(id=c["id"] or f"call_{uuid.uuid4().hex[:8]}", type="function",
                                  function=SimpleNamespace(name=c["name"], arguments=c["arguments"] or "{}"))
                  for _, c in sorted(calls.items())]
    message = SimpleNamespace(role="assistant", content="".join(content).strip(), tool_calls=tool_calls or None)
    return SimpleNamespace(choices=[SimpleNamespace(message=message, finish_reason=finish)], model=model, usage=None)


def _groq_create(model=None, messages=None, tools=None, tool_choice=None, response_format=None,
                 temperature=None, max_tokens=None, on_text=None, **_ignored):
    stream = bool(on_text) and not response_format
    key = groq_key()
    if not key:
        raise GroqError("No GROQ_API_KEY in the .env file.")
    name = groq_models().get(model, model if model and "/" in model else groq_models()["chat"])
    clean = []
    for m in messages or []:
        m = dict(m)
        if m.get("tool_calls"):
            m["tool_calls"] = [c if isinstance(c, dict) else
                               {"id": c.id, "type": "function", "function": {"name": c.function.name, "arguments": c.function.arguments}}
                               for c in m["tool_calls"]]
        clean.append(m)
    body = {"model": name, "messages": clean}
    if tools and tool_choice != "none":
        fn_tools = [t for t in tools if t.get("type") == "function"]
        if fn_tools:
            body["tools"], body["tool_choice"] = fn_tools, tool_choice or "auto"
    if response_format:
        body["response_format"] = response_format
    if temperature is not None:
        body["temperature"] = temperature
    if max_tokens:
        body["max_completion_tokens"] = max_tokens
    if name.startswith("openai/gpt-oss"):
        body["reasoning_effort"] = "low"
    if stream:
        body["stream"] = True
    try:
        r = requests.post(GROQ_URL, json=body, timeout=60, headers={"Authorization": f"Bearer {key}"}, stream=stream)
    except requests.RequestException as e:
        raise GroqError(f"Can't reach Groq ({e.__class__.__name__}) - are you online?")
    if r.status_code == 429:
        raise GroqLimitError(r.text[:300], _wait_seconds(r.text, r.headers))
    if r.status_code in (401, 403):
        _state["bad_key"] = True
        raise GroqError("Groq rejected the API key (check GROQ_API_KEY in .env).")
    if not r.ok:
        raise GroqError(f"Groq error {r.status_code}: {r.text[:300]}")
    if stream:
        return _groq_stream(r, on_text)
    data = r.json()
    msg = data["choices"][0]["message"]
    content = _THINK_GROQ.sub("", msg.get("content") or "").strip()
    calls = [SimpleNamespace(id=c.get("id") or f"call_{uuid.uuid4().hex[:8]}", type="function",
                             function=SimpleNamespace(name=c["function"]["name"], arguments=c["function"].get("arguments") or "{}"))
             for c in msg.get("tool_calls") or []]
    message = SimpleNamespace(role="assistant", content=content, tool_calls=calls or None)
    return SimpleNamespace(choices=[SimpleNamespace(message=message, finish_reason=data["choices"][0].get("finish_reason"))],
                           model=data.get("model"), usage=_ns(data.get("usage", {})))


# ====================================================================== the automatic switch
def _announce(text):
    print(f"[AI] {text}")
    if on_switch:
        try:
            on_switch(text)
        except Exception:
            pass


def _use(name, reason=""):
    if _state["last"] != name:
        if name == "local" and _state["last"] == "groq":
            _announce(f"Switched to the local AI (Ollama){': ' + reason if reason else ''}.")
        elif name == "groq" and _state["last"] == "local":
            _announce("Groq is available again - switched back to Groq.")
    _state["last"], _state["reason"] = name, reason


def groq_available():
    import time
    return (provider() != "local" and bool(groq_key()) and not _state["bad_key"]
            and time.time() >= _state["groq_blocked_until"])


def _create(**kw):
    import time
    mode = provider()
    if mode != "local" and groq_available():
        try:
            r = _groq_create(**kw)
            _use("groq")
            return r
        except GroqLimitError as e:
            _state["groq_blocked_until"] = time.time() + e.wait_seconds
            back = time.strftime("%I:%M %p", time.localtime(_state["groq_blocked_until"])).lstrip("0")
            reason = f"Groq's tokens ran out, back at {back}"
            if mode == "groq":
                raise GroqError(f"{reason}. (Mode is 'Groq only' - switch to Auto in Settings to use the local AI.)")
            _use("local", reason)
        except GroqError as e:
            if mode == "groq":
                raise
            _use("local", str(e).split(" (")[0])
    elif mode == "groq":
        if not groq_key():
            raise GroqError("No GROQ_API_KEY in the .env file.")
        wait = max(0, _state["groq_blocked_until"] - time.time())
        raise GroqError(f"Groq's tokens ran out. Try again in {int(wait // 60)} min, or switch to Auto in Settings.")
    else:
        _use("local", _state["reason"] if mode == "auto" else "")
    return _ollama_create(**kw)


def which():
    """For the status display: which AI answers right now, and why."""
    import time
    if groq_available():
        return {"now": "groq", "reason": ""}
    if provider() == "local":
        return {"now": "local", "reason": "Local only (set in Settings)"}
    if not groq_key():
        return {"now": "local", "reason": "No GROQ_API_KEY in .env"}
    if _state["bad_key"]:
        return {"now": "local", "reason": "Groq rejected the API key"}
    back = time.strftime("%I:%M %p", time.localtime(_state["groq_blocked_until"])).lstrip("0")
    return {"now": "local", "reason": f"Groq's tokens ran out - switching back at {back}", "back_at": _state["groq_blocked_until"]}


class _Completions:
    def create(self, **kw):
        return _create(**kw)


class LocalClient:
    def __init__(self):
        self.chat = SimpleNamespace(completions=_Completions())


_client = None


def get_client():
    global _client
    if _client is None:
        _client = LocalClient()
    return _client


def ask(prompt, model="smart", json_mode=False, temperature=None):
    """One question -> one answer (text, or a dict when json_mode)."""
    r = get_client().chat.completions.create(model=model, messages=[{"role": "user", "content": prompt}],
                                             response_format={"type": "json_object"} if json_mode else None,
                                             temperature=temperature)
    text = r.choices[0].message.content
    return json.loads(text) if json_mode else text
