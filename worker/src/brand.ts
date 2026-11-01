import { MAX_UPLOAD_BYTES } from '../../src/renderer/src/data/requests'
import { BLOCK_TYPES, seedDoc, type BrandBlock, type BrandDoc, type BrandFile, type Chapter } from '../../src/renderer/src/data/brand'
import { cleanName, type CollabEnv } from './collab'

/** Brand Library API: the guidelines document, its files, and the staff page behind a private link. */

export interface BrandEnv extends CollabEnv {
  FILES: R2Bucket
  ASSETS: Fetcher
}

export class BrandError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
  }
}

type Row = Record<string, unknown>
type Me = { name: string; email: string }
const FID = /^[A-Za-z0-9-]{8,64}$/
const TOKEN = /^[A-Za-z0-9]{24,64}$/
const TYPES = new Set(BLOCK_TYPES.map((t) => t.type))
const MAX_DOC = 900_000
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
const now = () => new Date().toISOString()
const newToken = () => [...crypto.getRandomValues(new Uint8Array(24))].map((b) => 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 57]).join('')

async function loadDoc(db: D1Database): Promise<BrandDoc> {
  const row = await db.prepare('SELECT * FROM brand_doc WHERE id = 1').first<Row>()
  if (!row) return { ...seedDoc(), version: 0 }
  return { version: row.version as number, chapters: JSON.parse(row.chapters as string) as Chapter[] }
}

/** Every file the document points at */
function fileIds(chapters: Chapter[]): Set<string> {
  const ids = new Set<string>()
  const add = (f: BrandFile | null | undefined) => f && ids.add(f.id)
  for (const c of chapters)
    for (const b of c.blocks) {
      if (b.type === 'logos') b.slots.forEach((s) => s.files.forEach(add))
      if (b.type === 'examples') b.items.forEach((x) => add(x.file))
      if (b.type === 'files') b.files.forEach(add)
    }
  return ids
}

/** Light structural check: the app writes these, so this only guards against garbage. */
function checkDoc(v: unknown): Chapter[] {
  const d = v as BrandDoc
  if (!d || typeof d !== 'object' || !Array.isArray(d.chapters)) throw new BrandError(400, 'That didn’t look like the brand guidelines.')
  if (d.chapters.length > 60) throw new BrandError(400, 'Too many chapters.')
  for (const c of d.chapters) {
    if (!c || typeof c.id !== 'string' || typeof c.title !== 'string' || !Array.isArray(c.blocks)) throw new BrandError(400, 'A chapter is missing its title or content.')
    if (c.blocks.length > 120) throw new BrandError(400, `“${c.title}” has too many blocks.`)
    for (const b of c.blocks as BrandBlock[]) if (!b || typeof b.id !== 'string' || !TYPES.has(b.type)) throw new BrandError(400, `Something in “${c.title}” isn’t a kind of content the guide knows.`)
  }
  return d.chapters
}

async function serveFile(env: BrandEnv, row: Row, fid: string): Promise<Response> {
  const obj = await env.FILES.get(`brand/${fid}`)
  if (!obj) throw new BrandError(404, 'That file was removed.')
  return new Response(obj.body, {
    headers: {
      'content-type': row.content_type as string,
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(row.name as string)}`,
      'x-content-type-options': 'nosniff',
      // SVGs can carry scripts: never let a file run as a page
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'cache-control': 'private, max-age=300'
    }
  })
}

async function staffToken(db: D1Database, me: Me | null, rotate: boolean): Promise<string> {
  const row = await db.prepare('SELECT token FROM brand_link WHERE id = 1').first<Row>()
  if (row && !rotate) return row.token as string
  if (!me) throw new BrandError(404, 'Not found')
  const token = newToken()
  await db.prepare('INSERT INTO brand_link (id, token, created_at, created_by) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET token = excluded.token, created_at = excluded.created_at, created_by = excluded.created_by').bind(token, now(), me.name).run()
  return token
}

// ---------- team API: /api/brand ----------

export async function brandApi(request: Request, env: BrandEnv, me: Me, path: string, changed: (what: string) => void): Promise<Response | null> {
  const db = env.DB
  const method = request.method

  if (path === '/api/brand' && method === 'GET') return json(await loadDoc(db))

  if (path === '/api/brand' && method === 'PUT') {
    const text = await request.text()
    if (text.length > MAX_DOC) throw new BrandError(413, 'The guidelines got too big to save. Move long text into a downloadable file.')
    const body = JSON.parse(text) as BrandDoc
    const chapters = checkDoc(body)
    const cur = await db.prepare('SELECT version FROM brand_doc WHERE id = 1').first<Row>()
    const curVersion = (cur?.version as number | undefined) ?? 0
    if (body.version !== curVersion) throw new BrandError(409, 'Someone else just changed the guidelines.')
    const version = curVersion + 1
    const res = await db
      .prepare('INSERT INTO brand_doc (id, version, chapters, updated_at, updated_by) VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET version = excluded.version, chapters = excluded.chapters, updated_at = excluded.updated_at, updated_by = excluded.updated_by WHERE brand_doc.version = ?')
      .bind(version, JSON.stringify(chapters), now(), me.name, curVersion)
      .run()
    if (!res.meta.changes) throw new BrandError(409, 'Someone else just changed the guidelines.')
    // Tidy up: files nothing points at any more (uploads from the last day are left alone, they may be mid-edit)
    const used = fileIds(chapters)
    const cutoff = new Date(Date.now() - 864e5).toISOString()
    const { results } = await db.prepare('SELECT id FROM brand_files WHERE at < ?').bind(cutoff).all<Row>()
    const unused = (results ?? []).map((r) => r.id as string).filter((id) => !used.has(id))
    if (unused.length) {
      await env.FILES.delete(unused.map((id) => `brand/${id}`))
      await db.batch(unused.map((id) => db.prepare('DELETE FROM brand_files WHERE id = ?').bind(id)))
    }
    changed('brand')
    return json({ version, chapters })
  }

  if (path === '/api/brand/files' && method === 'POST') {
    const name = cleanName(new URL(request.url).searchParams.get('name') ?? 'file') || 'file'
    const contentType = (request.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim().toLowerCase()
    const bytes = await request.arrayBuffer()
    if (!bytes.byteLength) throw new BrandError(400, 'That file is empty.')
    if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new BrandError(413, `That file is over ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`)
    const f: BrandFile = { id: crypto.randomUUID(), name, contentType, size: bytes.byteLength, uploadedBy: me.name, at: now() }
    await env.FILES.put(`brand/${f.id}`, bytes, { httpMetadata: { contentType } })
    await db.prepare('INSERT INTO brand_files (id, name, content_type, size, uploaded_by, at) VALUES (?,?,?,?,?,?)').bind(f.id, f.name, f.contentType, f.size, f.uploadedBy, f.at).run()
    return json(f)
  }

  const fm = /^\/api\/brand\/files\/([A-Za-z0-9-]{8,64})$/.exec(path)
  if (fm && method === 'GET') {
    const row = await db.prepare('SELECT * FROM brand_files WHERE id = ?').bind(fm[1]).first<Row>()
    if (!row) throw new BrandError(404, 'That file was removed.')
    return serveFile(env, row, fm[1])
  }

  if (path === '/api/brand/staff-link') {
    if (method === 'GET') return json({ token: await staffToken(db, me, false) })
    if (method === 'POST') return json({ token: await staffToken(db, me, true) })
  }
  return null
}

// ---------- staff page: /track/brand/<token> (no sign-in) ----------

export async function brandLinkRoute(request: Request, env: BrandEnv, url: URL): Promise<Response | null> {
  const m = /^\/track\/brand\/([A-Za-z0-9]{16,64})(?:\/(data|files\/([A-Za-z0-9-]{8,64})))?$/.exec(url.pathname)
  if (!m) return null
  if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'Not allowed' }, 405)
  const row = await env.DB.prepare('SELECT token FROM brand_link WHERE id = 1').first<Row>()
  const ok = !!row && TOKEN.test(m[1]) && row.token === m[1]

  if (!m[2]) {
    // The page itself; it shows its own "link not working" message
    const page = await env.ASSETS.fetch(new Request(`${url.origin}/brand.html`))
    const html = (await page.text()).replaceAll('"/assets/', '"/track/assets/')
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer' } })
  }
  if (!ok) return json({ error: 'This link isn’t working any more. Ask NorthStar Creative for the current one.' }, 404)

  const doc = await loadDoc(env.DB)
  // Staff never see chapters still in progress, or who edited what
  const chapters = doc.chapters.filter((c) => !c.draft).map((c) => ({ ...c, updatedBy: '' }))

  if (m[2] === 'data') return json({ version: doc.version, chapters }, 200)

  const fid = m[3]
  if (!FID.test(fid) || !fileIds(chapters).has(fid)) return json({ error: 'That file isn’t available.' }, 404)
  const f = await env.DB.prepare('SELECT * FROM brand_files WHERE id = ?').bind(fid).first<Row>()
  if (!f) return json({ error: 'That file isn’t available.' }, 404)
  return serveFile(env, f, fid)
}
