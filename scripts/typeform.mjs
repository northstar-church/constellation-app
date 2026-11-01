// Connects the "Media Request NEW" Typeform to Constellation: stores the keys and adds the webhook.
import { ACCOUNT } from './cf-account.mjs'
import { execSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'

const FORM = 'C0002LdL'
const TF = (process.env.TF_TOKEN || '').trim()
const CF = readFileSync('.cf-token', 'utf8').trim()
const url = /MAIN_VITE_HUB_URL=(.*)/.exec(readFileSync('.env', 'utf8'))[1].trim()
const env = { ...process.env, CLOUDFLARE_API_TOKEN: CF, CLOUDFLARE_ACCOUNT_ID: ACCOUNT, CI: '1' }
const die = (m) => { console.log('\n✗ ' + m); process.exit(1) }

if (!TF) die('No Typeform token entered.')
const me = await fetch('https://api.typeform.com/forms/' + FORM, { headers: { Authorization: 'Bearer ' + TF } })
if (!me.ok) die(`Typeform didn't accept that token (HTTP ${me.status}). Check it has Forms: Read, Responses: Read and Webhooks: Read + Write.`)
console.log('✓ Typeform token works')

const secret = randomBytes(32).toString('hex')
const put = (name, value) => execSync(`npx wrangler secret put ${name}`, { input: value, env, stdio: ['pipe', 'ignore', 'inherit'] })
put('TYPEFORM_SECRET', secret)
put('TYPEFORM_TOKEN', TF)
console.log('✓ Keys stored in Constellation')

const hook = await fetch(`https://api.typeform.com/forms/${FORM}/webhooks/constellation`, {
  method: 'PUT',
  headers: { Authorization: 'Bearer ' + TF, 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: url + '/hooks/typeform', enabled: true, secret, verify_ssl: true })
})
if (!hook.ok) die(`Couldn't add the webhook (HTTP ${hook.status}): ${await hook.text()}`)
console.log('✓ Webhook added: new responses now go to ' + url + '/hooks/typeform')
console.log('\nAll set. Submit a test response to the form and it should appear on the board within a few seconds.')
