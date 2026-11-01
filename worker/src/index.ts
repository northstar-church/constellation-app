import { CATEGORIES } from '../../src/renderer/src/data/constants'
import type { CategoryId, Feed, Milestone, TeamEvent } from '../../src/renderer/src/data/types'
import { identify, type Identity } from './auth'
import { buildIcs } from './ics'
import type { LiveHub } from './live'
import { RequestError, requestsApi, slackHook, trackerRoute, typeformHook, type RequestsEnv } from './requests'
import { CollabError, getTeam, listNotifications, markRead } from './collab'
import { remindDuePosts, socialApi, SocialError } from './social'
import { studioApi, StudioError } from './studio'
import { bookApi, BookError } from './blackbook'
import { brandApi, brandLinkRoute, BrandError } from './brand'
import { reportData } from './reports'
import { alert, weeklySummary, type AlertEnv } from './alerts'
import { migrateRoute, type MigrateEnv } from './migrate'
import { staffCalendarRoute, staffCalendarToken } from './staffcal'
import { espaceApi, espaceSync, type EspaceEnv } from './espace'
import { authRoute, type SessionEnv } from './session'
import { refreshTeam, teamApi, TeamError } from './team'
import { reviewApi, ReviewError, reviewHousekeeping, reviewLinkRoute, reviewOriginalHook } from './review'

export { LiveHub } from './live'

export interface Env extends RequestsEnv, EspaceEnv {
  DB: D1Database
  LIVE: DurableObjectNamespace<LiveHub>
  ASSETS: Fetcher
  ACCESS_TEAM_DOMAIN: string
  ACCESS_AUD: string
  /** Secret that release.command uses to publish app updates. */
  RELEASE_KEY?: string
  /** Local development only: skip Access and act as this user. Never set in production. */
  DEV_USER_EMAIL?: string
  /** Cloudflare account that owns Stream (Video Review) */
  CF_ACCOUNT_ID?: string
  /** Stream: Edit token, set by stream.command (secret) */
  STREAM_TOKEN?: string
  /** Optional: key for Little Black Book account numbers (otherwise derived from RELEASE_KEY) */
  VAULT_KEY?: string
  /** Only while moving to another Cloudflare account (migrate.command sets it) */
  MIGRATE_UNTIL?: string
}

// ---------- helpers ----------

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  })

const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^\d{2}:\d{2}$/
const ID = /^[A-Za-z0-9-]{8,64}$/
const CATEGORY_IDS = new Set<string>(CATEGORIES.map((c) => c.id))

function str(v: unknown, field: string, max = 500, allowEmpty = true): string {
  if (typeof v !== 'string') throw new HttpError(400, `${field} must be text`)
  const s = v.trim()
  if (!allowEmpty && !s) throw new HttpError(400, `${field} is required`)
  if (s.length > max) throw new HttpError(400, `${field} is too long`)
  return s
}
function opt(v: unknown, re: RegExp, field: string): string | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v !== 'string' || !re.test(v)) throw new HttpError(400, `${field} is invalid`)
  return v
}
function req(v: unknown, re: RegExp, field: string): string {
  const s = opt(v, re, field)
  if (!s) throw new HttpError(400, `${field} is required`)
  return s
}

async function body(request: Request): Promise<Record<string, unknown>> {
  try {
    const b = await request.json()
    if (b && typeof b === 'object') return b as Record<string, unknown>
  } catch {
    /* fall through */
  }
  throw new HttpError(400, 'Expected a JSON body')
}

// ---------- row mapping ----------

type Row = Record<string, unknown>

const toEvent = (r: Row): TeamEvent => ({
  id: r.id as string,
  title: r.title as string,
  category: r.category as CategoryId,
  ministry: r.ministry as string,
  startDate: r.start_date as string,
  endDate: (r.end_date as string) ?? null,
  startTime: (r.start_time as string) ?? null,
  endTime: (r.end_time as string) ?? null,
  location: r.location as string,
  owner: r.owner as string,
  notes: r.notes as string,
  templateId: (r.template_id as string) ?? null,
  updatedAt: r.updated_at as string,
  updatedBy: r.updated_by as string,
  espace: r.espace ? (JSON.parse(r.espace as string) as TeamEvent['espace']) : null
})

const toMilestone = (r: Row): Milestone => ({
  id: r.id as string,
  eventId: r.event_id as string,
  title: r.title as string,
  dueDate: r.due_date as string,
  done: !!r.done,
  owner: r.owner as string,
  sortOrder: r.sort_order as number
})

const toFeed = (r: Row): Feed => ({
  id: r.id as string,
  token: r.token as string,
  name: r.name as string,
  categories: r.categories ? (JSON.parse(r.categories as string) as CategoryId[]) : null,
  includeMilestones: !!r.include_milestones,
  createdAt: r.created_at as string,
  createdBy: r.created_by as string
})

async function loadAll(db: D1Database) {
  const [ev, ms] = await db.batch([
    db.prepare('SELECT * FROM events ORDER BY start_date, start_time'),
    db.prepare('SELECT * FROM milestones ORDER BY due_date, sort_order')
  ])
  return { events: (ev.results as Row[]).map(toEvent), milestones: (ms.results as Row[]).map(toMilestone) }
}

const liveHub = (env: Env) => env.LIVE.get(env.LIVE.idFromName('team-calendar'))

function randomToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(24))
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// ---------- API ----------

async function api(request: Request, env: Env, ctx: ExecutionContext, me: Identity, path: string): Promise<Response> {
  const method = request.method
  const db = env.DB
  const changed = (what: string) => ctx.waitUntil(liveHub(env).broadcast(JSON.stringify({ changed: what, by: me.name })))

  if (path === '/api/me' && method === 'GET') return json(me)

  if (path.startsWith('/api/requests')) {
    const origin = new URL(request.url).origin
    const res = await requestsApi(request, env, ctx, me, path, origin, (what = 'requests') => changed(what))
    if (res) return res
  }

  if (path.startsWith('/api/social')) {
    const res = await socialApi(request, env, ctx, me, path, changed)
    if (res) return res
  }

  if (path === '/api/reports' && method === 'GET') return json(await reportData(db))

  if (path.startsWith('/api/brand')) {
    const res = await brandApi(request, env, me, path, changed)
    if (res) return res
  }

  if (path.startsWith('/api/vendors')) {
    const res = await bookApi(request, env, me, path, changed)
    if (res) return res
  }

  if (path.startsWith('/api/review')) {
    const res = await reviewApi(request, env, ctx, me, path, changed)
    if (res) return res
  }

  if (path.startsWith('/api/studio')) {
    const res = await studioApi(request, env, me, path, changed)
    if (res) return res
  }

  if (path === '/api/espace' || path.startsWith('/api/espace/')) {
    const res = await espaceApi(request, env, me, path, changed, ctx)
    if (res) return res
  }

  if (path === '/api/team' || path.startsWith('/api/team/')) {
    const res = await teamApi(request, env, me, path, changed)
    if (res) return res
  }
  if (path === '/api/notifications' && method === 'GET') return json(await listNotifications(env.DB, me.email))
  if (path === '/api/notifications/read' && method === 'POST') {
    const b = await body(request)
    await markRead(env.DB, me.email, Array.isArray(b.ids) ? b.ids.filter((x): x is string => typeof x === 'string') : null)
    changed('notifications')
    return json({ ok: true })
  }

  if (path === '/api/live') {
    if (request.headers.get('Upgrade') !== 'websocket') throw new HttpError(426, 'Expected a WebSocket')
    return liveHub(env).fetch(request)
  }

  if (path === '/api/calendar' && method === 'GET') return json(await loadAll(db))
  if (path === '/api/calendar/staff-link') {
    if (method === 'GET') return json({ token: await staffCalendarToken(db, me.name, false) })
    if (method === 'POST') {
      const token = await staffCalendarToken(db, me.name, true)
      changed('calendar-link')
      return json({ token })
    }
  }

  let m = /^\/api\/events\/([^/]+)$/.exec(path)
  if (m) {
    const id = m[1]
    if (!ID.test(id)) throw new HttpError(400, 'Bad event id')

    const fromEspace = await db.prepare('SELECT espace, ministry FROM events WHERE id = ? AND espace IS NOT NULL').bind(id).first<{ espace: string; ministry: string }>()

    if (method === 'DELETE') {
      if (fromEspace) throw new HttpError(409, 'This event comes from eSpace. Cancel or move it there and it updates here within 15 minutes.')
      await db.batch([
        db.prepare('DELETE FROM milestones WHERE event_id = ?').bind(id),
        db.prepare('DELETE FROM events WHERE id = ?').bind(id),
        // A media request made into this event goes back to "Add To Event Calendar".
        db.prepare('UPDATE requests SET event_id = NULL WHERE event_id = ?').bind(id)
      ])
      changed('events')
      changed('requests')
      return json({ ok: true })
    }

    if (method === 'PUT' && fromEspace) {
      // eSpace owns the name, dates and rooms. Here: the ministry (for every date of a recurring series) and notes.
      const b = await body(request)
      const e = (b.event ?? {}) as Record<string, unknown>
      const ministry = str(e.ministry ?? fromEspace.ministry, 'Ministry', 80)
      const link = JSON.parse(fromEspace.espace) as NonNullable<TeamEvent['espace']>
      const now = new Date().toISOString()
      const stmts = [db.prepare('UPDATE events SET notes = ?, updated_at = ?, updated_by = ? WHERE id = ?').bind(str(e.notes ?? '', 'Notes', 5000), now, me.name, id)]
      if (ministry !== fromEspace.ministry)
        stmts.push(
          db
            .prepare("UPDATE events SET ministry = ?, espace = json_set(espace, '$.ministryByHand', json('true')) WHERE espace IS NOT NULL AND json_extract(espace, '$.eventId') = ?")
            .bind(ministry, link.eventId)
        )
      await db.batch(stmts)
      changed('events')
      return json({ ok: true, updatedAt: now, updatedBy: me.name })
    }

    if (method === 'PUT') {
      const b = await body(request)
      const e = (b.event ?? {}) as Record<string, unknown>
      const list = Array.isArray(b.milestones) ? (b.milestones as Record<string, unknown>[]) : []
      if (list.length > 100) throw new HttpError(400, 'Too many milestones')
      const category = str(e.category, 'Category', 40)
      if (!CATEGORY_IDS.has(category)) throw new HttpError(400, 'Unknown category')
      const startDate = req(e.startDate, DATE, 'Start date')
      const endDate = opt(e.endDate, DATE, 'End date')
      if (endDate && endDate < startDate) throw new HttpError(400, 'End date is before the start date')

      const now = new Date().toISOString()
      const stmts = [
        db
          .prepare(
            `INSERT INTO events (id,title,category,ministry,start_date,end_date,start_time,end_time,location,owner,notes,template_id,updated_at,updated_by)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)
             ON CONFLICT(id) DO UPDATE SET title=?2,category=?3,ministry=?4,start_date=?5,end_date=?6,start_time=?7,end_time=?8,
               location=?9,owner=?10,notes=?11,template_id=?12,updated_at=?13,updated_by=?14`
          )
          .bind(
            id,
            str(e.title, 'Title', 200, false),
            category,
            str(e.ministry ?? 'All church', 'Ministry', 80),
            startDate,
            endDate,
            opt(e.startTime, TIME, 'Start time'),
            opt(e.endTime, TIME, 'End time'),
            str(e.location ?? '', 'Location', 200),
            str(e.owner ?? '', 'Owner', 80),
            str(e.notes ?? '', 'Notes', 5000),
            e.templateId ? str(e.templateId, 'Template', 40) : null,
            now,
            me.name
          ),
        // The client always sends the full milestone list, so replace it.
        db.prepare('DELETE FROM milestones WHERE event_id = ?').bind(id)
      ]
      list.forEach((ms, i) => {
        const msId = str(ms.id, 'Milestone id', 64)
        if (!ID.test(msId)) throw new HttpError(400, 'Bad milestone id')
        stmts.push(
          db
            .prepare('INSERT INTO milestones (id,event_id,title,due_date,done,owner,sort_order) VALUES (?,?,?,?,?,?,?)')
            .bind(msId, id, str(ms.title, 'Milestone', 200, false), req(ms.dueDate, DATE, 'Milestone date'), ms.done ? 1 : 0, str(ms.owner ?? '', 'Milestone owner', 80), i)
        )
      })
      await db.batch(stmts)
      changed('events')
      return json({ ok: true, updatedAt: now, updatedBy: me.name })
    }
  }

  m = /^\/api\/milestones\/([^/]+)$/.exec(path)
  if (m && method === 'PATCH') {
    const b = await body(request)
    if (typeof b.done !== 'boolean') throw new HttpError(400, 'done must be true or false')
    await db.prepare('UPDATE milestones SET done = ? WHERE id = ?').bind(b.done ? 1 : 0, m[1]).run()
    changed('milestones')
    return json({ ok: true })
  }

  if (path === '/api/feeds' && method === 'GET') {
    const { results } = await db.prepare('SELECT * FROM feeds ORDER BY created_at').all()
    return json((results as Row[]).map(toFeed))
  }

  if (path === '/api/feeds' && method === 'POST') {
    const b = await body(request)
    let categories: string[] | null = null
    if (Array.isArray(b.categories)) {
      categories = b.categories.filter((c): c is string => typeof c === 'string' && CATEGORY_IDS.has(c))
      if (!categories.length) throw new HttpError(400, 'Pick at least one category')
      if (categories.length === CATEGORY_IDS.size) categories = null
    }
    const feed: Feed = {
      id: crypto.randomUUID(),
      token: randomToken(),
      name: str(b.name, 'Name', 80, false),
      categories: categories as CategoryId[] | null,
      includeMilestones: !!b.includeMilestones,
      createdAt: new Date().toISOString(),
      createdBy: me.name
    }
    await db
      .prepare('INSERT INTO feeds (id,token,name,categories,include_milestones,created_at,created_by) VALUES (?,?,?,?,?,?,?)')
      .bind(feed.id, feed.token, feed.name, categories ? JSON.stringify(categories) : null, feed.includeMilestones ? 1 : 0, feed.createdAt, feed.createdBy)
      .run()
    return json(feed, 201)
  }

  m = /^\/api\/feeds\/([^/]+)$/.exec(path)
  if (m && method === 'DELETE') {
    await db.prepare('DELETE FROM feeds WHERE id = ?').bind(m[1]).run()
    return json({ ok: true })
  }

  throw new HttpError(404, 'Not found')
}

// ---------- public subscribe feed (protected by its secret token, not by Access) ----------

async function feed(env: Env, token: string, host: string): Promise<Response> {
  const row = await env.DB.prepare('SELECT * FROM feeds WHERE token = ?').bind(token).first<Row>()
  if (!row) return new Response('Calendar not found', { status: 404 })
  const f = toFeed(row)
  const all = await loadAll(env.DB)
  // Only send recent and upcoming items: subscribers don't need years of history.
  const cutoff = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10)
  const events = all.events.filter((e) => (!f.categories || f.categories.includes(e.category)) && (e.endDate ?? e.startDate) >= cutoff)
  const ids = new Set(events.map((e) => e.id))
  const milestones = f.includeMilestones ? all.milestones.filter((m) => ids.has(m.eventId) && m.dueDate >= cutoff) : []
  return new Response(buildIcs(f.name, events, milestones, host), {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': `inline; filename="${f.name.replace(/[^\w -]/g, '')}.ics"`,
      'cache-control': 'private, max-age=300'
    }
  })
}

// ---------- app updates ----------

async function updateFile(env: Env, name: string, method: string): Promise<Response> {
  const obj = await env.FILES.get(`updates/${name}`)
  if (!obj) return new Response('Not found', { status: 404 })
  const type = name.endsWith('.yml')
    ? 'text/yaml; charset=utf-8'
    : name.endsWith('.dmg')
      ? 'application/x-apple-diskimage'
      : name.endsWith('.zip')
        ? 'application/zip'
        : 'application/octet-stream'
  const headers = new Headers({
    'content-type': type,
    'content-length': String(obj.size),
    // The version list must always be fresh; the versioned files never change.
    'cache-control': name.endsWith('.yml') || name === 'Constellation.dmg' ? 'no-cache' : 'public, max-age=31536000, immutable'
  })
  if (name === 'Constellation.dmg') headers.set('content-disposition', 'attachment; filename="Constellation.dmg"')
  return new Response(method === 'HEAD' ? null : obj.body, { headers })
}

/**
 * Publishing a release (release.command only): files arrive in 10 MB pieces, since one request
 * can't carry a 200 MB app. Guarded by the RELEASE_KEY secret; without it these routes don't exist.
 */
async function updateUpload(request: Request, env: Env, url: URL): Promise<Response> {
  const key = request.headers.get('x-release-key') ?? ''
  if (!env.RELEASE_KEY || key.length !== env.RELEASE_KEY.length || key !== env.RELEASE_KEY) return new Response('Not found', { status: 404 })
  const name = url.searchParams.get('name') ?? ''
  if (!/^[\w.-]+$/.test(name)) return json({ error: 'Bad file name' }, 400)
  const objectKey = `updates/${name}`
  const type = url.searchParams.get('type') || 'application/octet-stream'
  const uploadId = url.searchParams.get('uploadId') ?? ''
  switch (url.pathname) {
    case '/updates/_put':
      await env.FILES.put(objectKey, request.body, { httpMetadata: { contentType: type } })
      return json({ ok: true })
    case '/updates/_start': {
      const mpu = await env.FILES.createMultipartUpload(objectKey, { httpMetadata: { contentType: type } })
      return json({ uploadId: mpu.uploadId })
    }
    case '/updates/_part': {
      const part = await env.FILES.resumeMultipartUpload(objectKey, uploadId).uploadPart(Number(url.searchParams.get('part')), request.body!)
      return json(part)
    }
    case '/updates/_finish': {
      const { parts } = (await request.json()) as { parts: R2UploadedPart[] }
      await env.FILES.resumeMultipartUpload(objectKey, uploadId).complete(parts)
      return json({ ok: true })
    }
  }
  return new Response('Not found', { status: 404 })
}

// ---------- entry ----------

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    try {
      const f = /^\/feed\/([A-Za-z0-9_-]{16,64})\.ics$/.exec(url.pathname)
      if (f) return await feed(env, f[1], url.hostname)

      // Requester tracker and Typeform intake: public, each protected by its own secret.
      const live = () => ctx.waitUntil(liveHub(env).broadcast(JSON.stringify({ changed: 'requests' })))
      const bell = () => ctx.waitUntil(liveHub(env).broadcast(JSON.stringify({ changed: 'notifications' })))
      // Video Review links (and the page's own scripts): public, protected by the link's secret
      if (url.pathname.startsWith('/track/review/') || url.pathname.startsWith('/track/assets/')) {
        const res = await reviewLinkRoute(request, env, ctx, url, (what) => ctx.waitUntil(liveHub(env).broadcast(JSON.stringify({ changed: what }))))
        if (res) return res
      }
      // Event Calendar staff page: public, protected by its private link
      if (url.pathname.startsWith('/track/calendar/')) {
        const res = await staffCalendarRoute(request, env, url)
        if (res) return res
      }
      // Brand Library staff page: public, protected by its private link
      if (url.pathname.startsWith('/track/brand/')) {
        const res = await brandLinkRoute(request, env, url)
        if (res) return res
      }
      if (url.pathname.startsWith('/hooks/review-original/')) {
        const res = await reviewOriginalHook(request, env, url)
        if (res) return res
      }
      if (url.pathname.startsWith('/track/')) {
        const res = await trackerRoute(request, env, ctx, url, live, bell)
        if (res) return res
      }
      // App updates: the Mac app checks here for new versions (public; files are uploaded by release.command).
      if (url.pathname.startsWith('/updates/_export/') || url.pathname.startsWith('/updates/_import/')) return (await migrateRoute(request, env as unknown as MigrateEnv, url)) ?? new Response('Not found', { status: 404 })
      if (url.pathname.startsWith('/updates/_')) return await updateUpload(request, env, url)
      const up = /^\/updates\/([\w.-]+)$/.exec(url.pathname)
      if (up && (request.method === 'GET' || request.method === 'HEAD')) return await updateFile(env, up[1], request.method)

      if (url.pathname === '/hooks/slack') return await slackHook(request, env, ctx, live, bell)
      if (url.pathname === '/hooks/typeform') {
        const res = await typeformHook(request, env, ctx, url.origin, live)
        if (res.status >= 400 && res.status !== 405) ctx.waitUntil(alert(env as unknown as AlertEnv, 'typeform', `Typeform’s delivery was rejected (HTTP ${res.status}). New Media Requests may not be arriving. If this keeps happening, run typeform.command again.`))
        return res
      }

      // release.command checks this before switching off Cloudflare's sign-in page
      if (url.pathname === '/hooks/auth-status') return json({ auth: 'constellation' })

      if (url.pathname.startsWith('/api/')) {
        await refreshTeam(env)
        const auth = await authRoute(request, env as unknown as SessionEnv, url.pathname)
        if (auth) return auth
        const me = await identify(request, env)
        if (!me) {
          // A page opened in a browser or sign-in window goes to the sign-in screen, then comes back
          const nav = request.method === 'GET' && (request.headers.get('sec-fetch-mode') === 'navigate' || (request.headers.get('accept') ?? '').includes('text/html'))
          if (nav && url.pathname !== '/api/live') return Response.redirect(`${url.origin}/signin?next=${encodeURIComponent(url.pathname + url.search)}`, 302)
          return json({ error: 'Not signed in' }, 401)
        }
        const listed = getTeam(env).find((m) => m.email && m.email === me.email)
        if (listed) me.name = listed.name
        return await api(request, env, ctx, me, url.pathname)
      }

      return env.ASSETS.fetch(request)
    } catch (err) {
      if (err instanceof HttpError || err instanceof RequestError || err instanceof CollabError || err instanceof SocialError || err instanceof StudioError || err instanceof ReviewError || err instanceof BookError || err instanceof BrandError || err instanceof TeamError) return json({ error: err.message }, err.status)
      console.error(err)
      ctx.waitUntil(alert(env as unknown as AlertEnv, 'server-error', `${request.method} ${url.pathname}: ${(err as Error)?.message ?? String(err)}`))
      return json({ error: 'Something went wrong on the server' }, 500)
    }
  },

  /** Cron (every 5 minutes): posting-time reminders for scheduled social posts. */
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const broadcast = (what: string) => liveHub(env).broadcast(JSON.stringify({ changed: what }))
    await refreshTeam(env).catch(() => {})
    const a = env as unknown as AlertEnv
    const watch = (name: string, p: Promise<unknown>) => p.catch((e) => alert(a, 'cron', `${name}: ${(e as Error)?.message ?? String(e)}`))
    ctx.waitUntil(watch('Posting reminders', remindDuePosts(env, broadcast)))
    // Once an hour: Video Review clean-up (archive, warnings, Stream deletion dates)
    if (new Date(event.scheduledTime).getUTCMinutes() < 5) ctx.waitUntil(watch('Video Review clean-up', reviewHousekeeping(env, broadcast)))
    ctx.waitUntil(watch('Weekly check-in', weeklySummary(a, new Date(event.scheduledTime))))
    // Every 15 minutes: bring in approved events from eSpace
    if (new Date(event.scheduledTime).getUTCMinutes() % 15 < 5) ctx.waitUntil(watch('eSpace sync', espaceSync(env, broadcast)))
  }
} satisfies ExportedHandler<Env>
