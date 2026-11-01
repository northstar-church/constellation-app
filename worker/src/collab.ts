import {
  PROOF_TYPES,
  MAX_UPLOAD_BYTES,
  DEFAULT_TEAM,
  findMember,
  joinNames,
  parseTeam,
  type TeamMember,
  type FileKind,
  type Notification,
  type RequestComment,
  type RequestFile
} from '../../src/renderer/src/data/requests'
import { notifyPerson, type SlackEnv } from './slack'

/**
 * Files (proofs and finished artwork, stored in R2), team-only comments, and notifications.
 * Comments are never sent to the requester: they don't appear on the tracker or in the
 * requester's Slack thread.
 */

export interface CollabEnv extends SlackEnv {
  DB: D1Database
  FILES: R2Bucket
  /** JSON roster: [{"name":"Sarah Lee","email":"sarah.lee@northstarchurch.org","pm":false}, …] */
  TEAM_MEMBERS?: string
}

/**
 * Copies the files a requester uploaded on the Typeform into Constellation (Typeform keeps
 * them behind its login). Needs TYPEFORM_TOKEN; without it, or if a download fails, the
 * Typeform link is added to the request's details instead.
 */
export async function storeAttachments(env: CollabEnv & { TYPEFORM_TOKEN?: string }, requestId: string, urls: string[], by: string): Promise<void> {
  const fallback: string[] = []
  for (const url of urls.slice(0, 10)) {
    let ok = false
    if (env.TYPEFORM_TOKEN && /^https:\/\/api\.typeform\.com\//.test(url)) {
      try {
        const res = await fetch(url, { headers: { authorization: `Bearer ${env.TYPEFORM_TOKEN}` } })
        const size = Number(res.headers.get('content-length') || 0)
        if (res.ok && res.body && size <= MAX_UPLOAD_BYTES) {
          const raw = decodeURIComponent(url.split('/').pop() ?? 'attachment')
          const name = cleanName(raw.replace(/^[0-9a-f]{8,}-/i, '')) // Typeform prefixes names with an id
          const contentType = (res.headers.get('content-type') || 'application/octet-stream').split(';')[0]
          const id = crypto.randomUUID()
          const key = `requests/${requestId}/${id}/${name}`
          const obj = await env.FILES.put(key, size ? res.body : await res.arrayBuffer(), { httpMetadata: { contentType } })
          await env.DB.prepare('INSERT INTO request_files (id,request_id,kind,name,content_type,size,r2_key,uploaded_by,at) VALUES (?,?,?,?,?,?,?,?,?)')
            .bind(id, requestId, 'reference', name, contentType, obj?.size ?? size, key, by, new Date().toISOString())
            .run()
          ok = true
        }
      } catch (e) {
        console.warn('Could not copy Typeform attachment', e)
      }
    }
    if (!ok) fallback.push(url)
  }
  if (fallback.length) {
    const lines = fallback.map((u) => `Attachment (open while signed in to Typeform): ${u}`).join('\n')
    await env.DB.prepare("UPDATE requests SET details = TRIM(details || char(10) || char(10) || ?) WHERE id = ?").bind(lines, requestId).run()
  }
}

/** The live team list, kept fresh from the database by team.ts (refreshTeam) at the start of each request */
let teamCache: TeamMember[] | null = null
export const setTeamCache = (t: TeamMember[]) => {
  teamCache = t
}
export const getTeam = (env: CollabEnv): TeamMember[] => teamCache ?? parseTeam(env.TEAM_MEMBERS) ?? DEFAULT_TEAM

export class CollabError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

type Row = Record<string, unknown>

export const toFile = (r: Row): RequestFile => ({
  id: r.id as string,
  requestId: r.request_id as string,
  kind: r.kind as FileKind,
  name: r.name as string,
  contentType: r.content_type as string,
  size: r.size as number,
  uploadedBy: r.uploaded_by as string,
  at: r.at as string
})

export const toComment = (r: Row): RequestComment => ({
  id: r.id as string,
  requestId: r.request_id as string,
  authorName: r.author_name as string,
  authorEmail: r.author_email as string,
  body: r.body as string,
  at: r.at as string
})

export const cleanName = (name: string) =>
  name
    .replace(/[\\/:*?"<>|\x00-\x1f]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'file'

export async function listFiles(db: D1Database, requestId?: string): Promise<RequestFile[]> {
  const q = requestId
    ? db.prepare('SELECT * FROM request_files WHERE request_id = ? ORDER BY at').bind(requestId)
    : db.prepare('SELECT * FROM request_files ORDER BY at')
  return ((await q.all<Row>()).results ?? []).map(toFile)
}

export async function listComments(db: D1Database): Promise<RequestComment[]> {
  return ((await db.prepare('SELECT * FROM request_comments ORDER BY at').all<Row>()).results ?? []).map(toComment)
}

// ---------- files ----------

export async function uploadFile(
  request: Request,
  env: CollabEnv,
  requestId: string,
  url: URL,
  me: { name: string }
): Promise<{ file: RequestFile; eventStmt: { kind: 'proof' | 'final'; message: string } }> {
  const kind = url.searchParams.get('kind')
  if (kind !== 'proof' && kind !== 'final') throw new CollabError(400, 'Upload must be a proof or final artwork')
  const name = cleanName(url.searchParams.get('name') ?? 'file')
  const contentType = (request.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim().toLowerCase()
  if (kind === 'proof' && !PROOF_TYPES.includes(contentType)) {
    throw new CollabError(400, 'Proofs can be JPG, PNG, GIF, WebP or PDF. Use Final Artwork for other file types.')
  }
  const length = Number(request.headers.get('content-length') || 0)
  if (length > MAX_UPLOAD_BYTES) throw new CollabError(413, `That file is over ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`)

  const id = crypto.randomUUID()
  const key = `requests/${requestId}/${id}/${name}`
  let size = length
  if (length > 0 && request.body) {
    await env.FILES.put(key, request.body, { httpMetadata: { contentType } })
  } else {
    const bytes = await request.arrayBuffer()
    if (!bytes.byteLength) throw new CollabError(400, 'That file is empty.')
    if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new CollabError(413, 'That file is too large.')
    size = bytes.byteLength
    await env.FILES.put(key, bytes, { httpMetadata: { contentType } })
  }

  const file: RequestFile = { id, requestId, kind, name, contentType, size, uploadedBy: me.name, at: new Date().toISOString() }
  await env.DB.prepare('INSERT INTO request_files (id,request_id,kind,name,content_type,size,r2_key,uploaded_by,at) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(id, requestId, kind, name, contentType, size, key, me.name, file.at)
    .run()
  return { file, eventStmt: { kind, message: name } }
}

export async function deleteFile(env: CollabEnv, requestId: string, fileId: string): Promise<void> {
  const row = await env.DB.prepare('SELECT r2_key FROM request_files WHERE id = ? AND request_id = ?').bind(fileId, requestId).first<Row>()
  if (!row) throw new CollabError(404, 'That file is already gone')
  await env.FILES.delete(row.r2_key as string)
  await env.DB.prepare('DELETE FROM request_files WHERE id = ?').bind(fileId).run()
}

/** Removes every stored file for a request (when the request is deleted). */
export async function deleteAllFiles(env: CollabEnv, requestId: string): Promise<void> {
  const { results } = await env.DB.prepare('SELECT r2_key FROM request_files WHERE request_id = ?').bind(requestId).all<Row>()
  const keys = (results ?? []).map((r) => r.r2_key as string)
  if (keys.length) await env.FILES.delete(keys)
  await env.DB.prepare('DELETE FROM request_files WHERE request_id = ?').bind(requestId).run()
}

/** Streams a stored file. `inline` shows images and PDFs in place; otherwise it downloads. */
export async function serveFile(env: CollabEnv, requestId: string, fileId: string, opts: { download: boolean; allow?: (f: RequestFile) => boolean }) {
  const row = await env.DB.prepare('SELECT * FROM request_files WHERE id = ? AND request_id = ?').bind(fileId, requestId).first<Row>()
  if (!row) return new Response('Not found', { status: 404 })
  const f = toFile(row)
  if (opts.allow && !opts.allow(f)) return new Response('Not found', { status: 404 })
  const obj = await env.FILES.get(row.r2_key as string)
  if (!obj) return new Response('Not found', { status: 404 })
  const viewable = f.contentType.startsWith('image/') || f.contentType === 'application/pdf'
  const disposition = opts.download || !viewable ? 'attachment' : 'inline'
  const headers: Record<string, string> = {
    'content-type': f.contentType,
    'content-length': String(obj.size),
    'content-disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    'cache-control': 'private, max-age=300',
    'x-content-type-options': 'nosniff'
  }
  // Uploaded files never run as pages (PDFs keep the browser's own viewer).
  if (f.contentType !== 'application/pdf') headers['content-security-policy'] = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox"
  return new Response(obj.body, { headers })
}

// ---------- comments + notifications ----------

export async function notify(env: CollabEnv, recipients: string[], n: Omit<Notification, 'id' | 'read' | 'requestTitle'>, slackText: string) {
  if (!recipients.length) return
  await env.DB.batch(
    recipients.map((email) =>
      env.DB.prepare('INSERT INTO notifications (id,recipient_email,request_id,kind,actor,message,at,read) VALUES (?,?,?,?,?,?,?,0)').bind(
        crypto.randomUUID(),
        email,
        n.requestId,
        n.kind,
        n.actor,
        n.message,
        n.at
      )
    )
  )
  await Promise.all(recipients.map((email) => notifyPerson(env, email, slackText)))
}

/** Who hears about a comment: the project manager(s), the assigned team member, and anyone who has commented before. Never the author. */
export async function commentRecipients(env: CollabEnv, requestId: string, assignees: { name: string }[], authorEmail: string): Promise<string[]> {
  const set = new Set<string>()
  const team = getTeam(env)
  for (const m of team) if (m.pm && m.email) set.add(m.email.toLowerCase())
  for (const a of assignees) {
    const m = findMember(team, a.name)
    if (m?.email) set.add(m.email.toLowerCase())
  }
  const { results } = await env.DB.prepare('SELECT DISTINCT author_email FROM request_comments WHERE request_id = ?').bind(requestId).all<Row>()
  for (const r of results ?? []) if (r.author_email) set.add(String(r.author_email).toLowerCase())
  set.delete(authorEmail.toLowerCase())
  return [...set]
}

export async function addComment(
  env: CollabEnv,
  req: { id: string; title: string; assignees: { name: string }[] },
  me: { name: string; email: string },
  body: string
): Promise<{ comment: RequestComment; notified: () => Promise<void> }> {
  const text = body.trim().slice(0, 4000)
  if (!text) throw new CollabError(400, 'Write a comment first')
  const recipients = await commentRecipients(env, req.id, req.assignees, me.email)
  const comment: RequestComment = { id: crypto.randomUUID(), requestId: req.id, authorName: me.name, authorEmail: me.email, body: text, at: new Date().toISOString() }
  await env.DB.prepare('INSERT INTO request_comments (id,request_id,author_name,author_email,body,at) VALUES (?,?,?,?,?,?)')
    .bind(comment.id, req.id, me.name, me.email, text, comment.at)
    .run()
  const snippet = text.length > 280 ? `${text.slice(0, 277)}…` : text
  return {
    comment,
    notified: () =>
      notify(
        env,
        recipients,
        { requestId: req.id, kind: 'comment', actor: me.name, message: snippet, at: comment.at },
        `💬 *${me.name}* commented on *${req.title}* (team only):\n>${snippet.replace(/\n/g, '\n>')}\nReply in Constellation → Media Requests.`
      )
  }
}

/**
 * The requester wrote back (in Slack or on their tracker). Tell the project manager(s), the assigned
 * team member, and anyone on the team who has messaged the requester about this request.
 */
export async function notifyReply(
  env: CollabEnv,
  req: { id: string; title: string; assignees: { name: string }[]; requesterName: string },
  message: string,
  via: 'slack' | 'tracker'
) {
  const team = getTeam(env)
  const set = new Set<string>()
  for (const m of team) if (m.pm && m.email) set.add(m.email.toLowerCase())
  for (const x of req.assignees) {
    const m = findMember(team, x.name)
    if (m?.email) set.add(m.email.toLowerCase())
  }
  const { results } = await env.DB.prepare("SELECT DISTINCT by_name FROM request_events WHERE request_id = ? AND kind = 'note'").bind(req.id).all<Row>()
  for (const r of results ?? []) {
    const m = findMember(team, String(r.by_name ?? ''))
    if (m?.email) set.add(m.email.toLowerCase())
  }
  const who = req.requesterName || 'The requester'
  const snippet = message.length > 280 ? `${message.slice(0, 277)}…` : message
  await notify(
    env,
    [...set],
    { requestId: req.id, kind: 'reply', actor: who, message: snippet, at: new Date().toISOString() },
    `📨 *${who}* replied about *${req.title}*${via === 'tracker' ? ' on their tracker' : ''}:\n>${snippet.replace(/\n/g, '\n>')}\nAnswer with Message Requester in Constellation → Media Requests.`
  )
}

/**
 * Someone finished their part. The others still working on it hear about it; when it was the
 * last part, the project manager hears too, since the request is ready to move along.
 */
export async function notifyPartDone(
  env: CollabEnv,
  req: { id: string; title: string; assignees: { name: string; done: boolean }[] },
  finishedBy: string[],
  me: { name: string; email: string }
) {
  const team = getTeam(env)
  const remaining = req.assignees.filter((a) => !a.done)
  const set = new Set<string>()
  for (const a of remaining) {
    const m = findMember(team, a.name)
    if (m?.email) set.add(m.email.toLowerCase())
  }
  if (!remaining.length) for (const m of team) if (m.pm && m.email) set.add(m.email.toLowerCase())
  set.delete(me.email.toLowerCase())
  const who = joinNames(finishedBy)
  const parts = finishedBy.length > 1 ? 'their parts' : 'their part'
  const tail = remaining.length ? 'It’s over to you.' : finishedBy.length > 1 ? 'Every part is done, so it’s ready to move along.' : 'That was the last part, so it’s ready to move along.'
  await notify(
    env,
    [...set],
    { requestId: req.id, kind: 'partdone', actor: finishedBy.join(' & '), message: tail, at: new Date().toISOString() },
    `✅ *${who}* finished ${parts} of *${req.title}*. ${tail} Open Constellation → Media Requests.`
  )
}

export async function notifyAssigned(env: CollabEnv, req: { id: string; title: string; dueDate: string | null }, assignee: string, me: { name: string; email: string }) {
  const m = findMember(getTeam(env), assignee)
  if (!m?.email || m.email.toLowerCase() === me.email.toLowerCase()) return
  const due = req.dueDate ? ` It’s needed by ${req.dueDate}.` : ''
  await notify(
    env,
    [m.email.toLowerCase()],
    { requestId: req.id, kind: 'assigned', actor: me.name, message: `assigned you to ${req.title}`, at: new Date().toISOString() },
    `🗂️ *${me.name}* assigned you to *${req.title}*.${due} Open Constellation → Media Requests for the details.`
  )
}

export async function listNotifications(db: D1Database, email: string): Promise<Notification[]> {
  const { results } = await db
    .prepare(
      `SELECT n.*, COALESCE(r.title, NULLIF(p.title, ''), substr(p.caption, 1, 80), v.title, CASE WHEN n.kind LIKE 'post-%' THEN 'A deleted post' WHEN n.kind LIKE 'review-%' THEN 'A deleted review' ELSE 'A deleted request' END) AS request_title
       FROM notifications n
       LEFT JOIN requests r ON r.id = n.request_id
       LEFT JOIN social_posts p ON p.id = n.request_id
       LEFT JOIN review_reviews v ON v.id = n.request_id
       WHERE n.recipient_email = ? ORDER BY n.at DESC LIMIT 60`
    )
    .bind(email.toLowerCase())
    .all<Row>()
  return (results ?? []).map((r) => ({
    id: r.id as string,
    requestId: r.request_id as string,
    requestTitle: r.request_title as string,
    kind: r.kind as Notification['kind'],
    actor: r.actor as string,
    message: r.message as string,
    at: r.at as string,
    read: !!r.read
  }))
}

export async function markRead(db: D1Database, email: string, ids: string[] | null): Promise<void> {
  if (ids && !ids.length) return
  if (!ids) {
    await db.prepare('UPDATE notifications SET read = 1 WHERE recipient_email = ?').bind(email.toLowerCase()).run()
    return
  }
  await db.batch(ids.slice(0, 100).map((id) => db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND recipient_email = ?').bind(id, email.toLowerCase())))
}
