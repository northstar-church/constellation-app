// Saves the Slack app's signing secret so Constellation accepts replies, then checks the server really has it.
import { ACCOUNT } from './cf-account.mjs'
import { execSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'

const SECRET = (process.env.SIGNING_SECRET || '').trim()
const die = (m) => { console.log('\n✗ ' + m); process.exit(1) }
if (!/^[0-9a-f]{32}$/i.test(SECRET)) die('That doesn’t look like a signing secret (32 letters and numbers, from Basic Information → App Credentials → Signing Secret → Show).')
const hub = /MAIN_VITE_HUB_URL=(.*)/.exec(readFileSync('.env', 'utf8'))[1].trim()
const env = { ...process.env, CLOUDFLARE_API_TOKEN: readFileSync('.cf-token', 'utf8').trim(), CLOUDFLARE_ACCOUNT_ID: ACCOUNT, CI: '1' }

execSync('npx wrangler secret put SLACK_SIGNING_SECRET', { input: SECRET, env, stdio: ['pipe', 'ignore', 'inherit'] })
console.log('✓ Signing secret saved in Constellation')

// Ask the server to answer a challenge signed with this secret, the same check Slack does.
console.log('Checking the server has it…')
let ok = false
for (let i = 0; i < 6 && !ok; i++) {
  await new Promise((r) => setTimeout(r, 5000))
  const raw = JSON.stringify({ type: 'url_verification', challenge: 'constellation-check' })
  const ts = Math.floor(Date.now() / 1000)
  const sig = 'v0=' + createHmac('sha256', SECRET).update(`v0:${ts}:${raw}`).digest('hex')
  const res = await fetch(`${hub}/hooks/slack`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-slack-request-timestamp': String(ts), 'x-slack-signature': sig }, body: raw }).catch(() => null)
  ok = res?.ok && (await res.text()) === 'constellation-check'
}
if (!ok) die('The server didn’t accept it yet. Make sure release.command has finished, then run this again.')
console.log('✓ The server accepts Slack replies')
console.log('\nAll set. Next: paste the updated manifest into the Slack app (see Claude’s steps).')
