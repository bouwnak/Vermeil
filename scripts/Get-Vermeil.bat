<# : Vermeil launcher - the batch part only starts PowerShell on this same file
@echo off
title Get Vermeil
powershell -NoProfile -ExecutionPolicy Bypass -Command "$f='%~f0'; iex ((Get-Content -LiteralPath $f) -join [char]10)"
pause
exit /b
#>
# Get-Vermeil.bat - the small file you send to another PC. Double-click it there and it:
#   1. downloads the Vermeil installer zip from your link (OneDrive, Google Drive, Dropbox or any direct link)
#   2. unzips it into Documents\Vermeil (running it again UPDATES the app and keeps your env keys, saves and plugins)
#   3. runs INSTALL.bat (Python, packages, voice, desktop shortcut)
# Make it with:  python scripts\package_app.py --url "<share link of the zip>"
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"            # the progress bar makes downloads 10x slower in Windows PowerShell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$url = "__VERMEIL_URL__"
$dest = Join-Path ([Environment]::GetFolderPath("MyDocuments")) "Vermeil"
Write-Host "=== Vermeil launcher ===" -ForegroundColor Cyan

if ($url -like "__*") { $url = Read-Host "Paste the download link of the Vermeil installer zip" }
# turn share links into direct downloads
if ($url -match "drive\.google\.com/.*(?:/d/|id=)([\w-]+)") { $url = "https://drive.usercontent.google.com/download?id=$($Matches[1])&export=download&confirm=t" }
elseif ($url -match "dropbox\.com") { $url = $url -replace "dl=0", "dl=1"; if ($url -notmatch "dl=1") { $url += $(if ($url -match "\?") { "&dl=1" } else { "?dl=1" }) } }
elseif ($url -match "1drv\.ms|onedrive\.live\.com|sharepoint\.com") { if ($url -notmatch "download=1") { $url += $(if ($url -match "\?") { "&download=1" } else { "?download=1" }) } }

$tmp = Join-Path $env:TEMP "vermeil_download"
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
New-Item -ItemType Directory $tmp | Out-Null
$zip = Join-Path $tmp "Vermeil.zip"
Write-Host "1/3  Downloading Vermeil (this can take a while for a big zip)..."
try { Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing }
catch { Write-Host "Download failed: $($_.Exception.Message)`nCheck the link is shared as 'Anyone with the link' and try again." -ForegroundColor Red; exit 1 }
$mb = [math]::Round((Get-Item $zip).Length / 1MB)
$fs = [IO.File]::OpenRead($zip); $b0 = $fs.ReadByte(); $b1 = $fs.ReadByte(); $fs.Close()
if ($b0 -ne 0x50 -or $b1 -ne 0x4B) {                 # every zip starts with "PK"
    Write-Host "That link gave a web page, not the zip ($mb MB). Share the zip as 'Anyone with the link can view' and use that link." -ForegroundColor Red; exit 1
}
Write-Host "     got $mb MB"

Write-Host "2/3  Unzipping into $dest ..."
Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
$src = Join-Path $tmp "Vermeil"
if (-not (Test-Path (Join-Path $src "app.py"))) { Write-Host "This zip isn't a Vermeil installer." -ForegroundColor Red; exit 1 }
$skip = @()
if (Test-Path (Join-Path $dest "data\plugins.json")) { $skip = @("/XF", (Join-Path $src "data\plugins.json")) }   # keep your plugin choices
robocopy $src $dest /E /NFL /NDL /NJH /NJS /NP @skip | Out-Null
if ($LASTEXITCODE -ge 8) { Write-Host "Copying the files failed (robocopy code $LASTEXITCODE)." -ForegroundColor Red; exit 1 }
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "3/3  Installing..."
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $dest "scripts\install.ps1")
