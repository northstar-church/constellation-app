import {
  STAGES,
  joinNames,
  normalizeAssignees,
  primaryAssignee,
  stageById,
  type Assignment,
  type HistoryKind,
  type MediaRequest,
  type RequestEvent,
  type StageId
} from '../../src/renderer/src/data/requests'
import { trackerPage } from '../../src/renderer/src/requests/trackerPage'
import { notifyReceived, notifyTeam, notifyUpdate, slack as slackApi, type SlackEnv } from './slack'
import { mapTypeform, verifyTypeform, type IntakeRequest } from './typeform'
import { addComment, CollabError, storeAttachments, deleteAllFiles, deleteFile, listComments, listFiles, notifyAssigned, notifyPartDone, notifyReply, serveFile, uploadFile, type CollabEnv } from './collab'

export interface RequestsEnv extends SlackEnv, CollabEnv {
  DB: D1Database
  TYPEFORM_SECRET?: string
  /** Typeform personal access token (responses:read) for copying requesters' uploaded files */
  TYPEFORM_TOKEN?: string
  /** Optional JSON: {"title":"<field ref>","requesterEmail":"<ref>",…} */
  TYPEFORM_FIELDS?: string
  /** Public address used in Slack links, e.g. https://constellation.northstarchurch.org */
  PUBLIC_URL?: string
}

export class RequestError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

type Row = Record<string, unknown>
const STAGE_IDS = new Set<string>(STAGES.map((s) => s.id))
const DATE = /^\d{4}-\d{2}-\d{2}$/
const ID = /^[A-Za-z0-9-]{8,64}$/

const toRequest = (r: Row): MediaRequest => ({
  id: r.id as string,
  token: r.token as string,
  title: r.title as string,
  details: r.details as string,
  deliverables: JSON.parse((r.deliverables as string) || '[]') as string[],
  ministry: r.ministry as string,
  requesterName: r.requester_name as string,
  requesterEmail: r.requester_email as string,
  dueDate: (r.due_date as string) ?? null,
  eventDate: (r.event_date as string) ?? null,
  eventId: (r.event_id as string) ?? null,
  stage: r.stage as StageId,
  assignee: r.assignee as string,
  assignees: normalizeAssignees(parseJson(r.assignees), r.assignee as string),
  proofUrl: r.proof_url as string,
  publicNote: r.public_note as string,
  sortOrder: r.sort_order as number,
  source: r.source as MediaRequest['source'],
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
  updatedBy: r.updated_by as string
})

function parseJson(v: unknown): unknown {
  try {
    return typeof v === 'string' ? JSON.parse(v) : null
  } catch {
    return null
  }
}

const toEvent = (r: Row): RequestEvent => ({
  id: r.id as string,
  requestId: r.request_id as string,
  at: r.at as string,
  kind: r.kind as HistoryKind,
  stage: (r.stage as StageId) ?? null,
  message: r.message as string,
  by: r.by_name as string,
  public: !!r.public
})

function token(): string {
  const b = crypto.getRandomValues(new Uint8Array(18))
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const cleanList = (v: unknown) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => x.trim().slice(0, 40)).filter(Boolean).slice(0, 20) : []
function safeUrl(v: unknown): string {
  const s = clean(v, 1000)
  if (!s) return ''
  let u: URL | null = null
  try {
    u = new URL(s)
  } catch {
    /* handled below */
  }
  if (!u || (u.protocol !== 'https:' && u.protocol !== 'http:')) throw new RequestError(400, 'Proof link must be a web address starting with https://')
  return u.toString()
}

export const trackerUrl = (env: RequestsEnv, origin: string, r: MediaRequest) => `${(env.PUBLIC_URL || origin).replace(/\/$/, '')}/track/${r.token}`

async function getById(db: D1Database, id: string) {
  const row = await db.prepare('SELECT * FROM requests WHERE id = ?').bind(id).first<Row>()
  return row ? { req: toRequest(row), slack: slackThread(row) } : null
}
async function getByToken(db: D1Database, t: string) {
  const row = await db.prepare('SELECT * FROM requests WHERE token = ?').bind(t).first<Row>()
  return row ? { req: toRequest(row), slack: slackThread(row) } : null
}
const slackThread = (row: Row) => (row.slack_channel && row.slack_ts ? { channel: row.slack_channel as string, ts: row.slack_ts as string } : null)

export function eventStmt(db: D1Database, requestId: string, kind: HistoryKind, stage: StageId | null, message: string, by: string, isPublic = true) {
  return db
    .prepare('INSERT INTO request_events (id,request_id,at,kind,stage,message,by_name,public) VALUES (?,?,?,?,?,?,?,?)')
    .bind(crypto.randomUUID(), requestId, new Date().toISOString(), kind, stage, message, by, isPublic ? 1 : 0)
}

async function history(db: D1Database, requestId: string) {
  const { results } = await db.prepare('SELECT * FROM request_events WHERE request_id = ? ORDER BY at').bind(requestId).all<Row>()
  return results.map(toEvent)
}

// ---------- create ----------

async function create(env: RequestsEnv, origin: string, input: IntakeRequest & { source: MediaRequest['source'] }, by: string): Promise<MediaRequest | null> {
  const now = new Date().toISOString()
  const r: MediaRequest = {
    id: crypto.randomUUID(),
    token: token(),
    title: input.title.slice(0, 200) || 'New media request',
    details: input.details,
    deliverables: input.deliverables,
    ministry: input.ministry,
    requesterName: input.requesterName,
    requesterEmail: input.requesterEmail.toLowerCase(),
    dueDate: input.dueDate && DATE.test(input.dueDate) ? input.dueDate : null,
    eventDate: input.eventDate && DATE.test(input.eventDate) ? input.eventDate : null,
    eventId: null,
    stage: 'received',
    assignee: '',
    assignees: [],
    proofUrl: '',
    publicNote: '',
    sortOrder: Date.now(),
    source: input.source,
    createdAt: now,
    updatedAt: now,
    updatedBy: by
  }
  const res = await env.DB.prepare(
    `INSERT INTO requests (id,token,title,details,deliverables,ministry,requester_name,requester_email,due_date,event_date,stage,assignee,proof_url,public_note,sort_order,source,source_id,created_at,updated_at,updated_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source_id) DO NOTHING`
  )
    .bind(r.id, r.token, r.title, r.details, JSON.stringify(r.deliverables), r.ministry, r.requesterName, r.requesterEmail, r.dueDate, r.eventDate, r.stage, '', '', '', r.sortOrder, r.source, input.sourceId || null, now, now, by)
    .run()
  if (!res.meta.changes) return null // a retried webhook: already have it
  await eventStmt(env.DB, r.id, 'created', 'received', '', by).run()
  return r
}

/**
 * Updates the requester in their Slack thread. If they don't have one yet (the request came in
 * before Slack was connected, or Slack was briefly unreachable), it starts one first.
 */
async function tellRequester(env: RequestsEnv, r: MediaRequest, thread: { channel: string; ts: string } | null, headline: string, note: string, link: string) {
  let t = thread
  if (!t) {
    const sent = await notifyReceived(env, r, link)
    if (!sent || sent === 'not_found') return
    await env.DB.prepare('UPDATE requests SET slack_channel = ?, slack_ts = ? WHERE id = ?').bind(sent.channel, sent.ts, r.id).run()
    t = sent
  }
  await notifyUpdate(env, r, t, headline, note, link)
}

/** Slack work for a new request; runs after the response is sent. */
async function announce(env: RequestsEnv, origin: string, r: MediaRequest) {
  const url = trackerUrl(env, origin, r)
  const sent = await notifyReceived(env, r, url)
  if (sent === 'not_found') {
    await eventStmt(env.DB, r.id, 'note', null, `Couldn’t find ${r.requesterEmail || 'the requester'} in Slack, so they won’t get Slack updates. Share their tracker link instead.`, 'Constellation', false).run()
  } else if (sent) {
    await env.DB.prepare('UPDATE requests SET slack_channel = ?, slack_ts = ? WHERE id = ?').bind(sent.channel, sent.ts, r.id).run()
  }
  const due = r.dueDate ? ` · due ${r.dueDate}` : ''
  await notifyTeam(env, `📥 New media request: *${r.title}* from ${r.requesterName || r.requesterEmail || 'someone'}${r.ministry ? ` (${r.ministry})` : ''}${due}`)
}

// ---------- team API (behind sign-in) ----------

export async function requestsApi(
  request: Request,
  env: RequestsEnv,
  ctx: ExecutionContext,
  me: { name: string; email: string },
  path: string,
  origin: string,
  changed: (what?: string) => void
): Promise<Response | null> {
  const method = request.method
  const db = env.DB
  const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store' } })

  if (path === '/api/requests' && method === 'GET') {
    const [rq, ev] = await db.batch([
      db.prepare('SELECT * FROM requests ORDER BY sort_order'),
      db.prepare('SELECT * FROM request_events ORDER BY at')
    ])
    const [files, comments] = await Promise.all([listFiles(db), listComments(db)])
    return json({ requests: (rq.results as Row[]).map(toRequest), history: (ev.results as Row[]).map(toEvent), files, comments })
  }

  if (path === '/api/requests' && method === 'POST') {
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>
    if (!clean(b.title, 200)) throw new RequestError(400, 'Give the request a title')
    const r = await create(
      env,
      origin,
      {
        sourceId: '',
        source: 'manual',
        title: clean(b.title, 200),
        details: clean(b.details, 8000),
        deliverables: cleanList(b.deliverables),
        ministry: clean(b.ministry, 80),
        requesterName: clean(b.requesterName, 120),
        requesterEmail: clean(b.requesterEmail, 200),
        dueDate: typeof b.dueDate === 'string' ? b.dueDate : null,
        eventDate: typeof b.eventDate === 'string' ? b.eventDate : null,
        attachments: []
      },
      me.name
    )
    if (!r) throw new RequestError(500, 'Could not create the request')
    ctx.waitUntil(announce(env, origin, r).finally(changed))
    changed()
    return json(r, 201)
  }

  const m = /^\/api\/requests\/([^/]+)(?:\/(note|files|comments)(?:\/([^/]+))?)?$/.exec(path)
  if (!m) return null
  const id = m[1]
  const sub = m[2] ?? ''
  const subId = m[3] ?? ''
  if (!ID.test(id)) throw new RequestError(400, 'Bad request id')
  const found = await getById(db, id)
  if (!found) throw new RequestError(404, 'That request no longer exists')
  const { req: before, slack } = found

  if (method === 'DELETE' && !sub) {
    await deleteAllFiles(env, id)
    await db.batch([
      db.prepare('DELETE FROM request_events WHERE request_id = ?').bind(id),
      db.prepare('DELETE FROM request_comments WHERE request_id = ?').bind(id),
      db.prepare('DELETE FROM notifications WHERE request_id = ?').bind(id),
      db.prepare('DELETE FROM requests WHERE id = ?').bind(id)
    ])
    changed()
    return json({ ok: true })
  }

  // A note to the requester, sent without changing the stage.
  if (method === 'POST' && sub === 'note') {
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const message = clean(b.message, 2000)
    if (!message) throw new RequestError(400, 'Write a message first')
    await db.batch([
      db.prepare('UPDATE requests SET public_note = ?, updated_at = ?, updated_by = ? WHERE id = ?').bind(message, new Date().toISOString(), me.name, id),
      eventStmt(db, id, 'note', null, message, me.name)
    ])
    const after = { ...before, publicNote: message }
    ctx.waitUntil(tellRequester(env, after, slack, `New note about *${after.title}* from ${me.name.split(' ')[0]}:`, message, trackerUrl(env, origin, after)))
    changed()
    return json({ ok: true })
  }

  // Proof files and finished artwork.
  if (sub === 'files') {
    if (method === 'POST' && !subId) {
      const { file } = await uploadFile(request, env, id, new URL(request.url), me)
      // Proofs show in the requester's history; finals are revealed when the request is delivered.
      await eventStmt(db, id, file.kind === 'proof' ? 'proof' : 'final', null, file.name, me.name, file.kind === 'proof').run()
      changed()
      return json(file, 201)
    }
    if (method === 'GET' && subId) return serveFile(env, id, subId, { download: new URL(request.url).searchParams.has('download') })
    if (method === 'DELETE' && subId) {
      await deleteFile(env, id, subId)
      changed()
      return json({ ok: true })
    }
    return null
  }

  // Team-only comments: never shown to the requester.
  if (sub === 'comments' && method === 'POST' && !subId) {
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const { comment, notified } = await addComment(env, before, me, typeof b.body === 'string' ? b.body : '')
    ctx.waitUntil(notified().then(() => changed('notifications')))
    changed()
    return json(comment, 201)
  }

  if (method === 'PATCH' && !sub) {
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const next: MediaRequest = { ...before }
    if ('title' in b) next.title = clean(b.title, 200) || before.title
    if ('details' in b) next.details = clean(b.details, 8000)
    if ('deliverables' in b) next.deliverables = cleanList(b.deliverables)
    if ('ministry' in b) next.ministry = clean(b.ministry, 80)
    if ('requesterName' in b) next.requesterName = clean(b.requesterName, 120)
    if ('requesterEmail' in b) next.requesterEmail = clean(b.requesterEmail, 200).toLowerCase()
    if ('dueDate' in b) next.dueDate = typeof b.dueDate === 'string' && DATE.test(b.dueDate) ? b.dueDate : null
    if ('eventDate' in b) next.eventDate = typeof b.eventDate === 'string' && DATE.test(b.eventDate) ? b.eventDate : null
    if ('eventId' in b) next.eventId = typeof b.eventId === 'string' && ID.test(b.eventId) ? b.eventId : null
    if ('assignees' in b) next.assignees = normalizeAssignees(b.assignees)
    else if ('assignee' in b) {
      // Older app versions send a single name: that person replaces the list.
      const one = clean(b.assignee, 80)
      next.assignees = one ? [{ name: one, done: before.assignees.find((a) => a.name === one)?.done ?? false }] : []
    }
    next.assignee = primaryAssignee(next.assignees)
    if ('proofUrl' in b) next.proofUrl = safeUrl(b.proofUrl)
    if (typeof b.sortOrder === 'number' && Number.isFinite(b.sortOrder)) next.sortOrder = b.sortOrder
    if ('stage' in b) {
      if (typeof b.stage !== 'string' || !STAGE_IDS.has(b.stage)) throw new RequestError(400, 'Unknown stage')
      next.stage = b.stage as StageId
    }
    const message = clean(b.message, 2000) // optional note to send with a stage change
    const stageChanged = next.stage !== before.stage
    if (stageChanged && next.stage === 'proof' && !next.proofUrl) {
      const proofs = await db.prepare("SELECT COUNT(*) AS n FROM request_files WHERE request_id = ? AND kind = 'proof'").bind(id).first<{ n: number }>()
      if (!proofs?.n) throw new RequestError(400, 'Add a proof link or upload a proof file first, so the requester has something to review.')
    }
    if (stageChanged) next.publicNote = message
    next.updatedAt = new Date().toISOString()
    next.updatedBy = me.name

    const stmts = [
      db
        .prepare(
          `UPDATE requests SET title=?,details=?,deliverables=?,ministry=?,requester_name=?,requester_email=?,due_date=?,event_date=?,event_id=?,assignee=?,assignees=?,proof_url=?,
           sort_order=?,stage=?,public_note=?,updated_at=?,updated_by=? WHERE id=?`
        )
        .bind(next.title, next.details, JSON.stringify(next.deliverables), next.ministry, next.requesterName, next.requesterEmail, next.dueDate, next.eventDate, next.eventId, next.assignee, JSON.stringify(next.assignees), next.proofUrl, next.sortOrder, next.stage, next.publicNote, next.updatedAt, me.name, id)
    ]
    if (stageChanged) stmts.push(eventStmt(db, id, 'stage', next.stage, message, me.name))
    if (next.proofUrl && next.proofUrl !== before.proofUrl) stmts.push(eventStmt(db, id, 'proof', null, '', me.name, next.stage === 'proof'))
    // Someone's part is done: logged for the team (not shown to the requester).
    const finished = next.assignees.filter((a) => a.done && !before.assignees.some((o) => o.name === a.name && o.done))
    for (const a of finished) stmts.push(eventStmt(db, id, 'partdone', null, a.name, me.name, false))
    await db.batch(stmts)

    const added = next.assignees.filter((a) => !before.assignees.some((o) => o.name === a.name))
    for (const a of added) ctx.waitUntil(notifyAssigned(env, next, a.name, me).then(() => changed('notifications')))
    if (finished.length) ctx.waitUntil(notifyPartDone(env, next, finished.map((a) => a.name), me).then(() => changed('notifications')))
    if (stageChanged) {
      const s = stageById(next.stage)
      const active = next.assignees.filter((a) => !a.done).map((a) => a.name)
      const who = active.length && next.stage === 'scheduled' ? ` ${joinNames(active)} ${active.length > 1 ? 'are' : 'is'} on it.` : ''
      ctx.waitUntil(tellRequester(env, next, slack, `*${next.title}* is now *${s.label}*.${who}`, message, trackerUrl(env, origin, next)))
    }
    changed()
    return json(next)
  }

  return null
}

// ---------- requester tracker (public, protected by its secret link) ----------

const html = (body: string, status = 200) =>
  new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: 'self'; form-action 'self'; base-uri 'none'"
    }
  })

const notFound = () =>
  html(
    `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Request not found</title><body style="font-family:'Helvetica Neue',Arial,sans-serif;background:#f4f4f5;color:#231f20;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;padding:20px"><div><h1 style="letter-spacing:-1px">We can’t find that request</h1><p style="color:#71717a">The link may be incomplete, or the request was removed. Reply to the Creative team in Slack and we’ll help.</p></div>`,
    404
  )

const FLASH: Record<string, string> = {
  approved: 'Thanks! You approved the proof. We’ll prepare the final files.',
  message: 'Thanks! Your message is with the Creative team.',
  changes: 'Thanks! We got your changes and we’re back in design.',
  late: 'This request has already moved past the proof stage.'
}

export async function trackerRoute(
  request: Request,
  env: RequestsEnv,
  ctx: ExecutionContext,
  url: URL,
  changed: () => void,
  notified: () => void = () => {}
): Promise<Response | null> {
  const m = /^\/track\/([A-Za-z0-9_-]{16,64})(?:\/(approve|changes|message|files\/[A-Za-z0-9-]{8,64}))?$/.exec(url.pathname)
  if (!m) return null
  const found = await getByToken(env.DB, m[1])
  if (!found) return notFound()
  const { req, slack } = found

  // Files the requester may see: proofs, and finished artwork once delivered.
  if (m[2]?.startsWith('files/') && request.method === 'GET') {
    return serveFile(env, req.id, m[2].slice(6), {
      download: url.searchParams.has('download'),
      allow: (f) => f.kind === 'proof' || (f.kind === 'final' && req.stage === 'delivered')
    })
  }

  if (request.method === 'GET' && !m[2]) {
    return html(trackerPage(req, await history(env.DB, req.id), { interactive: true, flash: FLASH[url.searchParams.get('done') ?? ''] }, await listFiles(env.DB, req.id)))
  }
  if (request.method !== 'POST' || !m[2]) return new Response('Method not allowed', { status: 405 })

  const back = (done: string) => Response.redirect(`${url.origin}/track/${req.token}?done=${done}`, 303)

  // A message to the team, at any stage.
  if (m[2] === 'message') {
    const form = await request.formData().catch(() => null)
    const message = clean(form?.get('message'), 2000)
    if (!message) return back('')
    ctx.waitUntil(recordReply(env, req, message, 'tracker').then(() => (changed(), notified())))
    return back('message')
  }

  if (req.stage !== 'proof') return back('late')

  const who = req.requesterName || 'The requester'
  const now = new Date().toISOString()
  if (m[2] === 'approve') {
    const next: MediaRequest = { ...req, stage: 'approved', publicNote: '', updatedAt: now, updatedBy: who }
    await env.DB.batch([
      env.DB.prepare("UPDATE requests SET stage='approved', public_note='', updated_at=?, updated_by=? WHERE id=?").bind(now, who, req.id),
      eventStmt(env.DB, req.id, 'approved', 'approved', '', who)
    ])
    const link = trackerUrl(env, url.origin, next)
    ctx.waitUntil(
      Promise.all([
        notifyTeam(env, `✅ ${who} approved the proof for *${req.title}*.`),
        tellRequester(env, next, slack, `Thanks for approving *${req.title}*!`, '', link)
      ]).then(changed)
    )
    changed()
    return back('approved')
  }

  const form = await request.formData().catch(() => null)
  const message = clean(form?.get('message'), 2000)
  if (!message) return back('late')
  // Changes reopen everyone's part.
  const reopened: Assignment[] = req.assignees.map((a) => ({ ...a, done: false }))
  const next: MediaRequest = { ...req, stage: 'design', publicNote: '', assignees: reopened, assignee: primaryAssignee(reopened), updatedAt: now, updatedBy: who }
  await env.DB.batch([
    env.DB.prepare("UPDATE requests SET stage='design', public_note='', assignees=?, assignee=?, updated_at=?, updated_by=? WHERE id=?").bind(JSON.stringify(reopened), next.assignee, now, who, req.id),
    eventStmt(env.DB, req.id, 'changes', 'design', message, who)
  ])
  const link = trackerUrl(env, url.origin, next)
  ctx.waitUntil(
    Promise.all([
      notifyTeam(env, `✏️ ${who} requested changes on *${req.title}*:\n>${message.replace(/\n/g, '\n>')}`),
      tellRequester(env, next, slack, `Got it. Your changes to *${req.title}* are with the team.`, message, link)
    ]).then(changed)
  )
  changed()
  return back('changes')
}

// ---------- requester replies (Slack and tracker) ----------

/** Saves a message from the requester to the request's history and tells the team. False if it was already saved. */
async function recordReply(env: RequestsEnv, req: MediaRequest, message: string, via: 'slack' | 'tracker', eventId?: string): Promise<boolean> {
  const now = new Date().toISOString()
  const res = await env.DB.prepare('INSERT OR IGNORE INTO request_events (id,request_id,at,kind,stage,message,by_name,public) VALUES (?,?,?,?,?,?,?,1)')
    .bind(eventId ?? crypto.randomUUID(), req.id, now, 'reply', null, message, req.requesterName || 'Requester')
    .run()
  if (!res.meta.changes) return false
  await env.DB.prepare('UPDATE requests SET updated_at = ? WHERE id = ?').bind(now, req.id).run()
  await notifyReply(env, req, message, via)
  return true
}

/** Slack's message formatting to plain text: links, mentions and escaped characters. */
export function slackToPlain(s: string): string {
  return s
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2 ($1)')
    .replace(/<(https?:[^>]+)>/g, '$1')
    .replace(/<mailto:[^|>]+\|([^>]+)>/g, '$1')
    .replace(/<[@#!][^>]*>/g, '')
    .replace(/(^|\s)\*([^*\n]+)\*(?=\s|$|[.,!?])/g, '$1$2')
    .replace(/(^|\s)_([^_\n]+)_(?=\s|$|[.,!?])/g, '$1$2')
    .replace(/(^|\s)~([^~\n]+)~(?=\s|$|[.,!?])/g, '$1$2')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim()
    .slice(0, 2000)
}

/** Slack signs every request with the app's signing secret; anything else is rejected. */
async function verifySlack(raw: string, headers: Headers, secret: string | undefined): Promise<boolean> {
  const ts = headers.get('x-slack-request-timestamp') ?? ''
  const sig = headers.get('x-slack-signature') ?? ''
  if (!secret || !/^\d+$/.test(ts) || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`v0:${ts}:${raw}`)))
  const expected = 'v0=' + [...mac].map((b) => b.toString(16).padStart(2, '0')).join('')
  if (expected.length !== sig.length) return false
  let diff = 0
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i)
  return diff === 0
}

interface SlackMessageEvent {
  type: string
  channel: string
  channel_type?: string
  user?: string
  bot_id?: string
  subtype?: string
  text?: string
  ts: string
  thread_ts?: string
  client_msg_id?: string
  files?: unknown[]
}

/** Slack Events API: a requester replied to the Constellation bot in their DM. */
export async function slackHook(request: Request, env: RequestsEnv, ctx: ExecutionContext, changed: () => void, notified: () => void): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const raw = await request.text()
  if (!(await verifySlack(raw, request.headers, env.SLACK_SIGNING_SECRET))) return new Response('Bad signature', { status: 401 })
  const body = JSON.parse(raw) as { type?: string; challenge?: string; event?: SlackMessageEvent }
  if (body.type === 'url_verification') return new Response(body.challenge ?? '', { headers: { 'content-type': 'text/plain' } })
  // Slack resends if we're slow; the first delivery is already being handled.
  if (request.headers.get('x-slack-retry-num')) return new Response('OK')
  const e = body.event
  if (body.type === 'event_callback' && e?.type === 'message' && e.channel_type === 'im' && e.user && !e.bot_id && (!e.subtype || e.subtype === 'file_share')) {
    ctx.waitUntil(handleSlackReply(env, e).then((saved) => saved && (changed(), notified())))
  }
  return new Response('OK')
}

async function handleSlackReply(env: RequestsEnv, e: SlackMessageEvent): Promise<boolean> {
  const db = env.DB
  const threadTs = e.thread_ts && e.thread_ts !== e.ts ? e.thread_ts : null
  // A reply in a request's thread belongs to that request; otherwise use their most recent open request.
  let row = threadTs ? await db.prepare('SELECT * FROM requests WHERE slack_channel = ? AND slack_ts = ?').bind(e.channel, threadTs).first<Row>() : null
  let guessed = false
  if (!row) {
    const { results } = await db
      .prepare("SELECT * FROM requests WHERE slack_channel = ? ORDER BY CASE WHEN stage = 'delivered' THEN 1 ELSE 0 END, updated_at DESC LIMIT 10")
      .bind(e.channel)
      .all<Row>()
    row = results?.[0] ?? null
    guessed = (results ?? []).filter((r) => r.stage !== 'delivered').length > 1
  }
  const say = (text: string) => slackApi(env, 'chat.postMessage', { channel: e.channel, thread_ts: e.thread_ts ?? e.ts, text, unfurl_links: false })
  if (!row) {
    await say('Thanks for your message! I couldn’t match it to one of your media requests. Reply in a request’s thread here, or use the message box on its tracker page, and it’ll go straight to the Creative team.')
    return false
  }
  const req = toRequest(row)
  let text = slackToPlain(e.text ?? '')
  if (e.files?.length) {
    text += `${text ? '\n' : ''}(Also sent ${e.files.length === 1 ? 'a file' : `${e.files.length} files`} in Slack, which can’t come through yet. Ask them for a link.)`
    await say('Thanks! Files sent here don’t reach the Creative team yet. Please share a link (Google Drive, Dropbox, etc.) instead.')
  }
  if (!text) return false
  const saved = await recordReply(env, req, text, 'slack', `slack-${e.client_msg_id ?? e.ts}`)
  if (!saved) return false
  const reacted = await slackApi(env, 'reactions.add', { channel: e.channel, timestamp: e.ts, name: 'white_check_mark' })
  if (guessed) await say(`Got it. I added this to *${req.title}*. To write about a different request, reply in that request’s thread.`)
  else if (!reacted.ok) await say('Got it. Your message is with the Creative team.')
  return true
}

// ---------- Typeform intake ----------

export async function typeformHook(request: Request, env: RequestsEnv, ctx: ExecutionContext, origin: string, changed: () => void): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const raw = await request.text()
  if (!(await verifyTypeform(raw, request.headers.get('Typeform-Signature'), env.TYPEFORM_SECRET ?? ''))) {
    return new Response('Bad signature', { status: 401 })
  }
  let refs = {}
  try {
    refs = env.TYPEFORM_FIELDS ? JSON.parse(env.TYPEFORM_FIELDS) : {}
  } catch {
    console.warn('TYPEFORM_FIELDS is not valid JSON; matching by question wording instead')
  }
  const intake = mapTypeform(JSON.parse(raw), refs)
  if (!intake) return new Response('Ignored', { status: 200 })
  const r = await create(env, origin, { ...intake, source: 'typeform' }, intake.requesterName || 'Typeform')
  if (r) {
    if (intake.attachments.length) ctx.waitUntil(storeAttachments(env, r.id, intake.attachments, r.requesterName || 'Requester').then(changed))
    ctx.waitUntil(announce(env, origin, r).finally(changed))
    changed()
  }
  return new Response('OK', { status: 200 })
}
