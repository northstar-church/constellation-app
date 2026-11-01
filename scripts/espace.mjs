// Connects the Event Calendar to eSpace: checks the API key, shows what eSpace will send, then stores the key in Constellation.
import { ACCOUNT } from './cf-account.mjs'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const KEY = (process.env.ESPACE_KEY || '').trim()
const env = { ...process.env, CLOUDFLARE_API_TOKEN: readFileSync('.cf-token', 'utf8').trim(), CLOUDFLARE_ACCOUNT_ID: ACCOUNT, CI: '1' }
const die = (m) => {
  console.log('\n✗ ' + m)
  process.exit(1)
}
if (!KEY) die('No key pasted. In eSpace: Profile → API Keys (bottom of the page) → Create New Key.')

// 1. Trade the key for a sign-in token, the way Constellation will
let base = 'https://api.espace.cool/api/v2'
let res
for (const b of [base, 'https://app.espace.cool/api/v2']) {
  res = await fetch(`${b}/requesttoken`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ apiKey: KEY }) }).catch(() => null)
  if (res && res.status !== 404) {
    base = b
    break
  }
}
if (!res) die('Couldn’t reach eSpace. Check the internet connection and try again.')
const raw = await res.text()
if (!res.ok) die(`eSpace didn’t accept that key (HTTP ${res.status}). Make a new one (Profile → API Keys → Create New Key) and copy it before clicking Save.`)
let token = raw
try {
  const j = JSON.parse(raw)
  token = typeof j === 'string' ? j : j.token ?? j.Token ?? j.access_token ?? j.Data ?? raw
} catch {
  /* plain text token */
}
token = String(token).replace(/^"|"$/g, '')
console.log('✓ eSpace accepted the key')

// 2. Show what's there, so we can check the categories before switching anything on
const get = async (path) => {
  const r = await fetch(base + path, { headers: { Authorization: `Bearer ${token}`, accept: 'application/json' } })
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`)
  return r.json()
}
try {
  const cats = await get('/ministry/categories')
  const list = (Array.isArray(cats) ? cats : cats.Data ?? cats.data ?? []).map((c) => ({ id: c.Id ?? c.id, name: c.Name ?? c.name }))
  console.log(`\neSpace categories (${list.length}), with approved dates in the next 30 days:`)
  for (const c of list) {
    const occ = await get(`/event/occurrences?nextDays=30&categoryIds=${c.id}`).catch(() => [])
    const rows = Array.isArray(occ) ? occ : occ.Data ?? []
    const approved = rows.filter((o) => o.IsFinalApproved !== false && !/cancel/i.test(o.OccurrenceStatus ?? ''))
    console.log(`  • ${c.name}: ${approved.length}${approved.length ? `  (e.g. ${[...new Set(approved.map((o) => o.EventName))].slice(0, 3).join(', ')})` : ''}`)
  }
} catch (e) {
  console.log(`\n… Connected, but couldn’t list categories yet (${e.message}). That’s OK; send Claude this message.`)
}

// 3. Keep the key in Constellation (never in the app or on GitHub)
execSync('npx wrangler secret put ESPACE_API_KEY', { input: KEY, env, stdio: ['pipe', 'ignore', 'inherit'] })
console.log('\n✓ Saved in Constellation')
console.log('\nAll set. Send Claude a screenshot of this window (it has no key in it) so the sync can be built against your real categories.')
