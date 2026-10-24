# setup_rvc.ps1 - one-time setup for RVC voice clones (Characters -> Voice clone).
#  1. downloads the two helper models into tools\rvc (skipped if they're already there):
#       vec-768-layer-12.onnx  (~360 MB)  ContentVec - hears WHAT is said
#       rmvpe.pt               (~173 MB)  RMVPE - hears the PITCH
#  2. installs faiss-cpu, so the voice's .index file can be used too (optional, makes the clone closer)
# Run it from the project folder:  powershell -ExecutionPolicy Bypass -File scripts\setup_rvc.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$dir = Join-Path $root "tools\rvc"
New-Item -ItemType Directory -Force -Path $dir | Out-Null

Write-Host "1/2  RVC helper models in $dir" -ForegroundColor Cyan
$files = @{
    "vec-768-layer-12.onnx" = "https://huggingface.co/NaruseMioShirakana/MoeSS-SUBModel/resolve/main/vec-768-layer-12.onnx";
    "rmvpe.pt"              = "https://huggingface.co/lj1995/VoiceConversionWebUI/resolve/main/rmvpe.pt"
}
foreach ($f in $files.Keys) {
    $out = Join-Path $dir $f
    if (Test-Path $out) { Write-Host "   $f - already there"; continue }
    Write-Host "   downloading $f (this can take a few minutes)..."
    # curl.exe (built into Windows 10/11) is much faster than Invoke-WebRequest and can continue a broken download
    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    if ($curl) {
        & $curl.Source -L --retry 3 -C - -o "$out.part" $files[$f]
        if ($LASTEXITCODE -ne 0) { throw "Download of $f failed - run this script again to continue it." }
    } else {
        $ProgressPreference = "SilentlyContinue"
        Invoke-WebRequest -Uri $files[$f] -OutFile "$out.part"
    }
    Move-Item -Force "$out.part" $out
}

Write-Host "2/2  Installing faiss-cpu (for .index files)..." -ForegroundColor Cyan
python -m pip install faiss-cpu
if ($LASTEXITCODE -ne 0) { Write-Host "faiss-cpu didn't install - voices still work, just without their .index." -ForegroundColor Yellow }

Write-Host "Testing..." -ForegroundColor Cyan
python senses\rvc.py
Write-Host "Done! Open Characters -> Voice clone (RVC) -> Import to add a voice." -ForegroundColor Green
