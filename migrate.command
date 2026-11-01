#!/bin/bash
# Double-click to move Constellation to the NorthStar Church Cloudflare account.
cd "$(dirname "$0")"
clear
echo "Constellation · move to the NorthStar Church Cloudflare account"
echo
echo "You'll paste two tokens from the church account (they won't show as you paste):"
echo "  1. The main token (Manage account → Account API tokens)"
echo "  2. The Stream token"
echo
read -s -p "1. Main token, then Return: " NEW_TOKEN
echo
read -s -p "2. Stream token, then Return: " STREAM_TOKEN
echo
echo
NEW_TOKEN="$NEW_TOKEN" STREAM_TOKEN="$STREAM_TOKEN" node scripts/migrate.mjs
echo
read -n 1 -s -r -p "Press any key to close this window."
