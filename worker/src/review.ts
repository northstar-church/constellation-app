import { alert, type AlertEnv } from './alerts'
import { findMember, type TeamMember } from '../../src/renderer/src/data/requests'
import {
  leavesStreamAt,
  mentionsIn,
  RETENTION,
  timecode,
  type Review,
  type ReviewComment,
  type ReviewDecision,
  type ReviewSnapshot,
  type ReviewVersion,
  type ShareLink,
  type Stroke
} from '../../src/renderer/src/data/review'
import { cleanName, getTeam, notify, type CollabEnv } from './collab'
import { eventStmt } from './requests'

/** Video Review API: reviews, versions (R2 originals + Cloudflare Stream playback), comments, approvals and review links. */

export interface ReviewEnv extends CollabEnv {
  ASSETS: Fetcher
  PUBLIC_URL?: string
  /** Cloudflare account that owns Stream */
  CF_ACCOUNT_ID?: string
  /** API token with Stream: Edit (secret) */
  STREAM_TOKEN?: string
  /** Local testing only: a stand-in for Cloudflare's API */
  STREAM_API_BASE?: string
}

export class ReviewError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
  }
}

type Row = Record<string, unknown>
type Me = { name: string; email: string }
const ID = /^[A-Za-z0-9-]{8,64}$/
const TOKEN = /^[A-Za-z0-9]{16,64}$/
const STATUSES = new Set(['in-progress', 'needs-review', 'changes', 'approved'])
const TOOLS = new Set(['pen', 'arrow', 'rect', 'ellipse'])
const EMOJI = new Set(['👍', '❤️', '😂', '🎉', '👀', '🔥'])
const PART_MAX = 95 * 1024 * 1024
const DAY = 86_400_000

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const parse = <T>(v: unknown, fallback: T): T => {
  try {
    return typeof v === 'string' ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}
const now = () => new Date().toISOString()

// ---------- rows → shared types ----------

/** Where media is served from: the team app (/api/review) or a review link (/track/review/<token>) */
type Base = string

const toVersion = (r: Row, base: Base): ReviewVersion => {
  const kind = r.kind === 'image' ? 'image' : 'video'
  const archived = r.archived === 1
  return {
    id: r.id as string,
    n: r.n as number,
    kind,
    name: r.name as string,
    size: r.size as number,
    duration: r.duration as number,
    fps: r.fps as number,
    width: r.width as number,
    height: r.height as number,
    state: r.state as ReviewVersion['state'],
    src: kind === 'image' ? `${base}/media/${r.id}` : archived ? '' : (r.hls as string),
    thumb: r.has_thumb === 1 ? `${base}/thumb/${r.id}` : '',
    uploadedBy: r.uploaded_by as string,
    at: r.at as string,
    archived,
    hasOriginal: true,
    restoredAt: (r.restored_at as string) ?? null,
    error: (r.error as string) || undefined
  }
}
const toReview = (r: Row, versions: ReviewVersion[]): Review => ({
  id: r.id as string,
  title: r.title as string,
  folder: r.folder as string,
  status: r.status as Review['status'],
  requestId: (r.request_id as string) || null,
  versions,
  keep: r.keep === 1,
  createdBy: r.created_by as string,
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string
})
const toComment = (r: Row): ReviewComment => ({
  id: r.id as string,
  reviewId: r.review_id as string,
  versionId: r.version_id as string,
  parentId: (r.parent_id as string) || null,
  author: r.author as string,
  guest: r.guest === 1,
  body: r.body as string,
  t: (r.t as number) ?? null,
  tEnd: (r.t_end as number) ?? null,
  pin: parse<[number, number] | null>(r.pin, null),
  drawing: parse<Stroke[]>(r.drawing, []),
  resolved: r.resolved === 1,
  reactions: parse<Record<string, string[]>>(r.reactions, {}),
  at: r.at as string,
  editedAt: (r.edited_at as string) ?? null
})
const toDecision = (r: Row): ReviewDecision => ({
  id: r.id as string,
  reviewId: r.review_id as string,
  versionId: r.version_id as string,
  by: r.by_name as string,
  guest: r.guest === 1,
  decision: r.decision === 'approved' ? 'approved' : 'changes',
  note: r.note as string,
  at: r.at as string
})
const toLink = (r: Row): ShareLink => ({
  id: r.id as string,
  reviewId: r.review_id as string,
  token: r.token as string,
  label: r.label as string,
  allowComments: r.allow_comments === 1,
  allowDownload: r.allow_download === 1,
  allVersions: r.all_versions === 1,
  expiresAt: (r.expires_at as string) ?? null,
  active: r.active === 1,
  views: r.views as number,
  createdBy: r.created_by as string,
  createdAt: r.created_at as string
})

async function snapshot(db: D1Database, base: Base, only?: { reviewId: string; latestOnly: boolean }): Promise<ReviewSnapshot> {
  const where = only ? ' WHERE review_id = ?' : ''
  const bind = (sql: string) => (only ? db.prepare(sql).bind(only.reviewId) : db.prepare(sql))
  const [rv, vs, cs, ds, ls] = await db.batch([
    only ? db.prepare('SELECT * FROM review_reviews WHERE id = ?').bind(only.reviewId) : db.prepare('SELECT * FROM review_reviews ORDER BY updated_at DESC'),
    bind(`SELECT * FROM review_versions${where} ORDER BY n`),
    bind(`SELECT * FROM review_comments${where} ORDER BY at`),
    bind(`SELECT * FROM review_decisions${where} ORDER BY at`),
    only ? db.prepare('SELECT * FROM review_links WHERE 0') : db.prepare('SELECT * FROM review_links ORDER BY created_at')
  ])
  const byReview = new Map<string, ReviewVersion[]>()
  for (const v of vs.results as Row[]) byReview.set(v.review_id as string, [...(byReview.get(v.review_id as string) ?? []), toVersion(v, base)])
  let reviews = (rv.results as Row[]).map((r) => toReview(r, byReview.get(r.id as string) ?? [])).filter((r) => r.versions.length)
  if (only?.latestOnly) reviews = reviews.map((r) => ({ ...r, versions: r.versions.slice(-1) }))
  const visible = new Set(reviews.flatMap((r) => r.versions.map((v) => v.id)))
  return {
    reviews,
    comments: (cs.results as Row[]).map(toComment).filter((c) => visible.has(c.versionId)),
    decisions: (ds.results as Row[]).map(toDecision).filter((d) => visible.has(d.versionId)),
    links: (ls.results as Row[]).map(toLink)
  }
}

async function getReview(db: D1Database, id: string): Promise<Review> {
  const s = await snapshot(db, '/api/review', { reviewId: id, latestOnly: false })
  const r = s.reviews[0]
  if (!r) throw new ReviewError(404, 'That review no longer exists.')
  return r
}

const touch = (db: D1Database, id: string) => db.prepare('UPDATE review_reviews SET updated_at = ? WHERE id = ?').bind(now(), id)

// ---------- Cloudflare Stream ----------

const streamReady = (env: ReviewEnv) => !!env.STREAM_TOKEN && !!env.CF_ACCOUNT_ID

async function stream(env: ReviewEnv, path: string, method = 'GET', body?: unknown): Promise<{ ok: boolean; status: number; result: Record<string, unknown> | null; error: string }> {
  const res = await fetch(`${env.STREAM_API_BASE || 'https://api.cloudflare.com/client/v4'}/accounts/${env.CF_ACCOUNT_ID}/stream${path}`, {
    method,
    headers: { authorization: `Bearer ${env.STREAM_TOKEN}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const data = (await res.json().catch(() => ({}))) as { success?: boolean; result?: Record<string, unknown>; errors?: { message: string }[] }
  return { ok: res.ok && data.success !== false, status: res.status, result: data.result ?? null, error: data.errors?.map((e) => e.message).join('; ') || `HTTP ${res.status}` }
}

async function hmac(env: ReviewEnv, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`review-original:${env.STREAM_TOKEN}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Stream's own deletion date: a week after Constellation means to archive it, as a safety net. */
const backstop = (r: Review, v: ReviewVersion) => {
  const at = leavesStreamAt(r, { ...v, archived: false })
  return at ? new Date(at.getTime() + 7 * DAY).toISOString() : null
}

/** Has Stream copy the original from R2 (through a short-lived signed link) and prepare it for playback. */
async function sendToStream(env: ReviewEnv, r: Review, v: ReviewVersion): Promise<void> {
  if (!streamReady(env)) throw new ReviewError(503, 'Video streaming isn’t set up yet. Run stream.command on the Mac (see SETUP.md).')
  const exp = Date.now() + 12 * 3600_000
  const sig = await hmac(env, `${v.id}.${exp}`)
  const base = (env.PUBLIC_URL || '').replace(/\/$/, '')
  const del = backstop(r, v)
  const res = await stream(env, '/copy', 'POST', {
    url: `${base}/hooks/review-original/${v.id}?exp=${exp}&sig=${sig}`,
    meta: { name: `${r.title} v${v.n}`, constellation: v.id },
    ...(del ? { scheduledDeletion: del } : {})
  })
  if (!res.ok || !res.result?.uid) throw new ReviewError(502, `Cloudflare Stream didn’t take the video: ${res.error}`)
  await env.DB.prepare("UPDATE review_versions SET stream_uid = ?, hls = '', state = 'processing', error = '', archived = 0, stream_delete_at = ?, checked_at = NULL WHERE id = ?")
    .bind(res.result.uid as string, del, v.id)
    .run()
}

async function dropFromStream(env: ReviewEnv, uid: string) {
  if (!uid || !streamReady(env)) return
  const res = await stream(env, `/${uid}`, 'DELETE')
  if (!res.ok && res.status !== 404) console.error('Stream delete failed', uid, res.error)
}

/** Asks Stream how videos still processing are doing (at most every 10 seconds each). */
async function refreshProcessing(env: ReviewEnv, reviewId?: string): Promise<boolean> {
  if (!streamReady(env)) return false
  const cutoff = new Date(Date.now() - 10_000).toISOString()
  const { results } = await env.DB.prepare(
    `SELECT id, stream_uid, duration, width, height FROM review_versions WHERE state = 'processing' AND stream_uid != '' AND (checked_at IS NULL OR checked_at < ?)${reviewId ? ' AND review_id = ?' : ''} LIMIT 8`
  )
    .bind(...(reviewId ? [cutoff, reviewId] : [cutoff]))
    .all<Row>()
  let changed = false
  for (const v of results ?? []) {
    const res = await stream(env, `/${v.stream_uid}`)
    const r = res.result
    const state = (r?.status as { state?: string; errorReasonText?: string } | undefined)?.state
    if (r && r.readyToStream && (r.playback as { hls?: string })?.hls) {
      const input = (r.input as { width?: number; height?: number }) ?? {}
      await env.DB.prepare("UPDATE review_versions SET state = 'ready', hls = ?, duration = ?, width = ?, height = ?, checked_at = ? WHERE id = ?")
        .bind((r.playback as { hls: string }).hls, (r.duration as number) > 0 ? r.duration : v.duration, input.width || v.width, input.height || v.height, now(), v.id)
        .run()
      changed = true
    } else if (state === 'error' || (!res.ok && res.status === 404)) {
      const why = (r?.status as { errorReasonText?: string } | undefined)?.errorReasonText || 'Stream couldn’t process this file.'
      await env.DB.prepare("UPDATE review_versions SET state = 'error', error = ?, checked_at = ? WHERE id = ?").bind(why, now(), v.id).run()
      await alert(env as unknown as AlertEnv, 'stream', `Version ${v.n} of a review couldn’t be processed by Stream: ${why}`)
      changed = true
    } else {
      await env.DB.prepare('UPDATE review_versions SET checked_at = ? WHERE id = ?').bind(now(), v.id).run()
    }
  }
  return changed
}

// ---------- notifications ----------

const emailOf = (team: TeamMember[], name: string) => findMember(team, name)?.email?.toLowerCase() ?? ''

/** Who follows a review: whoever made it, uploaded a version, or commented (team only). */
async function followers(env: ReviewEnv, reviewId: string): Promise<Set<string>> {
  const [a, b, c] = await env.DB.batch([
    env.DB.prepare('SELECT created_by_email AS e FROM review_reviews WHERE id = ?').bind(reviewId),
    env.DB.prepare('SELECT DISTINCT uploaded_by_email AS e FROM review_versions WHERE review_id = ?').bind(reviewId),
    env.DB.prepare('SELECT DISTINCT author_email AS e FROM review_comments WHERE review_id = ? AND guest = 0').bind(reviewId)
  ])
  return new Set([...(a.results as Row[]), ...(b.results as Row[]), ...(c.results as Row[])].map((r) => String(r.e || '').toLowerCase()).filter(Boolean))
}

async function notifyComment(env: ReviewEnv, r: Review, v: ReviewVersion, c: ReviewComment, authorEmail: string) {
  const team = getTeam(env)
  const who = await followers(env, r.id)
  for (const n of mentionsIn(c.body, team.map((m) => m.name))) {
    const e = emailOf(team, n)
    if (e) who.add(e)
  }
  who.delete(authorEmail.toLowerCase())
  const at = c.t != null ? ` at ${timecode(c.t, v.fps)}` : ''
  const first = c.author.split(' ')[0]
  await notify(
    env,
    [...who],
    { requestId: r.id, kind: 'review-comment', actor: c.author, message: `v${v.n}${at}: ${c.body.slice(0, 160)}`, at: c.at },
    `💬 *${first}*${c.guest ? ' (review link)' : ''} commented on *${r.title}* v${v.n}${at}:\n>${c.body.replace(/\n/g, '\n>')}\nOpen Constellation → Video Review.`
  )
}

// ---------- shared actions (team and review links) ----------

function cleanStrokes(v: unknown): Stroke[] {
  if (!Array.isArray(v)) return []
  return v
    .slice(0, 40)
    .filter((s) => s && TOOLS.has(s.tool) && Array.isArray(s.points))
    .map((s) => ({
      tool: s.tool,
      color: /^#[0-9a-f]{6}$/i.test(String(s.color)) ? String(s.color) : '#ff3b30',
      points: (s.points as unknown[])
        .slice(0, 600)
        .filter((p): p is [number, number] => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && n >= -0.1 && n <= 1.1))
        .map(([x, y]) => [Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000] as [number, number])
    }))
    .filter((s) => s.points.length >= 2)
}

async function addComment(env: ReviewEnv, b: Record<string, unknown>, who: { name: string; email: string; guest: boolean }, allowedVersions: Set<string> | null): Promise<ReviewComment> {
  const versionId = str(b.versionId, 64)
  const v = await env.DB.prepare('SELECT * FROM review_versions WHERE id = ?').bind(versionId).first<Row>()
  if (!v || (allowedVersions && !allowedVersions.has(versionId))) throw new ReviewError(404, 'That version is no longer here.')
  const parentId = str(b.parentId, 64) || null
  if (parentId) {
    const p = await env.DB.prepare('SELECT version_id FROM review_comments WHERE id = ? AND parent_id IS NULL').bind(parentId).first<Row>()
    if (!p) throw new ReviewError(404, 'That comment was deleted.')
  }
  const drawing = parentId ? [] : cleanStrokes(b.drawing)
  const body = str(b.body, 5000).trim()
  if (!body && !drawing.length) throw new ReviewError(400, 'Write a comment or draw something first.')
  const t = parentId ? null : num(b.t)
  const tEnd = t != null ? num(b.tEnd) : null
  const pinRaw = Array.isArray(b.pin) && b.pin.length === 2 && b.pin.every((n) => typeof n === 'number' && n >= 0 && n <= 1) ? (b.pin as [number, number]) : null
  const c: ReviewComment = {
    id: crypto.randomUUID(),
    reviewId: v.review_id as string,
    versionId,
    parentId,
    author: who.name,
    guest: who.guest,
    body,
    t: t != null ? Math.max(0, t) : null,
    tEnd: tEnd != null && t != null && tEnd > t ? tEnd : null,
    pin: parentId ? null : pinRaw,
    drawing,
    resolved: false,
    reactions: {},
    at: now(),
    editedAt: null
  }
  await env.DB.batch([
    env.DB.prepare('INSERT INTO review_comments (id,review_id,version_id,parent_id,author,author_email,guest,body,t,t_end,pin,drawing,resolved,reactions,at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)').bind(
      c.id,
      c.reviewId,
      c.versionId,
      c.parentId,
      c.author,
      who.email,
      who.guest ? 1 : 0,
      c.body,
      c.t,
      c.tEnd,
      c.pin ? JSON.stringify(c.pin) : null,
      JSON.stringify(c.drawing),
      '{}',
      c.at
    ),
    touch(env.DB, c.reviewId),
    env.DB.prepare('UPDATE review_versions SET warned_at = NULL WHERE review_id = ?').bind(c.reviewId)
  ])
  return c
}

async function react(env: ReviewEnv, id: string, emoji: string, name: string, allowedVersions: Set<string> | null) {
  if (!EMOJI.has(emoji)) throw new ReviewError(400, 'Pick one of the reactions.')
  const row = await env.DB.prepare('SELECT * FROM review_comments WHERE id = ?').bind(id).first<Row>()
  if (!row || (allowedVersions && !allowedVersions.has(row.version_id as string))) throw new ReviewError(404, 'That comment was deleted.')
  const reactions = parse<Record<string, string[]>>(row.reactions, {})
  const list = reactions[emoji] ?? []
  reactions[emoji] = list.includes(name) ? list.filter((n) => n !== name) : [...list, name]
  if (!reactions[emoji].length) delete reactions[emoji]
  await env.DB.prepare('UPDATE review_comments SET reactions = ? WHERE id = ?').bind(JSON.stringify(reactions), id).run()
}

async function decide(env: ReviewEnv, reviewId: string, b: Record<string, unknown>, who: { name: string; email: string; guest: boolean }, allowedVersions: Set<string> | null) {
  const r = await getReview(env.DB, reviewId)
  const versionId = str(b.versionId, 64)
  const v = r.versions.find((x) => x.id === versionId)
  if (!v || (allowedVersions && !allowedVersions.has(versionId))) throw new ReviewError(404, 'That version is no longer here.')
  const decision = b.decision === 'approved' ? 'approved' : 'changes'
  const note = str(b.note, 2000).trim()
  const at = now()
  await env.DB.batch([
    env.DB.prepare('INSERT INTO review_decisions (id,review_id,version_id,by_name,by_email,guest,decision,note,at) VALUES (?,?,?,?,?,?,?,?,?)').bind(
      crypto.randomUUID(),
      r.id,
      v.id,
      who.name,
      who.email,
      who.guest ? 1 : 0,
      decision,
      note,
      at
    ),
    env.DB.prepare('UPDATE review_reviews SET status = ?, updated_at = ? WHERE id = ?').bind(decision === 'approved' ? 'approved' : 'changes', at, r.id)
  ])
  // Tell the people following the review
  const to = await followers(env, r.id)
  to.delete(who.email.toLowerCase())
  const first = who.name.split(' ')[0]
  await notify(
    env,
    [...to],
    { requestId: r.id, kind: 'review-decision', actor: who.name, message: `${decision === 'approved' ? 'Approved' : 'Requested changes on'} v${v.n}${note ? `: ${note.slice(0, 140)}` : ''}`, at },
    `${decision === 'approved' ? '✅' : '✏️'} *${first}*${who.guest ? ' (review link)' : ''} ${decision === 'approved' ? 'approved' : 'requested changes on'} *${r.title}* v${v.n}${note ? `\n>${note.replace(/\n/g, '\n>')}` : ''}`
  )
  // A requester deciding through their review link moves their media request along, like the tracker's buttons
  if (who.guest && r.requestId) {
    const req = await env.DB.prepare('SELECT * FROM requests WHERE id = ?').bind(r.requestId).first<Row>()
    if (req && req.stage === 'proof') {
      const stage = decision === 'approved' ? 'approved' : 'design'
      await env.DB.batch([
        env.DB.prepare('UPDATE requests SET stage = ?, public_note = ?, updated_at = ?, updated_by = ? WHERE id = ?').bind(stage, '', at, who.name, r.requestId),
        eventStmt(env.DB, r.requestId, decision === 'approved' ? 'approved' : 'changes', stage, note || (decision === 'approved' ? '' : 'Requested changes in Video Review (see the comments).'), who.name)
      ])
    }
  }
}

/** Streams a stored file back, with Range support so big videos can be scrubbed and downloaded. */
async function serveObject(env: ReviewEnv, key: string, request: Request, opts: { download?: string; type?: string }) {
  const range = request.headers.get('range')
  const head = await env.FILES.head(key)
  if (!head) return new Response('Not found', { status: 404 })
  const size = head.size
  const m = range ? /bytes=(\d*)-(\d*)/.exec(range) : null
  const headers: Record<string, string> = {
    'content-type': opts.type || head.httpMetadata?.contentType || 'application/octet-stream',
    'accept-ranges': 'bytes',
    'cache-control': 'private, max-age=3600',
    'x-content-type-options': 'nosniff'
  }
  if (opts.download) headers['content-disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(opts.download)}`
  if (m && (m[1] || m[2])) {
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]))
    const end = m[1] && m[2] ? Math.min(size - 1, Number(m[2])) : size - 1
    const obj = await env.FILES.get(key, { range: { offset: start, length: end - start + 1 } })
    if (!obj) return new Response('Not found', { status: 404 })
    return new Response(obj.body, { status: 206, headers: { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': String(end - start + 1) } })
  }
  const obj = await env.FILES.get(key)
  if (!obj) return new Response('Not found', { status: 404 })
  return new Response(obj.body, { headers: { ...headers, 'content-length': String(size) } })
}

async function serveVersionFile(env: ReviewEnv, versionId: string, what: 'media' | 'thumb' | 'download', request: Request, allowed: Set<string> | null) {
  if (allowed && !allowed.has(versionId)) return new Response('Not found', { status: 404 })
  const v = await env.DB.prepare('SELECT * FROM review_versions WHERE id = ?').bind(versionId).first<Row>()
  if (!v) return new Response('Not found', { status: 404 })
  if (what === 'thumb') return serveObject(env, `review/thumb/${versionId}`, request, { type: 'image/jpeg' })
  if (what === 'media' && v.kind !== 'image') return new Response('Videos play from Stream', { status: 404 })
  // SVGs never run as pages
  const type = v.content_type === 'image/svg+xml' && what === 'media' ? 'image/svg+xml' : (v.content_type as string)
  const res = await serveObject(env, `review/orig/${versionId}`, request, { type, download: what === 'download' ? (v.name as string) : undefined })
  if (v.content_type === 'image/svg+xml') res.headers.set('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
  return res
}

// ---------- team API: /api/review ----------

export async function reviewApi(request: Request, env: ReviewEnv, ctx: ExecutionContext, me: Me, path: string, changed: (what: string) => void): Promise<Response | null> {
  const db = env.DB
  const method = request.method
  const body = async () => ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
  const done = (data: unknown = { ok: true }) => {
    changed('review')
    return json(data)
  }
  const meWho = { name: me.name, email: me.email.toLowerCase(), guest: false }

  if (path === '/api/review' && method === 'GET') {
    if (await refreshProcessing(env)) changed('review')
    return json(await snapshot(db, '/api/review'))
  }

  // ----- uploads: start → parts → finish -----
  if (path === '/api/review/upload/start' && method === 'POST') {
    const b = await body()
    const name = cleanName(str(b.name, 200)) || 'file'
    const contentType = str(b.contentType, 120).toLowerCase() || 'application/octet-stream'
    const size = Number(b.size) || 0
    if (!/^(video|image)\//.test(contentType)) throw new ReviewError(400, 'Video Review takes videos and images.')
    if (size > 20 * 1024 ** 3) throw new ReviewError(413, 'That file is over 20 GB. Export a review copy.')
    const id = crypto.randomUUID()
    const mp = await env.FILES.createMultipartUpload(`review/orig/${id}`, { httpMetadata: { contentType } })
    await db.prepare('INSERT INTO review_uploads (id,r2_upload_id,name,content_type,size,created_by,at) VALUES (?,?,?,?,?,?,?)').bind(id, mp.uploadId, name, contentType, size, me.email, now()).run()
    return json({ id, partSize: 50 * 1024 * 1024 })
  }
  let m = /^\/api\/review\/upload\/([A-Za-z0-9-]{8,64})\/part$/.exec(path)
  if (m && method === 'POST') {
    const n = Number(new URL(request.url).searchParams.get('n'))
    if (!Number.isInteger(n) || n < 1 || n > 10000) throw new ReviewError(400, 'Bad part number.')
    const up = await db.prepare('SELECT * FROM review_uploads WHERE id = ?').bind(m[1]).first<Row>()
    if (!up) throw new ReviewError(404, 'That upload expired. Try again.')
    const bytes = await request.arrayBuffer()
    if (!bytes.byteLength || bytes.byteLength > PART_MAX) throw new ReviewError(413, 'That piece is too large.')
    const part = await env.FILES.resumeMultipartUpload(`review/orig/${m[1]}`, up.r2_upload_id as string).uploadPart(n, bytes)
    const parts = parse<{ partNumber: number; etag: string }[]>(up.parts, []).filter((p) => p.partNumber !== n)
    parts.push({ partNumber: part.partNumber, etag: part.etag })
    await db.prepare('UPDATE review_uploads SET parts = ? WHERE id = ?').bind(JSON.stringify(parts), m[1]).run()
    return json({ ok: true })
  }
  m = /^\/api\/review\/upload\/([A-Za-z0-9-]{8,64})\/finish$/.exec(path)
  if (m && method === 'POST') {
    const b = await body()
    const up = await db.prepare('SELECT * FROM review_uploads WHERE id = ?').bind(m[1]).first<Row>()
    if (!up) throw new ReviewError(404, 'That upload expired. Try again.')
    const parts = parse<{ partNumber: number; etag: string }[]>(up.parts, []).sort((a, z) => a.partNumber - z.partNumber)
    const obj = await env.FILES.resumeMultipartUpload(`review/orig/${m[1]}`, up.r2_upload_id as string).complete(parts)
    await db.prepare('DELETE FROM review_uploads WHERE id = ?').bind(m[1]).run()
    const kind = (up.content_type as string).startsWith('image/') ? 'image' : 'video'
    // Poster frame made by the app
    const thumb = str(b.thumb, 400_000)
    const t = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(thumb)
    if (t) await env.FILES.put(`review/thumb/${m[1]}`, Uint8Array.from(atob(t[1]), (c) => c.charCodeAt(0)), { httpMetadata: { contentType: 'image/jpeg' } })

    let reviewId = str(b.reviewId, 64)
    const at = now()
    let n = 1
    const stmts: D1PreparedStatement[] = []
    if (reviewId) {
      const r = await db.prepare('SELECT * FROM review_reviews WHERE id = ?').bind(reviewId).first<Row>()
      if (!r) throw new ReviewError(404, 'That review no longer exists.')
      n = ((await db.prepare('SELECT MAX(n) AS n FROM review_versions WHERE review_id = ?').bind(reviewId).first<Row>())?.n as number) + 1 || 1
      // A new version wants a fresh look
      stmts.push(db.prepare("UPDATE review_reviews SET status = CASE WHEN status = 'approved' OR status = 'changes' THEN 'needs-review' ELSE status END, updated_at = ? WHERE id = ?").bind(at, reviewId))
    } else {
      reviewId = crypto.randomUUID()
      const requestId = str(b.requestId, 64) || null
      stmts.push(
        db
          .prepare('INSERT INTO review_reviews (id,title,folder,status,request_id,keep,created_by,created_by_email,created_at,updated_at) VALUES (?,?,?,?,?,0,?,?,?,?)')
          .bind(reviewId, str(b.title, 120).trim() || (up.name as string).replace(/\.[^.]+$/, ''), str(b.folder, 80).trim(), 'in-progress', requestId, me.name, me.email.toLowerCase(), at, at)
      )
    }
    stmts.push(
      db
        .prepare(
          'INSERT INTO review_versions (id,review_id,n,kind,name,content_type,size,duration,fps,width,height,state,has_thumb,uploaded_by,uploaded_by_email,at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
        )
        .bind(
          m[1],
          reviewId,
          n,
          kind,
          up.name as string,
          up.content_type as string,
          obj.size,
          Math.max(0, num(b.duration) ?? 0),
          30,
          Math.max(0, Math.round(num(b.width) ?? 0)),
          Math.max(0, Math.round(num(b.height) ?? 0)),
          kind === 'video' ? 'processing' : 'ready',
          t ? 1 : 0,
          me.name,
          me.email.toLowerCase(),
          at
        )
    )
    await db.batch(stmts)
    const r = await getReview(db, reviewId)
    const v = r.versions.find((x) => x.id === m![1])!
    if (kind === 'video') {
      try {
        await sendToStream(env, r, v)
      } catch (e) {
        await db.prepare("UPDATE review_versions SET state = 'error', error = ? WHERE id = ?").bind((e as Error).message, v.id).run()
        await alert(env as unknown as AlertEnv, 'stream', `“${r.title}” v${v.n} couldn’t be sent to Stream: ${(e as Error).message}`)
      }
    }
    // People already following hear about a new version
    if (n > 1) {
      const to = await followers(env, reviewId)
      to.delete(me.email.toLowerCase())
      ctx.waitUntil(
        notify(env, [...to], { requestId: reviewId, kind: 'review-version', actor: me.name, message: `v${n} is up`, at }, `🎬 *${me.name.split(' ')[0]}* uploaded v${n} of *${r.title}*.`).then(() => changed('notifications'))
      )
    }
    return done(await getReview(db, reviewId))
  }

  // ----- comments -----
  if (path === '/api/review/comments' && method === 'POST') {
    const c = await addComment(env, await body(), meWho, null)
    const r = await getReview(db, c.reviewId)
    const v = r.versions.find((x) => x.id === c.versionId)!
    ctx.waitUntil(notifyComment(env, r, v, c, me.email).then(() => changed('notifications')))
    return done(c)
  }
  m = /^\/api\/review\/comments\/([A-Za-z0-9-]{8,64})(\/react)?$/.exec(path)
  if (m) {
    const row = await db.prepare('SELECT * FROM review_comments WHERE id = ?').bind(m[1]).first<Row>()
    if (!row) throw new ReviewError(404, 'That comment was deleted.')
    if (m[2] && method === 'POST') {
      await react(env, m[1], str((await body()).emoji, 8), me.name, null)
      return done()
    }
    const mine = String(row.author_email).toLowerCase() === me.email.toLowerCase() && row.guest !== 1
    if (method === 'PATCH') {
      const b = await body()
      if ('resolved' in b) await db.prepare('UPDATE review_comments SET resolved = ? WHERE id = ?').bind(b.resolved === true ? 1 : 0, m[1]).run()
      if ('body' in b) {
        if (!mine) throw new ReviewError(403, 'You can only edit your own comments.')
        const text = str(b.body, 5000).trim()
        if (text) await db.prepare('UPDATE review_comments SET body = ?, edited_at = ? WHERE id = ?').bind(text, now(), m[1]).run()
      }
      return done()
    }
    if (method === 'DELETE') {
      if (!mine) throw new ReviewError(403, 'You can only delete your own comments.')
      await db.prepare('DELETE FROM review_comments WHERE id = ? OR parent_id = ?').bind(m[1], m[1]).run()
      return done()
    }
  }

  // ----- links -----
  m = /^\/api\/review\/links\/([A-Za-z0-9-]{8,64})$/.exec(path)
  if (m && method === 'PATCH') {
    const b = await body()
    const row = await db.prepare('SELECT * FROM review_links WHERE id = ?').bind(m[1]).first<Row>()
    if (!row) throw new ReviewError(404, 'That link was removed.')
    const l = toLink(row)
    if ('active' in b) l.active = b.active === true
    if ('allowComments' in b) l.allowComments = b.allowComments === true
    if ('allowDownload' in b) l.allowDownload = b.allowDownload === true
    if ('allVersions' in b) l.allVersions = b.allVersions === true
    if ('label' in b) l.label = str(b.label, 80).trim() || l.label
    if ('expiresAt' in b) l.expiresAt = typeof b.expiresAt === 'string' && !Number.isNaN(Date.parse(b.expiresAt)) ? new Date(b.expiresAt).toISOString() : null
    await db
      .prepare('UPDATE review_links SET active=?, allow_comments=?, allow_download=?, all_versions=?, label=?, expires_at=? WHERE id=?')
      .bind(l.active ? 1 : 0, l.allowComments ? 1 : 0, l.allowDownload ? 1 : 0, l.allVersions ? 1 : 0, l.label, l.expiresAt, l.id)
      .run()
    return done()
  }

  // ----- files -----
  m = /^\/api\/review\/(media|thumb|download)\/([A-Za-z0-9-]{8,64})$/.exec(path)
  if (m && method === 'GET') return serveVersionFile(env, m[2], m[1] as 'media' | 'thumb' | 'download', request, null)

  // ----- one review -----
  m = /^\/api\/review\/([A-Za-z0-9-]{8,64})(?:\/(decide|links|versions\/([A-Za-z0-9-]{8,64})(?:\/(fps|restore))?))?$/.exec(path)
  if (!m) return null
  const reviewId = m[1]
  const row = await db.prepare('SELECT * FROM review_reviews WHERE id = ?').bind(reviewId).first<Row>()
  if (!row) throw new ReviewError(404, 'That review no longer exists.')

  if (!m[2] && method === 'PATCH') {
    const b = await body()
    const sets: string[] = []
    const vals: unknown[] = []
    if ('title' in b && str(b.title, 120).trim()) (sets.push('title = ?'), vals.push(str(b.title, 120).trim()))
    if ('folder' in b) (sets.push('folder = ?'), vals.push(str(b.folder, 80).trim()))
    if ('status' in b && STATUSES.has(String(b.status))) (sets.push('status = ?'), vals.push(String(b.status)))
    if ('requestId' in b) (sets.push('request_id = ?'), vals.push(str(b.requestId, 64) || null))
    if ('keep' in b) (sets.push('keep = ?'), vals.push(b.keep === true ? 1 : 0))
    if (sets.length) await db.prepare(`UPDATE review_reviews SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).bind(...vals, now(), reviewId).run()
    if ('keep' in b) ctx.waitUntil(syncDeletionDates(env, reviewId))
    return done()
  }
  if (!m[2] && method === 'DELETE') {
    const { results } = await db.prepare('SELECT id, stream_uid FROM review_versions WHERE review_id = ?').bind(reviewId).all<Row>()
    for (const v of results ?? []) {
      await dropFromStream(env, v.stream_uid as string)
      await env.FILES.delete([`review/orig/${v.id}`, `review/thumb/${v.id}`])
    }
    await db.batch([
      db.prepare('DELETE FROM review_comments WHERE review_id = ?').bind(reviewId),
      db.prepare('DELETE FROM review_decisions WHERE review_id = ?').bind(reviewId),
      db.prepare('DELETE FROM review_links WHERE review_id = ?').bind(reviewId),
      db.prepare('DELETE FROM review_versions WHERE review_id = ?').bind(reviewId),
      db.prepare('DELETE FROM review_reviews WHERE id = ?').bind(reviewId),
      db.prepare('DELETE FROM notifications WHERE request_id = ?').bind(reviewId)
    ])
    return done()
  }
  if (m[2] === 'decide' && method === 'POST') {
    await decide(env, reviewId, await body(), meWho, null)
    changed('notifications')
    return done()
  }
  if (m[2] === 'links' && method === 'POST') {
    const b = await body()
    const token = [...crypto.getRandomValues(new Uint8Array(15))].map((x) => x.toString(36).padStart(2, '0')).join('').slice(0, 24)
    const l: ShareLink = {
      id: crypto.randomUUID(),
      reviewId,
      token,
      label: str(b.label, 80).trim() || 'Review link',
      allowComments: b.allowComments !== false,
      allowDownload: b.allowDownload === true,
      allVersions: b.allVersions === true,
      expiresAt: typeof b.expiresAt === 'string' && !Number.isNaN(Date.parse(b.expiresAt)) ? new Date(b.expiresAt).toISOString() : null,
      active: true,
      views: 0,
      createdBy: me.name,
      createdAt: now()
    }
    await db
      .prepare('INSERT INTO review_links (id,review_id,token,label,allow_comments,allow_download,all_versions,expires_at,active,views,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,1,0,?,?)')
      .bind(l.id, reviewId, l.token, l.label, l.allowComments ? 1 : 0, l.allowDownload ? 1 : 0, l.allVersions ? 1 : 0, l.expiresAt, l.createdBy, l.createdAt)
      .run()
    return done(l)
  }
  if (m[3]) {
    const v = await db.prepare('SELECT * FROM review_versions WHERE id = ? AND review_id = ?').bind(m[3], reviewId).first<Row>()
    if (!v) throw new ReviewError(404, 'That version is no longer here.')
    if (m[4] === 'fps' && method === 'POST') {
      const fps = num((await body()).fps)
      if (!fps || fps < 1 || fps > 120) throw new ReviewError(400, 'Pick a frame rate.')
      await db.prepare('UPDATE review_versions SET fps = ? WHERE id = ?').bind(fps, m[3]).run()
      return done()
    }
    if (m[4] === 'restore' && method === 'POST') {
      // Archived, or never made it onto Stream (e.g. uploaded before Stream was connected)
      if (v.archived !== 1 && v.state !== 'error') return done()
      await db.batch([db.prepare('UPDATE review_versions SET restored_at = ?, warned_at = NULL WHERE id = ?').bind(now(), m[3]), touch(db, reviewId)])
      const r = await getReview(db, reviewId)
      await sendToStream(env, r, r.versions.find((x) => x.id === m![3])!)
      return done()
    }
    if (!m[4] && method === 'DELETE') {
      const count = (await db.prepare('SELECT COUNT(*) AS n FROM review_versions WHERE review_id = ?').bind(reviewId).first<Row>())?.n as number
      if (count < 2) throw new ReviewError(400, 'A review needs at least one version. Delete the review instead.')
      await dropFromStream(env, v.stream_uid as string)
      await env.FILES.delete([`review/orig/${m[3]}`, `review/thumb/${m[3]}`])
      await db.batch([
        db.prepare('DELETE FROM review_comments WHERE version_id = ?').bind(m[3]),
        db.prepare('DELETE FROM review_decisions WHERE version_id = ?').bind(m[3]),
        db.prepare('DELETE FROM review_versions WHERE id = ?').bind(m[3]),
        touch(db, reviewId)
      ])
      return done()
    }
  }
  return null
}

// ---------- the signed link Stream copies originals from: /hooks/review-original/<id> ----------

export async function reviewOriginalHook(request: Request, env: ReviewEnv, url: URL): Promise<Response | null> {
  const m = /^\/hooks\/review-original\/([A-Za-z0-9-]{8,64})$/.exec(url.pathname)
  if (!m) return null
  const exp = Number(url.searchParams.get('exp'))
  const sig = url.searchParams.get('sig') ?? ''
  if (!streamReady(env) || !exp || exp < Date.now() || sig !== (await hmac(env, `${m[1]}.${exp}`))) return new Response('Link expired', { status: 403 })
  return serveObject(env, `review/orig/${m[1]}`, request, {})
}

// ---------- review links: /track/review/<token> (no sign-in) ----------

export async function reviewLinkRoute(request: Request, env: ReviewEnv, ctx: ExecutionContext, url: URL, changed: (what: string) => void): Promise<Response | null> {
  // The guest page's scripts and styles (the same files the app uses)
  const a = /^\/track\/assets\/([\w.-]+)$/.exec(url.pathname)
  if (a) {
    const res = await env.ASSETS.fetch(new Request(`${url.origin}/assets/${a[1]}`, request))
    // Stylesheets point at fonts under /assets/, which needs sign-in: send those through /track/assets/ too
    if (!a[1].endsWith('.css') || !res.ok) return res
    return new Response((await res.text()).replaceAll('/assets/', '/track/assets/'), { headers: { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'public, max-age=3600' } })
  }

  const m = /^\/track\/review\/([A-Za-z0-9]{16,64})(?:\/(data|comments|react|decide|(media|thumb|download)\/([A-Za-z0-9-]{8,64})))?$/.exec(url.pathname)
  if (!m || !TOKEN.test(m[1])) return null
  const row = await env.DB.prepare('SELECT * FROM review_links WHERE token = ?').bind(m[1]).first<Row>()
  const link = row ? toLink(row) : null
  const gone = !link || !link.active || (link.expiresAt && new Date(link.expiresAt) < new Date())

  if (!m[2]) {
    // The page itself; it shows its own "link expired" message
    const page = await env.ASSETS.fetch(new Request(`${url.origin}/guest.html`))
    const html = (await page.text()).replaceAll('"/assets/', '"/track/assets/')
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } })
  }
  if (gone) return json({ error: 'This review link has expired or was turned off. Ask the creative team for a new one.' }, 410)
  const base = `/track/review/${m[1]}`
  const snap = await snapshot(env.DB, base, { reviewId: link.reviewId, latestOnly: !link.allVersions })
  const allowed = new Set(snap.reviews.flatMap((r) => r.versions.map((v) => v.id)))

  if (m[2] === 'data' && request.method === 'GET') {
    if (url.searchParams.has('view')) ctx.waitUntil(env.DB.prepare('UPDATE review_links SET views = views + 1 WHERE id = ?').bind(link.id).run())
    if (await refreshProcessing(env, link.reviewId)) changed('review')
    const team = getTeam(env)
    return json({ ...snap, link: { label: link.label, allowComments: link.allowComments, allowDownload: link.allowDownload, allVersions: link.allVersions }, team: team.map((t) => t.name) })
  }
  if (m[3] && request.method === 'GET') {
    if (m[3] === 'download' && !link.allowDownload) return new Response('Downloads are off for this link', { status: 403 })
    return serveVersionFile(env, m[4], m[3] as 'media' | 'thumb' | 'download', request, allowed)
  }
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  if (!link.allowComments) throw new ReviewError(403, 'Comments are turned off for this link.')
  const b = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
  const name = str(b.name, 80).replace(/[\x00-\x1f<>]/g, '').replace(/\s+/g, ' ').trim()
  if (!name) throw new ReviewError(400, 'Type your name first.')
  const who = { name, email: '', guest: true }

  if (m[2] === 'comments') {
    if (b.parentId && !snap.comments.some((c) => c.id === b.parentId)) throw new ReviewError(404, 'That comment was deleted.')
    const c = await addComment(env, b, who, allowed)
    const r = snap.reviews[0]
    const v = r.versions.find((x) => x.id === c.versionId)!
    ctx.waitUntil(notifyComment(env, r, v, c, '').then(() => changed('notifications')))
    changed('review')
    return json(c)
  }
  if (m[2] === 'react') {
    await react(env, str(b.id, 64), str(b.emoji, 8), name, allowed)
    changed('review')
    return json({ ok: true })
  }
  if (m[2] === 'decide') {
    await decide(env, link.reviewId, b, who, allowed)
    changed('review')
    changed('requests')
    changed('notifications')
    return json({ ok: true })
  }
  return null
}

// ---------- housekeeping (cron): keep stored Stream minutes down ----------

/** Brings Stream's own deletion dates in line with Constellation's rules (activity pushes them later). */
async function syncDeletionDates(env: ReviewEnv, reviewId?: string) {
  if (!streamReady(env)) return
  const s = await snapshot(env.DB, '/api/review', reviewId ? { reviewId, latestOnly: false } : undefined)
  const { results } = await env.DB.prepare(`SELECT id, stream_uid, stream_delete_at FROM review_versions WHERE stream_uid != '' AND archived = 0${reviewId ? ' AND review_id = ?' : ''}`)
    .bind(...(reviewId ? [reviewId] : []))
    .all<Row>()
  const rows = new Map((results ?? []).map((r) => [r.id as string, r]))
  for (const r of s.reviews) {
    for (const v of r.versions) {
      const row = rows.get(v.id)
      if (!row) continue
      const want = backstop(r, v)
      const have = (row.stream_delete_at as string) ?? null
      if (want === have || (want && have && Math.abs(Date.parse(want) - Date.parse(have)) < DAY)) continue
      const res = await stream(env, `/${row.stream_uid}`, 'POST', { scheduledDeletion: want })
      if (res.ok) await env.DB.prepare('UPDATE review_versions SET stream_delete_at = ? WHERE id = ?').bind(want, v.id).run()
    }
  }
}

/** Hourly: archive what's past its date, warn uploaders 3 days ahead, keep Stream's dates in step, tidy abandoned uploads. */
export async function reviewHousekeeping(env: ReviewEnv, broadcast: (what: string) => Promise<void>): Promise<void> {
  await refreshProcessing(env)
  const s = await snapshot(env.DB, '/api/review')
  const { results } = await env.DB.prepare("SELECT id, stream_uid, warned_at, uploaded_by_email FROM review_versions WHERE kind = 'video' AND archived = 0 AND stream_uid != ''").all<Row>()
  const rows = new Map((results ?? []).map((r) => [r.id as string, r]))
  let changed = false
  for (const r of s.reviews) {
    for (const v of r.versions) {
      const row = rows.get(v.id)
      if (!row) continue
      const at = leavesStreamAt(r, v)
      if (!at) continue
      const left = at.getTime() - Date.now()
      if (left <= 0) {
        await dropFromStream(env, row.stream_uid as string)
        await env.DB.prepare("UPDATE review_versions SET archived = 1, stream_uid = '', hls = '', stream_delete_at = NULL, warned_at = NULL WHERE id = ?").bind(v.id).run()
        changed = true
      } else if (left <= RETENTION.warnDays * DAY && !row.warned_at && row.uploaded_by_email) {
        const days = Math.max(1, Math.ceil(left / DAY))
        await notify(
          env,
          [String(row.uploaded_by_email)],
          { requestId: r.id, kind: 'review-expiring', actor: 'Constellation', message: `v${v.n} leaves streaming in ${days} day${days === 1 ? '' : 's'}`, at: new Date().toISOString() },
          `🗄️ *${r.title}* v${v.n} comes off streaming in ${days} day${days === 1 ? '' : 's'} to save space. The original and comments are kept, and it can be restored anytime. Open it and click 📌 Keep to leave it on.`
        )
        await env.DB.prepare('UPDATE review_versions SET warned_at = ? WHERE id = ?').bind(new Date().toISOString(), v.id).run()
        changed = true
      }
    }
  }
  await syncDeletionDates(env)
  // Uploads started and never finished
  const stale = await env.DB.prepare('SELECT id, r2_upload_id FROM review_uploads WHERE at < ?').bind(new Date(Date.now() - 2 * DAY).toISOString()).all<Row>()
  for (const u of stale.results ?? []) {
    await env.FILES.resumeMultipartUpload(`review/orig/${u.id}`, u.r2_upload_id as string)
      .abort()
      .catch(() => {})
    await env.DB.prepare('DELETE FROM review_uploads WHERE id = ?').bind(u.id).run()
  }
  if (changed) {
    await broadcast('review')
    await broadcast('notifications')
  }
}

/**
 * After moving to a new Cloudflare account: the old Stream copies belong to the old account, so every video
 * that was playable is sent to this account's Stream again from its original in R2. Archived ones stay archived.
 */
export async function restreamAll(env: ReviewEnv): Promise<{ sent: number; skipped: number; failed: string[] }> {
  const snap = await snapshot(env.DB, '/api/review')
  const out = { sent: 0, skipped: 0, failed: [] as string[] }
  for (const r of snap.reviews)
    for (const v of r.versions) {
      if (v.kind !== 'video' || v.archived || !v.hasOriginal) {
        out.skipped++
        continue
      }
      try {
        await sendToStream(env, r, v)
        out.sent++
      } catch (e) {
        out.failed.push(`${r.title} v${v.n}: ${(e as Error).message}`)
      }
    }
  return out
}
