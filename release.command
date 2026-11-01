#!/bin/bash
# Double-click to build a new version of the Constellation Mac app and send it to everyone.
cd "$(dirname "$0")"
clear
echo "Constellation · release a new version of the Mac app"
echo
pause() { echo; read -n 1 -s -r -p "Press any key to close this window."; exit "${1:-1}"; }

if ! xcrun --find notarytool >/dev/null 2>&1; then
  echo "This needs Apple's command line tools. A window will pop up to install them."
  echo "Click Install, wait for it to finish, then double-click release.command again."
  xcode-select --install 2>/dev/null
  pause
fi
if ! security find-identity -v -p codesigning | grep -q "Developer ID Application"; then
  echo "No \"Developer ID Application\" certificate found in your Keychain. Ask Claude for the steps."
  pause
fi
if ! xcrun notarytool history --keychain-profile constellation >/dev/null 2>&1; then
  KEY=$(ls AuthKey_*.p8 2>/dev/null | head -1)
  if [ -z "$KEY" ]; then echo "Put your AuthKey_….p8 file from App Store Connect in this folder, then try again."; pause; fi
  KEY_ID=$(basename "$KEY" .p8 | sed 's/AuthKey_//')
  read -p "Paste the Issuer ID (from the App Store Connect API page), then press Return: " ISSUER
  xcrun notarytool store-credentials constellation --key "$KEY" --key-id "$KEY_ID" --issuer "$ISSUER" || pause
fi
echo "✓ Signing and notarization ready"

# An old Constellation installer left open as a disk blocks building the new one; eject it.
for v in /Volumes/Constellation*; do
  [ -d "$v" ] && hdiutil detach "$v" -force >/dev/null 2>&1 && echo "✓ Ejected an open installer disk ($(basename "$v"))"
done
echo
npm install --no-audit --no-fund --loglevel=error || pause
node scripts/release.mjs || pause
open dist
pause 0
