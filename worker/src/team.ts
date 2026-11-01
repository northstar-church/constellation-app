import { DEFAULT_TEAM, parseTeam, type TeamMember } from '../../src/renderer/src/data/requests'
import { setTeamCache, type CollabEnv } from './collab'

/** The team list, stored in D1 and edited on the Team screen by team admins. */

export class TeamError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
  }
}

type Row = Record<string, unknown>
type Me = { name: string; email: string }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
const now = () => new Date().toISOString()
const EMAIL = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i
const toMember = (r: Row): TeamMember => ({ name: r.name as string, email: r.email as string, pm: !!r.pm, assignable: !!r.assignable, socialLead: !!r.social_lead, admin: !!r.admin })

let loadedAt = 0
let current: TeamMember[] = []
let inFlight: Promise<TeamMember[]> | null = null

async function readTeam(env: CollabEnv): Promise<TeamMember[]> {
  const { results } = await env.DB.prepare('SELECT * FROM team_members ORDER BY sort, added_at').all<Row>()
  if (results?.length) return results.map(toMember)
  // First run: start from the list that was set up before (wrangler.jsonc), with Jeremy and Stephanie as team admins
  const seed = parseTeam(env.TEAM_MEMBERS) ?? DEFAULT_TEAM
  const admins = new Set(DEFAULT_TEAM.filter((m) => m.admin).map((m) => m.email))
  const at = now()
  await env.DB.batch(
    seed
      .filter((m) => m.email)
      .map((m, i) =>
        env.DB.prepare('INSERT OR IGNORE INTO team_members (email, name, pm, assignable, social_lead, admin, sort, added_at, added_by) VALUES (?,?,?,?,?,?,?,?,?)').bind(
          m.email.toLowerCase(),
          m.name,
          m.pm ? 1 : 0,
          m.assignable === false ? 0 : 1,
          m.socialLead ? 1 : 0,
          m.admin || admins.has(m.email.toLowerCase()) ? 1 : 0,
          i,
          at,
          'setup'
        )
      )
  )
  const again = await env.DB.prepare('SELECT * FROM team_members ORDER BY sort, added_at').all<Row>()
  return (again.results ?? []).map(toMember)
}

/** Loads the team into memory (at most every 15 seconds, or right away after a change). */
export async function refreshTeam(env: CollabEnv, force = false): Promise<TeamMember[]> {
  if (!force && Date.now() - loadedAt < 15_000 && !inFlight) return current
  inFlight ??= readTeam(env)
    .then((t) => {
      setTeamCache(t)
      current = t
      loadedAt = Date.now()
      return t
    })
    .finally(() => (inFlight = null))
  return inFlight
}

export async function teamApi(request: Request, env: CollabEnv, me: Me, path: string, changed: (what: string) => void): Promise<Response | null> {
  const db = env.DB
  const method = request.method
  const team = await refreshTeam(env, true)
  const mine = team.find((m) => m.email === me.email)
  const mustAdmin = () => {
    if (!mine?.admin) throw new TeamError(403, 'Only a team admin can change the team.')
  }
  const done = async () => {
    await refreshTeam(env, true)
    changed('team')
    changed('requests')
    return json({ ok: true })
  }

  if (path === '/api/team' && method === 'GET') {
    const { results } = await db.prepare("SELECT email, MAX(last_seen) AS last, COUNT(*) AS n FROM sessions WHERE expires_at > ? GROUP BY email").bind(now()).all<Row>()
    const seen = new Map((results ?? []).map((r) => [r.email as string, r]))
    return json(team.map((m) => ({ ...m, lastActive: (seen.get(m.email)?.last as string) ?? null, devices: Number(seen.get(m.email)?.n ?? 0) })))
  }

  if (path === '/api/team' && method === 'POST') {
    mustAdmin()
    const b = (await request.json().catch(() => ({}))) as Partial<TeamMember>
    const email = String(b.email ?? '').trim().toLowerCase()
    const name = String(b.name ?? '').trim().slice(0, 80)
    if (!name) throw new TeamError(400, 'Add their name.')
    if (!EMAIL.test(email)) throw new TeamError(400, 'That email doesn’t look right.')
    if (team.some((m) => m.email === email)) throw new TeamError(409, `${email} is already on the team.`)
    if (team.some((m) => m.name.toLowerCase() === name.toLowerCase())) throw new TeamError(409, `Someone named ${name} is already on the team. Add a middle initial or last name to tell them apart.`)
    const stmts = []
    if (b.socialLead) stmts.push(db.prepare('UPDATE team_members SET social_lead = 0'))
    stmts.push(
      db.prepare('INSERT INTO team_members (email, name, pm, assignable, social_lead, admin, sort, added_at, added_by) VALUES (?,?,?,?,?,?,?,?,?)').bind(email, name, b.pm ? 1 : 0, b.assignable ? 1 : 0, b.socialLead ? 1 : 0, b.admin ? 1 : 0, team.length, now(), me.name)
    )
    await db.batch(stmts)
    return done()
  }

  const m = /^\/api\/team\/([^/]+)(\/sessions)?$/.exec(path)
  if (!m) return null
  const email = decodeURIComponent(m[1]).toLowerCase()
  const who = team.find((t) => t.email === email)
  if (!who) throw new TeamError(404, 'They’re no longer on the team.')
  const admins = team.filter((t) => t.admin).length

  if (m[2] && method === 'DELETE') {
    if (email !== me.email) mustAdmin()
    await db.prepare('DELETE FROM sessions WHERE email = ?').bind(email).run()
    return done()
  }
  if (m[2]) return null

  if (method === 'PATCH') {
    mustAdmin()
    const b = (await request.json().catch(() => ({}))) as Partial<TeamMember>
    const sets: string[] = []
    const vals: unknown[] = []
    if (typeof b.name === 'string' && b.name.trim()) (sets.push('name = ?'), vals.push(b.name.trim().slice(0, 80)))
    if (typeof b.pm === 'boolean') (sets.push('pm = ?'), vals.push(b.pm ? 1 : 0))
    if (typeof b.assignable === 'boolean') (sets.push('assignable = ?'), vals.push(b.assignable ? 1 : 0))
    if (typeof b.admin === 'boolean') {
      if (!b.admin && who.admin && admins === 1) throw new TeamError(409, 'Someone has to be able to manage the team. Make another person a team admin first.')
      sets.push('admin = ?')
      vals.push(b.admin ? 1 : 0)
    }
    const stmts = []
    if (typeof b.socialLead === 'boolean') {
      if (b.socialLead) stmts.push(db.prepare('UPDATE team_members SET social_lead = 0'))
      sets.push('social_lead = ?')
      vals.push(b.socialLead ? 1 : 0)
    }
    if (!sets.length) return json({ ok: true })
    stmts.push(db.prepare(`UPDATE team_members SET ${sets.join(', ')} WHERE email = ?`).bind(...vals, email))
    await db.batch(stmts)
    return done()
  }

  if (method === 'DELETE') {
    mustAdmin()
    if (email === me.email) throw new TeamError(409, 'You can’t remove yourself. Ask another team admin.')
    if (who.admin && admins === 1) throw new TeamError(409, 'Someone has to be able to manage the team. Make another person a team admin first.')
    await db.batch([db.prepare('DELETE FROM team_members WHERE email = ?').bind(email), db.prepare('DELETE FROM sessions WHERE email = ?').bind(email)])
    return done()
  }
  return null
}
