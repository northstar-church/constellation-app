import { notifyPerson, type SlackEnv } from './slack'
import { refreshTeam } from './team'
import type { CollabEnv } from './collab'

/**
 * Constellation's own sign-in: church email → 6-digit code by Slack DM → a session that lasts a year
 * and renews while it's used. Only hashes of codes and session keys are stored.
 */

export interface SessionEnv extends CollabEnv, SlackEnv {
  RELEASE_KEY?: string
}
export interface Identity {
  email: string
  name: string
}

const COOKIE = 'cs_session'
const YEAR = 365 * 86400_000
const CODE_TTL = 10 * 60_000
const MAX_CODES_PER_HOUR = 5
const MAX_TRIES = 5
const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } })
const now = () => new Date().toISOString()
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
const sha = async (s: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
const b64url = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const cookieOf = (req: Request) => new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(req.headers.get('Cookie') ?? '')?.[1] ?? ''
const setCookie = (token: string, maxAge: number) => `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`

/** Equal-time string compare */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

/** Who's signed in, from the session cookie (or "Authorization: Bearer"). Renews the session while it's used. */
export async function sessionIdentify(req: Request, env: SessionEnv): Promise<Identity | null> {
  const token = cookieOf(req) || /^Bearer\s+(\S+)$/.exec(req.headers.get('Authorization') ?? '')?.[1] || ''
  if (!token || token.length < 30) return null
  const id = await sha(token)
  const row = await env.DB.prepare('SELECT email, last_seen, expires_at FROM sessions WHERE id = ?').bind(id).first<{ email: string; last_seen: string; expires_at: string }>()
  if (!row || row.expires_at < now()) return null
  const team = await refreshTeam(env)
  const member = team.find((m) => m.email === row.email)
  if (!member) return null // removed from the team
  if (Date.now() - Date.parse(row.last_seen) > 6 * 3600_000) {
    await env.DB.prepare('UPDATE sessions SET last_seen = ?, expires_at = ?, agent = ? WHERE id = ?')
      .bind(now(), new Date(Date.now() + YEAR).toISOString(), (req.headers.get('user-agent') ?? '').slice(0, 200), id)
      .run()
  }
  return { email: member.email, name: member.name }
}

/** /api/auth/*: start (send a code), verify (sign in), signout. Public: no session needed. */
export async function authRoute(request: Request, env: SessionEnv, path: string): Promise<Response | null> {
  if (!path.startsWith('/api/auth/')) return null
  if (request.method !== 'POST') return json({ error: 'Not allowed' }, 405)
  const body = (await request.json().catch(() => ({}))) as { email?: string; code?: string }
  const email = String(body.email ?? '').trim().toLowerCase()
  const pepper = env.RELEASE_KEY ?? 'constellation'

  if (path === '/api/auth/start') {
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) return json({ error: 'Enter your church email, like first.last@northstarchurch.org.' }, 400)
    const team = await refreshTeam(env, true)
    const member = team.find((m) => m.email === email)
    if (!member) return json({ error: 'That email isn’t on the Constellation team. Ask Jeremy or Stephanie to add you.' }, 403)
    const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM login_codes WHERE email = ? AND created_at > ?').bind(email, new Date(Date.now() - 3600_000).toISOString()).first<{ n: number }>()
    if ((recent?.n ?? 0) >= MAX_CODES_PER_HOUR) return json({ error: 'Too many codes in the last hour. Use the most recent one, or try again later.' }, 429)
    const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000
    const code = String(n).padStart(6, '0')
    await env.DB.prepare('INSERT INTO login_codes (email, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?)').bind(email, await sha(`${email}:${code}:${pepper}`), new Date(Date.now() + CODE_TTL).toISOString(), now()).run()
    const sent = await notifyPerson(
      env,
      email,
      `Your Constellation sign-in code is *${code.slice(0, 3)} ${code.slice(3)}*\nIt works for 10 minutes. If you didn’t just try to sign in, you can ignore this.`
    )
    if (!sent) {
      await env.DB.prepare('DELETE FROM login_codes WHERE email = ?').bind(email).run()
      return json({ error: `Couldn’t find ${email} in Slack, so the code couldn’t be sent. Make sure you’re in the NorthStar Slack with this email.` }, 502)
    }
    return json({ ok: true, via: 'slack' })
  }

  if (path === '/api/auth/verify') {
    const code = String(body.code ?? '').replace(/\D/g, '')
    if (!email || code.length !== 6) return json({ error: 'Enter the 6-digit code from Slack.' }, 400)
    const row = await env.DB.prepare('SELECT rowid AS id, code_hash, expires_at, attempts FROM login_codes WHERE email = ? ORDER BY created_at DESC LIMIT 1').bind(email).first<{ id: number; code_hash: string; expires_at: string; attempts: number }>()
    if (!row || row.expires_at < now()) return json({ error: 'That code has expired. Send a new one.' }, 400)
    if (row.attempts >= MAX_TRIES) return json({ error: 'Too many wrong tries. Send a new code.' }, 429)
    if (!same(await sha(`${email}:${code}:${pepper}`), row.code_hash)) {
      await env.DB.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE rowid = ?').bind(row.id).run()
      return json({ error: row.attempts + 1 >= MAX_TRIES ? 'That’s not the code, and that was the last try. Send a new code.' : 'That’s not the code. Check the latest Slack message and try again.' }, 400)
    }
    const team = await refreshTeam(env, true)
    const member = team.find((m) => m.email === email)
    if (!member) return json({ error: 'That email isn’t on the Constellation team anymore.' }, 403)
    const token = b64url(crypto.getRandomValues(new Uint8Array(32)))
    await env.DB.batch([
      env.DB.prepare('DELETE FROM login_codes WHERE email = ?').bind(email),
      env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now()),
      env.DB.prepare('INSERT INTO sessions (id, email, created_at, last_seen, expires_at, agent) VALUES (?,?,?,?,?,?)').bind(
        await sha(token),
        email,
        now(),
        now(),
        new Date(Date.now() + YEAR).toISOString(),
        (request.headers.get('user-agent') ?? '').slice(0, 200)
      )
    ])
    // The Mac app keeps the key itself; browsers only get the HttpOnly cookie
    const app = request.headers.get('x-constellation-app') === '1'
    return json({ ok: true, ...(app ? { token } : {}), me: { email: member.email, name: member.name } }, 200, { 'Set-Cookie': setCookie(token, 400 * 86400) })
  }

  if (path === '/api/auth/signout') {
    const token = cookieOf(request) || /^Bearer\s+(\S+)$/.exec(request.headers.get('Authorization') ?? '')?.[1] || ''
    if (token) await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha(token)).run()
    return json({ ok: true }, 200, { 'Set-Cookie': setCookie('', 0) })
  }
  return json({ error: 'Not found' }, 404)
}
