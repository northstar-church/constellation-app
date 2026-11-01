import { MAX_UPLOAD_BYTES, findMember, type TeamMember } from '../../src/renderer/src/data/requests'
import { canAutoPublish, platformById, type PostActivity, type PostMedia, type SocialAccount, type SocialPost } from '../../src/renderer/src/data/social'
import { cleanName, getTeam, notify, type CollabEnv } from './collab'

/** Posting Calendar API: shared posts, their media, review notifications and posting-time reminders. */

export class SocialError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
  }
}

type Row = Record<string, unknown>
const PLATFORM_IDS = new Set(['facebook', 'instagram', 'tiktok', 'youtube'])
const STATUS_IDS = new Set(['idea', 'draft', 'review', 'scheduled', 'posted'])
const CATEGORY_IDS = new Set(['', 'kids', 'students', 'discipleship', 'community', 'missions', 'special-needs', 'sunday-recap', 'sunday-services'])
const ID = /^[A-Za-z0-9-]{8,64}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^\d{2}:\d{2}$/

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')
const parse = <T>(v: unknown, fallback: T): T => {
  try {
    return typeof v === 'string' ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}

const toPost = (r: Row): SocialPost => ({
  id: r.id as string,
  platform: r.platform as SocialPost['platform'],
  title: r.title as string,
  caption: r.caption as string,
  media: parse<PostMedia[]>(r.media, []),
  date: r.date as string,
  time: r.time as string,
  at: (r.at as string) ?? null,
  status: r.status as SocialPost['status'],
  category: r.category as SocialPost['category'],
  campaign: r.campaign as string,
  poster: r.poster as string,
  author: r.author as string,
  postUrl: r.post_url as string,
  reviewNote: r.review_note as string,
  activity: parse<PostActivity[]>(r.activity, []),
  account: (r.account as string) ?? '',
  autoPublish: r.auto_publish === 1,
  publishState: ((r.publish_state as string) ?? '') as SocialPost['publishState'],
  publishError: (r.publish_error as string) ?? '',
  boardId: (r.board_id as string) ?? '',
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string
})

/** Media must be files uploaded through /api/social/media. */
function cleanMedia(v: unknown): PostMedia[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((m) => m && typeof m.id === 'string' && ID.test(m.id))
    .slice(0, 20)
    .map((m) => {
      const out: PostMedia = { id: m.id, name: cleanName(str(m.name, 200) || 'file'), kind: m.kind === 'video' ? 'video' : 'image', url: `/api/social/media/${m.id}` }
      const w = Number(m.w)
      const h = Number(m.h)
      if (Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0 && w < 100000 && h < 100000) Object.assign(out, { w, h })
      return out
    })
}

/** Only the fields a person may set; anything missing keeps its current value. */
function cleanFields(b: Record<string, unknown>, base: SocialPost): SocialPost {
  const next = { ...base }
  if ('title' in b) next.title = str(b.title, 200)
  if ('caption' in b) next.caption = str(b.caption, 64000)
  if ('media' in b) next.media = cleanMedia(b.media)
  if ('date' in b) next.date = typeof b.date === 'string' && DATE.test(b.date) ? b.date : ''
  if ('time' in b) next.time = typeof b.time === 'string' && TIME.test(b.time) ? b.time : ''
  if ('at' in b) next.at = typeof b.at === 'string' && !Number.isNaN(Date.parse(b.at)) ? new Date(b.at).toISOString() : null
  if ('status' in b && typeof b.status === 'string' && STATUS_IDS.has(b.status)) next.status = b.status as SocialPost['status']
  if ('category' in b && typeof b.category === 'string' && CATEGORY_IDS.has(b.category)) next.category = b.category as SocialPost['category']
  if ('campaign' in b) next.campaign = str(b.campaign, 120).trim()
  if ('poster' in b) next.poster = str(b.poster, 120)
  if ('postUrl' in b) next.postUrl = /^https?:\/\//i.test(str(b.postUrl, 600)) ? str(b.postUrl, 600) : ''
  if ('reviewNote' in b) next.reviewNote = str(b.reviewNote, 2000)
  if ('account' in b) next.account = str(b.account, 80)
  if ('autoPublish' in b) next.autoPublish = b.autoPublish === true
  if ('boardId' in b) next.boardId = typeof b.boardId === 'string' && /^[A-Za-z0-9-]{6,64}$/.test(b.boardId) ? b.boardId : ''
  // Only the server sets a publishing failure; a person can clear it (re-scheduling tries again)
  if (b.publishState === '') {
    next.publishState = ''
    next.publishError = ''
  }
  return next
}

async function listAccounts(db: D1Database): Promise<SocialAccount[]> {
  const { results } = await db.prepare('SELECT id, platform, name, handle, external_id FROM social_accounts ORDER BY platform, sort, name').all<Row>()
  return (results ?? []).map((r) => ({ id: r.id as string, platform: r.platform as SocialAccount['platform'], name: r.name as string, handle: r.handle as string, connected: !!r.external_id }))
}

/** Auto-publishing only applies to connected Instagram/Facebook accounts; an account must be one of ours. */
function settleAccount(p: SocialPost, accounts: SocialAccount[]) {
  const mine = accounts.filter((a) => a.platform === p.platform)
  if (!mine.some((a) => a.id === p.account)) p.account = mine.length === 1 ? mine[0].id : ''
  p.autoPublish = p.autoPublish && canAutoPublish(p.platform) && !!mine.find((a) => a.id === p.account)?.connected
}

const leadOf = (team: TeamMember[]) => team.find((m) => m.socialLead)
const isLead = (lead: TeamMember | undefined, me: { email: string }) => !!lead && !!lead.email && lead.email.toLowerCase() === me.email.toLowerCase()
const emailOf = (team: TeamMember[], name: string) => findMember(team, name)?.email?.toLowerCase() ?? ''
const label = (p: SocialPost) => p.title || p.caption.split('\n')[0].slice(0, 80) || 'Untitled post'
const when = (p: SocialPost) => {
  if (!p.date) return ''
  const d = new Date(`${p.date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  if (!p.time) return ` for ${d}`
  const [h, m] = p.time.split(':').map(Number)
  return ` for ${d} at ${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`
}

async function save(db: D1Database, p: SocialPost, insert: boolean, remindReset: boolean) {
  const cols = [p.platform, p.title, p.caption, JSON.stringify(p.media), p.date, p.time, p.at ?? null, p.status, p.category, p.campaign, p.poster, p.author, p.postUrl, p.reviewNote, JSON.stringify(p.activity), p.account, p.autoPublish ? 1 : 0, p.publishState, p.publishError, p.boardId, p.updatedAt]
  if (insert) {
    await db
      .prepare(
        `INSERT INTO social_posts (platform,title,caption,media,date,time,at,status,category,campaign,poster,author,post_url,review_note,activity,account,auto_publish,publish_state,publish_error,board_id,updated_at,id,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .bind(...cols, p.id, p.createdAt)
      .run()
  } else {
    await db
      .prepare(
        `UPDATE social_posts SET platform=?,title=?,caption=?,media=?,date=?,time=?,at=?,status=?,category=?,campaign=?,poster=?,author=?,post_url=?,review_note=?,activity=?,account=?,auto_publish=?,publish_state=?,publish_error=?,board_id=?,updated_at=?${
          remindReset ? ',reminded_at=NULL' : ''
        } WHERE id=?`
      )
      .bind(...cols, p.id)
      .run()
  }
}

/** Tells the right people about a status change. */
async function notifyChange(env: CollabEnv, team: TeamMember[], before: SocialPost | null, after: SocialPost, me: { name: string; email: string }) {
  const lead = leadOf(team)
  const pf = platformById(after.platform).label
  const first = me.name.split(' ')[0]
  const myEmail = me.email.toLowerCase()
  const snippet = label(after)
  const from = before?.status ?? null
  const to = after.status
  if (to === 'review' && from !== 'review' && lead?.email && !isLead(lead, me)) {
    await notify(
      env,
      [lead.email.toLowerCase()],
      { requestId: after.id, kind: 'post-review', actor: me.name, message: `${pf}${when(after)}`, at: new Date().toISOString() },
      `📝 *${first}* submitted a ${pf} post${when(after)} for your review: _${snippet}_\nOpen Constellation → Posting Calendar.`
    )
  }
  if (from === 'review' && to === 'scheduled') {
    const who = [...new Set([emailOf(team, after.author), emailOf(team, after.poster)])].filter((e) => e && e !== myEmail)
    await notify(
      env,
      who,
      { requestId: after.id, kind: 'post-approved', actor: me.name, message: `${pf}${when(after)}`, at: new Date().toISOString() },
      `✅ *${first}* approved your ${pf} post${when(after)}: _${snippet}_`
    )
  }
  if (from === 'review' && to === 'draft' && after.reviewNote) {
    const who = [emailOf(team, after.author)].filter((e) => e && e !== myEmail)
    await notify(
      env,
      who,
      { requestId: after.id, kind: 'post-sentback', actor: me.name, message: after.reviewNote, at: new Date().toISOString() },
      `↩️ *${first}* sent back your ${pf} post: _${snippet}_\n>${after.reviewNote.replace(/\n/g, '\n>')}\nOpen Constellation → Posting Calendar to update it.`
    )
  }
}

const CONTENT_FIELDS = ['title', 'caption', 'media', 'date', 'time'] as const

export async function socialApi(
  request: Request,
  env: CollabEnv,
  ctx: ExecutionContext,
  me: { name: string; email: string },
  path: string,
  changed: (what: string) => void
): Promise<Response | null> {
  const db = env.DB
  const method = request.method
  const team = getTeam(env)
  const lead = leadOf(team)
  const iAmLead = isLead(lead, me)
  const now = () => new Date().toISOString()
  const log = (what: string, note?: string): PostActivity => ({ at: now(), by: me.name, what: str(what, 120), ...(note ? { note: str(note, 2000) } : {}) })

  if (path === '/api/social' && method === 'GET') {
    const { results } = await db.prepare('SELECT * FROM social_posts ORDER BY date, time').all<Row>()
    return json({ posts: (results ?? []).map(toPost) })
  }
  if (path === '/api/social/accounts' && method === 'GET') return json({ accounts: await listAccounts(db) })

  // Everyone can look; only the social media director adds, changes or posts anything.
  if (method !== 'GET' && lead && !iAmLead) throw new SocialError(403, `Only ${lead.name.split(' ')[0]} can make changes in the Posting Calendar.`)

  // New posts: one per platform
  if (path === '/api/social' && method === 'POST') {
    const b = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
    const platforms = Array.isArray(b.platforms) ? [...new Set(b.platforms.filter((p): p is string => typeof p === 'string' && PLATFORM_IDS.has(p)))] : []
    if (!platforms.length) throw new SocialError(400, 'Pick at least one platform.')
    const draft = (b.draft ?? {}) as Record<string, unknown>
    const blank: SocialPost = {
      id: '',
      platform: 'instagram',
      title: '',
      caption: '',
      media: [],
      date: '',
      time: '',
      at: null,
      status: 'draft',
      category: '',
      campaign: '',
      poster: me.name,
      author: me.name,
      postUrl: '',
      reviewNote: '',
      activity: [],
      account: '',
      autoPublish: false,
      publishState: '',
      publishError: '',
      boardId: '',
      createdAt: now(),
      updatedAt: now()
    }
    const fields = cleanFields(draft, blank)
    if (fields.status === 'scheduled' && lead && !iAmLead) throw new SocialError(403, `Only ${lead.name.split(' ')[0]} can schedule posts. Submit it for review instead.`)
    if (fields.status === 'posted') fields.status = 'draft'
    const what = str(b.what, 120) || 'created'
    const chosen = (b.accounts ?? {}) as Record<string, unknown>
    const accounts = await listAccounts(db)
    const made: SocialPost[] = []
    for (const platform of platforms) {
      const p: SocialPost = {
        ...fields,
        platform: platform as SocialPost['platform'],
        title: platform === 'youtube' ? fields.title : '',
        id: crypto.randomUUID(),
        author: me.name,
        account: str(chosen[platform], 80),
        activity: [log('created'), ...(what !== 'created' ? [log(what)] : [])]
      }
      settleAccount(p, accounts)
      await save(db, p, true, false)
      made.push(p)
    }
    ctx.waitUntil(Promise.all(made.map((p) => notifyChange(env, team, null, p, me))).then(() => changed('notifications')))
    changed('social')
    return json({ posts: made })
  }

  if (path === '/api/social/media' && method === 'POST') {
    const url = new URL(request.url)
    const name = cleanName(url.searchParams.get('name') ?? 'file') || 'file'
    const contentType = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    if (!/^(image|video)\//.test(contentType)) throw new SocialError(400, 'Posts can include images and videos only.')
    const length = Number(request.headers.get('content-length') || 0)
    if (length > MAX_UPLOAD_BYTES) throw new SocialError(413, `That file is over ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB. Share a smaller export, or post the full video straight from your computer.`)
    const id = crypto.randomUUID()
    const bytes = await request.arrayBuffer()
    if (!bytes.byteLength) throw new SocialError(400, 'That file is empty.')
    if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new SocialError(413, 'That file is too large.')
    await env.FILES.put(`social/${id}`, bytes, { httpMetadata: { contentType } })
    const kind = contentType.startsWith('video/') ? 'video' : 'image'
    await db.prepare('INSERT INTO social_media (id,name,kind,content_type,size,uploaded_by,at) VALUES (?,?,?,?,?,?,?)').bind(id, name, kind, contentType, bytes.byteLength, me.name, now()).run()
    const media: PostMedia = { id, name, kind, url: `/api/social/media/${id}` }
    return json(media)
  }

  // Creative Studio images copied into a post (each post keeps its own file)
  if (path === '/api/social/media/from-studio' && method === 'POST') {
    const b = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
    const ids = (Array.isArray(b.ids) ? b.ids : []).filter((x): x is string => typeof x === 'string' && /^[A-Za-z0-9-]{6,64}$/.test(x)).slice(0, 20)
    const out: PostMedia[] = []
    for (const sid of ids) {
      const row = await db.prepare('SELECT * FROM studio_media WHERE id = ?').bind(sid).first<Row>()
      const obj = row ? await env.FILES.get(`studio/${sid}`) : null
      if (!row || !obj) throw new SocialError(404, 'One of those images is no longer on the board.')
      const id = crypto.randomUUID()
      const bytes = await obj.arrayBuffer()
      await env.FILES.put(`social/${id}`, bytes, { httpMetadata: { contentType: row.content_type as string } })
      await db
        .prepare('INSERT INTO social_media (id,name,kind,content_type,size,uploaded_by,at) VALUES (?,?,?,?,?,?,?)')
        .bind(id, row.name as string, 'image', row.content_type as string, bytes.byteLength, me.name, now())
        .run()
      out.push({ id, name: row.name as string, kind: 'image', url: `/api/social/media/${id}` })
    }
    return json({ media: out })
  }

  let m = /^\/api\/social\/media\/([A-Za-z0-9-]{8,64})$/.exec(path)
  if (m && method === 'GET') {
    const row = await db.prepare('SELECT * FROM social_media WHERE id = ?').bind(m[1]).first<Row>()
    const obj = row ? await env.FILES.get(`social/${m[1]}`) : null
    if (!row || !obj) throw new SocialError(404, 'That file is no longer available.')
    return new Response(obj.body, {
      headers: {
        'content-type': row.content_type as string,
        'content-length': String(obj.size),
        'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(row.name as string)}`,
        'cache-control': 'private, max-age=86400',
        'x-content-type-options': 'nosniff'
      }
    })
  }

  m = /^\/api\/social\/([A-Za-z0-9-]{8,64})\/publish$/.exec(path)
  if (m && method === 'POST') {
    // Publishing straight to Instagram/Facebook switches on once Meta is connected.
    throw new SocialError(400, 'Instagram and Facebook aren’t connected to Constellation yet, so posts can’t publish on their own.')
  }

  m = /^\/api\/social\/([A-Za-z0-9-]{8,64})$/.exec(path)
  if (!m) return null
  const row = await db.prepare('SELECT * FROM social_posts WHERE id = ?').bind(m[1]).first<Row>()
  if (!row) throw new SocialError(404, 'That post no longer exists.')
  const before = toPost(row)

  if (method === 'DELETE') {
    await db.prepare('DELETE FROM social_posts WHERE id = ?').bind(before.id).run()
    changed('social')
    return json({ ok: true })
  }

  if (method === 'PATCH') {
    const b = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
    const patch = (b.patch ?? {}) as Record<string, unknown>
    let what = str(b.what, 120)
    const note = str(b.note, 2000)
    const after = cleanFields(patch, before)
    if ('account' in patch || 'autoPublish' in patch) settleAccount(after, await listAccounts(db))
    if (lead && !iAmLead) {
      // Only the social media director schedules; her approval covers what she saw.
      if (after.status === 'scheduled' && before.status !== 'scheduled') throw new SocialError(403, `Only ${lead.name.split(' ')[0]} can schedule posts. Submit it for review instead.`)
      const contentChanged = CONTENT_FIELDS.some((f) => JSON.stringify(after[f]) !== JSON.stringify(before[f]))
      if (before.status === 'scheduled' && after.status === 'scheduled' && contentChanged) {
        after.status = 'review'
        what = what ? `${what} (back to review)` : 'edited a scheduled post (back to review)'
      }
    }
    after.updatedAt = now()
    if (what) after.activity = [...before.activity, log(what, note)]
    const remindReset = after.at !== before.at || (after.status === 'scheduled' && before.status !== 'scheduled')
    await save(db, after, false, remindReset)
    ctx.waitUntil(notifyChange(env, team, before, after, me).then(() => changed('notifications')))
    changed('social')
    return json(after)
  }

  return null
}

/** Every few minutes: tell whoever is posting that a scheduled post's time has come. */
export async function remindDuePosts(env: CollabEnv, broadcast: (what: string) => Promise<void>): Promise<number> {
  const team = getTeam(env)
  const now = new Date()
  const soon = new Date(now.getTime() + 5 * 60_000).toISOString()
  const dayAgo = new Date(now.getTime() - 24 * 3600_000).toISOString()
  const { results } = await env.DB.prepare(
    "SELECT * FROM social_posts WHERE status = 'scheduled' AND auto_publish = 0 AND at IS NOT NULL AND at <= ? AND at >= ? AND reminded_at IS NULL LIMIT 50"
  )
    .bind(soon, dayAgo)
    .all<Row>()
  let sent = 0
  for (const r of results ?? []) {
    const p = toPost(r)
    const email = emailOf(team, p.poster)
    await env.DB.prepare('UPDATE social_posts SET reminded_at = ? WHERE id = ?').bind(now.toISOString(), p.id).run()
    if (!email) continue
    const pf = platformById(p.platform).label
    await notify(
      env,
      [email],
      { requestId: p.id, kind: 'post-due', actor: 'Constellation', message: `${pf}: ${label(p)}`, at: now.toISOString() },
      `⏰ Time to post on *${pf}*: _${label(p)}_\nOpen Constellation → Posting Calendar to copy the caption and media, then mark it posted.`
    )
    sent++
  }
  if (sent) await broadcast('notifications')
  return sent
}
