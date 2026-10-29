@echo off
rem Sets up UniMate (text -> animation for rigged models) in tools\unimate.
rem Needs: Miniconda (https://docs.conda.io/en/latest/miniconda.html) and Git for Windows (https://git-scm.com).
rem It gets its own Python 3.10 environment called "unimate", so it can't break the app's Python.
rem Download size: about 2 GB (libraries + the checkpoint). The checkpoint is CC BY-NC (personal use only).
cd /d "%~dp0.."

where conda >nul 2>nul
if errorlevel 1 (
  echo Miniconda isn't installed, or isn't on PATH.
  echo Install it from https://docs.conda.io/en/latest/miniconda.html, then run this again from the "Anaconda Prompt".
  pause & exit /b 1
)
where git >nul 2>nul
if errorlevel 1 (
  echo Git for Windows isn't installed. Get it from https://git-scm.com and run this again.
  pause & exit /b 1
)

if not exist tools\unimate\unimate (
  echo [1/4] Downloading the UniMate code...
  git clone --depth 1 https://github.com/Friedrich-M/UniMate tools\unimate || (pause & exit /b 1)
)

call conda env list | findstr /b /c:"unimate " >nul
if errorlevel 1 (
  echo [2/4] Making the "unimate" Python 3.10 environment...
  call conda create -n unimate python=3.10 -y || (pause & exit /b 1)
)

echo [3/4] Installing UniMate's libraries (this is the long part)...
cd tools\unimate
call conda run --no-capture-output -n unimate python -m pip install "setuptools<81" || (pause & exit /b 1)
call conda run --no-capture-output -n unimate python -m pip install -r requirements.txt --no-build-isolation || (pause & exit /b 1)
call conda run --no-capture-output -n unimate python -m pip install -U "huggingface_hub[cli]"

echo [4/4] Downloading the UniMate checkpoint...
call conda run --no-capture-output -n unimate hf download Linzhan/UniMate --repo-type model --local-dir outputs ^
  --include "unimate_uniml3d_f60_v3/*.json" --include "unimate_uniml3d_f60_v3/*.npy" ^
  --include "unimate_uniml3d_f60_v3/checkpoints/checkpoint_step_150000.pt" || (pause & exit /b 1)
cd ..\..

echo.
echo UniMate is ready. In the app: edit a character, pick the model, press "Rig ^& animate".
pause
