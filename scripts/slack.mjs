// Connects Constellation to Slack: checks the bot token and channel, then stores them.
import { ACCOUNT } from './cf-account.mjs'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const BOT = (process.env.SLACK_BOT || '').trim()
const CHANNEL = (process.env.SLACK_CHANNEL || '').trim().toUpperCase()
const env = { ...process.env, CLOUDFLARE_API_TOKEN: readFileSync('.cf-token', 'utf8').trim(), CLOUDFLARE_ACCOUNT_ID: ACCOUNT, CI: '1' }
const die = (m) => { console.log('\n✗ ' + m); process.exit(1) }
const slack = async (method, body) =>
  (await fetch('https://slack.com/api/' + method, { method: 'POST', headers: { Authorization: 'Bearer ' + BOT, 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) })).json()

if (!BOT.startsWith('xoxb-')) die('That isn\'t a bot token. It should start with xoxb- (Slack app → OAuth & Permissions → Bot User OAuth Token).')
const auth = await slack('auth.test', {})
if (!auth.ok) die('Slack didn\'t accept the token: ' + auth.error)
console.log(`✓ Connected to ${auth.team} as @${auth.user}`)
const me = await (await fetch('https://slack.com/api/users.lookupByEmail?email=' + encodeURIComponent('jeremy.thompson@northstarchurch.org'), { headers: { Authorization: 'Bearer ' + BOT } })).json()
if (!me.ok) die('The app can\'t look people up by email (' + me.error + '). Make sure it has the users:read.email scope, then reinstall it.')
console.log('✓ Can find people by email')

if (CHANNEL) {
  const post = await slack('chat.postMessage', { channel: CHANNEL, text: ':sparkles: Constellation is connected. Team updates about media requests will show up here.' })
  if (!post.ok) die(post.error === 'not_in_channel' || post.error === 'channel_not_found'
    ? 'The app isn\'t in that channel yet. In the channel, type /invite @Constellation, then run this again.'
    : 'Couldn\'t post to the channel: ' + post.error)
  console.log('✓ Posted a hello in the team channel')
}

const put = (name, value) => execSync(`npx wrangler secret put ${name}`, { input: value, env, stdio: ['pipe', 'ignore', 'inherit'] })
put('SLACK_BOT_TOKEN', BOT)
if (CHANNEL) put('SLACK_TEAM_CHANNEL', CHANNEL)
console.log('✓ Saved in Constellation')
console.log('\nAll set. New requests will DM the requester with their tracker link.')
