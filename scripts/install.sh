#!/usr/bin/env bash
# install.sh - sets Vermeil up on a Mac or a Linux laptop (Windows uses INSTALL.bat).
#   Mac:   double-click "INSTALL Mac.command" in the Vermeil folder
#   Linux: open a terminal in the Vermeil folder and run:  bash "INSTALL Linux.sh"
# 1. checks Python   2. makes a private Python folder (.venv) and installs the core packages
# 3. downloads her default voice   4. makes an empty env file for your keys
# 5. makes a "Start Vermeil" launcher   6. opens Vermeil on Settings -> Plugins
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
OS="$(uname -s)"
echo "=== Installing Vermeil in $ROOT ==="

# 1. Python 3.10+
PY=""
for c in python3.13 python3.12 python3.11 python3.10 python3; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then
    PY="$c"; break
  fi
done
if [ -z "$PY" ]; then
  if [ "$OS" = "Darwin" ]; then
    echo "Python 3.10 or newer isn't installed. Get Python 3.13 from https://www.python.org/downloads/macos/ , install it, then double-click INSTALL Mac.command again."
    open "https://www.python.org/downloads/macos/" || true
  else
    echo "Python 3.10 or newer isn't installed. Run:  sudo apt install python3 python3-venv python3-pip   (Ubuntu/Mint)  then run this again."
  fi
  exit 1
fi
echo "1/6  $($PY --version) found"

# Linux: the sound and window libraries come from the system
if [ "$OS" = "Linux" ] && command -v apt-get >/dev/null 2>&1; then
  if ! dpkg -s libportaudio2 >/dev/null 2>&1 || ! "$PY" -c 'import venv' 2>/dev/null; then
    echo "     Linux needs a few system parts (sound + window). Your password may be asked:"
    sudo apt-get install -y python3-venv libportaudio2 libsndfile1 libxcb-cursor0 || echo "     (couldn't install them - sound or the window may not work)"
  fi
fi

# 2. a private Python folder so nothing clashes with the system's Python
echo "2/6  Installing the core packages (a few minutes the first time)..."
[ -d .venv ] || "$PY" -m venv .venv
VPY="$ROOT/.venv/bin/python"
"$VPY" -m pip install --upgrade pip
CORE="requests pywebview numpy rapidfuzz vaderSentiment psutil pillow sounddevice soundfile piper-tts"
if [ "$OS" = "Linux" ]; then CORE="$CORE PyQt6 PyQt6-WebEngine qtpy"; fi      # the window on Linux
"$VPY" -m pip install $CORE || { echo "pip failed - check the internet connection and run the installer again."; exit 1; }

# 3. her default offline voice (Piper)
echo "3/6  Her voice..."
"$VPY" -c "import folders, tts, os; k='en_US-amy-medium'; p=os.path.join(tts.VOICES_DIR, k + '.onnx'); print('   already here') if os.path.exists(p) else tts.download_voice(k)" || echo "     (the voice will download on first start)"

# 4. env file for your keys
if [ ! -f env ] && [ ! -f .env ]; then
  cp env.example env 2>/dev/null || true
  echo "4/6  Made an empty 'env' file - open it with TextEdit / a text editor and paste your GROQ_API_KEY (and the others you use)."
else
  echo "4/6  env file already here"
fi

# 5. launcher
if [ "$OS" = "Darwin" ]; then
  cat > "Start Vermeil.command" <<EOF
#!/bin/bash
cd "$ROOT"
exec "$VPY" app.py
EOF
  chmod +x "Start Vermeil.command"
  ln -sf "$ROOT/Start Vermeil.command" "$HOME/Desktop/Start Vermeil.command" 2>/dev/null || true
  echo "5/6  Launcher: 'Start Vermeil' on your Desktop (and in the Vermeil folder)"
else
  cat > start-vermeil.sh <<EOF
#!/bin/bash
cd "$ROOT"
exec "$VPY" app.py
EOF
  chmod +x start-vermeil.sh
  mkdir -p "$HOME/.local/share/applications"
  cat > "$HOME/.local/share/applications/vermeil.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Vermeil
Comment=Your AI companion
Exec="$ROOT/start-vermeil.sh"
Icon=$ROOT/ui/vermeil.png
Path=$ROOT
Terminal=false
Categories=Utility;
EOF
  [ -d "$HOME/Desktop" ] && cp "$HOME/.local/share/applications/vermeil.desktop" "$HOME/Desktop/" && chmod +x "$HOME/Desktop/vermeil.desktop" || true
  echo "5/6  Launcher: 'Vermeil' in your apps menu (and on the Desktop)"
fi

# 6. start
echo "6/6  Starting Vermeil. Pick your features in Settings -> Plugins."
nohup "$VPY" app.py >/dev/null 2>&1 &
echo ""
echo "=== FINISHED! Vermeil is installed. ==="
echo "Open her any time with the Vermeil launcher. You can close this window now."
