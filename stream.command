#!/bin/bash
# Double-click to turn on video playback for Video Review (Cloudflare Stream).
cd "$(dirname "$0")"
clear
echo "Constellation · connect Cloudflare Stream (Video Review)"
echo
read -s -p "Paste the Stream API token, then press Return (it won't show): " STREAM_TOKEN
echo
STREAM_TOKEN="$STREAM_TOKEN" node scripts/stream.mjs
echo
read -n 1 -s -r -p "Press any key to close this window."
