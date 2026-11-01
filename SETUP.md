# Constellation: setup

Constellation is an installed Mac app. All of its screens ship inside the app; the church's Cloudflare account only stores and relays the **shared** data (Event Calendar now; briefs, storyboards and video review later):

| Piece | Cloudflare service |
|---|---|
| Shared data API, live updates, subscribe feeds | Worker (`constellation`) |
| Calendar data | D1 database (`constellation`) |
| Live updates between teammates | Durable Object (`LiveHub`) |
| Sign-in (codes by Slack DM) | Built into Constellation (team list in the app) |

Cost: the free plans cover a team this size. Video review (later) will add Cloudflare Stream usage.

You need Node.js 20+ on your Mac. Run commands from the project folder.

---

## 1. Install and sign in to Cloudflare (once)

```bash
npm install
npx wrangler login          # opens a browser, approve access to the church account
```

## 2. Create the database

```bash
npx wrangler d1 create constellation
```

Copy the `database_id` it prints into `wrangler.jsonc` (replace the `0000…` value), then:

```bash
npm run db:migrate
```

## 3. Deploy

```bash
npm run deploy
```

Then in the Cloudflare dashboard: **Workers & Pages → constellation → Settings → Domains & Routes → Add → Custom domain**, and enter e.g. `constellation.northstarchurch.org`. (The domain must be managed in this Cloudflare account. If it isn't, use the `*.workers.dev` address for now.)

## 4. Sign-in

Constellation has its own sign-in screen: people enter their church email and get a 6-digit code as a Slack DM from the Constellation bot (so they need to be in Slack under that email). They stay signed in for a year, renewing while they use it. Nothing to set up in Cloudflare; release.command switches off any old Cloudflare Access sign-in in front of the app.

Check it: open `https://constellation.northstarchurch.org/api/me` in a browser. You should get the sign-in screen, then a line showing your name and email.

(The same address also serves a browser version of the app, handy on a borrowed computer. The Mac app doesn't need it.)

> Never set `DEV_USER_EMAIL` on the deployed Worker; it's only for local testing.

## Media requests: Slack and Typeform

Ministry leaders keep using the Typeform. Each submission lands on the **Media Requests** board, the leader gets a Slack DM with a link to their tracker, and every stage change, note and proof updates them in that DM thread.

### Slack app (once, about 5 minutes; you need to be a Slack admin)

1. Go to **api.slack.com/apps → Create New App → From an app manifest**, pick the NorthStar workspace, and paste:

   ```yaml
   display_information:
     name: Constellation
     description: Media request updates from NorthStar Creative
     background_color: "#231f20"
   features:
     app_home:
       home_tab_enabled: false
       messages_tab_enabled: true
       messages_tab_read_only_enabled: false
     bot_user:
       display_name: Constellation
       always_online: true
   oauth_config:
     scopes:
       bot:
         - chat:write
         - im:write
         - im:history
         - reactions:write
         - users:read
         - users:read.email
   settings:
     event_subscriptions:
       request_url: https://constellation.northstar-creative.workers.dev/hooks/slack
       bot_events:
         - message.im
     org_deploy_enabled: false
     socket_mode_enabled: false
     token_rotation_enabled: false
   ```
   Requesters can reply to the bot in Slack: their replies land in the request's history and notify the team. Before saving a manifest with `event_subscriptions`, save the app's **Signing Secret** (Basic Information → App Credentials) with **slack-replies.command**, so Slack's address check passes.
2. **Install to Workspace → Allow.** Copy the **Bot User OAuth Token** (starts with `xoxb-`).
3. Optional, App Home / Basic Information: upload the Constellation emblem as the app icon.
4. In Slack, open the creative team's channel, run `/invite @Constellation`, then copy the channel ID (channel name → **About** → bottom of the panel, starts with `C`).

### Typeform webhook

This connects the **Media Request NEW** form. Its 10 questions are already matched to the request card in `wrangler.jsonc` (`TYPEFORM_FIELDS`), so nothing changes for ministry leaders.

1. Make up a long random secret (e.g. run `openssl rand -hex 32`).
2. In Typeform: open **Media Request NEW** → **Connect → Webhooks → Add a webhook**. URL: `https://constellation.northstarchurch.org/hooks/typeform`. Then **Edit → Secret** and paste the secret. Turn the webhook **on**.
3. So leaders' uploaded zip files come into Constellation (Typeform keeps them behind its login): in Typeform go to **Account → Personal tokens → Generate a new token**, give it only the **Responses: Read** permission, and copy it.

If you ever add, remove or reword questions on that form, tell me and I'll update the matching. Anything a question doesn't match is still kept in the request's details.

### File storage (proofs and final artwork)

```bash
npx wrangler r2 bucket create constellation-files
```

Files up to 95 MB each. The free R2 tier includes 10 GB; past that it's about $0.015 per GB each month. For bigger files (raw video, huge print PDFs), paste a link in the proof link field instead.

### Your team roster

Comment and assignment notifications go to people by their church email, and the project manager (C.A. Phillips) hears about every comment. That's the only difference: everyone on the team has the same access. The starting list is under `vars` in `wrangler.jsonc` (only used once to fill the Team screen; after that, manage people in the app):

```jsonc
"TEAM_MEMBERS": "[{\"name\":\"Jeremy Thompson\",\"email\":\"jeremy.thompson@northstarchurch.org\"},{\"name\":\"Sarah Vanderheyden\",\"email\":\"sarah.vanderheyden@northstarchurch.org\"},{\"name\":\"C.A. Phillips\",\"email\":\"ca.phillips@northstarchurch.org\",\"pm\":true}]"
```

Names here are what shows in the Assigned dropdown and the board filters. Change it any time and run `npm run deploy`; no app reinstall needed.

### Save the settings in Cloudflare

```bash
npx wrangler secret put SLACK_BOT_TOKEN     # paste the xoxb- token
npx wrangler secret put TYPEFORM_SECRET     # paste the webhook secret
npx wrangler secret put TYPEFORM_TOKEN      # paste the Typeform personal token (for uploaded files)
```

In `wrangler.jsonc` under `vars`, add `"SLACK_TEAM_CHANNEL": "C…"` and `"PUBLIC_URL": "https://constellation.northstarchurch.org"`, then `npm run deploy`.

**Test it:** submit the Typeform yourself. Within a few seconds you should get a Slack DM from Constellation, the creative channel gets a "New media request" post, and the card appears on the board. Move it to Scheduled in the app and the DM thread updates.

If a leader's email isn't in Slack, the card says **Not found in Slack** and the request history notes it. Use **Copy Tracker Link** to send it to them another way.

## 5. Build the Mac app

```bash
cp .env.example .env        # set MAIN_VITE_HUB_URL=https://constellation.northstarchurch.org
npm run dist:mac
```

The installer is in `dist/`. What teammates see:

1. Open the app → enter their church email → type the code Constellation sends them in Slack.
2. That's it. They stay signed in for the session length set in step 4, and the calendar updates live as anyone edits.
3. Without internet the app shows **You're Offline** and reconnects on its own.

Without an Apple Developer account ($99/yr) the app isn't notarized: the first time, right-click the app → **Open**. With one, add signing settings to the `build.mac` section in `package.json`.

Updates: changes to the app's screens ship as a new installer (`npm run dist:mac`). Changes to the shared-data backend go live for everyone with `npm run deploy`.

## Subscribe links

In the app: **Team calendar → Subscribe → New subscribe link.** Each link has its own name and category filter, for example:

- **NorthStar Staff:** all categories, with milestones
- **NorthStar Events:** Weekend service, Special event, Ministry event, Outreach (safe for the congregation)

Anyone with a link can see what it includes. Deleting a link stops it working for everyone who added it.

---

## Local development

```bash
npm run db:migrate:local
npm run worker:dev          # http://localhost:8787, signed in as DEV_USER_EMAIL from .dev.vars
npm run dev                 # Electron window against the Vite dev server (demo data)
npm run preview:web         # single-file demo preview in ./preview
npm run typecheck
```

## Day to day

- **Add or remove a team member:** in the app, **Team** (bottom of the sidebar). Jeremy and Stephanie are team admins and can add people, remove them, change roles and sign someone out everywhere. Takes effect right away; no release needed.
- **Ship a new version of the Mac app:** double-click **release.command**. It builds, signs and notarizes the next version, then publishes it; everyone's app downloads it and shows **Restart To Update**.
- **Install link for new teammates:** `https://constellation.northstar-creative.workers.dev/updates/Constellation.dmg` (always the latest version).

## Proofing new sections before release

- **Preview link**: Claude republishes the "Constellation Preview" page after each round of changes (sample data, opens in any browser, shareable). Built with `npm run preview:web && node scripts/preview-page.mjs`.
- **preview.command**: opens a test copy of the Mac app on sample data that updates live as files change. It keeps its own settings (~/Library/Application Support/Constellation Preview), so the installed app and real data are untouched.
- Only **release.command** sends changes to the team.

## Video Review: Cloudflare Stream

Videos play from Cloudflare Stream; the original files are kept in R2 (the same storage as proofs).

1. In the Cloudflare dashboard open **Media → Stream** and subscribe (from $5/month for 1,000 stored minutes, $1 per 1,000 minutes watched; encoding is free).
2. **My Profile → API Tokens → Create Token → Custom token**: name it "Constellation Stream", permission **Account → Stream → Edit**, account **NorthStar Creative**. Create it and copy it.
3. Double-click **stream.command** and paste the token.

Images work without Stream. A video uploaded before step 3 shows "can't play yet"; click **Try Again** once Stream is connected.

**Keeping stored minutes down** (src/renderer/src/data/review.ts, `RETENTION`): older versions leave Stream 14 days after a newer one is uploaded, approved reviews after 30 quiet days, everything else after 45. The uploader is told 3 days ahead; 📌 Keep exempts a review. Originals, thumbnails and comments stay, and **Restore** puts a version back on Stream. Each video also carries Stream's own deletion date (a week after Constellation's), so Cloudflare cleans up even if Constellation doesn't. The clean-up runs hourly with the existing cron.

Review links (`/track/review/<token>`) are public pages: no sign-in, protected by the link's secret. They can be turned off or set to expire in Share.

## Little Black Book

Vendors live in D1 (`vendors`, `vendor_files`, `vendor_events`); files in R2 under `vendors/<id>/`. Account numbers are encrypted (AES-256-GCM) with a key derived from the `RELEASE_KEY` secret, or from `VAULT_KEY` if you set one (`npx wrangler secret put VAULT_KEY`). Changing that secret makes saved account numbers unreadable (they'd need re-entering). Every view or copy of an account number is logged in the vendor's Activity. No usernames or passwords are stored; those stay in Bitwarden.

## Brand Library

Nothing to set up: release.command adds the tables and the app section. The guide starts from the Illustrator draft (October 2026).

- Edit in the app with **Edit Guidelines**. Chapters marked **In progress** are hidden from staff.
- Files (logos, examples, downloads) are stored in the R2 bucket under `brand/`. Files nothing points to are cleaned up a day after they're removed.
- **Share** gives the staff page link (`/track/brand/<token>`, no sign-in, read-only). **New Link** turns the old one off.

## GitHub backup

The folder backs itself up to the church's private GitHub repo every 3 hours (and when you log in), only when something changed. Secrets (`.cf-token`, `.release-key`, the `.p8` key, `.env`), `node_modules`, `dist` and `imports/` are never sent.

- **First time:** double-click **github.command**. It asks for the repo link and a fine-grained GitHub token (church account → only this repo → Contents: Read and write). The token is kept in your Mac's Keychain.
- **If a problem comes up** (GitHub unreachable, token expired), a Mac notification says so. Details: Console → Log Reports → `constellation-github.log`.
- **If macOS blocks it from the Desktop folder:** System Settings → Privacy & Security → Files and Folders (or Full Disk Access) → allow **bash**. Then double-click github.command again.
- **Token expired:** create a new one the same way and run github.command again.
- **Turn it off:** `launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/org.northstarchurch.constellation-github.plist`

## Event Calendar ← eSpace

Approved events in the eSpace categories you switch on come into the Event Calendar every 15 minutes, for the next 6 months (recurring events: every date). eSpace is the source of truth: name, dates, times and rooms can only be changed there. In Constellation you can set an event's ministry (it applies to every date of a recurring series and sticks through syncs) and add notes.

- **Connect (once):** in eSpace, Profile → API Keys → Create New Key (copy it before Save). Double-click **espace.command** and paste it. It's stored as the `ESPACE_API_KEY` secret.
- **Settings:** Event Calendar → **eSpace** (team admins can change them): which eSpace categories come in and as what (starts with Ministry Event and Staff Use/Meeting), eSpace's own ministry list, and who books for which ministry. Events take the ministry of the staff member who created them in eSpace; people not on the list are flagged and their events show as All church.
- **Problems** (key rejected, eSpace unreachable) show in the eSpace panel and come as a Slack DM like the other health alerts. The calendar keeps the last good copy meanwhile.
- **Key revoked or lost:** make a new one and run espace.command again.
