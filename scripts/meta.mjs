// Connects Meta: checks the system-user token, finds NorthStar's Instagram accounts and Facebook Page,
// stores the token in Constellation and marks those accounts connected. Run again any time to re-check.
import { ACCOUNT } from './cf-account.mjs'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const BUSINESS = '183467125605232'
const G = 'https://graph.facebook.com/v23.0'
const TOKEN = (process.env.META_TOKEN || '').trim()
const NEEDED = ['instagram_basic', 'instagram_content_publish', 'pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'business_management']
const HANDLES = { nsckennesaw: 'ig-nsckennesaw', 'nsc.students': 'ig-nsc-students' }
const env = { ...process.env, CLOUDFLARE_API_TOKEN: readFileSync('.cf-token', 'utf8').trim(), CLOUDFLARE_ACCOUNT_ID: ACCOUNT, CI: '1' }
const die = (m) => {
  console.log('\n✗ ' + m)
  process.exit(1)
}
const get = async (path, params = {}) => {
  const u = new URL(G + path)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  const res = await fetch(u, { headers: { Authorization: 'Bearer ' + TOKEN } })
  const data = await res.json().catch(() => ({}))
  return res.ok ? data : { error: data.error ?? { message: `HTTP ${res.status}` } }
}
const sql = (s) => execSync(`npx wrangler d1 execute constellation --remote --command ${JSON.stringify(s)}`, { env, stdio: ['ignore', 'ignore', 'inherit'] })
const q = (s) => `'${String(s).replace(/'/g, "''")}'`

if (!TOKEN) die('No token pasted.')

// 1. Token works, and has the permissions publishing needs
const me = await get('/me', { fields: 'id,name' })
if (me.error) die(`Meta didn't accept that token (${me.error.message}).`)
const perms = await get('/me/permissions')
const granted = new Set((perms.data ?? []).filter((p) => p.status === 'granted').map((p) => p.permission))
const missing = perms.error ? [] : NEEDED.filter((p) => !granted.has(p))
console.log(`✓ Token works (system user: ${me.name})`)
if (missing.length) die(`The token is missing: ${missing.join(', ')}.\n  Generate a new one with those checked (Revoke tokens first if you like).`)
if (!perms.error) console.log('✓ All publishing permissions granted')

// 2. Find the Instagram accounts (owned by the portfolio, or linked to a Page) and the Page
const ig = new Map() // username -> id
for (const path of [`/${BUSINESS}/instagram_business_accounts`, `/${BUSINESS}/owned_instagram_accounts`]) {
  const r = await get(path, { fields: 'id,username', limit: '50' })
  for (const a of r.data ?? []) if (a.username) ig.set(a.username.toLowerCase(), a.id)
}
const pages = (await get('/me/accounts', { fields: 'id,name,instagram_business_account{id,username}', limit: '50' })).data ?? []
for (const p of pages) {
  const a = p.instagram_business_account
  if (a?.username) ig.set(a.username.toLowerCase(), a.id)
}

// 3. Only keep accounts this token can actually publish to
const found = []
for (const [handle, id] of Object.entries(HANDLES)) {
  const igId = ig.get(handle)
  if (!igId) {
    console.log(`– @${handle}: not found. Add it to the portfolio and assign it to the Constellation system user, then run this again.`)
    continue
  }
  const check = await get(`/${igId}`, { fields: 'username' })
  if (check.error) {
    console.log(`– @${handle}: found, but this token can't use it (${check.error.message})`)
    continue
  }
  found.push([id, igId])
  console.log(`✓ @${handle}`)
}
const fbPages = []
for (const p of pages) {
  const t = await get(`/${p.id}`, { fields: 'access_token' })
  if (t.error || !t.access_token) {
    console.log(`– Facebook: ${p.name}: can't post (${t.error?.message ?? 'no Page token'})`)
    continue
  }
  fbPages.push(p)
  console.log(`✓ Facebook: ${p.name}`)
}
if (!found.length && !fbPages.length) die('No accounts this token can publish to. Check the system user’s Assigned assets.')

// 4. Save
execSync('npx wrangler secret put META_TOKEN', { input: TOKEN, env, stdio: ['pipe', 'ignore', 'inherit'] })
console.log('✓ Token saved in Constellation')
const stmts = found.map(([id, igId]) => `UPDATE social_accounts SET external_id = ${q(igId)} WHERE id = ${q(id)};`)
fbPages.forEach((p, i) =>
  stmts.push(
    `INSERT INTO social_accounts (id, platform, name, handle, external_id, sort) VALUES (${q('fb-' + p.id)}, 'facebook', ${q(p.name)}, '', ${q(p.id)}, ${10 + i}) ON CONFLICT(id) DO UPDATE SET name = excluded.name, external_id = excluded.external_id;`
  )
)
sql(stmts.join(' '))
console.log('✓ Accounts marked connected')
console.log('\nAll set. Those accounts now show as connected in the Posting Calendar.')
