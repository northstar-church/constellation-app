#!/bin/bash
# Double-click to connect Constellation's Event Calendar to eSpace (one time).
cd "$(dirname "$0")"
clear
echo "Constellation · connect eSpace"
echo
read -s -p "Paste the eSpace API key, then press Return (it won't show): " ESPACE_KEY
echo
ESPACE_KEY="$ESPACE_KEY" node scripts/espace.mjs
echo
read -n 1 -s -r -p "Press any key to close this window."
