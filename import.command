#!/bin/bash
# Double-click to copy the open Notion media requests into Constellation (safe to run again; nothing is duplicated).
cd "$(dirname "$0")"
clear
echo "Constellation · import open requests from Notion"
echo
export CLOUDFLARE_API_TOKEN="$(cat .cf-token)" CLOUDFLARE_ACCOUNT_ID="$(node -p "require('fs').readFileSync('wrangler.jsonc','utf8').match(/\"CF_ACCOUNT_ID\":\s*\"(\w+)\"/)[1]")" CI=1
npx wrangler d1 execute constellation --remote --file imports/notion-open.sql && echo && echo "✓ Imported. Switch to another section and back (or reopen Constellation) to see them."
echo
read -n 1 -s -r -p "Press any key to close this window."
