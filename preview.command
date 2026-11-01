#!/bin/bash
# Double-click to open a test copy of Constellation with sample data. It updates live as Claude changes files.
# Your installed Constellation and everyone's real data are untouched. Close this window to stop it.
cd "$(dirname "$0")"
clear
echo "Constellation · preview (sample data, not the real app)"
echo
npm install --no-audit --no-fund --loglevel=error || { read -n 1 -s -r -p "Install failed. Press any key to close."; exit 1; }
echo "Starting… the preview window opens in a few seconds. Leave this Terminal window open while you look around."
CONSTELLATION_PREVIEW=1 npx electron-vite dev
