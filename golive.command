#!/bin/bash
# Double-click this file to put Constellation live on Cloudflare.
cd "$(dirname "$0")"
clear
echo "Constellation · go-live setup"
echo
if ! command -v node >/dev/null 2>&1; then
  echo "This needs Node.js, which isn't installed on this Mac yet."
  echo "Opening nodejs.org: download the LTS installer, run it, then double-click golive.command again."
  open "https://nodejs.org/en/download"
  read -n 1 -s -r -p "Press any key to close."
  exit 1
fi
echo "Installing the project's tools (first run takes a few minutes)…"
npm install --no-audit --no-fund --loglevel=error || { read -n 1 -s -r -p "Install failed. Press any key to close."; exit 1; }
echo
node scripts/golive.mjs
echo
read -n 1 -s -r -p "Press any key to close this window."
