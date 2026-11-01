#!/bin/bash
# Double-click once to back up this folder to the church's GitHub, then automatically every 3 hours.
cd "$(dirname "$0")"
DIR="$(pwd)"
echo "Constellation → GitHub backup setup"
echo

if ! xcode-select -p >/dev/null 2>&1; then
  echo "Git isn't installed yet. A window will offer to install Apple's command line tools. Click Install, then run this again."
  xcode-select --install; read -n1 -s -p "Press any key to close."; exit 1
fi

read -p "Paste the GitHub repo link (like https://github.com/northstar-church/constellation), then press Return: " URL
URL="${URL%/}"; URL="${URL%.git}"
[[ "$URL" =~ ^https://github\.com/[^/]+/[^/]+$ ]] || { echo "That doesn't look like a GitHub repo link."; read -n1 -s -p "Press any key to close."; exit 1; }
echo
echo "Now a GitHub access token, so the backup can send files without asking:"
echo "  github.com → your picture → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token"
echo "  Resource owner: the church account · Repository access: Only select repositories → this repo"
echo "  Permissions → Repository permissions → Contents: Read and write · Expiration: up to 1 year (put a reminder on your calendar)"
read -s -p "Paste the token, then press Return (it won't show): " TOKEN; echo
[ -n "$TOKEN" ] || { echo "No token entered."; read -n1 -s -p "Press any key to close."; exit 1; }

# Ask GitHub directly what this token can do with this repo, so any problem has a clear answer
REPO="${URL#https://github.com/}"
CODE=$(curl -s -o /tmp/cst-gh.json -w "%{http_code}" -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/$REPO")
PUSH=$(grep -o '"push": *[a-z]*' /tmp/cst-gh.json | head -1 | grep -o 'true\|false'); rm -f /tmp/cst-gh.json
fail() { echo; echo "✗ $*"; echo; read -n1 -s -p "Press any key to close."; exit 1; }
case "$CODE" in
  200) [ "$PUSH" = true ] || fail "The token can see $REPO but can't write to it. Edit the token → Repository permissions → Contents: Read and write.";;
  401) fail "GitHub says that token isn't valid (mistyped, expired or deleted). Copy it again, or make a new one.";;
  403) fail "GitHub blocked the token. The church's GitHub may need an owner to approve it: Organization settings → Personal access tokens → Pending requests.";;
  404) fail "The token can't see $REPO. Usually one of these:
   • The token is still waiting for approval by a church GitHub owner (Organization settings → Personal access tokens → Pending requests)
   • Resource owner was left on your personal account instead of northstar-church
   • The repo isn't picked under Repository access, or the link has a typo";;
  000) fail "Couldn't reach GitHub. Check the internet connection and try again.";;
  *) fail "GitHub answered $CODE. Try again in a minute.";;
esac
echo "✓ Token works for $REPO"

[ -d .git ] || git init -q -b main
git config user.name "Jeremy Thompson"
git config user.email "jeremy.thompson@northstarchurch.org"
git config credential.helper osxkeychain
# The user name in the link makes git use exactly this saved token, not any older GitHub sign-in on this Mac
git remote remove origin 2>/dev/null; git remote add origin "https://constellation-backup@github.com/$REPO.git"
printf "protocol=https\nhost=github.com\nusername=constellation-backup\n\n" | git credential-osxkeychain erase 2>/dev/null
printf "protocol=https\nhost=github.com\nusername=constellation-backup\npassword=%s\n\n" "$TOKEN" | git credential-osxkeychain store
unset TOKEN

if ! ERR=$(GIT_TERMINAL_PROMPT=0 git ls-remote origin 2>&1 >/dev/null); then
  fail "Git couldn't connect even though the token works: $ERR"
fi

# If the repo already has files (like a README), build on top of them
if [ -z "$(git rev-parse -q --verify HEAD)" ] && git fetch -q origin main 2>/dev/null; then
  git reset -q origin/main
  git ls-files -d -z | xargs -0 git checkout -- 2>/dev/null
fi

# Last check: never send secrets
git add -A
BAD=$(git diff --cached --name-only | grep -E '(^|/)(\.cf-token|\.release-key|\.env|\.dev\.vars|.*\.p8)$')
[ -z "$BAD" ] || { git reset -q; echo "✗ Stopped: these secret files would have been sent: $BAD"; read -n1 -s -p "Press any key to close."; exit 1; }
git reset -q

chmod +x scripts/github-sync.sh
echo "Sending the first copy (a minute or two)…"
if ! scripts/github-sync.sh; then
  echo "✗ The first upload didn't finish. Details: ~/Library/Logs/constellation-github.log"
  read -n1 -s -p "Press any key to close."; exit 1
fi
echo "✓ Constellation is on GitHub: $URL"

# Every 3 hours (and when you log in), save any changes
PL="$HOME/Library/LaunchAgents/org.northstarchurch.constellation-github.plist"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PL" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>org.northstarchurch.constellation-github</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$DIR/scripts/github-sync.sh</string></array>
  <key>StartInterval</key><integer>10800</integer>
  <key>RunAtLoad</key><true/>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
</dict></plist>
PLIST
launchctl bootout "gui/$(id -u)" "$PL" 2>/dev/null
launchctl bootstrap "gui/$(id -u)" "$PL" && echo "✓ Automatic backup is on: every 3 hours, only when something changed."
echo
echo "If macOS asks whether \"bash\" can access your Desktop folder, click Allow."
echo "To check it later: open Console → Log Reports → constellation-github.log"
read -n1 -s -p "Press any key to close."
