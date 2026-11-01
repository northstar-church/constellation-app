// The Cloudflare account Constellation runs on: read from wrangler.jsonc (CF_ACCOUNT_ID), so it's set in one place.
import { readFileSync } from 'node:fs'
export const ACCOUNT = /"CF_ACCOUNT_ID":\s*"([0-9a-f]{32})"/.exec(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'))[1]
