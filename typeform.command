#!/bin/bash
# Double-click to connect the Media Request Typeform to Constellation.
cd "$(dirname "$0")"
clear
echo "Constellation · connect Typeform"
echo
read -s -p "Paste your Typeform personal token, then press Return (it won't show): " TF_TOKEN
echo
TF_TOKEN="$TF_TOKEN" node scripts/typeform.mjs
echo
read -n 1 -s -r -p "Press any key to close this window."
