import { normalizeAssignees } from '../../src/renderer/src/data/requests'
import type { ReportData, REvent, RPost, RRequest, RReview } from '../../src/renderer/src/data/reports'

/** Reports: the facts the app needs to work out every report. The app does the math for whatever range is picked. */

type Row = Record<string, unknown>
const list = <T,>(v: unknown): T[] => {
  try {
    const x = typeof v === 'string' ? JSON.parse(v) : v
    return Array.isArray(x) ? (x as T[]) : []
  } catch {
    return []
  }
}

export async function reportData(db: D1Database): Promise<ReportData> {
  const [req, posts, revs, events, ms, accts] = await db.batch([
    db.prepare(
      `SELECT r.id, r.title, r.ministry, r.deliverables, r.assignees, r.assignee, r.created_at, r.updated_at, r.due_date, r.stage,
         (SELECT MIN(e.at) FROM request_events e WHERE e.request_id = r.id AND (e.kind = 'proof' OR (e.kind = 'stage' AND e.stage = 'proof'))) AS first_proof,
         (SELECT MAX(e.at) FROM request_events e WHERE e.request_id = r.id AND e.kind = 'stage' AND e.stage = 'delivered') AS delivered
       FROM requests r`
    ),
    db.prepare('SELECT id, platform, account, date, status, campaign FROM social_posts'),
    db.prepare(
      `SELECT v.id, v.title, v.status, v.created_at, v.updated_at,
         (SELECT COUNT(*) FROM review_versions x WHERE x.review_id = v.id) AS versions,
         (SELECT MIN(x.at) FROM review_versions x WHERE x.review_id = v.id) AS first_version,
         (SELECT COUNT(*) FROM review_decisions d WHERE d.review_id = v.id AND d.decision = 'changes') AS changes,
         (SELECT MAX(d.at) FROM review_decisions d WHERE d.review_id = v.id AND d.decision = 'approved') AS approved
       FROM review_reviews v`
    ),
    db.prepare('SELECT id, title, ministry, category, start_date FROM events WHERE espace IS NULL'), // eSpace events have no promo timelines to report on
    db.prepare('SELECT event_id, due_date, done FROM milestones'),
    db.prepare('SELECT id, handle FROM social_accounts')
  ])

  const requests: RRequest[] = (req.results as Row[]).map((r) => {
    const delivered = r.stage === 'delivered'
    return {
      id: r.id as string,
      title: r.title as string,
      ministry: (r.ministry as string) || '',
      deliverables: list<string>(r.deliverables).filter((x) => typeof x === 'string'),
      assignees: normalizeAssignees(list(r.assignees), (r.assignee as string) ?? '').map((a) => a.name),
      createdAt: r.created_at as string,
      dueDate: (r.due_date as string | null) || null,
      firstProofAt: (r.first_proof as string | null) ?? null,
      // Only requests that are delivered now count; older ones moved before stage history existed use their last update
      deliveredAt: delivered ? ((r.delivered as string | null) ?? (r.updated_at as string)) : null,
      stage: r.stage as string
    }
  })

  const rposts: RPost[] = (posts.results as Row[]).map((p) => ({ id: p.id as string, platform: p.platform as string, account: (p.account as string) || '', date: (p.date as string) || '', status: p.status as string, campaign: (p.campaign as string) || '' }))

  const reviews: RReview[] = (revs.results as Row[]).map((v) => ({
    id: v.id as string,
    title: v.title as string,
    createdAt: v.created_at as string,
    firstVersionAt: (v.first_version as string | null) ?? null,
    versions: Number(v.versions) || 0,
    changes: Number(v.changes) || 0,
    approvedAt: v.status === 'approved' ? ((v.approved as string | null) ?? (v.updated_at as string)) : null,
    status: v.status as string
  }))

  const byEvent = new Map<string, REvent['milestones']>()
  for (const m of ms.results as Row[]) byEvent.set(m.event_id as string, [...(byEvent.get(m.event_id as string) ?? []), { dueDate: m.due_date as string, done: !!m.done }])
  const revents: REvent[] = (events.results as Row[]).map((e) => ({ id: e.id as string, title: e.title as string, ministry: (e.ministry as string) || 'All church', category: e.category as string, startDate: e.start_date as string, milestones: byEvent.get(e.id as string) ?? [] }))

  const accounts: Record<string, string> = {}
  for (const a of accts.results as Row[]) if (a.handle) accounts[a.id as string] = a.handle as string

  return { requests, posts: rposts, reviews, events: revents, accounts }
}
