import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { Env } from './index'
import { sessionIdentify, type SessionEnv } from './session'

export interface Identity {
  email: string
  name: string
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null
let jwksDomain = ''

/** "jeremy.thompson@…" → "Jeremy Thompson" */
export function nameFromEmail(email: string): string {
  return email
    .split('@')[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join(' ')
}

/**
 * Cloudflare Access sits in front of the whole app and handles sign-in (emailed codes).
 * Every request it lets through carries a signed JWT, which we verify here so the API
 * can never be reached around Access.
 */
export async function identify(req: Request, env: Env): Promise<Identity | null> {
  if (env.DEV_USER_EMAIL) {
    // Local development only: an x-dev-user header acts as another teammate.
    const email = (req.headers.get('x-dev-user') || env.DEV_USER_EMAIL).toLowerCase()
    return { email, name: nameFromEmail(email) }
  }
  // Constellation's own sign-in (code by Slack DM)
  const viaSession = await sessionIdentify(req, env as unknown as SessionEnv)
  if (viaSession) return viaSession
  // Cloudflare Access (before the switch to Constellation's own sign-in)
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null

  const token =
    req.headers.get('Cf-Access-Jwt-Assertion') ??
    /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(req.headers.get('Cookie') ?? '')?.[1]
  if (!token) return null

  const issuer = `https://${env.ACCESS_TEAM_DOMAIN.replace(/^https?:\/\//, '')}`
  if (!jwks || jwksDomain !== issuer) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`))
    jwksDomain = issuer
  }
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer, audience: env.ACCESS_AUD })
    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : ''
    return email ? { email, name: nameFromEmail(email) } : null
  } catch {
    return null
  }
}
