#!/bin/bash
# Double-click to connect Constellation to Slack.
cd "$(dirname "$0")"
clear
echo "Constellation · connect Slack"
echo
read -s -p "Paste the Bot User OAuth Token (xoxb-…), then press Return (it won't show): " SLACK_BOT
echo
read -p "Paste the team channel ID (starts with C), or just press Return to skip: " SLACK_CHANNEL
SLACK_BOT="$SLACK_BOT" SLACK_CHANNEL="$SLACK_CHANNEL" node scripts/slack.mjs
echo
read -n 1 -s -r -p "Press any key to close this window."
