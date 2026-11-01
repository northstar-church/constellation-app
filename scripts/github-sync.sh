#!/bin/bash
# Saves any changes in the Constellation folder to the church GitHub repo.
# Runs on its own every 3 hours (set up by github.command). Safe to run by hand too.
cd "$(dirname "$0")/.." || exit 1
export GIT_TERMINAL_PROMPT=0
LOG="$HOME/Library/Logs/constellation-github.log"
say() { echo "$(date '+%Y-%m-%d %H:%M') $*" >> "$LOG"; }
alert() { say "PROBLEM: $*"; osascript -e "display notification \"$*\" with title \"Constellation GitHub backup\"" >/dev/null 2>&1; }

[ -d .git ] || { alert "This folder isn't set up yet. Double-click github.command."; exit 1; }
if ! ls . >/dev/null 2>&1; then alert "macOS blocked access to the Desktop folder. See SETUP.md → GitHub backup."; exit 1; fi

git add -A >/dev/null 2>&1 || { alert "Couldn't read the folder (macOS may be blocking Desktop access)."; exit 1; }
if ! git diff --cached --quiet; then
  n=$(git diff --cached --name-only | wc -l | tr -d ' ')
  v=$(node -p "require('./package.json').version" 2>/dev/null || sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' package.json | head -1)
  git commit -q -m "Auto-sync $(date '+%b %-d, %Y %-I:%M %p') (v$v, $n files)" || { alert "Couldn't save a snapshot."; exit 1; }
fi

# Nothing to send?
git fetch -q origin 2>>"$LOG" || { alert "Couldn't reach GitHub. Will try again later."; exit 1; }
if git rev-parse -q --verify origin/main >/dev/null && [ "$(git rev-list --count origin/main..HEAD)" = 0 ]; then say "Up to date"; exit 0; fi

if ! git push -q origin HEAD:main 2>>"$LOG"; then
  # Someone changed something on GitHub: put our changes on top and try once more
  if git pull -q --rebase origin main 2>>"$LOG" && git push -q origin HEAD:main 2>>"$LOG"; then
    say "Pushed (after catching up with GitHub)"
  else
    git rebase --abort >/dev/null 2>&1
    alert "Couldn't send changes to GitHub. Check the log in Console → constellation-github.log."
    exit 1
  fi
else
  say "Pushed $(git log -1 --format=%s)"
fi
