# setup_ollama.ps1 - puts Ollama (the local/offline AI) INSIDE the project folder, like Kokoro: tools\ollama.
# After this, Vermeil starts it hidden in the background whenever she needs it and closes it when she exits -
# you never have to open the Ollama app again.
#   1. copies your installed Ollama program into tools\ollama (no download), or downloads it if it isn't installed
#   2. optionally MOVES your downloaded AI models (~/.ollama/models) into tools\ollama\models
# Run from the project folder:  scripts\setup_ollama.bat      (or: powershell -ExecutionPolicy Bypass -File scripts\setup_ollama.ps1)
param([switch]$MoveModels, [switch]$Download)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$dir = Join-Path $root "tools\ollama"
New-Item -ItemType Directory -Force -Path $dir | Out-Null

# 1. the program
$installed = Join-Path $env:LOCALAPPDATA "Programs\Ollama"
if (Test-Path (Join-Path $dir "ollama.exe")) {
    Write-Host "1/3  Ollama is already in tools\ollama" -ForegroundColor Green
} elseif ((Test-Path (Join-Path $installed "ollama.exe")) -and -not $Download) {
    Write-Host "1/3  Copying your installed Ollama into tools\ollama (no download needed)..." -ForegroundColor Cyan
    Get-ChildItem $installed | Where-Object { $_.Name -notlike "unins*" -and $_.Name -ne "ollama app.exe" } |
        Copy-Item -Destination $dir -Recurse -Force
} else {
    Write-Host "1/3  Downloading Ollama for Windows (about 1-2 GB, a few minutes)..." -ForegroundColor Cyan
    $zip = Join-Path $env:TEMP "ollama-windows-amd64.zip"
    $ProgressPreference = "SilentlyContinue"
    Invoke-WebRequest -Uri "https://github.com/ollama/ollama/releases/latest/download/ollama-windows-amd64.zip" -OutFile $zip
    Expand-Archive -Path $zip -DestinationPath $dir -Force
    Remove-Item $zip
}
if (-not (Test-Path (Join-Path $dir "ollama.exe"))) { Write-Host "ollama.exe isn't in tools\ollama - something went wrong." -ForegroundColor Red; exit 1 }

# 2. the models (optional: they're big)
$models = Join-Path $env:USERPROFILE ".ollama\models"
$target = Join-Path $dir "models"
if ((Test-Path (Join-Path $models "manifests")) -and -not (Test-Path (Join-Path $target "manifests"))) {
    $gb = [math]::Round(((Get-ChildItem $models -Recurse -File | Measure-Object Length -Sum).Sum / 1GB), 1)
    if (-not $MoveModels) {
        Write-Host ""
        Write-Host "Your AI models ($gb GB) are in $models." -ForegroundColor Yellow
        Write-Host "Vermeil can use them right where they are. Moving them into the project folder makes the folder"
        Write-Host "self-contained, BUT this project is in OneDrive: $gb GB will upload to the cloud and can fill a free"
        Write-Host "OneDrive plan (5 GB). Pause OneDrive first if you move them."
        $a = Read-Host "Move the models into tools\ollama\models? (y/N)"
        $MoveModels = $a -match "^[yY]"
    }
    if ($MoveModels) {
        Write-Host "2/3  Moving $gb GB of models..." -ForegroundColor Cyan
        robocopy $models $target /E /MOVE /NFL /NDL /NJH /NJS | Out-Null
        Write-Host "     Done. Models now live in tools\ollama\models"
    } else { Write-Host "2/3  Models stay in $models (Vermeil finds them there)." }
} else { Write-Host "2/3  Models: nothing to move." }

# 3. test: start it hidden, list the models, stop it
Write-Host "3/3  Testing..." -ForegroundColor Cyan
Push-Location $root
python -c "import folders, llm, time; llm.start_ollama(wait=20); print('   running:', llm.status()['running'], '| models:', ', '.join(llm.status()['installed']) or 'none yet (run: python scripts/setup_local.py)'); llm.stop_ollama()"
Pop-Location
Write-Host ""
Write-Host "Done! Vermeil now starts the local AI by herself (hidden) and closes it when you close her." -ForegroundColor Green
Write-Host "You can uninstall the Ollama app (Settings > Apps) and/or turn off 'Ollama' in Task Manager > Startup apps." -ForegroundColor Green
