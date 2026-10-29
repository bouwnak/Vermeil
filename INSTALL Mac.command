#!/bin/bash
# Double-click me on a Mac to install Vermeil (the first time macOS may ask: right-click -> Open).
cd "$(dirname "$0")"
bash scripts/install.sh
echo
read -n 1 -s -r -p "Press any key to close this window."
