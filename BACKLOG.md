# Constellation backlog

Ideas and parked work, roughly in the order they came up. Anything in the Mac app ships with release.command; server-only items ship with golive.command.

## New sections
- **Staff Event Calendar (parked)**: private-link calendar page for all staff (title, ministry, time, location), ministry color-coding in the app, event submissions approved by Jeremy or Stephanie with a Slack DM back. Built and previewed; code is on git branch `parked/staff-calendar`, waiting on the team's decision.
- **Auto-posting (Meta)**: account picker, Publish automatically and Publish now are in the app. Left: JT generates the system-user token and runs meta.command (church account); then build the publishing (scheduled + Publish now; images, carousels, Reels; Facebook Page; failures alert Sarah and JT). @northstar_kids is off the list until it's in the business portfolio. Add a second Meta app admin (Sarah) so nothing depends on one person.
- **Auto-posting (TikTok, YouTube)**: needs each platform's app audit before posts can be public; reminders until then.
- **Posting Calendar connections**: plan posts from Event Calendar events and Media Requests (delivered artwork attaches to posts).
- **Creative Studio follow-ups**: live cursors and comments on cards; start Posting Calendar posts from a brief's deliverables.

## Sign-in and accounts
- **Team spaces**: other ministries get their own spaces in Constellation.

## Media Requests
- **Files sent in Slack replies**: bring images/files a requester sends to the bot into the request (needs the files:read scope). For now they're asked to share a link.
- **Notion history**: optionally import the 707 Done requests (and their files) as Delivered, if an archive in Constellation becomes useful.

## Housekeeping
- **Old Cloudflare account (NorthStar Creative)**: cancel its Stream subscription about a week after the move (early November 2026). Keep the rest (backup + forwarding of old links) for about 6 months, then delete.
- **Reach and engagement in Reports**: once Meta is connected.

## Platforms
- **Windows version** (when the app is complete). Until then, the Windows teammate can use the web version at constellation.northstarchurch.org and install it from Edge/Chrome (menu → Install Constellation as an app).
  - App tweaks: Windows window controls instead of the Mac title bar; taskbar badge instead of the Dock badge.
  - Builds: GitHub Actions makes the Windows installer; release.command publishes Mac + Windows together, both auto-update.
  - Code signing decision: unsigned (one-time "Run anyway" warning), Azure Trusted Signing (~$10/mo, needs Microsoft org verification), or a code-signing certificate ($200–400/yr).
  - Testing: the Windows teammate tries a preview build before it goes out.
  - Fonts: confirm the Helvetica Neue license allows bundling for Windows, or use a free look-alike there.
- **GitHub backup (waiting on GitHub owner):** github.command and the 3-hourly sync are ready. Waiting for a northstar-church GitHub owner to allow/approve fine-grained tokens (Settings → Personal access tokens). Then make a token with Resource owner = northstar-church, only constellation-app, Contents: Read and write, and run github.command.

- **eSpace sync, later ideas:** hide specific recurring series (e.g. weekly Sunday programs) if the calendar feels busy; link Media Requests to eSpace events.
