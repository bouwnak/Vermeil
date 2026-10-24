# setup_kokoro.ps1 - one-time setup for Vermeil's online voice (Kokoro), running INSIDE the app. No Docker.
#  1. installs the small "kokoro-onnx" Python package (it uses onnxruntime, which Piper already uses)
#  2. downloads the Kokoro model into tools\kokoro (skipped if it's already there)
# Run it from the project folder:  powershell -ExecutionPolicy Bypass -File scripts\setup_kokoro.ps1
# Add -Gpu to also install the NVIDIA GPU version of onnxruntime (optional - CPU is fast enough).
param([switch]$Gpu)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$dir = Join-Path $root "tools\kokoro"
New-Item -ItemType Directory -Force -Path $dir | Out-Null

Write-Host "1/2  Installing the kokoro-onnx package..." -ForegroundColor Cyan
python -m pip install --upgrade kokoro-onnx
if ($LASTEXITCODE -ne 0) { Write-Host "pip failed - is Python installed and on PATH?" -ForegroundColor Red; exit 1 }
if ($Gpu) { python -m pip install onnxruntime-gpu; Write-Host "Add ONNX_PROVIDER=CUDAExecutionProvider to your .env to use the GPU." }

Write-Host "2/2  Kokoro model files in $dir" -ForegroundColor Cyan
$base = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
foreach ($f in @("voices-v1.0.bin", "kokoro-v1.0.onnx")) {
    $out = Join-Path $dir $f
    if (Test-Path $out) { Write-Host "   $f - already there"; continue }
    Write-Host "   downloading $f (the model is about 310 MB)..."
    $ProgressPreference = "SilentlyContinue"
    Invoke-WebRequest -Uri "$base/$f" -OutFile "$out.part"
    Move-Item -Force "$out.part" $out
}

Write-Host "Testing..." -ForegroundColor Cyan
python senses\kokoro.py
Write-Host "Done! Start Vermeil normally - she uses Kokoro whenever the AI is online." -ForegroundColor Green
