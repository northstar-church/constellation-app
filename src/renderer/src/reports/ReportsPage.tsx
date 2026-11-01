import { format, parseISO } from 'date-fns'
import { useEffect, useMemo, useState } from 'react'
import { buildReport, delta, fmtDays, fmtNum, fmtPct, previous, rangeFor, rangeLabel, RANGES, type Range, type RangeId, type Report, type ReportData } from '../data/reports'
import { Bars, Card, Columns, Stat } from './charts'
import type { ReportStore } from './reportStore'
import './reports.css'

type Tab = 'summary' | 'requests' | 'posts' | 'reviews'
const TABS: { id: Tab; label: string }[] = [
  { id: 'summary', label: 'Summary' },
  { id: 'requests', label: 'Media Requests' },
  { id: 'posts', label: 'Posting Calendar' },
  { id: 'reviews', label: 'Video Review' }
]

function pref<T>(k: string, f: T): T {
  try {
    const v = localStorage.getItem(`constellation.reports.${k}`)
    return v ? (JSON.parse(v) as T) : f
  } catch {
    return f
  }
}
function save(k: string, v: unknown) {
  try {
    localStorage.setItem(`constellation.reports.${k}`, JSON.stringify(v))
  } catch {
    /* ignore */
  }
}

const countRows = (head: string, rows: { label: string; value: number }[]) => ({ head: [head, 'Count'], rows: rows.map((r) => [r.label, r.value]) })
const bucketRows = (r: Report['requests']['trend'], a: string, b?: string) => ({ head: ['Period', a, ...(b ? [b] : [])], rows: r.map((x) => [x.long, x.a, ...(b ? [x.b] : [])]) })

export function ReportsPage({ store }: { store: ReportStore }) {
  const [data, setData] = useState<ReportData | null>(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<Tab>(() => {
    const t = pref<Tab>('tab', 'summary')
    return TABS.some((x) => x.id === t) ? t : 'summary' // a tab that's since been removed
  })
  const [rangeId, setRangeId] = useState<RangeId>(() => pref('range', 'quarter'))
  const [custom, setCustom] = useState<Range>(() => pref('custom', rangeFor('month')))
  useEffect(() => save('tab', tab), [tab])
  useEffect(() => save('range', rangeId), [rangeId])
  useEffect(() => save('custom', custom), [custom])

  const load = () =>
    store
      .load()
      .then((d) => {
        setData(d)
        setError('')
      })
      .catch((e: Error) => setError(e.message))
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store])

  const range = rangeFor(rangeId, new Date(), custom)
  const { cur, prev } = useMemo(() => (data ? { cur: buildReport(data, range), prev: buildReport(data, previous(range)) } : { cur: null, prev: null }), [data, range.from, range.to]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="main rp-main">
      <div className="page-head rp-head">
        <h1>Reports</h1>
        <span className="rp-range-label">{rangeLabel(range)}</span>
        <span style={{ flex: 1 }} />
        <label className="pill rp-select">
          <select value={rangeId} onChange={(e) => setRangeId(e.target.value as RangeId)} aria-label="Date range">
            {RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </label>
        {rangeId === 'custom' && (
          <span className="rp-custom">
            <input type="date" value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))} aria-label="From" />
            <span>to</span>
            <input type="date" value={custom.to} min={custom.from} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))} aria-label="To" />
          </span>
        )}
        <button className="pill" onClick={() => window.print()} title="Print, or choose “Save as PDF” in the print dialog">Print / PDF</button>
      </div>
      <div className="rp-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>
      {store.mode === 'demo' && <div className="banner">Preview: 15 months of made-up history so you can see how the reports read. Once live, these come from your real requests, posts and reviews.</div>}
      {error && <div className="banner warn">{error}</div>}

      <div className="rp-scroll">
        {!cur || !prev ? (
          <div className="empty">Loading…</div>
        ) : (
          <div className="rp-body">
            <div className="rp-print-head">
              <b>NorthStar Creative · {TABS.find((t) => t.id === tab)!.label}</b>
              <span>{rangeLabel(range)} · compared with {rangeLabel(previous(range))}</span>
            </div>
            {tab === 'summary' && <Summary cur={cur} prev={prev} />}
            {tab === 'requests' && <Requests cur={cur} prev={prev} />}
            {tab === 'posts' && <Posts cur={cur} prev={prev} />}
            {tab === 'reviews' && <Reviews cur={cur} prev={prev} />}
            <p className="rp-foot">Compared with {rangeLabel(previous(range))}. Made {format(new Date(), 'MMM d, yyyy')}.</p>
          </div>
        )}
      </div>
    </main>
  )
}

type P = { cur: Report; prev: Report }

function Summary({ cur, prev }: P) {
  const q = cur.requests
  const notes: string[] = []
  if (q.byMinistry[0]) notes.push(`${q.byMinistry[0].label} sent the most requests (${q.byMinistry[0].value} of ${q.received}).`)
  if (q.byDeliverable[0]) notes.push(`${q.byDeliverable[0].label} was the most requested deliverable.`)
  const t = delta(q.turnaround, prev.requests.turnaround, false, 'days')
  if (t && t.good != null) notes.push(`Turnaround ${t.good ? 'improved' : 'slowed'} to ${fmtDays(q.turnaround)} on average (${t.text.replace(' vs previous', '')}).`)
  if (q.overdue) notes.push(`${q.overdue} open request${q.overdue === 1 ? ' is' : 's are'} past due right now.`)
  if (cur.posts.perWeek != null) notes.push(`About ${cur.posts.perWeek.toFixed(1)} social posts went out per week.`)
  if (cur.reviews.rounds != null) notes.push(`Approved videos took ${cur.reviews.rounds.toFixed(1)} versions on average.`)

  return (
    <>
      <div className="rp-stats">
        <Stat hero label="Requests delivered" value={fmtNum(q.delivered)} delta={delta(q.delivered, prev.requests.delivered, true, 'count')} />
        <Stat label="Average turnaround" value={fmtDays(q.turnaround)} delta={t} hint="From request to delivered" />
        <Stat label="Delivered on time" value={fmtPct(q.onTime)} delta={delta(q.onTime, prev.requests.onTime, true, 'pct')} hint="Of requests with a due date" />
        <Stat label="Posts published" value={fmtNum(cur.posts.posted)} delta={delta(cur.posts.posted, prev.posts.posted, true, 'count')} />
        <Stat label="Videos approved" value={fmtNum(cur.reviews.approved)} delta={delta(cur.reviews.approved, prev.reviews.approved, true, 'count')} />
      </div>
      <div className="rp-grid2">
        <Card wide title="Requests received and delivered" sub="Is the team keeping up with what comes in?" table={bucketRows(q.trend, 'Received', 'Delivered')}>
          <Columns data={q.trend} aName="Received" bName="Delivered" />
        </Card>
        <section className="rp-card rp-notes">
          <header>
            <div>
              <h3>Highlights</h3>
            </div>
          </header>
          <ul>{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </section>
        <Card title="Requests by ministry" table={countRows('Ministry', q.byMinistry)}>
          <Bars data={q.byMinistry} max={6} />
        </Card>
      </div>
    </>
  )
}

function Requests({ cur, prev }: P) {
  const q = cur.requests
  const p = prev.requests
  return (
    <>
      <div className="rp-stats">
        <Stat label="Received" value={fmtNum(q.received)} delta={delta(q.received, p.received, true, 'count')} />
        <Stat label="Delivered" value={fmtNum(q.delivered)} delta={delta(q.delivered, p.delivered, true, 'count')} />
        <Stat label="Average turnaround" value={fmtDays(q.turnaround)} delta={delta(q.turnaround, p.turnaround, false, 'days')} hint="Request to delivered" />
        <Stat label="Time to first proof" value={fmtDays(q.firstProof)} delta={delta(q.firstProof, p.firstProof, false, 'days')} />
        <Stat label="Delivered on time" value={fmtPct(q.onTime)} delta={delta(q.onTime, p.onTime, true, 'pct')} />
        <Stat label="Open right now" value={fmtNum(q.open)} hint={q.overdue ? `${q.overdue} past due` : 'None past due'} />
      </div>
      <div className="rp-grid2">
        <Card wide title="Received and delivered" table={bucketRows(q.trend, 'Received', 'Delivered')}>
          <Columns data={q.trend} aName="Received" bName="Delivered" />
        </Card>
        <Card title="By ministry" sub="Requests received" table={countRows('Ministry', q.byMinistry)}>
          <Bars data={q.byMinistry} />
        </Card>
        <Card title="By deliverable" sub="A request can ask for more than one" table={countRows('Deliverable', q.byDeliverable)}>
          <Bars data={q.byDeliverable} />
        </Card>
        <Card title="Delivered by teammate" sub="Shared requests count for each person on them" table={countRows('Teammate', q.byTeammate)}>
          <Bars data={q.byTeammate} />
        </Card>
        <Card
          title="Late and past due"
          sub="Delivered after the due date in this range, plus anything open and past due now"
          table={{ head: ['Request', 'Ministry', 'Due', 'Delivered', 'Days late'], rows: q.late.map((x) => [x.title, x.ministry, format(parseISO(x.due), 'MMM d'), x.delivered ? format(parseISO(x.delivered), 'MMM d') : 'Still open', x.daysLate]) }}
        >
          {q.late.length ? (
            <ul className="rp-list">
              {q.late.slice(0, 7).map((x, i) => (
                <li key={i}>
                  <span>
                    <b>{x.title}</b>
                    <small>{x.ministry} · due {format(parseISO(x.due), 'MMM d')}{x.delivered ? ` · delivered ${format(parseISO(x.delivered), 'MMM d')}` : ' · still open'}</small>
                  </span>
                  <span className={`rp-late ${x.delivered ? '' : 'open'}`}>{x.daysLate} day{x.daysLate === 1 ? '' : 's'} late</span>
                </li>
              ))}
              {q.late.length > 7 && <li className="rp-list-more">+{q.late.length - 7} more in the table view</li>}
            </ul>
          ) : (
            <div className="rp-empty">Everything with a due date was on time.</div>
          )}
        </Card>
      </div>
    </>
  )
}

function Posts({ cur, prev }: P) {
  const s = cur.posts
  const p = prev.posts
  return (
    <>
      <div className="rp-stats">
        <Stat label="Posts published" value={fmtNum(s.posted)} delta={delta(s.posted, p.posted, true, 'count')} />
        <Stat label="Per week" value={s.perWeek == null ? '–' : s.perWeek.toFixed(1)} delta={delta(s.perWeek, p.perWeek, true, 'count')} />
        <Stat label="Scheduled ahead" value={fmtNum(s.upcoming)} hint="Ready to go out from today" />
        <Stat label="Didn’t go out" value={fmtNum(s.missed)} hint="Scheduled in this range but never marked posted" />
      </div>
      <div className="rp-grid2">
        <Card wide title="Posts published" table={bucketRows(s.trend, 'Posts')}>
          <Columns data={s.trend} aName="Posts" />
        </Card>
        <Card title="By account" table={countRows('Account', s.byAccount)}>
          <Bars data={s.byAccount} />
        </Card>
        <Card title="By platform" table={countRows('Platform', s.byPlatform)}>
          <Bars data={s.byPlatform} />
        </Card>
        <Card title="Top campaigns" table={countRows('Campaign', s.campaigns)}>
          <Bars data={s.campaigns} empty="No posts were tagged with a campaign." />
        </Card>
        <section className="rp-card rp-notes">
          <header>
            <div>
              <h3>Reach and engagement</h3>
            </div>
          </header>
          <p className="rp-muted">Likes, reach and saves per post show up here once Constellation is connected to Meta.</p>
        </section>
      </div>
    </>
  )
}

function Reviews({ cur, prev }: P) {
  const v = cur.reviews
  const p = prev.reviews
  return (
    <>
      <div className="rp-stats">
        <Stat label="Videos approved" value={fmtNum(v.approved)} delta={delta(v.approved, p.approved, true, 'count')} />
        <Stat label="Versions per video" value={v.rounds == null ? '–' : v.rounds.toFixed(1)} delta={delta(v.rounds, p.rounds, false, 'count')} hint="Fewer means fewer rounds of changes" />
        <Stat label="First cut to approval" value={fmtDays(v.daysToApprove)} delta={delta(v.daysToApprove, p.daysToApprove, false, 'days')} />
        <Stat label="In review now" value={fmtNum(v.open)} hint={`${v.started} started in this range`} />
      </div>
      <div className="rp-grid2">
        <Card wide title="Videos approved" table={bucketRows(v.trend, 'Approved')}>
          <Columns data={v.trend} aName="Approved" />
        </Card>
        <Card title="Versions before approval" sub="How many cuts each approved video took" table={countRows('Versions', v.roundsSpread)}>
          <Bars data={v.roundsSpread} />
        </Card>
      </div>
    </>
  )
}

