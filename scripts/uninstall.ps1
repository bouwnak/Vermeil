# uninstall.ps1 - removes Vermeil from this PC. UNINSTALL.bat (next to the app) runs this.
# 1. closes Vermeil   2. keeps a backup of your saves + env keys (if you want)   3. removes the desktop shortcut
# 4. deletes the app folder. Python and its packages stay (other programs may use them).
# Install again later with Get-Vermeil.bat or INSTALL.bat from your Google Drive folder.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path "$root\app.py")) { Write-Host "This isn't a Vermeil folder: $root" -ForegroundColor Red; exit 1 }
Write-Host "=== Uninstall Vermeil from $root ===" -ForegroundColor Cyan
$ok = Read-Host "Type YES to uninstall"
if ($ok -ne "YES") { Write-Host "Nothing was removed."; exit 0 }

# 1. close Vermeil (the python that runs app.py from this folder)
Get-CimInstance Win32_Process -Filter "Name like 'python%'" | Where-Object { $_.CommandLine -like "*$root*app.py*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

# 2. a backup of your things, so a reinstall can bring them back
$keep = Read-Host "Keep a backup of your chats, characters, room and keys in Documents\Vermeil-backup? (Y/n)"
if ($keep -ne "n") {
    $backup = Join-Path ([Environment]::GetFolderPath("MyDocuments")) "Vermeil-backup"
    New-Item -ItemType Directory -Force $backup | Out-Null
    foreach ($f in @("env", ".env")) { if (Test-Path "$root\$f") { Copy-Item "$root\$f" $backup -Force } }
    if (Test-Path "$root\data") {
        Get-ChildItem "$root\data" -Force | Where-Object { $_.Name -notin @("piper_voices", "rvc_voices_cache", "games") } |
            Copy-Item -Destination $backup -Recurse -Force
    }
    Write-Host "Backup: $backup  (to restore: copy its files into the new Vermeil\data folder, and 'env' next to app.py)" -ForegroundColor Green
}

# 3. the desktop shortcut
$lnk = Join-Path ([Environment]::GetFolderPath("Desktop")) "Vermeil.lnk"
if (Test-Path $lnk) { Remove-Item $lnk -Force }

# 4. the app folder - deleted from a copy of this script in TEMP, because a folder can't delete itself while in use
$job = Join-Path $env:TEMP "vermeil_remove.ps1"
@"
Start-Sleep -Seconds 2
Remove-Item -LiteralPath '$($root -replace "'", "''")' -Recurse -Force -ErrorAction SilentlyContinue
if (Test-Path -LiteralPath '$($root -replace "'", "''")') { Write-Host 'Some files were in use - close Vermeil / File Explorer and delete the folder by hand.' } else { Write-Host 'Vermeil is uninstalled.' }
Start-Sleep -Seconds 4
"@ | Set-Content -Encoding utf8 $job
Set-Location $env:TEMP
Start-Process powershell -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$job`""
