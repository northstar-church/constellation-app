// Builds a new signed version of the Mac app and publishes it so everyone's app updates itself.
import { ACCOUNT } from './cf-account.mjs'
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, openSync, readSync, closeSync, statSync, readdirSync, rmSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { request as httpsRequest } from 'node:https'

const env = {
  ...process.env,
  CLOUDFLARE_API_TOKEN: readFileSync('.cf-token', 'utf8').trim(),
  CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
  APPLE_KEYCHAIN_PROFILE: 'constellation',
  CI: '1'
}
const run = (cmd, input) => execSync(cmd, { stdio: input ? ['pipe', 'inherit', 'inherit'] : 'inherit', env, input })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const die = (m) => { console.log('\n✗ ' + m); process.exit(1) }
const hub = /MAIN_VITE_HUB_URL=(.*)/.exec(readFileSync('.env', 'utf8'))[1].trim()

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const savePkg = () => writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n')
const published = existsSync('.last-published') ? readFileSync('.last-published', 'utf8').trim() : ''
const built = existsSync('dist/latest-mac.yml') ? /version:\s*(\S+)/.exec(readFileSync('dist/latest-mac.yml', 'utf8'))?.[1] : ''

// 1. Build the next version, unless the current one is already built and just wasn't published yet
if (built === pkg.version && published !== pkg.version) {
  console.log(`Constellation ${pkg.version} is already built. Publishing it…\n`)
} else {
  const prev = pkg.version
  const [a, b, c] = prev.split('.').map(Number)
  pkg.version = `${a}.${b}.${c + 1}`
  savePkg()
  console.log(`Building Constellation ${pkg.version} (5–10 minutes; Apple's notarization check is the slow part)…\n`)
  try {
    run('npm run dist:mac')
  } catch {
    pkg.version = prev
    savePkg()
    die('The build failed (see above). Nothing was published.')
  }
}

// 2. Make sure the server can receive releases (a private key only this Mac and the server know)
if (!existsSync('.release-key')) {
  const key = randomBytes(32).toString('hex')
  console.log('One-time: setting up the release key…')
  run('npx wrangler secret put RELEASE_KEY', key)
  writeFileSync('.release-key', key, { mode: 0o600 })
}
const releaseKey = readFileSync('.release-key', 'utf8').trim()
console.log('Updating the database…')
run('npx wrangler d1 migrations apply constellation --remote')
console.log('Updating the server…')
run('npm run deploy')
await sleep(15000) // let the new server version settle in everywhere before uploading

// Constellation has its own sign-in now: once the server answers for it, switch off Cloudflare's sign-in page in front of it
{
  const host = new URL(hub).host
  let ready = false
  for (let i = 0; i < 6 && !ready; i++) {
    try {
      ready = (await (await fetch(`${hub}/hooks/auth-status`)).json()).auth === 'constellation'
    } catch {
      await sleep(5000)
    }
  }
  const api = (path, method = 'GET') =>
    fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}${path}`, { method, headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` } }).then((r) => r.json())
  const apps = ready ? ((await api('/access/apps?per_page=100')).result ?? []).filter((a) => a.domain === host || String(a.domain).startsWith(host + '/')) : []
  for (const a of apps) {
    const r = await api(`/access/apps/${a.id}`, 'DELETE')
    if (!r.success) console.log(`… Couldn’t switch off Cloudflare sign-in for ${a.domain}: ${JSON.stringify(r.errors)}`)
  }
  if (apps.length) console.log('✓ Sign-in now uses Constellation’s own screen (codes by Slack); Cloudflare’s sign-in page is off')
}

// Each request uses a fresh connection (reused ones are what drop mid-upload with EPIPE / socket errors),
// and each piece is retried with growing pauses, so a flaky connection only slows a release down.
function post(path, params, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${hub}/updates/${path}?${new URLSearchParams(params)}`)
    const data = body == null ? Buffer.alloc(0) : Buffer.isBuffer(body) ? body : Buffer.from(body)
    const req = httpsRequest(url, { method: 'POST', agent: false, headers: { 'x-release-key': releaseKey, 'content-length': data.length, connection: 'close' }, timeout: 180000 }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString() }))
      res.on('error', reject)
    })
    req.on('timeout', () => req.destroy(Object.assign(new Error('timed out'), { code: 'TIMEOUT' })))
    req.on('error', reject)
    req.end(data)
  })
}
async function call(path, params, body) {
  let last = ''
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      const res = await post(path, params, body)
      if (res.status >= 200 && res.status < 300) return JSON.parse(res.text)
      last = `HTTP ${res.status} ${res.text.slice(0, 200)}`
      if (res.status < 500) break
    } catch (e) {
      last = e.code || e.message
    }
    process.stdout.write(` (retrying: ${last})`)
    await sleep(Math.min(attempt * 5000, 30000))
  }
  die(`Upload step ${path} failed: ${last}. Nothing was published; run release.command again to retry (it picks up where it left off).`)
}
/** Size of a file already on the server ('' if it isn't there) */
async function serverSize(name) {
  try {
    const res = await fetch(`${hub}/updates/${name}`, { method: 'HEAD' })
    return res.ok ? res.headers.get('content-length') ?? '' : ''
  } catch {
    return ''
  }
}
const PART = 10 * 1024 * 1024
async function upload(name, file, type, { skipIfThere = false } = {}) {
  const size = statSync(file).size
  if (skipIfThere && (await serverSize(name)) === String(size)) {
    console.log(`Already uploaded ${name} ✓`)
    return
  }
  process.stdout.write(`Uploading ${name} (${Math.round(size / 1048576)} MB)`)
  if (size <= PART) {
    await call('_put', { name, type }, readFileSync(file))
  } else {
    const { uploadId } = await call('_start', { name, type })
    const parts = []
    const fd = openSync(file, 'r')
    for (let n = 1, offset = 0; offset < size; n++, offset += PART) {
      const buf = Buffer.alloc(Math.min(PART, size - offset))
      readSync(fd, buf, 0, buf.length, offset)
      parts.push(await call('_part', { name, uploadId, part: n }, buf))
      if (n % 3 === 0) process.stdout.write('.')
    }
    closeSync(fd)
    await call('_finish', { name, uploadId }, JSON.stringify({ parts }))
  }
  console.log(' ✓')
}

// 3. Versioned files first, the version list last, so no one ever sees a half-uploaded release
const yml = readFileSync('dist/latest-mac.yml', 'utf8')
for (const f of [...new Set([...yml.matchAll(/url:\s*(\S+)/g)].map((m) => m[1]))]) await upload(f, `dist/${f}`, f.endsWith('.zip') ? 'application/zip' : 'application/octet-stream', { skipIfThere: true })
const dmg = `dist/Constellation-${pkg.version}-universal.dmg`
if (existsSync(dmg)) await upload('Constellation.dmg', dmg, 'application/x-apple-diskimage')
await upload('latest-mac.yml', 'dist/latest-mac.yml', 'text/yaml')
writeFileSync('.last-published', pkg.version)

// 4. Tidy up: older builds are already on the server, and the app only ever needs the newest one
let freed = 0
for (const f of readdirSync('dist')) {
  const v = /^Constellation-(\d+\.\d+\.\d+)-/.exec(f)?.[1]
  const old = (v && v !== pkg.version) || /^mac(-universal)?(-\w+)?(-temp)?$/.test(f)
  if (!old) continue
  const path = `dist/${f}`
  try {
    freed += statSync(path).isDirectory() ? 0 : statSync(path).size
    rmSync(path, { recursive: true, force: true })
  } catch {
    /* leave anything that can't be removed */
  }
}
if (freed) console.log(`Cleaned up older builds (${(freed / 1e9).toFixed(1)} GB freed)`)

console.log(`\n✓ Constellation ${pkg.version} is published.`)
console.log('  Everyone\'s app downloads it on its own and shows "Restart To Update".')
console.log(`  New teammates can always download the latest installer from:\n  ${hub}/updates/Constellation.dmg`)
