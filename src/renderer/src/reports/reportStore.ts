import { addDays, format } from 'date-fns'
import { call } from '../data/cloudStore'
import { DELIVERABLES, REQUEST_MINISTRIES } from '../data/requests'
import type { ReportData, REvent, RPost, RRequest, RReview } from '../data/reports'

export interface ReportStore {
  mode: 'demo' | 'cloud'
  load(): Promise<ReportData>
}

export const createCloudReportStore = (): ReportStore => ({ mode: 'cloud', load: () => call<ReportData>('/api/reports') })

/** Preview: 15 months of made-up history, the same every time */
export function createDemoReportStore(): ReportStore {
  let cache: ReportData | null = null
  return { mode: 'demo', load: async () => (cache ??= demoData()) }
}

function demoData(): ReportData {
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
  const pick = <T,>(xs: T[], w?: number[]) => {
    if (!w) return xs[Math.floor(rnd() * xs.length)]
    const t = w.reduce((s, x) => s + x, 0)
    let r = rnd() * t
    for (let i = 0; i < xs.length; i++) if ((r -= w[i]) <= 0) return xs[i]
    return xs[xs.length - 1]
  }
  const today = new Date()
  today.setHours(12, 0, 0, 0)
  const iso = (d: Date) => d.toISOString()
  const ymd = (d: Date) => format(d, 'yyyy-MM-dd')
  const start = addDays(today, -460)
  const team = ['Jeremy Thompson', 'Sarah Vanderheyden', 'C.A. Phillips', 'Kendrick Banks']
  const minW = REQUEST_MINISTRIES.map((m) => ({ Kids: 9, HSM: 7, '678': 6, 'Sunday AM': 8, Community: 5, Missions: 4, 'Small Groups': 5, Connections: 4, 'Executive Team': 3 })[m] ?? 1.5)
  const titles = ['Fall Fest promo', 'Baptism Sunday slides', 'Volunteer recruitment graphic', 'Series bumper', 'Camp registration push', 'Bulletin insert', 'Lobby banner', 'Testimony video', 'Instagram carousel', 'Event signage', 'Mission trip recap video', 'Small group launch kit']

  const requests: RRequest[] = []
  const reviews: RReview[] = []
  for (let d = start; d <= today; d = addDays(d, 1)) {
    const busy = [8, 10, 11].includes(d.getMonth()) ? 1.5 : [5, 6].includes(d.getMonth()) ? 0.7 : 1
    let n = rnd() < 0.85 * busy ? 1 : 0
    if (rnd() < 0.18 * busy) n++
    for (let i = 0; i < n; i++) {
      const created = new Date(d)
      created.setHours(8 + Math.floor(rnd() * 9))
      const due = addDays(created, 7 + Math.floor(rnd() * 21))
      // Turnaround slowly improves over the year
      const age = (today.getTime() - created.getTime()) / 864e5
      const work = Math.max(2, Math.round((age > 200 ? 13 : 10) * (0.45 + rnd())))
      const deliveredAt = addDays(created, work)
      const done = deliveredAt <= today && !(age < 25 && rnd() < 0.5)
      const proof = addDays(created, Math.max(1, Math.round(work * 0.6)))
      const deliverables = [pick(DELIVERABLES.map((x) => x.label), [10, 6, 2, 4, 3, 7, 1, 2, 1])]
      if (rnd() < 0.35) deliverables.push(pick(['Social', 'Print', 'Graphic', 'Video']))
      const assignees = [pick(team, [3, 3, 2, 3])]
      if (rnd() < 0.2) assignees.push(pick(team))
      requests.push({
        id: `r${requests.length}`,
        title: pick(titles),
        ministry: pick(REQUEST_MINISTRIES, minW),
        deliverables: [...new Set(deliverables)],
        assignees: [...new Set(assignees)],
        createdAt: iso(created),
        dueDate: rnd() < 0.9 ? ymd(due) : null,
        firstProofAt: proof <= today ? iso(proof) : null,
        deliveredAt: done ? iso(deliveredAt) : null,
        stage: done ? 'delivered' : pick(['received', 'scheduled', 'design', 'proof'])
      })
      if (deliverables.includes('Video') && rnd() < 0.8) {
        const v = 1 + Math.floor(rnd() * rnd() * 4.5)
        const first = addDays(created, 3)
        const appr = addDays(first, v * 2 + Math.floor(rnd() * 4))
        const ok = appr <= today
        reviews.push({ id: `v${reviews.length}`, title: requests[requests.length - 1].title, createdAt: iso(first), firstVersionAt: iso(first), versions: v, changes: v - 1, approvedAt: ok ? iso(appr) : null, status: ok ? 'approved' : pick(['in-progress', 'needs-review', 'changes']) })
      }
    }
  }

  const posts: RPost[] = []
  const campaigns = ['Christmas at NorthStar', 'Better Together', 'Easter', 'Summer Camp', 'Serve Kennesaw', 'Fall Fest', '']
  for (let d = start; d <= addDays(today, 30); d = addDays(d, 1)) {
    const n = rnd() < 0.62 ? 1 : 0
    for (let i = 0; i < n + (rnd() < 0.15 ? 1 : 0); i++) {
      const platform = pick(['instagram', 'facebook', 'tiktok', 'youtube'], [6, 3, 1.2, 0.8])
      const future = d > today
      posts.push({
        id: `p${posts.length}`,
        platform,
        account: platform === 'instagram' ? pick(['ig-nsckennesaw', 'ig-nsc-students'], [5, 3]) : '',
        date: ymd(d),
        status: future ? pick(['scheduled', 'draft', 'review']) : rnd() < 0.96 ? 'posted' : 'scheduled',
        campaign: pick(campaigns, [2, 1, 1, 1, 1, 1, 6])
      })
    }
  }

  const events: REvent[] = []
  for (let d = start; d <= addDays(today, 90); d = addDays(d, 1)) {
    if (rnd() < 0.3) {
      const ms = Array.from({ length: Math.floor(rnd() * 5) }, (_, i) => {
        const due = addDays(d, -7 * (i + 1))
        return { dueDate: ymd(due), done: due < today ? rnd() < 0.88 : rnd() < 0.2 }
      })
      events.push({ id: `e${events.length}`, title: pick(titles), ministry: pick(['All church', ...REQUEST_MINISTRIES], [6, ...minW]), category: rnd() < 0.1 ? 'series' : 'ministry', startDate: ymd(d), milestones: ms })
    }
  }

  return { requests, posts, reviews, events, accounts: { 'ig-nsckennesaw': 'nsckennesaw', 'ig-nsc-students': 'nsc.students' } }
}
