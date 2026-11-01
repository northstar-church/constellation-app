// The staff calendar page: a read-only Event Calendar for everyone at NorthStar, behind a private link.
// Shows only each event's title, ministry, time and location. Events are scheduled in eSpace.
import { addDays, addMonths, endOfMonth, endOfWeek, format, isSameMonth, parseISO, startOfMonth, startOfWeek } from 'date-fns'
import { useEffect, useMemo, useState } from 'react'
import { categoryById, eventSwatch } from '../data/constants'
import type { CategoryId } from '../data/types'
import { tint, tintBg } from '../data/tint'
import { occursOn, timeLabel, todayStr, ymd } from '../calendar/util'
import './staff.css'

export interface StaffEvent {
  id: string
  title: string
  category: CategoryId
  ministry: string
  startDate: string
  endDate: string | null
  startTime: string | null
  endTime: string | null
  location: string
}

export interface StaffSource {
  load(): Promise<{ events: StaffEvent[] }>
  /** Subscribe link for Outlook / Google / iPhone */
  icsUrl: string
}

type View = 'month' | 'list'

const whenText = (e: StaffEvent) => {
  const s = parseISO(e.startDate)
  let out = format(s, 'EEEE, MMMM d')
  if (e.endDate && e.endDate !== e.startDate) out = `${format(s, 'EEE, MMM d')} – ${format(parseISO(e.endDate), 'EEE, MMM d')}`
  return out
}
/** Ministry Events go by their ministry; Sermon Series, Staff Use / Meeting and MISC by their category */
const keyOf = (e: StaffEvent) => (e.category === 'ministry' ? e.ministry : categoryById(e.category).label)
const swatch = (e: StaffEvent) => eventSwatch(e)
const tm = (t: string) => `${timeLabel(t)}m`
const timeText = (e: StaffEvent) => (e.startTime ? `${tm(e.startTime)}${e.endTime ? ` – ${tm(e.endTime)}` : ''}` : 'All day')

export function StaffCalendar({ source }: { source: StaffSource }) {
  const [events, setEvents] = useState<StaffEvent[] | null>(null)
  const [error, setError] = useState('')
  const [view, setView] = useState<View>(() => (window.matchMedia?.('(max-width: 720px)').matches ? 'list' : 'month'))
  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const [only, setOnly] = useState<string[]>([])
  const [open, setOpen] = useState<StaffEvent | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const load = () =>
      source
        .load()
        .then((d) => {
          setEvents(d.events)
          setError('')
        })
        .catch((e: Error) => setError(e.message))
    load()
    const id = setInterval(load, 5 * 60_000)
    return () => clearInterval(id)
  }, [source])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const shown = useMemo(() => (events ?? []).filter((e) => !only.length || only.includes(keyOf(e))), [events, only])
  const used = useMemo(() => {
    const keys = new Map<string, ReturnType<typeof swatch>>()
    for (const e of events ?? []) if (!keys.has(keyOf(e))) keys.set(keyOf(e), swatch(e))
    return [...keys].sort((a, b) => a[0].localeCompare(b[0]))
  }, [events])
  const toggle = (m: string) => setOnly((l) => (l.includes(m) ? l.filter((x) => x !== m) : [...l, m]))

  const copyIcs = async () => {
    try {
      await navigator.clipboard.writeText(source.icsUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt('Copy this link:', source.icsUrl)
    }
  }

  return (
    <div className="sc">
      <header className="sc-head">
        <div className="sc-title">
          <span className="sc-kicker">NorthStar Church</span>
          <h1>Event Calendar</h1>
        </div>
        <div className="sc-actions">
          <button className="sc-btn" onClick={copyIcs} title="Add this calendar to Outlook, Google Calendar or your phone">
            {copied ? 'Link copied ✓' : 'Subscribe'}
          </button>
        </div>
      </header>

      <div className="sc-bar">
        {view === 'month' ? (
          <div className="sc-nav">
            <button onClick={() => setMonth((m) => addMonths(m, -1))} aria-label="Previous month">‹</button>
            <button className="label" onClick={() => setMonth(startOfMonth(new Date()))} title="Back to this month">{format(month, 'MMMM yyyy')}</button>
            <button onClick={() => setMonth((m) => addMonths(m, 1))} aria-label="Next month">›</button>
          </div>
        ) : (
          <div className="sc-nav"><span className="label static">Upcoming</span></div>
        )}
        <div className="sc-seg" role="tablist" aria-label="View">
          <button className={view === 'month' ? 'on' : ''} onClick={() => setView('month')} role="tab" aria-selected={view === 'month'}>Month</button>
          <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')} role="tab" aria-selected={view === 'list'}>List</button>
        </div>
      </div>

      {used.length > 0 && (
        <div className="sc-legend" aria-label="Filter by ministry">
          {used.map(([m, c]) => {
            const on = !only.length || only.includes(m)
            return (
              <button key={m} className={`sc-key ${on ? '' : 'off'}`} onClick={() => toggle(m)} aria-pressed={only.includes(m)} title={only.includes(m) ? `Stop filtering to ${m}` : `Show only ${m}`}>
                <span className="dot" style={{ background: c.color }} /> {m}
              </button>
            )
          })}
          {only.length > 0 && <button className="sc-key clear" onClick={() => setOnly([])}>Show all</button>}
        </div>
      )}

      {error && <div className="sc-error">{error}</div>}
      {!events && !error && <div className="sc-empty">Loading…</div>}
      {events && (view === 'month' ? <Month month={month} events={shown} onOpen={setOpen} /> : <List events={shown} onOpen={setOpen} />)}

      <footer className="sc-foot">Questions about an event? Contact the ministry hosting it. Events are scheduled in eSpace.</footer>

      {open && <Details e={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

function Chip({ e, day, onOpen }: { e: StaffEvent; day: string; onOpen: (e: StaffEvent) => void }) {
  const c = swatch(e)
  const continues = e.startDate !== day
  if (continues && parseISO(day).getDay() !== 0)
    return <button className="sc-band" style={{ background: tintBg(c.soft, c.ink) }} title={e.title} aria-label={`${e.title} (continues)`} onClick={() => onOpen(e)} />
  return (
    <button className="sc-chip" style={tint(c.soft, c.ink)} onClick={() => onOpen(e)} title={`${e.title}${e.location ? ` · ${e.location}` : ''}`}>
      {!continues && e.startTime && <span className="t">{timeLabel(e.startTime)}</span>}
      {continues ? `↳ ${e.title}` : e.title}
    </button>
  )
}

const MAX = 4

function Month({ month, events, onOpen }: { month: Date; events: StaffEvent[]; onOpen: (e: StaffEvent) => void }) {
  const [expanded, setExpanded] = useState('')
  const days: Date[] = []
  for (let d = startOfWeek(startOfMonth(month)); d <= endOfWeek(endOfMonth(month)); d = addDays(d, 1)) days.push(d)
  const today = todayStr()
  return (
    <div className="sc-month">
      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="sc-dow">{d}</div>)}
      {days.map((d) => {
        const key = ymd(d)
        const list = events.filter((e) => occursOn(e as never, key)).sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''))
        const all = expanded === key
        const limit = all ? Infinity : list.length > MAX ? MAX - 1 : MAX
        return (
          <div key={key} className={`sc-cell ${isSameMonth(d, month) ? '' : 'other'} ${key === today ? 'today' : ''}`}>
            <span className="sc-num">{format(d, 'd')}</span>
            {list.slice(0, limit).map((e) => <Chip key={e.id} e={e} day={key} onOpen={onOpen} />)}
            {list.length > limit && <button className="sc-more" onClick={() => setExpanded(key)}>+{list.length - limit} more</button>}
            {all && list.length > MAX && <button className="sc-more" onClick={() => setExpanded('')}>show less</button>}
          </div>
        )
      })}
    </div>
  )
}

function List({ events, onOpen }: { events: StaffEvent[]; onOpen: (e: StaffEvent) => void }) {
  const today = todayStr()
  const upcoming = events.filter((e) => (e.endDate ?? e.startDate) >= today).sort((a, b) => a.startDate.localeCompare(b.startDate) || (a.startTime ?? '').localeCompare(b.startTime ?? ''))
  const groups = new Map<string, StaffEvent[]>()
  for (const e of upcoming) {
    const k = e.startDate < today ? today : e.startDate
    groups.set(k, [...(groups.get(k) ?? []), e])
  }
  if (!upcoming.length) return <div className="sc-empty">No upcoming events{events.length ? ' for these ministries' : ''}.</div>
  return (
    <div className="sc-list">
      {[...groups].map(([day, list]) => (
        <section key={day}>
          <h2 className="sc-day">
            <span className="d">{format(parseISO(day), 'd')}</span>
            <span>
              <b>{day === today ? 'Today' : format(parseISO(day), 'EEEE')}</b>
              <small>{format(parseISO(day), 'MMMM yyyy')}</small>
            </span>
          </h2>
          {list.map((e) => {
            const c = swatch(e)
            return (
              <button key={e.id} className="sc-row" onClick={() => onOpen(e)}>
                <span className="bar" style={{ background: c.color }} />
                <span className="time">{timeText(e)}</span>
                <span className="what">
                  <b>{e.title}</b>
                  <small>
                    {keyOf(e)}
                    {e.location && ` · ${e.location}`}
                    {e.endDate && e.endDate !== e.startDate && ` · through ${format(parseISO(e.endDate), 'MMM d')}`}
                  </small>
                </span>
              </button>
            )
          })}
        </section>
      ))}
    </div>
  )
}

function Details({ e, onClose }: { e: StaffEvent; onClose: () => void }) {
  const c = swatch(e)
  return (
    <div className="sc-scrim" onMouseDown={(x) => x.target === x.currentTarget && onClose()}>
      <div className="sc-card" role="dialog" aria-label={e.title}>
        <div className="sc-card-head" style={{ borderColor: c.color }}>
          <span className="sc-tag" style={tint(c.soft, c.ink)}><span className="dot" style={{ background: c.color }} /> {keyOf(e)}</span>
          <button className="sc-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <h2>{e.title}</h2>
        <dl>
          <dt>When</dt>
          <dd>{whenText(e)}<br />{timeText(e)}</dd>
          {e.location && (
            <>
              <dt>Where</dt>
              <dd>{e.location}</dd>
            </>
          )}
        </dl>
      </div>
    </div>
  )
}
