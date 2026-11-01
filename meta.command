#!/bin/bash
# Double-click to connect Meta (Instagram + Facebook) so Constellation can publish posts on its own.
cd "$(dirname "$0")"
clear
echo "Constellation · connect Meta (Instagram + Facebook publishing)"
echo
echo "In Meta Business Suite: Settings → System users → Constellation → Generate token."
echo "Pick the Constellation app, expiration Never, and these permissions:"
echo "  instagram_basic, instagram_content_publish, pages_show_list,"
echo "  pages_read_engagement, pages_manage_posts, business_management"
echo
read -s -p "Paste the token, then press Return (it won't show): " META_TOKEN
echo
META_TOKEN="$META_TOKEN" node scripts/meta.mjs
echo
read -n 1 -s -r -p "Press any key to close this window."
