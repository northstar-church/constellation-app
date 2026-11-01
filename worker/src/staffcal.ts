// Event Calendar for all staff: a read-only page behind a private link (/track/calendar/<token>), no sign-in.
// Staff see only each event's title, ministry, date, time and place. No notes, owners or milestones.
import type { TeamEvent } from '../../src/renderer/src/data/types'
import { buildIcs } from './ics'

type Row = Record<string, unknown>
const TOKEN = /^[A-Za-z0-9]{24,64}$/
const newToken = () => [...crypto.getRandomValues(new Uint8Array(24))].map((b) => 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 57]).join('')
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } })

/** The link's token, made the first time someone asks for it; rotate = replace it (old link stops working) */
export async function staffCalendarToken(db: D1Database, by: string, rotate: boolean): Promise<string> {
  const row = await db.prepare('SELECT token FROM calendar_link WHERE id = 1').first<{ token: string }>()
  if (row && !rotate) return row.token
  const token = newToken()
  await db
    .prepare('INSERT INTO calendar_link (id, token, created_at, created_by) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET token = excluded.token, created_at = excluded.created_at, created_by = excluded.created_by')
    .bind(token, new Date().toISOString(), by)
    .run()
  return token
}

/** What staff may see of an event */
const forStaff = (r: Row) => ({
  id: r.id as string,
  title: r.title as string,
  category: r.category as string,
  ministry: (r.ministry as string) || 'All church',
  startDate: r.start_date as string,
  endDate: (r.end_date as string) ?? null,
  startTime: (r.start_time as string) ?? null,
  endTime: (r.end_time as string) ?? null,
  location: (r.location as string) ?? ''
})

export async function staffCalendarRoute(request: Request, env: { DB: D1Database; ASSETS: Fetcher }, url: URL): Promise<Response | null> {
  const m = /^\/track\/calendar\/([A-Za-z0-9]{16,64})(?:\/(data|calendar\.ics))?$/.exec(url.pathname)
  if (!m) return null
  if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'Not allowed' }, 405)

  if (!m[2]) {
    // The page itself; it shows its own "link not working" message
    const page = await env.ASSETS.fetch(new Request(`${url.origin}/staff.html`))
    const html = (await page.text()).replaceAll('"/assets/', '"/track/assets/')
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer' } })
  }

  const row = await env.DB.prepare('SELECT token FROM calendar_link WHERE id = 1').first<{ token: string }>()
  if (!row || !TOKEN.test(m[1]) || row.token !== m[1]) {
    if (m[2] === 'calendar.ics') return new Response('This calendar link isn’t working any more. Ask NorthStar Creative for the current one.', { status: 404 })
    return json({ error: 'This link isn’t working any more. Ask NorthStar Creative for the current one.' }, 404)
  }

  // The last two months and everything ahead
  const from = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10)
  const { results } = await env.DB.prepare('SELECT id, title, category, ministry, start_date, end_date, start_time, end_time, location FROM events WHERE coalesce(end_date, start_date) >= ? ORDER BY start_date, start_time').bind(from).all<Row>()
  const events = (results ?? []).map(forStaff)

  if (m[2] === 'data') return json({ events })

  const forIcs = events.map((e) => ({ ...e, owner: '', notes: '', templateId: null, updatedAt: '', updatedBy: '' }) as unknown as TeamEvent)
  return new Response(buildIcs('NorthStar Event Calendar', forIcs, [], url.hostname), {
    headers: { 'content-type': 'text/calendar; charset=utf-8', 'content-disposition': 'inline; filename="NorthStar Event Calendar.ics"', 'cache-control': 'private, max-age=300' }
  })
}
