# install.ps1 - sets Vermeil up on a new PC. INSTALL.bat (next to the app) runs this; you can also run:
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1
# 1. checks Python   2. installs the core packages   3. downloads her default voice
# 4. makes an empty env file for your keys   5. desktop shortcut   6. opens Vermeil on Settings -> Plugins
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
Write-Host "=== Installing Vermeil in $root ===" -ForegroundColor Cyan

# 1. Python 3.10+
$py = Get-Command python -ErrorAction SilentlyContinue
if ($py -and $py.Source -like "*WindowsApps*") { $py = $null }     # the Microsoft Store "python" stub isn't real Python
if (-not $py -and (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Host "Python isn't installed - installing Python 3.13 for you..." -ForegroundColor Cyan
    & winget install -e --id Python.Python.3.13 --scope user --accept-package-agreements --accept-source-agreements
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "User") + ";" + [Environment]::GetEnvironmentVariable("Path", "Machine")
    $py = Get-Command python -ErrorAction SilentlyContinue
    if ($py -and $py.Source -like "*WindowsApps*") { $py = $null }
}
if (-not $py) {
    Write-Host "Python isn't installed. Get Python 3.13 from https://www.python.org/downloads/ - tick 'Add python.exe to PATH' - then run INSTALL.bat again." -ForegroundColor Red
    Start-Process "https://www.python.org/downloads/"
    exit 1
}
$ver = & python -c "import sys; print('%d.%d' % sys.version_info[:2])"
Write-Host "1/6  Python $ver found"

# 2. core packages (features are installed later from Settings -> Plugins)
Write-Host "2/6  Installing the core packages (a few minutes the first time)..." -ForegroundColor Cyan
& python -m pip install --upgrade pip
& python -m pip install requests pywebview numpy rapidfuzz vaderSentiment keyboard psutil pillow winotify sounddevice soundfile piper-tts pycaw comtypes
if ($LASTEXITCODE -ne 0) { Write-Host "pip failed - check the internet connection and run INSTALL.bat again." -ForegroundColor Red; exit 1 }

# 3. her default offline voice (Piper)
Write-Host "3/6  Her voice..." -ForegroundColor Cyan
& python -c "import folders, tts, os; k='en_US-amy-medium'; p=os.path.join(tts.VOICES_DIR, k + '.onnx'); print('   already here') if os.path.exists(p) else tts.download_voice(k)"

# 4. env file for your keys (never copied from the old PC)
if (-not (Test-Path "$root\env") -and -not (Test-Path "$root\.env")) {
    Copy-Item "$root\env.example" "$root\env" -ErrorAction SilentlyContinue
    Write-Host "4/6  Made an empty 'env' file - open it with Notepad and paste your GROQ_API_KEY (and the others you use)." -ForegroundColor Yellow
} else { Write-Host "4/6  env file already here" }

# 5. desktop shortcut (runs without a console window)
$pyw = Join-Path (Split-Path (Get-Command python).Source) "pythonw.exe"
if (-not (Test-Path $pyw)) { $pyw = (Get-Command python).Source }
$lnk = Join-Path ([Environment]::GetFolderPath("Desktop")) "Vermeil.lnk"
$sh = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
$sh.TargetPath = $pyw
$sh.Arguments = "`"$root\app.py`""
$sh.WorkingDirectory = $root
$sh.Save()
Write-Host "5/6  Desktop shortcut: Vermeil"

# 6. start - she opens on Settings -> Plugins so you can pick your features
Write-Host "6/6  Starting Vermeil. Pick your features in Settings -> Plugins." -ForegroundColor Green
Start-Process $pyw -ArgumentList "`"$root\app.py`"" -WorkingDirectory $root
