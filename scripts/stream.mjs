// Turns on Video Review playback: checks a Stream-only API token, then stores it in Constellation.
import { ACCOUNT } from './cf-account.mjs'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const TOKEN = (process.env.STREAM_TOKEN || '').trim()
const env = { ...process.env, CLOUDFLARE_API_TOKEN: readFileSync('.cf-token', 'utf8').trim(), CLOUDFLARE_ACCOUNT_ID: ACCOUNT, CI: '1' }
const die = (m) => {
  console.log('\n✗ ' + m)
  process.exit(1)
}

if (!TOKEN) die('No token pasted. Make one in Cloudflare: My Profile → API Tokens → Create Token → Custom token, with Account → Stream → Edit.')
const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/stream?limit=1`, { headers: { Authorization: 'Bearer ' + TOKEN } })
const data = await res.json().catch(() => ({}))
if (!res.ok || data.success === false) {
  const msg = (data.errors ?? []).map((e) => `${e.code}: ${e.message}`).join('; ') || `HTTP ${res.status}`
  if (res.status === 401 || res.status === 403 || /auth/i.test(msg))
    die(`Cloudflare didn't accept that token (${msg}).\n  Check it has Account → Stream → Edit, for the NorthStar Creative account.`)
  die(`Stream isn't ready on this account yet (${msg}).\n  In the Cloudflare dashboard open Media → Stream and subscribe (starts at $5/month), then run this again.`)
}
console.log('✓ Stream is on, and the token works')

execSync('npx wrangler secret put STREAM_TOKEN', { input: TOKEN, env, stdio: ['pipe', 'ignore', 'inherit'] })
console.log('✓ Saved in Constellation')
console.log('\nAll set. New videos in Video Review will play after a minute or two of processing.')
console.log('Videos uploaded before this need a new version (or a Restore) to play.')
