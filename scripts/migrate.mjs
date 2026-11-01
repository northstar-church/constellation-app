// Moves Constellation from the NorthStar Creative Cloudflare account to the NorthStar Church account.
// Safe to run again: finished steps are remembered in .migrate/state.json and skipped.
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, copyFileSync } from 'node:fs'
import { request as httpsRequest } from 'node:https'
import { ACCOUNT as OLD_ACCOUNT_FROM_CONFIG } from './cf-account.mjs'

const NEW_ACCOUNT = '7d1eaa1f778cc8ff4f726795600228a6'
const ZONE = 'northstarchurch.org'
const HOST = 'constellation.northstarchurch.org'
const NEW_HUB = `https://${HOST}`
const TYPEFORM_FORM = 'C0002LdL'

const NEW_TOKEN = (process.env.NEW_TOKEN || '').trim()
const STREAM_TOKEN = (process.env.STREAM_TOKEN || '').trim()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const die = (m) => {
  console.log('\n✗ ' + m + '\n\nNothing is lost: the current server is untouched and still running. Fix the above and run migrate.command again; finished steps are skipped.')
  process.exit(1)
}
const ok = (m) => console.log('✓ ' + m)
const step = (m) => console.log('\n' + m)

mkdirSync('.migrate', { recursive: true })
const STATE_FILE = '.migrate/state.json'
const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : {}
const save = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))

// ---------- what we start from ----------
if (!existsSync('.release-key')) die('No .release-key on this Mac. Run release.command once first.')
const RELEASE_KEY = readFileSync('.release-key', 'utf8').trim()
if (!state.oldAccount) {
  if (OLD_ACCOUNT_FROM_CONFIG === NEW_ACCOUNT) die('wrangler.jsonc already points at the church account, but this Mac has no record of a move. Ask Claude before going further.')
  state.oldAccount = OLD_ACCOUNT_FROM_CONFIG
  state.oldHub = /MAIN_VITE_HUB_URL=(.*)/.exec(readFileSync('.env', 'utf8'))[1].trim()
  copyFileSync('wrangler.jsonc', 'wrangler.old.jsonc')
  copyFileSync('.cf-token', '.cf-token-old')
  save()
}
const OLD_TOKEN = readFileSync('.cf-token-old', 'utf8').trim()
const OLD_HUB = state.oldHub
if (!NEW_TOKEN) die('No church-account token pasted.')
if (!STREAM_TOKEN && !state.secretsDone) die('No Stream token pasted.')

const oldEnv = { ...process.env, CLOUDFLARE_API_TOKEN: OLD_TOKEN, CLOUDFLARE_ACCOUNT_ID: state.oldAccount, CI: '1' }
const newEnv = { ...process.env, CLOUDFLARE_API_TOKEN: NEW_TOKEN, CLOUDFLARE_ACCOUNT_ID: NEW_ACCOUNT, CI: '1' }
const run = (cmd, env, input) => execSync(cmd, { stdio: input != null ? ['pipe', 'inherit', 'inherit'] : 'inherit', env, input })
const quiet = (cmd, env, input) => execSync(cmd, { stdio: ['pipe', 'ignore', 'inherit'], env, input })

async function cf(path, method = 'GET', body, token = NEW_TOKEN) {
  const res = await fetch('https://api.cloudflare.com/client/v4' + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const j = await res.json().catch(() => ({}))
  return { ok: res.ok && j.success !== false, status: res.status, result: j.result, errors: j.errors ?? [] }
}
const errText = (r) => r.errors.map((e) => `${e.code}: ${e.message}`).join('; ') || `HTTP ${r.status}`
const A = `/accounts/${NEW_ACCOUNT}`

/** Talk to a Constellation server's move endpoints (fresh connection each time; retried) */
function req(base, path, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : Buffer.from(JSON.stringify(body))
    const r = httpsRequest(new URL(base + path), { method, agent: false, timeout: 900000, headers: { 'x-release-key': RELEASE_KEY, connection: 'close', ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}) } }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString() }))
      res.on('error', reject)
    })
    r.on('timeout', () => r.destroy(new Error('timed out')))
    r.on('error', reject)
    r.end(data ?? undefined)
  })
}
async function server(base, path, opts, tries = 6) {
  let last = ''
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await req(base, path, opts)
      if (res.status >= 200 && res.status < 300) return JSON.parse(res.text)
      last = `HTTP ${res.status} ${res.text.slice(0, 160)}`
    } catch (e) {
      last = e.code || e.message
    }
    await sleep(Math.min(i * 4000, 20000))
  }
  throw new Error(last)
}
const until = () => new Date(Date.now() + 8 * 3600_000).toISOString()

async function main() {
  if (state.finished) {
    console.log(`Constellation already moved to ${NEW_HUB} (${state.finished}). Nothing to do.`)
    return
  }
  console.log(`Moving Constellation\n  from ${OLD_HUB} (NorthStar Creative account)\n  to   ${NEW_HUB} (NorthStar Church account)`)

  // 1. Check the church account is ready
  step('1. Checking the church account…')
  const v = await cf(`${A}/tokens/verify`)
  if (!v.ok) die('Cloudflare didn’t accept the church token: ' + errText(v) + '\n  Make sure you copied the whole token from Manage account → Account API tokens.')
  const missing = []
  if (!(await cf(`${A}/workers/subdomain`)).result?.subdomain) missing.push('Workers: no workers.dev subdomain yet (Compute → Workers & Pages)')
  const r2 = await cf(`${A}/r2/buckets`)
  if (!r2.ok) missing.push('R2 isn’t enabled, or the token lacks Workers R2 Storage → Edit (' + errText(r2) + ')')
  const d1 = await cf(`${A}/d1/database`)
  if (!d1.ok) missing.push('The token lacks D1 → Edit (' + errText(d1) + ')')
  const org = await cf(`${A}/access/organizations`)
  if (!org.ok || !org.result?.auth_domain) missing.push('Zero Trust isn’t set up, or the token lacks Access: Organizations → Edit (' + errText(org) + ')')
  const apps = await cf(`${A}/access/apps?per_page=100`)
  if (!apps.ok) missing.push('The token lacks Access: Apps and Policies → Edit (' + errText(apps) + ')')
  const zones = await cf(`/zones?name=${ZONE}`)
  const zone = zones.result?.[0]
  if (!zone) missing.push(`The token can’t see ${ZONE}. Edit the token: add a policy for the ${ZONE} zone with DNS → Edit, Workers Routes → Edit and Zone → Read`)
  if (STREAM_TOKEN) {
    const s = await cf(`${A}/stream?limit=1`, 'GET', null, STREAM_TOKEN)
    if (!s.ok) missing.push('The Stream token didn’t work (' + errText(s) + '). Check Stream is subscribed (Images & Stream) and the token has Stream → Edit')
  }
  if (missing.length) die('The church account needs a few things first:\n  - ' + missing.join('\n  - '))
  const teamDomain = org.result.auth_domain
  ok(`Church account ready (sign-in at ${teamDomain})`)

  // 2. Open the old server for the move (8 hours, release key only)
  step('2. Preparing the current server to hand everything over…')
  if (!state.built) {
    run('npm run build:web', oldEnv)
    state.built = true
    save()
  }
  quiet(`npx wrangler deploy --config wrangler.old.jsonc --var MIGRATE_UNTIL:${until()}`, oldEnv)
  let oldCounts
  for (let i = 0; i < 12 && !oldCounts; i++) {
    try {
      oldCounts = await server(OLD_HUB, '/updates/_export/counts', {}, 1)
    } catch {
      await sleep(5000)
    }
  }
  if (!oldCounts) die('The current server didn’t open for the move. Check the internet connection and try again.')
  ok(`Current server ready: ${oldCounts.files} files (${(oldCounts.bytes / 1e6).toFixed(0)} MB) to copy`)

  // 3. Database snapshot
  step('3. Saving a copy of the database…')
  if (!state.dumped) {
    run('npx wrangler d1 export constellation --remote --output .migrate/database.sql --config wrangler.old.jsonc', oldEnv)
    state.dumped = true
    save()
  }
  ok('Database copied to this Mac (.migrate/database.sql)')

  // 4. New database, storage and sign-in
  step('4. Setting up the church account…')
  let db = d1.result?.find((d) => d.name === 'constellation')
  if (!db) {
    const c = await cf(`${A}/d1/database`, 'POST', { name: 'constellation' })
    if (!c.ok) die('Couldn’t create the database: ' + errText(c))
    db = c.result
  }
  if (!r2.result?.buckets?.some((b) => b.name === 'constellation-files')) {
    const c = await cf(`${A}/r2/buckets`, 'POST', { name: 'constellation-files' })
    if (!c.ok) die('Couldn’t create file storage: ' + errText(c))
  }
  ok('Database and file storage created')

  const idps = await cf(`${A}/access/identity_providers`)
  if (!idps.result?.some((i) => i.type === 'onetimepin')) {
    const c = await cf(`${A}/access/identity_providers`, 'POST', { name: 'One-time PIN', type: 'onetimepin', config: {} })
    if (!c.ok) die('Couldn’t turn on emailed sign-in codes: ' + errText(c))
  }
  const cfg = readFileSync('wrangler.old.jsonc', 'utf8')
  const team = JSON.parse(JSON.parse('"' + /"TEAM_MEMBERS": "((?:[^"\\]|\\.)*)"/.exec(cfg)[1] + '"'))
  const emails = team.map((m) => m.email.toLowerCase()).filter(Boolean)
  async function policy(name, body) {
    const list = await cf(`${A}/access/policies?per_page=100`)
    const found = list.result?.find((p) => p.name === name)
    const r = found ? await cf(`${A}/access/policies/${found.id}`, 'PUT', { name, ...body }) : await cf(`${A}/access/policies`, 'POST', { name, ...body })
    if (!r.ok) die(`Couldn’t save the "${name}" sign-in rule: ` + errText(r))
    return r.result.id
  }
  async function app(name, domain, policyId) {
    const list = await cf(`${A}/access/apps?per_page=100`)
    const found = list.result?.find((a) => a.domain === domain)
    const body = { name, domain, type: 'self_hosted', session_duration: '720h', app_launcher_visible: false, policies: [{ id: policyId, precedence: 1 }] }
    const r = found ? await cf(`${A}/access/apps/${found.id}`, 'PUT', body) : await cf(`${A}/access/apps`, 'POST', body)
    if (!r.ok) die(`Couldn’t protect ${domain}: ` + errText(r))
    return r.result
  }
  const others = (apps.result ?? []).filter((a) => !String(a.name).startsWith('Constellation'))
  const teamPolicy = await policy('Constellation team', { decision: 'allow', include: emails.map((email) => ({ email: { email } })) })
  const publicPolicy = await policy('Constellation public links', { decision: 'bypass', include: [{ everyone: {} }] })
  const main = await app('Constellation', HOST, teamPolicy)
  for (const p of ['feed', 'track', 'hooks', 'updates', 'brand']) await app(`Constellation ${p} (public)`, `${HOST}/${p}`, publicPolicy)
  ok(`Sign-in protection on: only the team’s ${emails.length} emails get in; public links stay public`)
  if (!others.length) {
    const design = { name: 'Constellation', auth_domain: teamDomain, login_design: { background_color: '#E2E2DA', text_color: '#231F20', logo_path: `${NEW_HUB}/brand/logo.png`, header_text: 'Constellation · NorthStar Creative', footer_text: 'Sign in with your NorthStar email. We will email you a code.' } }
    const b = await cf(`${A}/access/organizations`, 'PUT', design)
    if (b.ok) ok('Sign-in page in Constellation’s look')
  } else ok(`Left the church’s sign-in page as it is (${others.length} other app${others.length === 1 ? '' : 's'} use it)`)

  // Point the project at the church account
  let next = readFileSync('wrangler.jsonc', 'utf8')
    .replace(/"database_id": "[^"]*"/, `"database_id": "${db.uuid}"`)
    .replace(/"ACCESS_TEAM_DOMAIN": "[^"]*"/, `"ACCESS_TEAM_DOMAIN": "${teamDomain}"`)
    .replace(/"ACCESS_AUD": "[^"]*"/, `"ACCESS_AUD": "${main.aud}"`)
    .replace(/"PUBLIC_URL": "[^"]*"/, `"PUBLIC_URL": "${NEW_HUB}"`)
    .replace(/"CF_ACCOUNT_ID": "[^"]*"/, `"CF_ACCOUNT_ID": "${NEW_ACCOUNT}"`)
  if (!/"routes":/.test(next)) next = next.replace(/"main": "[^"]*",/, (m) => `${m}\n  // The church domain; the workers.dev address is off so there's only one way in (through sign-in)\n  "routes": [{ "pattern": "${HOST}", "custom_domain": true }],\n  "workers_dev": false,\n  "preview_urls": false,`)
  writeFileSync('wrangler.jsonc', next)
  writeFileSync('.env', `MAIN_VITE_HUB_URL=${NEW_HUB}\n`)
  ok('Project now points at the church account')

  // 5. Database into the church account
  step('5. Loading the database into the church account…')
  if (!state.imported) {
    run('npx wrangler d1 execute constellation --remote --file .migrate/database.sql --yes', newEnv)
    state.imported = true
    save()
  }
  run('npx wrangler d1 migrations apply constellation --remote', newEnv)
  ok('Database loaded')

  // 6. The new server
  step(`6. Starting Constellation at ${NEW_HUB}…`)
  quiet(`npx wrangler deploy --var MIGRATE_UNTIL:${until()}`, newEnv)
  ok('Server deployed')
  if (!state.secretsDone) {
    const carried = await server(OLD_HUB, '/updates/_export/secrets')
    const all = { ...carried, RELEASE_KEY, STREAM_TOKEN }
    for (const [k, val] of Object.entries(all)) quiet(`npx wrangler secret put ${k}`, newEnv, val)
    state.secretsDone = true
    state.carried = Object.keys(carried)
    save()
  }
  ok(`Keys carried over: ${['RELEASE_KEY', 'STREAM_TOKEN', ...(state.carried ?? [])].join(', ')}`)
  process.stdout.write(`Waiting for ${HOST} to come online (a new address can take a few minutes)`)
  let newCounts
  for (let i = 0; i < 60 && !newCounts; i++) {
    try {
      newCounts = await server(NEW_HUB, '/updates/_export/counts', {}, 1)
    } catch {
      process.stdout.write('.')
      await sleep(10000)
    }
  }
  console.log('')
  if (!newCounts) die(`${HOST} didn’t come online within 10 minutes. It may just need longer: run migrate.command again in a few minutes.`)
  ok(`${HOST} is online`)

  // 7. Files, server to server
  step('7. Copying files (straight from the old server to the new one)…')
  const list = []
  let cursor = null
  do {
    const page = await server(OLD_HUB, `/updates/_export/list${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`)
    list.push(...page.objects)
    cursor = page.cursor
  } while (cursor)
  let done = 0
  let copied = 0
  const failed = []
  for (const o of list) {
    try {
      const r = await server(NEW_HUB, '/updates/_import/pull', { method: 'POST', body: { from: OLD_HUB, key: o.key, size: o.size } }, 5)
      if (!r.skipped) copied++
    } catch (e) {
      failed.push(`${o.key}: ${e.message}`)
    }
    done++
    if (done % 10 === 0 || done === list.length) process.stdout.write(`\r  ${done} of ${list.length} files`)
  }
  console.log('')
  if (failed.length) die(`${failed.length} file(s) didn’t copy:\n  ${failed.slice(0, 5).join('\n  ')}`)
  ok(`${list.length} files in place (${copied} copied this run)`)

  // 8. Check everything arrived
  step('8. Checking everything arrived…')
  const after = await server(NEW_HUB, '/updates/_export/counts')
  const before = await server(OLD_HUB, '/updates/_export/counts')
  const diffs = Object.keys(before.counts).filter((t) => before.counts[t] !== after.counts[t])
  if (before.files !== after.files || before.bytes !== after.bytes) diffs.push(`files (${before.files} vs ${after.files})`)
  if (diffs.length) die('These don’t match between the old and new server: ' + diffs.join(', '))
  ok(`Everything matches: ${Object.values(before.counts).filter((n) => n > 0).reduce((s, n) => s + n, 0)} records, ${before.files} files`)

  // 9. Videos onto the church account's Stream
  step('9. Sending Video Review videos to the church account’s Stream…')
  if (!state.restreamed) {
    const r = await server(NEW_HUB, '/updates/_import/restream', { method: 'POST' })
    if (r.failed.length) console.log('  Couldn’t re-send:\n  ' + r.failed.join('\n  ') + '\n  (These can be restored from Video Review later.)')
    state.restreamed = true
    save()
    ok(`${r.sent} video(s) sent; they’ll play after a few minutes of processing`)
  } else ok('Already done')

  // 10. Typeform sends new requests to the new address
  step('10. Pointing the Media Request form at the new address…')
  const sec = await server(OLD_HUB, '/updates/_export/secrets')
  if (sec.TYPEFORM_TOKEN && sec.TYPEFORM_SECRET) {
    const hook = await fetch(`https://api.typeform.com/forms/${TYPEFORM_FORM}/webhooks/constellation`, {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + sec.TYPEFORM_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: NEW_HUB + '/hooks/typeform', enabled: true, secret: sec.TYPEFORM_SECRET, verify_ssl: true })
    })
    if (hook.ok) ok('Typeform now sends to ' + NEW_HUB + '/hooks/typeform')
    else console.log(`  … Couldn’t update the Typeform webhook (HTTP ${hook.status}). Run typeform.command afterwards to fix it.`)
  } else console.log('  … Typeform isn’t connected on the old server; skipped')

  // 11. Close the move endpoints on the new server, switch this Mac to the church account
  step('11. Finishing up…')
  quiet('npx wrangler deploy', newEnv)
  writeFileSync('.cf-token', NEW_TOKEN, { mode: 0o600 })
  ok('This Mac now uses the church account for release.command and the other setup files')

  // 12. The old address forwards to the new one
  writeFileSync(
    'wrangler.redirect.jsonc',
    JSON.stringify(
      {
        name: 'constellation',
        main: 'scripts/redirect-worker.js',
        compatibility_date: '2026-10-01',
        workers_dev: true,
        vars: { TARGET: NEW_HUB },
        triggers: { crons: [] },
        migrations: [
          { tag: 'v1', new_sqlite_classes: ['LiveHub'] },
          { tag: 'v2', deleted_classes: ['LiveHub'] }
        ]
      },
      null,
      2
    )
  )
  quiet('npx wrangler deploy --config wrangler.redirect.jsonc', oldEnv)
  ok(`${OLD_HUB} now forwards to ${NEW_HUB} (old links keep working)`)
  state.finished = new Date().toISOString()
  save()

  console.log(`
All moved. Constellation now runs on the NorthStar Church Cloudflare account at ${NEW_HUB}

Two things left for you:
  1. Slack: api.slack.com/apps → Constellation → Event Subscriptions → change the Request URL to
       ${NEW_HUB}/hooks/slack
     and wait for "Verified" → Save Changes.
  2. Double-click release.command. That app version talks to the new address; your app picks it up on its own.

The old account still holds a full copy of everything (nothing was deleted there).`)
}

main().catch((e) => die(e.stack || String(e)))
