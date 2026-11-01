import { restreamAll, type ReviewEnv } from './review'

/**
 * Moving Constellation to another Cloudflare account (migrate.command). Both servers run this code:
 * the old one hands over its files and keys, the new one pulls them straight from the old one.
 * Locked with the release key, and only open while MIGRATE_UNTIL (set when deploying for the move) is in the future.
 */

export interface MigrateEnv extends ReviewEnv {
  RELEASE_KEY?: string
  MIGRATE_UNTIL?: string
  FILES: R2Bucket
  [k: string]: unknown
}

const CARRY = ['SLACK_BOT_TOKEN', 'SLACK_SIGNING_SECRET', 'SLACK_TEAM_CHANNEL', 'TYPEFORM_SECRET', 'TYPEFORM_TOKEN', 'META_TOKEN', 'VAULT_KEY']
const TABLES = ['requests', 'request_events', 'request_files', 'request_comments', 'events', 'milestones', 'feeds', 'social_posts', 'social_accounts', 'studio_boards', 'studio_cards', 'review_reviews', 'review_versions', 'review_comments', 'review_decisions', 'review_links', 'vendors', 'vendor_files', 'brand_files']
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

export async function migrateRoute(request: Request, env: MigrateEnv, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/updates/_export/') && !url.pathname.startsWith('/updates/_import/')) return null
  const key = request.headers.get('x-release-key') ?? ''
  const open = !!env.MIGRATE_UNTIL && Date.parse(env.MIGRATE_UNTIL) > Date.now()
  if (!open || !env.RELEASE_KEY || key.length !== env.RELEASE_KEY.length || key !== env.RELEASE_KEY) return new Response('Not found', { status: 404 })
  const path = url.pathname

  // ---- old server: hand things over ----
  if (path === '/updates/_export/secrets') {
    const out: Record<string, string> = {}
    for (const k of CARRY) if (typeof env[k] === 'string' && env[k]) out[k] = env[k] as string
    return json(out)
  }
  if (path === '/updates/_export/list') {
    // App release files stay behind: the new server gets its own from release.command
    const res = await env.FILES.list({ cursor: url.searchParams.get('cursor') || undefined, limit: 1000 })
    return json({ objects: res.objects.filter((o) => !o.key.startsWith('updates/')).map((o) => ({ key: o.key, size: o.size })), cursor: res.truncated ? res.cursor : null })
  }
  if (path === '/updates/_export/object') {
    const obj = await env.FILES.get(url.searchParams.get('key') ?? '')
    if (!obj) return json({ error: 'missing' }, 404)
    return new Response(obj.body, { headers: { 'content-type': obj.httpMetadata?.contentType || 'application/octet-stream', 'content-length': String(obj.size) } })
  }
  if (path === '/updates/_export/counts') {
    const counts: Record<string, number> = {}
    for (const t of TABLES) {
      try {
        counts[t] = ((await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{ n: number }>())?.n as number) ?? 0
      } catch {
        counts[t] = -1
      }
    }
    let files = 0
    let bytes = 0
    let cursor: string | undefined
    do {
      const res = await env.FILES.list({ cursor, limit: 1000 })
      for (const o of res.objects) if (!o.key.startsWith('updates/')) (files++, (bytes += o.size))
      cursor = res.truncated ? res.cursor : undefined
    } while (cursor)
    return json({ counts, files, bytes })
  }

  // ---- new server: pull a file from the old one, or re-send videos to this account's Stream ----
  if (path === '/updates/_import/pull' && request.method === 'POST') {
    const { from, key: objectKey, size } = (await request.json()) as { from: string; key: string; size: number }
    const have = await env.FILES.head(objectKey)
    if (have && have.size === size) return json({ ok: true, skipped: true })
    const res = await fetch(`${from.replace(/\/$/, '')}/updates/_export/object?key=${encodeURIComponent(objectKey)}`, { headers: { 'x-release-key': key } })
    if (!res.ok || !res.body) return json({ error: `old server said ${res.status}` }, 502)
    const fixed = new FixedLengthStream(size)
    const pipe = res.body.pipeTo(fixed.writable)
    await env.FILES.put(objectKey, fixed.readable, { httpMetadata: { contentType: res.headers.get('content-type') || 'application/octet-stream' } })
    await pipe
    return json({ ok: true })
  }
  if (path === '/updates/_import/restream' && request.method === 'POST') return json(await restreamAll(env))

  return new Response('Not found', { status: 404 })
}
