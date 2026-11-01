import { cardsFromTemplate, CARD_DEFAULT_WIDTH, type CardData, type CardType, type StudioBoard, type StudioCard, type StudioLine, type StudioMedia, type TemplateId } from '../../src/renderer/src/data/studio'
import { cleanName, type CollabEnv } from './collab'

/** Creative Studio API: boards, cards, lines and images, shared live with the team. */

export class StudioError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
  }
}

type Row = Record<string, unknown>
const TYPES = new Set<CardType>(['note', 'heading', 'todo', 'link', 'image', 'color', 'column', 'board', 'shot', 'slide'])
const TEMPLATE_IDS = new Set<TemplateId>(['blank', 'brief', 'storyboard', 'carousel', 'mood'])
const COLORS = new Set(['', 'sky', 'sun', 'rose', 'leaf', 'plum', 'clay', 'ink'])
const ID = /^[A-Za-z0-9-]{6,64}$/
const MAX_IMAGE = 30 * 1024 * 1024
const MAX_DATA = 40_000

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')
const num = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback)
const parse = <T>(v: unknown, fallback: T): T => {
  try {
    return typeof v === 'string' ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}

const toBoard = (r: Row): StudioBoard => ({
  id: r.id as string,
  title: r.title as string,
  parentId: r.parent_id as string,
  color: r.color as string,
  visibility: r.visibility === 'private' ? 'private' : 'team',
  owner: (r.owner as string) ?? '',
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
  updatedBy: r.updated_by as string
})
const toCard = (r: Row): StudioCard => ({
  id: r.id as string,
  boardId: r.board_id as string,
  type: r.type as CardType,
  x: r.x as number,
  y: r.y as number,
  w: r.w as number,
  parentId: (r.parent_id as string) || null,
  order: r.ord as number,
  color: r.color as string,
  data: parse<CardData>(r.data, {}),
  updatedAt: r.updated_at as string,
  updatedBy: r.updated_by as string
})
const toLine = (r: Row): StudioLine => ({ id: r.id as string, boardId: r.board_id as string, from: r.from_id as string, to: r.to_id as string, label: r.label as string })

/** Card content: known fields only, sensible sizes, images must be Studio uploads. */
function cleanData(v: unknown): Partial<CardData> {
  const d = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const out: Partial<CardData> = {}
  for (const k of ['text', 'title', 'url', 'caption', 'name', 'number', 'action', 'dialogue', 'camera', 'duration'] as const) {
    if (k in d) out[k] = str(d[k], k === 'text' ? 20000 : 2000)
  }
  if ('url' in out && out.url && !/^https?:\/\//i.test(out.url)) out.url = ''
  if ('hex' in d) out.hex = /^#[0-9a-f]{6}$/i.test(str(d.hex, 7)) ? str(d.hex, 7).toLowerCase() : '#cccccc'
  if ('boardId' in d && typeof d.boardId === 'string' && ID.test(d.boardId)) out.boardId = d.boardId
  if ('items' in d && Array.isArray(d.items)) {
    out.items = d.items.slice(0, 200).map((it) => ({ id: str(it?.id, 64) || crypto.randomUUID(), text: str(it?.text, 500), done: it?.done === true }))
  }
  if ('media' in d) {
    const m = d.media as Record<string, unknown> | null
    out.media = m && typeof m.id === 'string' && ID.test(m.id) ? { id: m.id, name: cleanName(str(m.name, 200)) || 'image', url: `/api/studio/media/${m.id}` } : null
  }
  return out
}

function cleanCard(b: Record<string, unknown>, base: StudioCard): StudioCard {
  const next = { ...base }
  if ('x' in b) next.x = Math.round(num(b.x, 0, 20000, base.x))
  if ('y' in b) next.y = Math.round(num(b.y, 0, 20000, base.y))
  if ('w' in b) next.w = Math.round(num(b.w, 120, 1200, base.w))
  if ('order' in b) next.order = num(b.order, -1e9, 1e9, base.order)
  if ('color' in b && typeof b.color === 'string' && COLORS.has(b.color)) next.color = b.color
  if ('parentId' in b) next.parentId = typeof b.parentId === 'string' && ID.test(b.parentId) ? b.parentId : null
  if ('boardId' in b && typeof b.boardId === 'string' && ID.test(b.boardId)) next.boardId = b.boardId
  if ('data' in b) next.data = { ...cleanData(b.data) }
  return next
}

const cardStmt = (db: D1Database, c: StudioCard) => {
  const data = JSON.stringify(c.data)
  if (data.length > MAX_DATA) throw new StudioError(413, 'That card has too much in it. Split it into a few cards.')
  return db
    .prepare(
      `INSERT INTO studio_cards (id,board_id,type,x,y,w,parent_id,ord,color,data,updated_at,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET board_id=excluded.board_id,type=excluded.type,x=excluded.x,y=excluded.y,w=excluded.w,parent_id=excluded.parent_id,
       ord=excluded.ord,color=excluded.color,data=excluded.data,updated_at=excluded.updated_at,updated_by=excluded.updated_by`
    )
    .bind(c.id, c.boardId, c.type, c.x, c.y, c.w, c.parentId, c.order, c.color, data, c.updatedAt, c.updatedBy)
}
const lineStmt = (db: D1Database, l: StudioLine) =>
  db.prepare('INSERT OR REPLACE INTO studio_lines (id,board_id,from_id,to_id,label) VALUES (?,?,?,?,?)').bind(l.id, l.boardId, l.from, l.to, l.label)

/** The board and every board inside it, however deep. */
async function boardTree(db: D1Database, id: string): Promise<string[]> {
  const { results } = await db.prepare('SELECT id, parent_id FROM studio_boards').all<Row>()
  const kids = new Map<string, string[]>()
  for (const r of results ?? []) kids.set(r.parent_id as string, [...(kids.get(r.parent_id as string) ?? []), r.id as string])
  const out: string[] = []
  const walk = (b: string) => {
    out.push(b)
    for (const k of kids.get(b) ?? []) if (!out.includes(k)) walk(k)
  }
  walk(id)
  return out
}

export async function studioApi(
  request: Request,
  env: CollabEnv,
  me: { name: string; email: string },
  path: string,
  changed: (what: string) => void
): Promise<Response | null> {
  const db = env.DB
  const method = request.method
  const now = () => new Date().toISOString()
  const body = async () => ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
  const done = (data: unknown) => {
    changed('studio')
    return json(data)
  }
  const myEmail = me.email.toLowerCase()

  // Who sees what: a private board (and everything inside it) is only for its owner.
  let seen: Set<string> | null = null
  const visibleIds = async () => {
    if (seen) return seen
    const { results } = await db.prepare('SELECT id, parent_id, visibility, owner_email FROM studio_boards').all<Row>()
    const byId = new Map((results ?? []).map((r) => [r.id as string, r]))
    const rootOf = (id: string) => {
      let r = byId.get(id)
      const hops = new Set<string>()
      while (r && r.parent_id && byId.has(r.parent_id as string) && !hops.has(r.id as string)) {
        hops.add(r.id as string)
        r = byId.get(r.parent_id as string)
      }
      return r
    }
    seen = new Set(
      [...byId.keys()].filter((id) => {
        const root = rootOf(id)!
        return root.visibility !== 'private' || (root.owner_email as string).toLowerCase() === myEmail
      })
    )
    return seen
  }
  const mustSee = async (boardId: string) => {
    if (!(await visibleIds()).has(boardId)) throw new StudioError(404, 'That board no longer exists, or it’s private.')
  }

  if (path === '/api/studio' && method === 'GET') {
    const [b, c, l] = await db.batch([db.prepare('SELECT * FROM studio_boards ORDER BY created_at'), db.prepare('SELECT * FROM studio_cards'), db.prepare('SELECT * FROM studio_lines')])
    const ok = await visibleIds()
    return json({
      boards: (b.results as Row[]).filter((r) => ok.has(r.id as string)).map(toBoard),
      cards: (c.results as Row[]).filter((r) => ok.has(r.board_id as string)).map(toCard),
      lines: (l.results as Row[]).filter((r) => ok.has(r.board_id as string)).map(toLine)
    })
  }

  // ---------- boards ----------
  if (path === '/api/studio/boards' && method === 'POST') {
    const b = await body()
    const template = TEMPLATE_IDS.has(b.template as TemplateId) ? (b.template as TemplateId) : 'blank'
    const parentId = typeof b.parentId === 'string' && ID.test(b.parentId) ? b.parentId : ''
    if (parentId) await mustSee(parentId)
    // Boards inside another board follow the top board's privacy
    const visibility = !parentId && b.visibility === 'private' ? 'private' : 'team'
    const board: StudioBoard = { id: crypto.randomUUID(), title: str(b.title, 120).trim() || 'Untitled Board', parentId, color: '', visibility, owner: me.name, createdAt: now(), updatedAt: now(), updatedBy: me.name }
    // Starting cards: given ones (a post planned in Studio), or the template's
    const given = Array.isArray(b.cards) ? b.cards.slice(0, 60).filter((c) => c && TYPES.has(c.type)) : null
    const cards = given
      ? given.map((c) => {
          const type = c.type as CardType
          return cleanCard({ ...c, parentId: null }, { id: crypto.randomUUID(), boardId: board.id, type, x: 80, y: 80, w: CARD_DEFAULT_WIDTH[type], parentId: null, order: 0, color: '', data: {}, updatedAt: now(), updatedBy: me.name })
        })
      : cardsFromTemplate(board.id, template, me.name)
    for (const c of cards) c.boardId = board.id
    if (parentId) {
      const at = (b.at ?? {}) as Record<string, unknown>
      cards.push({ id: crypto.randomUUID(), boardId: parentId, type: 'board', x: Math.round(num(at.x, 0, 20000, 80)), y: Math.round(num(at.y, 0, 20000, 80)), w: CARD_DEFAULT_WIDTH.board, parentId: null, order: 0, color: '', data: { boardId: board.id }, updatedAt: now(), updatedBy: me.name })
    }
    await db.batch([
      db
        .prepare('INSERT INTO studio_boards (id,title,parent_id,color,visibility,owner,owner_email,created_at,updated_at,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .bind(board.id, board.title, board.parentId, '', visibility, me.name, myEmail, board.createdAt, board.updatedAt, me.name),
      ...cards.map((c) => cardStmt(db, c))
    ])
    return done(board)
  }

  let m = /^\/api\/studio\/boards\/([A-Za-z0-9-]{6,64})$/.exec(path)
  if (m) {
    const row = await db.prepare('SELECT * FROM studio_boards WHERE id = ?').bind(m[1]).first<Row>()
    if (!row) throw new StudioError(404, 'That board no longer exists.')
    await mustSee(m[1])
    if (method === 'PATCH') {
      const b = await body()
      const next = toBoard(row)
      let ownerEmail = (row.owner_email as string) ?? ''
      if ('visibility' in b && (b.visibility === 'team' || b.visibility === 'private') && b.visibility !== next.visibility) {
        if (next.parentId) throw new StudioError(400, 'Boards inside another board follow that board. Change it on the top board.')
        if (ownerEmail && ownerEmail.toLowerCase() !== myEmail) throw new StudioError(403, `Only ${next.owner.split(' ')[0] || 'the person who made it'} can change who sees this board.`)
        next.visibility = b.visibility
        // Boards from before owners existed belong to whoever makes them private
        if (!ownerEmail) {
          ownerEmail = myEmail
          next.owner = me.name
        }
      }
      if ('title' in b) next.title = str(b.title, 120).trim() || next.title
      if ('color' in b && typeof b.color === 'string' && COLORS.has(b.color)) next.color = b.color
      if ('parentId' in b) {
        const p = typeof b.parentId === 'string' && ID.test(b.parentId) ? b.parentId : ''
        // A board can't go inside itself or one of its own boards
        if (p && (await boardTree(db, next.id)).includes(p)) throw new StudioError(400, 'A board can’t go inside itself.')
        if (p) await mustSee(p)
        next.parentId = p
      }
      await db
        .prepare('UPDATE studio_boards SET title=?, color=?, parent_id=?, visibility=?, owner=?, owner_email=?, updated_at=?, updated_by=? WHERE id=?')
        .bind(next.title, next.color, next.parentId, next.visibility, next.owner, ownerEmail, now(), me.name, next.id)
        .run()
      return done({ ok: true })
    }
    if (method === 'DELETE') {
      const ids = await boardTree(db, m[1])
      const marks = ids.map(() => '?').join(',')
      await db.batch([
        db.prepare(`DELETE FROM studio_cards WHERE board_id IN (${marks})`).bind(...ids),
        db.prepare(`DELETE FROM studio_lines WHERE board_id IN (${marks})`).bind(...ids),
        db.prepare(`DELETE FROM studio_boards WHERE id IN (${marks})`).bind(...ids),
        // board cards elsewhere that opened these boards
        db.prepare(`DELETE FROM studio_cards WHERE type = 'board' AND json_extract(data, '$.boardId') IN (${marks})`).bind(...ids)
      ])
      return done({ ok: true })
    }
  }

  // ---------- cards ----------
  if (path === '/api/studio/cards' && method === 'POST') {
    const b = await body()
    if (!TYPES.has(b.type as CardType)) throw new StudioError(400, 'Unknown card type.')
    if (typeof b.boardId !== 'string' || !ID.test(b.boardId)) throw new StudioError(400, 'Which board is this card for?')
    await mustSee(b.boardId)
    const type = b.type as CardType
    const base: StudioCard = { id: crypto.randomUUID(), boardId: b.boardId, type, x: 80, y: 80, w: CARD_DEFAULT_WIDTH[type], parentId: null, order: 0, color: '', data: {}, updatedAt: now(), updatedBy: me.name }
    const card = cleanCard(b, base)
    await cardStmt(db, card).run()
    return done(card)
  }

  // Several cards at once: positions, columns, colors
  if (path === '/api/studio/cards' && method === 'PATCH') {
    const b = await body()
    const patches = Array.isArray(b.patches) ? b.patches.slice(0, 300) : []
    const ids = patches.map((p) => str(p?.id, 64)).filter((id) => ID.test(id))
    if (!ids.length) return json({ ok: true })
    const { results } = await db.prepare(`SELECT * FROM studio_cards WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all<Row>()
    const ok = await visibleIds()
    const byId = new Map((results ?? []).filter((r) => ok.has(r.board_id as string)).map((r) => [r.id as string, toCard(r)]))
    const stmts = patches
      .filter((p) => byId.has(p.id))
      .map((p) => {
        const patch = { ...(p.patch ?? {}) }
        delete patch.data // content goes through /data so concurrent edits merge
        const next = cleanCard(patch, byId.get(p.id)!)
        if (!ok.has(next.boardId)) throw new StudioError(404, 'That board no longer exists, or it’s private.')
        return cardStmt(db, { ...next, updatedAt: now(), updatedBy: me.name })
      })
    if (stmts.length) await db.batch(stmts)
    return done({ ok: true })
  }

  m = /^\/api\/studio\/cards\/([A-Za-z0-9-]{6,64})\/data$/.exec(path)
  if (m && method === 'PATCH') {
    const row = await db.prepare('SELECT * FROM studio_cards WHERE id = ?').bind(m[1]).first<Row>()
    if (!row) throw new StudioError(404, 'That card was deleted.')
    await mustSee(row.board_id as string)
    const c = toCard(row)
    const merged = { ...c.data, ...cleanData(await body()) }
    await cardStmt(db, { ...c, data: merged, updatedAt: now(), updatedBy: me.name }).run()
    return done({ ok: true })
  }

  if (path === '/api/studio/cards/delete' && method === 'POST') {
    const b = await body()
    const ids = (Array.isArray(b.ids) ? b.ids : []).filter((id): id is string => typeof id === 'string' && ID.test(id)).slice(0, 300)
    if (!ids.length) return json({ cards: [], lines: [] })
    const marks = ids.map(() => '?').join(',')
    // A column takes its stacked cards with it
    const ok = await visibleIds()
    const cardRows = ((await db.prepare(`SELECT * FROM studio_cards WHERE id IN (${marks}) OR parent_id IN (${marks})`).bind(...ids, ...ids).all<Row>()).results ?? []).filter((r) =>
      ok.has(r.board_id as string)
    )
    const all = (cardRows ?? []).map((r) => r.id as string)
    if (!all.length) return json({ cards: [], lines: [] })
    const allMarks = all.map(() => '?').join(',')
    const { results: lineRows } = await db.prepare(`SELECT * FROM studio_lines WHERE from_id IN (${allMarks}) OR to_id IN (${allMarks})`).bind(...all, ...all).all<Row>()
    await db.batch([
      db.prepare(`DELETE FROM studio_cards WHERE id IN (${allMarks})`).bind(...all),
      db.prepare(`DELETE FROM studio_lines WHERE from_id IN (${allMarks}) OR to_id IN (${allMarks})`).bind(...all, ...all)
    ])
    return done({ cards: (cardRows ?? []).map(toCard), lines: (lineRows ?? []).map(toLine) })
  }

  // Undo a delete: put the same cards and lines back
  if (path === '/api/studio/restore' && method === 'POST') {
    const b = await body()
    const ok = await visibleIds()
    const cards = (Array.isArray(b.cards) ? b.cards : []).slice(0, 300).filter((c) => c && TYPES.has(c.type) && ID.test(str(c.id, 64)) && ok.has(str(c.boardId, 64)))
    const lines = (Array.isArray(b.lines) ? b.lines : []).slice(0, 300).filter((l) => l && ID.test(str(l.id, 64)) && ID.test(str(l.from, 64)) && ID.test(str(l.to, 64)) && ok.has(str(l.boardId, 64)))
    // Only put back cards that were really deleted (not overwrite someone else's)
    if (cards.length) {
      const { results: still } = await db.prepare(`SELECT id FROM studio_cards WHERE id IN (${cards.map(() => '?').join(',')})`).bind(...cards.map((c) => c.id)).all<Row>()
      const exists = new Set((still ?? []).map((r) => r.id as string))
      cards.splice(0, cards.length, ...cards.filter((c) => !exists.has(c.id)))
    }
    const stmts = [
      ...cards.map((c) => {
        const base: StudioCard = { id: c.id, boardId: c.boardId, type: c.type, x: 80, y: 80, w: CARD_DEFAULT_WIDTH[c.type as CardType], parentId: null, order: 0, color: '', data: {}, updatedAt: now(), updatedBy: me.name }
        return cardStmt(db, cleanCard(c, base))
      }),
      ...lines.map((l) => lineStmt(db, { id: l.id, boardId: str(l.boardId, 64), from: l.from, to: l.to, label: str(l.label, 80) }))
    ]
    if (stmts.length) await db.batch(stmts)
    return done({ ok: true })
  }

  // ---------- lines ----------
  if (path === '/api/studio/lines' && method === 'POST') {
    const b = await body()
    if (![b.boardId, b.from, b.to].every((v) => typeof v === 'string' && ID.test(v))) throw new StudioError(400, 'A line needs two cards.')
    await mustSee(b.boardId as string)
    const line: StudioLine = { id: crypto.randomUUID(), boardId: b.boardId as string, from: b.from as string, to: b.to as string, label: str(b.label, 80) }
    await lineStmt(db, line).run()
    return done(line)
  }
  m = /^\/api\/studio\/lines\/([A-Za-z0-9-]{6,64})$/.exec(path)
  if (m) {
    const line = await db.prepare('SELECT board_id FROM studio_lines WHERE id = ?').bind(m[1]).first<Row>()
    if (!line) throw new StudioError(404, 'That line was removed.')
    await mustSee(line.board_id as string)
  }
  if (m && method === 'PATCH') {
    await db.prepare('UPDATE studio_lines SET label = ? WHERE id = ?').bind(str((await body()).label, 80), m[1]).run()
    return done({ ok: true })
  }
  if (m && method === 'DELETE') {
    await db.prepare('DELETE FROM studio_lines WHERE id = ?').bind(m[1]).run()
    return done({ ok: true })
  }

  // ---------- images ----------
  if (path === '/api/studio/media' && method === 'POST') {
    const name = cleanName(new URL(request.url).searchParams.get('name') ?? 'image') || 'image'
    const contentType = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    if (!/^image\/(jpeg|png|gif|webp|svg\+xml|heic|heif|avif)$/.test(contentType)) throw new StudioError(400, 'Studio boards take images (JPG, PNG, GIF, WebP). Add videos as links.')
    const bytes = await request.arrayBuffer()
    if (!bytes.byteLength) throw new StudioError(400, 'That image is empty.')
    if (bytes.byteLength > MAX_IMAGE) throw new StudioError(413, 'That image is over 30 MB. Export a smaller version.')
    const id = crypto.randomUUID()
    await env.FILES.put(`studio/${id}`, bytes, { httpMetadata: { contentType } })
    await db.prepare('INSERT INTO studio_media (id,name,content_type,size,uploaded_by,at) VALUES (?,?,?,?,?,?)').bind(id, name, contentType, bytes.byteLength, me.name, now()).run()
    const media: StudioMedia = { id, name, url: `/api/studio/media/${id}` }
    return json(media)
  }
  // A post's images copied onto a board ("Plan In Studio")
  if (path === '/api/studio/media/from-posts' && method === 'POST') {
    const b = await body()
    const ids = (Array.isArray(b.ids) ? b.ids : []).filter((x): x is string => typeof x === 'string' && ID.test(x)).slice(0, 20)
    const out: StudioMedia[] = []
    for (const sid of ids) {
      const row = await db.prepare("SELECT * FROM social_media WHERE id = ? AND kind = 'image'").bind(sid).first<Row>()
      const obj = row ? await env.FILES.get(`social/${sid}`) : null
      if (!row || !obj) continue
      const id = crypto.randomUUID()
      const bytes = await obj.arrayBuffer()
      await env.FILES.put(`studio/${id}`, bytes, { httpMetadata: { contentType: row.content_type as string } })
      await db.prepare('INSERT INTO studio_media (id,name,content_type,size,uploaded_by,at) VALUES (?,?,?,?,?,?)').bind(id, row.name as string, row.content_type as string, bytes.byteLength, me.name, now()).run()
      out.push({ id, name: row.name as string, url: `/api/studio/media/${id}` })
    }
    return json({ media: out })
  }

  m = /^\/api\/studio\/media\/([A-Za-z0-9-]{6,64})$/.exec(path)
  if (m && method === 'GET') {
    const row = await db.prepare('SELECT * FROM studio_media WHERE id = ?').bind(m[1]).first<Row>()
    const obj = row ? await env.FILES.get(`studio/${m[1]}`) : null
    if (!row || !obj) throw new StudioError(404, 'That image is no longer available.')
    const headers: Record<string, string> = {
      'content-type': row.content_type as string,
      'content-length': String(obj.size),
      'cache-control': 'private, max-age=86400',
      'x-content-type-options': 'nosniff'
    }
    // SVGs never run as pages
    if (row.content_type === 'image/svg+xml') headers['content-security-policy'] = "default-src 'none'; style-src 'unsafe-inline'; sandbox"
    return new Response(obj.body, { headers })
  }

  return null
}
