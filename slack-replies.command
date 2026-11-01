#!/bin/bash
# Double-click to let requesters reply to Constellation in Slack (one time).
cd "$(dirname "$0")"
clear
echo "Constellation · turn on Slack replies"
echo
read -s -p "Paste the Slack app's Signing Secret, then press Return (it won't show): " SIGNING_SECRET
echo
SIGNING_SECRET="$SIGNING_SECRET" node scripts/slack-replies.mjs
echo
read -n 1 -s -r -p "Press any key to close this window."
