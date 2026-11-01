// Reports: the raw facts the server sends (ReportData), and the numbers worked out from them for a date range.
import { addDays, addMonths, differenceInCalendarDays, endOfMonth, format, parseISO, startOfMonth, startOfQuarter, startOfWeek, startOfYear, subDays, subQuarters, endOfQuarter } from 'date-fns'

export interface RRequest {
  id: string
  title: string
  ministry: string
  deliverables: string[]
  assignees: string[]
  createdAt: string
  dueDate: string | null
  firstProofAt: string | null
  deliveredAt: string | null
  stage: string
}
export interface RPost {
  id: string
  platform: string
  account: string
  date: string
  status: string
  campaign: string
}
export interface RReview {
  id: string
  title: string
  createdAt: string
  firstVersionAt: string | null
  versions: number
  changes: number
  approvedAt: string | null
  status: string
}
export interface REvent {
  id: string
  title: string
  ministry: string
  category: string
  startDate: string
  milestones: { dueDate: string; done: boolean }[]
}
export interface ReportData {
  requests: RRequest[]
  posts: RPost[]
  reviews: RReview[]
  events: REvent[]
  /** Instagram account handles by id, for labels */
  accounts: Record<string, string>
}

// ---------- ranges ----------

export type RangeId = 'month' | 'last30' | 'quarter' | 'lastQuarter' | 'ytd' | 'last12' | 'custom'
export interface Range {
  from: string
  to: string
}
export const RANGES: { id: RangeId; label: string }[] = [
  { id: 'month', label: 'This Month' },
  { id: 'last30', label: 'Last 30 Days' },
  { id: 'quarter', label: 'This Quarter' },
  { id: 'lastQuarter', label: 'Last Quarter' },
  { id: 'ytd', label: 'Year To Date' },
  { id: 'last12', label: 'Last 12 Months' },
  { id: 'custom', label: 'Custom' }
]
const ymd = (d: Date) => format(d, 'yyyy-MM-dd')
export function rangeFor(id: RangeId, today = new Date(), custom?: Range): Range {
  switch (id) {
    case 'month':
      return { from: ymd(startOfMonth(today)), to: ymd(today) }
    case 'last30':
      return { from: ymd(subDays(today, 29)), to: ymd(today) }
    case 'quarter':
      return { from: ymd(startOfQuarter(today)), to: ymd(today) }
    case 'lastQuarter': {
      const q = subQuarters(today, 1)
      return { from: ymd(startOfQuarter(q)), to: ymd(endOfQuarter(q)) }
    }
    case 'ytd':
      return { from: ymd(startOfYear(today)), to: ymd(today) }
    case 'last12':
      return { from: ymd(addDays(addMonths(today, -12), 1)), to: ymd(today) }
    case 'custom':
      return custom ?? { from: ymd(startOfMonth(today)), to: ymd(today) }
  }
}
/** The same length of time just before */
export function previous(r: Range): Range {
  const len = differenceInCalendarDays(parseISO(r.to), parseISO(r.from)) + 1
  return { from: ymd(subDays(parseISO(r.from), len)), to: ymd(subDays(parseISO(r.from), 1)) }
}
export const rangeLabel = (r: Range) => {
  const a = parseISO(r.from)
  const b = parseISO(r.to)
  return a.getFullYear() === b.getFullYear() ? `${format(a, 'MMM d')} – ${format(b, 'MMM d, yyyy')}` : `${format(a, 'MMM d, yyyy')} – ${format(b, 'MMM d, yyyy')}`
}

// ---------- the numbers ----------

const day = (iso: string) => iso.slice(0, 10)
const inR = (iso: string | null | undefined, r: Range) => !!iso && day(iso) >= r.from && day(iso) <= r.to
const days = (a: string, b: string) => Math.max(0, (Date.parse(b) - Date.parse(a)) / 864e5)
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)
const pct = (n: number, d: number) => (d ? n / d : null)
export type Count = { label: string; value: number }
function tally(items: string[]): Count[] {
  const m = new Map<string, number>()
  for (const i of items) if (i) m.set(i, (m.get(i) ?? 0) + 1)
  return [...m].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
}

export interface Bucket {
  label: string
  /** Full label for tooltips and tables */
  long: string
  a: number
  b: number
}
/** Months for long ranges, weeks for short ones */
function buckets(r: Range): { label: string; long: string; from: string; to: string }[] {
  const from = parseISO(r.from)
  const to = parseISO(r.to)
  const out: { label: string; long: string; from: string; to: string }[] = []
  if (differenceInCalendarDays(to, from) > 92) {
    for (let m = startOfMonth(from); m <= to; m = addMonths(m, 1))
      out.push({ label: format(m, 'MMM'), long: format(m, 'MMMM yyyy'), from: ymd(m < from ? from : m), to: ymd(endOfMonth(m) > to ? to : endOfMonth(m)) })
  } else {
    for (let w = startOfWeek(from); w <= to; w = addDays(w, 7))
      out.push({ label: format(w < from ? from : w, 'MMM d'), long: `Week of ${format(w < from ? from : w, 'MMM d')}`, from: ymd(w < from ? from : w), to: ymd(addDays(w, 6) > to ? to : addDays(w, 6)) })
  }
  return out
}
const per = (bs: ReturnType<typeof buckets>, a: (r: Range) => number, b: (r: Range) => number = () => 0): Bucket[] => bs.map((x) => ({ label: x.label, long: x.long, a: a(x), b: b(x) }))

export interface RequestReport {
  received: number
  delivered: number
  turnaround: number | null
  firstProof: number | null
  onTime: number | null
  open: number
  overdue: number
  trend: Bucket[]
  byMinistry: Count[]
  byDeliverable: Count[]
  byTeammate: Count[]
  late: { title: string; ministry: string; due: string; delivered: string | null; daysLate: number }[]
}
export interface PostReport {
  posted: number
  perWeek: number | null
  upcoming: number
  missed: number
  trend: Bucket[]
  byAccount: Count[]
  byPlatform: Count[]
  campaigns: Count[]
}
export interface ReviewReport {
  approved: number
  rounds: number | null
  daysToApprove: number | null
  open: number
  started: number
  roundsSpread: Count[]
  trend: Bucket[]
}
export interface EventReport {
  events: number
  milestonesDue: number
  milestonesDone: number | null
  overdueMilestones: number
  next30: number
  byMinistry: Count[]
  trend: Bucket[]
}
export interface Report {
  range: Range
  requests: RequestReport
  posts: PostReport
  reviews: ReviewReport
  events: EventReport
}

const PLATFORM_NAMES: Record<string, string> = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', youtube: 'YouTube' }

export function buildReport(d: ReportData, r: Range, today = ymd(new Date())): Report {
  const bs = buckets(r)

  // Media Requests
  const delivered = d.requests.filter((x) => inR(x.deliveredAt, r))
  const withDue = delivered.filter((x) => x.dueDate)
  const lateDone = withDue.filter((x) => day(x.deliveredAt!) > x.dueDate!)
  const open = d.requests.filter((x) => !x.deliveredAt)
  const overdueNow = open.filter((x) => x.dueDate && x.dueDate < today)
  const requests: RequestReport = {
    received: d.requests.filter((x) => inR(x.createdAt, r)).length,
    delivered: delivered.length,
    turnaround: mean(delivered.map((x) => days(x.createdAt, x.deliveredAt!))),
    firstProof: mean(d.requests.filter((x) => inR(x.firstProofAt, r)).map((x) => days(x.createdAt, x.firstProofAt!))),
    onTime: pct(withDue.length - lateDone.length, withDue.length),
    open: open.length,
    overdue: overdueNow.length,
    trend: per(
      bs,
      (b) => d.requests.filter((x) => inR(x.createdAt, b)).length,
      (b) => d.requests.filter((x) => inR(x.deliveredAt, b)).length
    ),
    byMinistry: tally(d.requests.filter((x) => inR(x.createdAt, r)).map((x) => x.ministry || 'No ministry')),
    byDeliverable: tally(d.requests.filter((x) => inR(x.createdAt, r)).flatMap((x) => x.deliverables)),
    byTeammate: tally(delivered.flatMap((x) => x.assignees)),
    late: [
      ...lateDone.map((x) => ({ title: x.title, ministry: x.ministry, due: x.dueDate!, delivered: day(x.deliveredAt!), daysLate: differenceInCalendarDays(parseISO(day(x.deliveredAt!)), parseISO(x.dueDate!)) })),
      ...overdueNow.map((x) => ({ title: x.title, ministry: x.ministry, due: x.dueDate!, delivered: null, daysLate: differenceInCalendarDays(parseISO(today), parseISO(x.dueDate!)) }))
    ].sort((a, b) => b.daysLate - a.daysLate)
  }

  // Posting Calendar
  const posted = d.posts.filter((x) => x.status === 'posted' && inR(x.date, r))
  const weeks = (differenceInCalendarDays(parseISO(r.to), parseISO(r.from)) + 1) / 7
  const accountName = (p: RPost) => (p.account && d.accounts[p.account] ? `@${d.accounts[p.account]}` : PLATFORM_NAMES[p.platform] ?? p.platform)
  const posts: PostReport = {
    posted: posted.length,
    perWeek: weeks >= 1 ? posted.length / weeks : null,
    upcoming: d.posts.filter((x) => x.status === 'scheduled' && x.date >= today).length,
    missed: d.posts.filter((x) => inR(x.date, r) && x.date < today && (x.status === 'scheduled' || x.status === 'review')).length,
    trend: per(bs, (b) => d.posts.filter((x) => x.status === 'posted' && inR(x.date, b)).length),
    byAccount: tally(posted.map(accountName)),
    byPlatform: tally(posted.map((p) => PLATFORM_NAMES[p.platform] ?? p.platform)),
    campaigns: tally(posted.map((p) => p.campaign)).slice(0, 6)
  }

  // Video Review
  const approved = d.reviews.filter((x) => inR(x.approvedAt, r))
  const reviews: ReviewReport = {
    approved: approved.length,
    rounds: mean(approved.map((x) => Math.max(1, x.versions))),
    daysToApprove: mean(approved.filter((x) => x.firstVersionAt).map((x) => days(x.firstVersionAt!, x.approvedAt!))),
    open: d.reviews.filter((x) => x.status !== 'approved').length,
    started: d.reviews.filter((x) => inR(x.createdAt, r)).length,
    roundsSpread: ['1', '2', '3', '4+'].map((label) => ({
      label: label === '1' ? '1 version' : `${label} versions`,
      value: approved.filter((x) => (label === '4+' ? x.versions >= 4 : Math.max(1, x.versions) === Number(label))).length
    })),
    trend: per(bs, (b) => d.reviews.filter((x) => inR(x.approvedAt, b)).length)
  }

  // Event Calendar
  const evs = d.events.filter((x) => inR(x.startDate, r))
  const msDue = d.events.flatMap((e) => e.milestones).filter((m) => inR(m.dueDate, r) && m.dueDate <= today)
  const events: EventReport = {
    events: evs.length,
    milestonesDue: msDue.length,
    milestonesDone: pct(msDue.filter((m) => m.done).length, msDue.length),
    overdueMilestones: d.events.flatMap((e) => e.milestones).filter((m) => !m.done && m.dueDate < today).length,
    next30: d.events.filter((x) => x.startDate >= today && x.startDate <= ymd(addDays(parseISO(today), 30))).length,
    byMinistry: tally(evs.map((x) => x.ministry || 'All church')),
    trend: per(bs, (b) => d.events.filter((x) => inR(x.startDate, b)).length)
  }

  return { range: r, requests, posts, reviews, events }
}

// ---------- formatting ----------

export const fmtDays = (n: number | null) => (n == null ? '–' : n < 10 ? `${n.toFixed(1)} days` : `${Math.round(n)} days`)
export const fmtPct = (n: number | null) => (n == null ? '–' : `${Math.round(n * 100)}%`)
export const fmtNum = (n: number | null) => (n == null ? '–' : n >= 10000 ? `${(n / 1000).toFixed(1)}K` : n % 1 ? n.toFixed(1) : n.toLocaleString())

/** Change vs the previous period, and whether that's good news */
export function delta(cur: number | null, prev: number | null, upIsGood: boolean, kind: 'count' | 'days' | 'pct'): { text: string; good: boolean | null } | null {
  if (cur == null || prev == null) return null
  const diff = cur - prev
  if (Math.abs(diff) < (kind === 'pct' ? 0.005 : kind === 'days' ? 0.05 : 0.5)) return { text: 'Same as previous', good: null }
  const sign = diff > 0 ? '+' : '−'
  const v = Math.abs(diff)
  const text = kind === 'pct' ? `${sign}${Math.round(v * 100)} pts` : kind === 'days' ? `${sign}${v.toFixed(1)} days` : `${sign}${Math.round(v)}`
  return { text: `${text} vs previous`, good: diff > 0 === upIsGood }
}
