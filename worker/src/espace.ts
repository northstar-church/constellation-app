// eSpace → Event Calendar. eSpace is the source of truth for what's happening: every 15 minutes the approved
// dates in the categories a team admin switched on come in as read-only events. In Constellation people can only
// set the ministry (for a whole recurring series) and add notes; those survive every sync.
import type { CategoryId, EspaceLink, EspaceStatus } from '../../src/renderer/src/data/types'
import type { TeamMember } from '../../src/renderer/src/data/requests'
import { CATEGORIES } from '../../src/renderer/src/data/constants'
import { alert, type AlertEnv } from './alerts'
import { getTeam } from './collab'
import { TeamError } from './team'

export interface EspaceEnv extends AlertEnv {
  /** Set by espace.command (secret) */
  ESPACE_API_KEY?: string
  /** Local testing only: a stand-in for eSpace */
  ESPACE_API_BASE?: string
}
type Me = { email: string; name: string }
type Row = Record<string, unknown>

const DAYS_AHEAD = 183
const TZ = 'America/New_York'
/** On first sight, these eSpace categories come in; everything else starts switched off */
const DEFAULT_ON: Record<string, CategoryId> = { 'ministry event': 'ministry', 'staff use/meeting': 'staff' }
const CATEGORY_IDS = new Set<string>(CATEGORIES.map((c) => c.id))

const base = (env: EspaceEnv) => (env.ESPACE_API_BASE || 'https://api.espace.cool').replace(/\/$/, '') + '/api/v2'
const today = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)

async function getState(db: D1Database, k: string): Promise<string | null> {
  const r = await db.prepare('SELECT v FROM espace_state WHERE k = ?').bind(k).first<{ v: string | null }>()
  return r?.v ?? null
}
const setState = (db: D1Database, k: string, v: string | null) => db.prepare('INSERT INTO espace_state (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').bind(k, v)

/** eSpace sign-in: the API key buys a token that lasts about a year; ask again when it stops working */
async function client(env: EspaceEnv) {
  const db = env.DB
  let token = await getState(db, 'token')
  const fresh = async () => {
    const r = await fetch(`${base(env)}/requesttoken`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ apiKey: env.ESPACE_API_KEY }) })
    if (!r.ok) throw new Error(`eSpace didn’t accept the API key (HTTP ${r.status}). Make a new key in eSpace (Profile → API Keys) and run espace.command again.`)
    const raw = await r.text()
    let t: unknown = raw
    try {
      const j = JSON.parse(raw)
      t = typeof j === 'string' ? j : j.token ?? j.Token ?? j.access_token ?? j.Data ?? raw
    } catch {
      /* plain text */
    }
    token = String(t).replace(/^"|"$/g, '')
    await setState(db, 'token', token).run()
  }
  if (!token) await fresh()
  return async <T>(path: string): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(base(env) + path, { headers: { Authorization: `Bearer ${token}`, accept: 'application/json' } })
      if (r.status === 401 && attempt === 0) {
        await fresh()
        continue
      }
      if (!r.ok) throw new Error(`eSpace ${path.split('?')[0]} answered ${r.status}`)
      const j = (await r.json()) as unknown
      return (Array.isArray(j) ? j : ((j as Row)?.Data ?? (j as Row)?.data ?? j)) as T
    }
  }
}

/** "2026-11-05T18:30:00" (church time) → date + HH:mm. Times with a zone are converted to church time. */
function split(s: unknown): { date: string; time: string } | null {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(s)) return null
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) {
    const d = new Date(s)
    if (isNaN(+d)) return null
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]))
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` }
  }
  return { date: s.slice(0, 10), time: s.length >= 16 ? s.slice(11, 16) : '00:00' }
}

interface Occurrence {
  OccurrenceId: number
  EventId: number
  EventName: string
  EventStart: string
  EventEnd: string
  IsAllDay?: boolean
  OccurrenceStatus?: string
  EventStatus?: string
  IsFinalApproved?: boolean
  Items?: { Name?: string; ItemType?: string }[]
  Contacts?: { FirstName?: string; LastName?: string; Email?: string }[]
}

/** One sync. Returns whether anything on the calendar changed. */
export async function espaceSync(env: EspaceEnv, broadcast: (what: string) => void): Promise<boolean> {
  if (!env.ESPACE_API_KEY) return false
  const db = env.DB
  try {
    const get = await client(env)

    // Categories: keep the list current, and what each one shows as
    const cats = (await get<{ Id: number; Name: string }[]>('/ministry/categories')).filter((c) => c && c.Id != null)
    const known = new Map(((await db.prepare('SELECT id, map_to FROM espace_categories').all<{ id: number; map_to: string | null }>()).results ?? []).map((r) => [r.id, r.map_to]))
    await db.batch(
      cats.map((c, i) =>
        known.has(c.Id)
          ? db.prepare('UPDATE espace_categories SET name = ?, sort = ? WHERE id = ?').bind(c.Name, i, c.Id)
          : db.prepare('INSERT INTO espace_categories (id, name, map_to, sort) VALUES (?, ?, ?, ?)').bind(c.Id, c.Name, DEFAULT_ON[c.Name.trim().toLowerCase()] ?? null, i)
      )
    )
    const mapping = new Map(cats.map((c) => [c.Id, known.has(c.Id) ? known.get(c.Id)! : (DEFAULT_ON[c.Name.trim().toLowerCase()] ?? null)]))

    // Who created each event, to give it their ministry
    const users = new Map((await get<{ Id: number; FirstName?: string; LastName?: string; Email?: string }[]>('/ministry/users').catch(() => [])).map((u) => [u.Id, { email: (u.Email ?? '').toLowerCase(), name: `${u.FirstName ?? ''} ${u.LastName ?? ''}`.trim() }]))
    const bookers = new Map(((await db.prepare('SELECT email, ministry FROM espace_bookers').all<{ email: string; ministry: string }>()).results ?? []).map((b) => [b.email, b.ministry]))

    const counts: Record<number, number> = {}
    const fresh = new Map<string, { title: string; category: CategoryId; date: string; endDate: string | null; start: string | null; end: string | null; location: string; link: EspaceLink }>()
    for (const c of cats) {
      const occ = await get<Occurrence[]>(`/event/occurrences?nextDays=${DAYS_AHEAD}&categoryIds=${c.Id}`)
      const ok = occ.filter((o) => o && o.OccurrenceId != null && o.IsFinalApproved !== false && !/cancel|declin|denied/i.test(`${o.OccurrenceStatus ?? ''} ${o.EventStatus ?? ''}`))
      counts[c.Id] = ok.length
      const mapTo = mapping.get(c.Id)
      if (!mapTo || !CATEGORY_IDS.has(mapTo) || !ok.length) continue
      const owners = new Map((await get<{ EventId: number; OwnerId?: number }[]>(`/event/list?nextDays=${DAYS_AHEAD}&categoryIds=${c.Id}`).catch(() => [])).map((e) => [e.EventId, e.OwnerId]))
      for (const o of ok) {
        const id = `espace-${o.OccurrenceId}`
        if (fresh.has(id)) continue // in two switched-on categories: the first one wins
        const s = split(o.EventStart)
        const e = split(o.EventEnd)
        if (!s) continue
        const owner = users.get(Number(owners.get(o.EventId)))
        const contact = o.Contacts?.find((x) => x.Email) ?? o.Contacts?.[0]
        const email = (owner?.email || contact?.Email || '').toLowerCase()
        const name = owner?.name || `${contact?.FirstName ?? ''} ${contact?.LastName ?? ''}`.trim() || email || 'Unknown'
        const spaces = [...new Set((o.Items ?? []).filter((it) => it?.Name && !/resource|service/i.test(it.ItemType ?? '')).map((it) => it.Name!.trim()))]
        const allDay = !!o.IsAllDay
        fresh.set(id, {
          title: (o.EventName ?? '').trim() || 'Untitled event',
          category: mapTo as CategoryId,
          date: s.date,
          endDate: e && e.date > s.date ? e.date : null,
          start: allDay ? null : s.time,
          end: allDay || !e ? null : e.time,
          location: spaces.join(', ').slice(0, 200),
          link: { eventId: o.EventId, occurrenceId: o.OccurrenceId, category: c.Name, spaces, url: 'https://app.espace.cool', bookedBy: name, bookedByEmail: email }
        })
      }
    }

    // Safety net: the same thing booked twice in eSpace (same name, day and times, e.g. an old booking nobody
    // canceled) shows once, with both bookings' rooms. The newest booking is the one kept; the panel notes the other.
    const twins = new Map<string, string>()
    for (const [id, f] of [...fresh].sort((a, b) => b[1].link.eventId - a[1].link.eventId)) {
      const k = [f.title.toLowerCase().replace(/\s+/g, ' '), f.date, f.endDate, f.start, f.end].join('|')
      const keep = twins.get(k)
      if (!keep) {
        twins.set(k, id)
        continue
      }
      const kept = fresh.get(keep)!
      if (kept.link.eventId === f.link.eventId) continue // same booking, different occurrence on the same day: leave both
      const spaces = [...new Set([...kept.link.spaces, ...f.link.spaces])]
      kept.link = { ...kept.link, spaces, alsoBooked: [...new Set([...(kept.link.alsoBooked ?? []), f.link.eventId])] }
      kept.location = spaces.join(', ').slice(0, 200)
      fresh.delete(id)
    }

    // Compare with what's on the calendar and write only the differences
    const from = today()
    const have = new Map(((await db.prepare("SELECT id, title, category, ministry, start_date, end_date, start_time, end_time, location, espace FROM events WHERE espace IS NOT NULL").all<Row>()).results ?? []).map((r) => [r.id as string, r]))
    const now = new Date().toISOString()
    const stmts: D1PreparedStatement[] = []
    // A ministry picked by hand belongs to the whole recurring series, including dates that come (back) later
    const seriesByHand = new Map<number, string>()
    for (const r of have.values()) {
      const l = JSON.parse(r.espace as string) as EspaceLink
      if (l.ministryByHand) seriesByHand.set(l.eventId, r.ministry as string)
    }
    for (const [id, f] of fresh) {
      const old = have.get(id)
      const handMinistry = seriesByHand.get(f.link.eventId)
      const byHand = handMinistry !== undefined
      const ministry = byHand ? handMinistry : (bookers.get(f.link.bookedByEmail) ?? 'All church')
      const link = JSON.stringify({ ...f.link, ...(byHand ? { ministryByHand: true } : {}) })
      if (!old) {
        stmts.push(
          db
            .prepare('INSERT INTO events (id,title,category,ministry,start_date,end_date,start_time,end_time,location,owner,notes,template_id,updated_at,updated_by,espace) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
            .bind(id, f.title, f.category, ministry, f.date, f.endDate, f.start, f.end, f.location, '', '', null, now, 'eSpace', link)
        )
      } else if (old.title !== f.title || old.category !== f.category || old.ministry !== ministry || old.start_date !== f.date || (old.end_date ?? null) !== f.endDate || (old.start_time ?? null) !== f.start || (old.end_time ?? null) !== f.end || old.location !== f.location || old.espace !== link) {
        stmts.push(
          db
            .prepare('UPDATE events SET title=?, category=?, ministry=?, start_date=?, end_date=?, start_time=?, end_time=?, location=?, espace=?, updated_at=?, updated_by=? WHERE id=?')
            .bind(f.title, f.category, ministry, f.date, f.endDate, f.start, f.end, f.location, link, now, 'eSpace', id)
        )
      }
    }
    // Gone from eSpace (canceled, unapproved, category switched off). Past dates stay as history.
    for (const [id, r] of have) {
      if (fresh.has(id) || (r.start_date as string) < from) continue
      stmts.push(db.prepare('DELETE FROM milestones WHERE event_id = ?').bind(id), db.prepare('UPDATE requests SET event_id = NULL WHERE event_id = ?').bind(id), db.prepare('DELETE FROM events WHERE id = ?').bind(id))
    }
    for (let i = 0; i < stmts.length; i += 90) await db.batch(stmts.slice(i, i + 90))
    await db.batch([setState(db, 'last_sync', now), setState(db, 'last_error', null), setState(db, 'counts', JSON.stringify(counts))])
    if (stmts.length) broadcast('events')
    broadcast('espace')
    return stmts.length > 0
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e)
    await setState(db, 'last_error', msg).run().catch(() => {})
    broadcast('espace')
    await alert(env, 'espace', msg)
    return false
  }
}

async function status(env: EspaceEnv): Promise<EspaceStatus> {
  const db = env.DB
  const [cats, bookers, mins, st, booked] = await db.batch([
    db.prepare('SELECT id, name, map_to FROM espace_categories ORDER BY sort, name'),
    db.prepare('SELECT email, name, ministry FROM espace_bookers ORDER BY name'),
    db.prepare('SELECT name FROM espace_ministries ORDER BY sort, name'),
    db.prepare("SELECT k, v FROM espace_state WHERE k IN ('last_sync','last_error','counts')"),
    db.prepare("SELECT json_extract(espace,'$.bookedByEmail') AS email, max(json_extract(espace,'$.bookedBy')) AS name, count(*) AS n FROM events WHERE espace IS NOT NULL AND start_date >= ? GROUP BY 1").bind(today())
  ])
  const state = Object.fromEntries(((st.results ?? []) as Row[]).map((r) => [r.k, r.v as string | null]))
  const counts = JSON.parse((state.counts as string) || '{}') as Record<string, number>
  const n = new Map(((booked.results ?? []) as Row[]).map((r) => [String(r.email ?? ''), { name: String(r.name ?? ''), n: Number(r.n) }]))
  const listed = (bookers.results ?? []) as Row[]
  const out = listed.map((b) => ({ email: b.email as string, name: b.name as string, ministry: b.ministry as string, count: n.get(b.email as string)?.n ?? 0 }))
  for (const [email, v] of n) if (email && !listed.some((b) => b.email === email)) out.push({ email, name: v.name || email, ministry: null as unknown as string, count: v.n })
  out.sort((a, b) => (a.ministry ? 1 : 0) - (b.ministry ? 1 : 0) || a.name.localeCompare(b.name))
  return {
    connected: !!env.ESPACE_API_KEY,
    lastSync: (state.last_sync as string) ?? null,
    lastError: (state.last_error as string) ?? null,
    categories: ((cats.results ?? []) as Row[]).map((c) => ({ id: c.id as number, name: c.name as string, mapTo: (c.map_to as CategoryId) ?? null, count: counts[String(c.id)] ?? 0 })),
    bookers: out.map((b) => ({ ...b, ministry: b.ministry ?? null })),
    ministries: ((mins.results ?? []) as Row[]).map((m) => m.name as string)
  }
}

/** /api/espace…: status for everyone; settings for team admins */
export async function espaceApi(request: Request, env: EspaceEnv, me: Me, path: string, changed: (what: string) => void, ctx: ExecutionContext): Promise<Response | null> {
  const db = env.DB
  const method = request.method
  const json = (d: unknown) => new Response(JSON.stringify(d), { headers: { 'content-type': 'application/json' } })
  const body = async () => (await request.json().catch(() => ({}))) as Record<string, unknown>
  const admin = () => {
    const mine = getTeam(env as never).find((m: TeamMember) => m.email.toLowerCase() === me.email.toLowerCase())
    if (!mine?.admin) throw new TeamError(403, 'Only a team admin can change the eSpace settings.')
  }

  if (path === '/api/espace' && method === 'GET') return json(await status(env))

  if (path === '/api/espace/sync' && method === 'POST') {
    if (!env.ESPACE_API_KEY) throw new TeamError(409, 'eSpace isn’t connected yet. Run espace.command once with the eSpace API key.')
    await espaceSync(env, changed)
    return json(await status(env))
  }

  let m = /^\/api\/espace\/categories\/(\d+)$/.exec(path)
  if (m && method === 'PUT') {
    admin()
    const b = await body()
    const mapTo = b.mapTo == null || b.mapTo === '' ? null : String(b.mapTo)
    if (mapTo && !CATEGORY_IDS.has(mapTo)) throw new TeamError(400, 'Unknown category')
    const r = await db.prepare('UPDATE espace_categories SET map_to = ? WHERE id = ?').bind(mapTo, Number(m[1])).run()
    if (!r.meta.changes) throw new TeamError(404, 'That eSpace category is gone. Sync and try again.')
    ctx.waitUntil(espaceSync(env, changed))
    changed('espace')
    return json({ ok: true })
  }

  if (path === '/api/espace/bookers' && method === 'PUT') {
    admin()
    const b = await body()
    const email = String(b.email ?? '').trim().toLowerCase()
    const name = String(b.name ?? '').trim().slice(0, 80)
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) throw new TeamError(400, 'That email doesn’t look right.')
    const ministry = b.ministry == null || b.ministry === '' ? null : String(b.ministry).slice(0, 80)
    if (ministry && ministry !== 'All church') {
      const ok = await db.prepare('SELECT 1 FROM espace_ministries WHERE name = ?').bind(ministry).first()
      if (!ok) throw new TeamError(400, `${ministry} isn’t on the eSpace ministry list. Add it first.`)
    }
    await db.batch([
      ministry
        ? db.prepare('INSERT INTO espace_bookers (email, name, ministry) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET name = excluded.name, ministry = excluded.ministry').bind(email, name || email, ministry)
        : db.prepare('DELETE FROM espace_bookers WHERE email = ?').bind(email),
      // Their events take the new ministry right away (except ones someone set by hand)
      db
        .prepare("UPDATE events SET ministry = ? WHERE espace IS NOT NULL AND json_extract(espace,'$.bookedByEmail') = ? AND coalesce(json_extract(espace,'$.ministryByHand'), 0) = 0")
        .bind(ministry ?? 'All church', email)
    ])
    changed('events')
    changed('espace')
    return json({ ok: true })
  }

  if (path === '/api/espace/ministries' && method === 'PUT') {
    admin()
    const b = await body()
    if (!Array.isArray(b.list)) throw new TeamError(400, 'Expected a list of ministries')
    const list = [...new Set(b.list.map((x) => String(x).trim().slice(0, 60)).filter(Boolean))]
    if (list.length > 60) throw new TeamError(400, 'That’s a lot of ministries. Keep it under 60.')
    const used = ((await db.prepare('SELECT DISTINCT ministry FROM espace_bookers').all<{ ministry: string }>()).results ?? []).map((r) => r.ministry)
    const gone = used.filter((u) => u !== 'All church' && !list.includes(u))
    if (gone.length) throw new TeamError(409, `Move everyone off ${gone.join(', ')} first.`)
    await db.batch([db.prepare('DELETE FROM espace_ministries'), ...list.map((n, i) => db.prepare('INSERT INTO espace_ministries (name, sort) VALUES (?, ?)').bind(n, i))])
    changed('espace')
    return json({ ok: true })
  }

  return null
}
