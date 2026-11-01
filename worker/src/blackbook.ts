import { MAX_UPLOAD_BYTES } from '../../src/renderer/src/data/requests'
import { VENDOR_CATEGORIES, type Vendor, type VendorContact, type VendorEvent, type VendorFile } from '../../src/renderer/src/data/blackbook'
import { cleanName, type CollabEnv } from './collab'

/** Little Black Book API: vendors, encrypted account numbers (every reveal logged), and files. */

export interface BookEnv extends CollabEnv {
  /** Optional dedicated key for account numbers; otherwise one is derived from RELEASE_KEY */
  VAULT_KEY?: string
  RELEASE_KEY?: string
}

export class BookError extends Error {
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
const CATS = new Set<string>(VENDOR_CATEGORIES)
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')
const now = () => new Date().toISOString()
const parse = <T>(v: unknown, fallback: T): T => {
  try {
    return typeof v === 'string' ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}

// ---------- account-number encryption (AES-256-GCM) ----------

async function key(env: BookEnv): Promise<CryptoKey> {
  const secret = env.VAULT_KEY || env.RELEASE_KEY
  if (!secret) throw new BookError(503, 'Account numbers can’t be saved until the server has its encryption key (run release.command once).')
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('constellation'), info: new TextEncoder().encode('little-black-book/account-numbers') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
async function seal(env: BookEnv, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(env), new TextEncoder().encode(plain)))
  const out = new Uint8Array(iv.length + ct.length)
  out.set(iv)
  out.set(ct, iv.length)
  return b64(out)
}
async function open(env: BookEnv, sealed: string): Promise<string> {
  const all = unb64(sealed)
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, await key(env), all.slice(12))
    return new TextDecoder().decode(plain)
  } catch {
    throw new BookError(500, 'Couldn’t unlock that account number (the server’s key changed). Re-enter it.')
  }
}

// ---------- rows ----------

const toFile = (r: Row): VendorFile => ({ id: r.id as string, name: r.name as string, contentType: r.content_type as string, size: r.size as number, uploadedBy: r.uploaded_by as string, at: r.at as string })
const toVendor = (r: Row, files: VendorFile[], activity: VendorEvent[]): Vendor => ({
  id: r.id as string,
  name: r.name as string,
  category: (CATS.has(r.category as string) ? r.category : 'Other') as Vendor['category'],
  website: r.website as string,
  phone: r.phone as string,
  email: r.email as string,
  address: r.address as string,
  accountLast4: r.account_last4 as string,
  hasAccount: !!r.account_enc,
  pricing: r.pricing as string,
  turnaround: r.turnaround as string,
  notes: r.notes as string,
  favorite: r.favorite === 1,
  contacts: parse<VendorContact[]>(r.contacts, []),
  files,
  activity,
  updatedAt: r.updated_at as string,
  updatedBy: r.updated_by as string
})

async function list(db: D1Database): Promise<Vendor[]> {
  const [v, f, e] = await db.batch([
    db.prepare('SELECT * FROM vendors ORDER BY name COLLATE NOCASE'),
    db.prepare('SELECT * FROM vendor_files ORDER BY at'),
    // Newest 25 events per vendor
    db.prepare('SELECT * FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY vendor_id ORDER BY at DESC) AS rn FROM vendor_events) WHERE rn <= 25 ORDER BY at DESC')
  ])
  const files = new Map<string, VendorFile[]>()
  for (const r of f.results as Row[]) files.set(r.vendor_id as string, [...(files.get(r.vendor_id as string) ?? []), toFile(r)])
  const events = new Map<string, VendorEvent[]>()
  for (const r of e.results as Row[]) events.set(r.vendor_id as string, [...(events.get(r.vendor_id as string) ?? []), { at: r.at as string, by: r.by_name as string, what: r.what as string }])
  return (v.results as Row[]).map((r) => toVendor(r, files.get(r.id as string) ?? [], events.get(r.id as string) ?? []))
}

const logStmt = (db: D1Database, vendorId: string, me: Me, what: string) =>
  db.prepare('INSERT INTO vendor_events (id,vendor_id,at,by_name,by_email,what) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(), vendorId, now(), me.name, me.email.toLowerCase(), what.slice(0, 200))

function cleanContacts(v: unknown): VendorContact[] {
  if (!Array.isArray(v)) return []
  return v.slice(0, 30).map((c) => ({
    id: ID.test(str(c?.id, 64)) ? str(c.id, 64) : crypto.randomUUID(),
    name: str(c?.name, 120).trim(),
    role: str(c?.role, 120).trim(),
    phone: str(c?.phone, 60).trim(),
    email: str(c?.email, 200).trim()
  }))
}

const FIELDS: Record<string, number> = { name: 120, website: 500, phone: 60, email: 200, address: 300, pricing: 5000, turnaround: 1000, notes: 10000 }
const LABEL: Record<string, string> = { name: 'name', website: 'website', phone: 'phone', email: 'email', address: 'address', pricing: 'pricing', turnaround: 'turnaround', notes: 'notes', category: 'category', contacts: 'contacts' }

export async function bookApi(request: Request, env: BookEnv, me: Me, path: string, changed: (what: string) => void): Promise<Response | null> {
  const db = env.DB
  const method = request.method
  const body = async () => ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
  const done = (data: unknown = { ok: true }) => {
    changed('vendors')
    return json(data)
  }

  if (path === '/api/vendors' && method === 'GET') return json({ vendors: await list(db) })

  if (path === '/api/vendors' && method === 'POST') {
    const b = await body()
    const id = crypto.randomUUID()
    const category = CATS.has(String(b.category)) ? String(b.category) : 'Other'
    const at = now()
    await db.batch([
      db.prepare('INSERT INTO vendors (id,name,category,created_at,updated_at,updated_by) VALUES (?,?,?,?,?,?)').bind(id, str(b.name, 120).trim() || 'New Vendor', category, at, at, me.name),
      logStmt(db, id, me, 'added this vendor')
    ])
    return done((await list(db)).find((v) => v.id === id))
  }

  const m = /^\/api\/vendors\/([A-Za-z0-9-]{8,64})(?:\/(account|reveal|files)(?:\/([A-Za-z0-9-]{8,64}))?)?$/.exec(path)
  if (!m) return null
  const row = await db.prepare('SELECT * FROM vendors WHERE id = ?').bind(m[1]).first<Row>()
  if (!row) throw new BookError(404, 'That vendor was removed.')
  const id = m[1]

  if (!m[2] && method === 'PATCH') {
    const b = await body()
    const sets: string[] = []
    const vals: unknown[] = []
    const changedNames: string[] = []
    for (const [k, max] of Object.entries(FIELDS)) {
      if (!(k in b)) continue
      let v = str(b[k], max).trim()
      if (k === 'name' && !v) continue
      if (k === 'website' && v && !/^https?:\/\//i.test(v)) v = `https://${v}`
      sets.push(`${k} = ?`)
      vals.push(v)
      if (v !== row[k]) changedNames.push(LABEL[k])
    }
    if ('category' in b && CATS.has(String(b.category))) (sets.push('category = ?'), vals.push(String(b.category)), b.category !== row.category && changedNames.push('category'))
    if ('favorite' in b) (sets.push('favorite = ?'), vals.push(b.favorite === true ? 1 : 0))
    if ('contacts' in b) (sets.push('contacts = ?'), vals.push(JSON.stringify(cleanContacts(b.contacts))), changedNames.push('contacts'))
    if (!sets.length) return json({ ok: true })
    const stmts = [db.prepare(`UPDATE vendors SET ${sets.join(', ')}, updated_at = ?, updated_by = ? WHERE id = ?`).bind(...vals, now(), me.name, id)]
    if (changedNames.length) stmts.push(logStmt(db, id, me, `updated ${[...new Set(changedNames)].join(', ')}`))
    await db.batch(stmts)
    return done()
  }
  if (!m[2] && method === 'DELETE') {
    const { results } = await db.prepare('SELECT id FROM vendor_files WHERE vendor_id = ?').bind(id).all<Row>()
    if (results?.length) await env.FILES.delete(results.map((f) => `vendors/${id}/${f.id}`))
    await db.batch([
      db.prepare('DELETE FROM vendor_files WHERE vendor_id = ?').bind(id),
      db.prepare('DELETE FROM vendor_events WHERE vendor_id = ?').bind(id),
      db.prepare('DELETE FROM vendors WHERE id = ?').bind(id)
    ])
    return done()
  }

  if (m[2] === 'account' && method === 'PUT') {
    const value = str((await body()).value, 120).trim()
    const sealed = value ? await seal(env, value) : ''
    await db.batch([
      db.prepare('UPDATE vendors SET account_enc = ?, account_last4 = ?, updated_at = ?, updated_by = ? WHERE id = ?').bind(sealed, value.slice(-4), now(), me.name, id),
      logStmt(db, id, me, value ? (row.account_enc ? 'changed the account number' : 'added the account number') : 'removed the account number')
    ])
    return done()
  }
  if (m[2] === 'reveal' && method === 'POST') {
    if (!row.account_enc) throw new BookError(404, 'No account number saved.')
    const why = (await body()).why === 'copy' ? 'copied' : 'viewed'
    const value = await open(env, row.account_enc as string)
    await logStmt(db, id, me, `${why} the account number`).run()
    changed('vendors')
    return json({ value })
  }

  if (m[2] === 'files' && !m[3] && method === 'POST') {
    const name = cleanName(new URL(request.url).searchParams.get('name') ?? 'file') || 'file'
    const contentType = (request.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim().toLowerCase()
    const bytes = await request.arrayBuffer()
    if (!bytes.byteLength) throw new BookError(400, 'That file is empty.')
    if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new BookError(413, `That file is over ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`)
    const fid = crypto.randomUUID()
    await env.FILES.put(`vendors/${id}/${fid}`, bytes, { httpMetadata: { contentType } })
    await db.batch([
      db.prepare('INSERT INTO vendor_files (id,vendor_id,name,content_type,size,uploaded_by,at) VALUES (?,?,?,?,?,?,?)').bind(fid, id, name, contentType, bytes.byteLength, me.name, now()),
      db.prepare('UPDATE vendors SET updated_at = ?, updated_by = ? WHERE id = ?').bind(now(), me.name, id),
      logStmt(db, id, me, `added ${name}`)
    ])
    return done()
  }
  if (m[2] === 'files' && m[3]) {
    const f = await db.prepare('SELECT * FROM vendor_files WHERE id = ? AND vendor_id = ?').bind(m[3], id).first<Row>()
    if (!f) throw new BookError(404, 'That file was removed.')
    if (method === 'GET') {
      const obj = await env.FILES.get(`vendors/${id}/${m[3]}`)
      if (!obj) throw new BookError(404, 'That file was removed.')
      return new Response(obj.body, {
        headers: {
          'content-type': f.content_type as string,
          'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.name as string)}`,
          'x-content-type-options': 'nosniff',
          'cache-control': 'private, no-store'
        }
      })
    }
    if (method === 'DELETE') {
      await env.FILES.delete(`vendors/${id}/${m[3]}`)
      await db.batch([db.prepare('DELETE FROM vendor_files WHERE id = ?').bind(m[3]), logStmt(db, id, me, `removed ${f.name}`)])
      return done()
    }
  }
  return null
}
