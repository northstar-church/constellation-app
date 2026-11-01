// Sets up Constellation's Cloudflare backend: database, file storage, sign-in protection, deploy.
// Safe to run again: anything already created is reused.
import { ACCOUNT } from './cf-account.mjs'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'

const TOKEN = (process.env.CLOUDFLARE_API_TOKEN || (existsSync('.cf-token') ? readFileSync('.cf-token', 'utf8') : '')).trim()
const API = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}`
const result = { ok: false, steps: [] }
const log = (msg) => {
  console.log(msg)
  result.steps.push(msg)
}
const save = () => writeFileSync('.golive-result.json', JSON.stringify(result, null, 2))

async function cf(path, method = 'GET', body) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  })
  const json = await res.json().catch(() => ({}))
  return { ok: res.ok && json.success !== false, status: res.status, result: json.result, errors: json.errors ?? [] }
}
const errText = (r) => r.errors.map((e) => `${e.code}: ${e.message}`).join('; ') || `HTTP ${r.status}`

function fail(msg) {
  log('\n✗ ' + msg)
  result.error = msg
  save()
  process.exit(1)
}

async function main() {
  if (!TOKEN) fail('No Cloudflare token found (.cf-token).')
  log('Checking your Cloudflare account…')
  const v = await cf('/tokens/verify')
  if (!v.ok) fail('The token was not accepted: ' + errText(v))

  // Three switches only the dashboard can flip
  const missing = []
  const sub = await cf('/workers/subdomain')
  const subdomain = sub.result?.subdomain
  if (!subdomain) missing.push('Workers & Pages: pick a workers.dev subdomain')
  const r2 = await cf('/r2/buckets')
  if (!r2.ok) missing.push('R2: enable it under Storage & databases → R2 object storage (' + errText(r2) + ')')
  const org = await cf('/access/organizations')
  const teamDomain = org.result?.auth_domain
  if (!org.ok && [401, 403].includes(org.status)) missing.push('Token permission: edit the token and add "Access: Organizations, Identity Providers, and Groups → Edit" (' + errText(org) + ')')
  else if (!teamDomain) missing.push('Zero Trust: click "Set up Zero Trust", pick a team name and the Free plan (' + errText(org) + ')')
  if (missing.length) fail('Turn these on in the Cloudflare dashboard, then run this again:\n  - ' + missing.join('\n  - '))

  const host = `constellation.${subdomain}.workers.dev`
  const url = `https://${host}`
  result.url = url
  result.teamDomain = teamDomain
  log(`✓ Account ready. Constellation will live at ${url}`)

  // Database
  const dbs = await cf('/d1/database?name=constellation')
  let db = dbs.result?.find((d) => d.name === 'constellation')
  if (!db) {
    const c = await cf('/d1/database', 'POST', { name: 'constellation' })
    if (!c.ok) fail('Could not create the database: ' + errText(c))
    db = c.result
  }
  log('✓ Database ready')

  // File storage
  if (!r2.result?.buckets?.some((b) => b.name === 'constellation-files')) {
    const c = await cf('/r2/buckets', 'POST', { name: 'constellation-files' })
    if (!c.ok) fail('Could not create file storage: ' + errText(c))
  }
  log('✓ File storage ready')

  // Sign-in: emailed one-time codes, only the team roster gets in
  const idps = await cf('/access/identity_providers')
  if (!idps.result?.some((i) => i.type === 'onetimepin')) {
    const c = await cf('/access/identity_providers', 'POST', { name: 'One-time PIN', type: 'onetimepin', config: {} })
    if (!c.ok) fail('Could not turn on emailed sign-in codes: ' + errText(c))
  }
  const cfg = readFileSync('wrangler.jsonc', 'utf8')
  const team = JSON.parse(JSON.parse('"' + /"TEAM_MEMBERS": "((?:[^"\\]|\\.)*)"/.exec(cfg)[1] + '"'))
  const emails = team.map((m) => m.email.toLowerCase())

  async function policy(name, body) {
    const list = await cf('/access/policies?per_page=100')
    const found = list.result?.find((p) => p.name === name)
    const r = found ? await cf(`/access/policies/${found.id}`, 'PUT', { name, ...body }) : await cf('/access/policies', 'POST', { name, ...body })
    if (!r.ok) fail(`Could not save the "${name}" sign-in rule: ` + errText(r))
    return r.result.id
  }
  async function app(name, domain, policyId) {
    const list = await cf('/access/apps?per_page=100')
    const found = list.result?.find((a) => a.domain === domain)
    const body = {
      name,
      domain,
      type: 'self_hosted',
      session_duration: '720h',
      app_launcher_visible: false,
      policies: [{ id: policyId, precedence: 1 }]
    }
    const r = found ? await cf(`/access/apps/${found.id}`, 'PUT', body) : await cf('/access/apps', 'POST', body)
    if (!r.ok) fail(`Could not protect ${domain}: ` + errText(r))
    return r.result
  }
  const teamPolicy = await policy('Constellation team', {
    decision: 'allow',
    include: emails.map((email) => ({ email: { email } }))
  })
  const publicPolicy = await policy('Constellation public links', { decision: 'bypass', include: [{ everyone: {} }] })
  const main = await app('Constellation', host, teamPolicy)
  for (const p of ['feed', 'track', 'hooks', 'updates', 'brand']) await app(`Constellation ${p} (public)`, `${host}/${p}`, publicPolicy)
  log(`✓ Sign-in protection on: only ${emails.join(', ')} can get in`)

  // Sign-in page in Constellation's look instead of Cloudflare's
  const design = {
    name: 'Constellation',
    auth_domain: teamDomain,
    login_design: {
      background_color: '#E2E2DA',
      text_color: '#231F20',
      logo_path: `${url}/brand/logo.png`,
      header_text: 'Constellation · NorthStar Creative',
      footer_text: 'Sign in with your NorthStar email. We will email you a code.'
    }
  }
  // Send only what we change (plus the two required fields); try without the extra text if Cloudflare objects.
  let brand = await cf('/access/organizations', 'PUT', design)
  if (!brand.ok) {
    const { header_text, footer_text, ...plain } = design.login_design
    brand = await cf('/access/organizations', 'PUT', { ...design, login_design: plain })
  }
  log(brand.ok ? '✓ Sign-in page branded' : '… Could not brand the sign-in page: ' + errText(brand))

  // Point the backend at what we just made
  let next = cfg
    .replace(/"database_id": "[^"]*"/, `"database_id": "${db.uuid}"`)
    .replace(/"ACCESS_TEAM_DOMAIN": "[^"]*"/, `"ACCESS_TEAM_DOMAIN": "${teamDomain}"`)
    .replace(/"ACCESS_AUD": "[^"]*"/, `"ACCESS_AUD": "${main.aud}"`)
  if (/"PUBLIC_URL":/.test(next)) next = next.replace(/"PUBLIC_URL": "[^"]*"/, `"PUBLIC_URL": "${url}"`)
  else next = next.replace(/"ACCESS_AUD": "[^"]*",/, (m) => `${m}\n    "PUBLIC_URL": "${url}",`)
  writeFileSync('wrangler.jsonc', next)
  writeFileSync('.env', `MAIN_VITE_HUB_URL=${url}\n`)

  const env = { ...process.env, CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: ACCOUNT, CI: '1' }
  const run = (cmd) => execSync(cmd, { stdio: 'inherit', env })
  log('Setting up the database tables…')
  run('npx wrangler d1 migrations apply constellation --remote')
  log('Deploying…')
  run('npm run deploy')
  log('✓ Deployed')

  // Smoke test: app is behind sign-in, public links are not
  log('Checking it from the outside (new addresses can take a minute)…')
  let gate = 0
  let track = 0
  for (let i = 0; i < 20 && !(gate && track); i++) {
    await new Promise((r) => setTimeout(r, 5000))
    try {
      const a = await fetch(url + '/api/me', { redirect: 'manual' })
      if ([302, 401, 403].includes(a.status) && (a.headers.get('location') ?? '').includes('cloudflareaccess')) gate = a.status
      const t = await fetch(url + '/track/check', { redirect: 'manual' })
      if (t.status === 404) track = t.status
    } catch {}
  }
  result.signInRequired = Boolean(gate)
  result.publicLinksOpen = Boolean(track)
  log(gate ? '✓ The app asks for sign-in' : '… Sign-in check not confirmed yet (may still be propagating)')
  log(track ? '✓ Requester tracker links are public' : '… Tracker check not confirmed yet (may still be propagating)')
  result.ok = true
  save()
  console.log(`\nAll set. Constellation is live at ${url}\nYou can close this window and go back to Claude.`)
}

main().catch((e) => fail(e.stack || String(e)))
