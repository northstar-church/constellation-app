import { addDays, differenceInCalendarDays, format, isWeekend, parseISO } from 'date-fns'
import { tint, tintBg } from '../data/tint'
import { useLayoutEffect, useRef } from 'react'
import { Avatar } from '../components/Avatar'
import { categoryById, eventSwatch } from '../data/constants'
import type { Milestone, TeamEvent } from '../data/types'
import { progressOf } from './EventPanel'
import { eventEnd, todayStr, ymd } from './util'

interface Props {
  events: TeamEvent[]
  milestones: Milestone[]
  selectedId: string | null
  onOpen: (eventId: string) => void
}

const DAY = 54 // px per day
const BEFORE = 21
const AFTER = 160

const rangeLabel = (a: string, b: string) => {
  const A = parseISO(a)
  const B = parseISO(b)
  if (a === b) return format(A, 'MMMM d')
  return format(A, 'MMM') === format(B, 'MMM') && format(A, 'yyyy') === format(B, 'yyyy')
    ? `${format(A, 'MMMM d')} – ${format(B, 'd')}`
    : `${format(A, 'MMMM d')} – ${format(B, 'MMMM d')}`
}

/** Each event is a card spanning its promo run-up, from first milestone to event day. */
export function TimelineView({ events, milestones, selectedId, onOpen }: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const today = todayStr()
  const start = addDays(parseISO(today), -BEFORE)
  const days = Array.from({ length: BEFORE + AFTER }, (_, i) => addDays(start, i))
  const x = (date: string) => differenceInCalendarDays(parseISO(date), start) * DAY
  const width = days.length * DAY
  const windowEnd = ymd(days[days.length - 1])

  const rows = events
    .map((e) => {
      const ms = milestones.filter((m) => m.eventId === e.id)
      const first = ms.reduce((min, m) => (m.dueDate < min ? m.dueDate : min), e.startDate)
      const last = ms.reduce((max, m) => (m.dueDate > max ? m.dueDate : max), eventEnd(e))
      return { e, ms, first, last }
    })
    .filter(({ e, ms, first, last }) => (ms.length > 0 || !!e.endDate) && last >= ymd(start) && first <= windowEnd)
    .sort((a, b) => a.first.localeCompare(b.first) || a.e.startDate.localeCompare(b.e.startDate))

  // Start scrolled so today sits a few days in from the left.
  useLayoutEffect(() => {
    const el = scroller.current?.closest('.content')
    if (el) el.scrollLeft = Math.max(0, x(today) - DAY * 3)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="tl" ref={scroller} style={{ width }}>
      <div className="tl-days">
        {days.map((d) => {
          const k = ymd(d)
          return (
            <div key={k} className={`tl-day ${k === today ? 'today' : ''}`} style={{ width: DAY }}>
              <span className="mon">{d.getDate() === 1 || k === ymd(start) ? format(d, 'MMM') : ' '}</span>
              {format(d, 'EEEEE d')}
            </div>
          )
        })}
      </div>
      <div className="tl-grid" style={{ width }}>
        {days.map((d, i) => (
          <div key={i} className={`tl-col ${isWeekend(d) ? 'weekend' : ''}`} style={{ left: i * DAY, width: DAY }} />
        ))}
      </div>
      <div className="tl-now" style={{ left: x(today) + DAY / 2 }} />
      <div className="tl-rows">
        {rows.length === 0 && <div className="empty" style={{ position: 'sticky', left: 0, width: 'min(100%, 900px)' }}>No promo timelines in this range. Give an event a timeline template to see it here.</div>}
        {rows.map(({ e, ms, first, last }) => {
          const c = { ...categoryById(e.category), ...eventSwatch(e) }
          const p = progressOf(ms)
          const left = Math.max(0, x(first))
          const w = Math.max(DAY, x(last) + DAY - left)
          return (
            <div key={e.id} className="tl-row">
              <button
                className={`tl-card ${selectedId === e.id ? 'selected' : ''}`}
                style={{ left, width: w }}
                onClick={() => onOpen(e.id)}
                aria-label={`${e.title}, ${rangeLabel(e.startDate, eventEnd(e))}`}
              >
                <span className="strip" style={{ background: `${c.color}aa` }} />
                <span className="body">
                  <span className="head">
                    <div>
                      <div className="dates">{rangeLabel(first, last)}</div>
                      <div className="title">{e.title}</div>
                    </div>
                    {e.owner && <Avatar name={e.owner} size={38} />}
                  </span>
                  <span className="bottom">
                    {p.total ? (
                      <span className="progress">
                        <span className="track" style={{ background: tintBg(c.soft, c.ink) }}>
                          <span className="fill" style={{ display: 'block', width: `${p.pct}%`, background: c.color }} />
                        </span>
                        {p.pct}%
                      </span>
                    ) : (
                      <span className="progress">{format(parseISO(e.startDate), 'EEE, MMM d')}</span>
                    )}
                    <span className="tag lg" style={tint(c.soft, c.ink)}>
                      {e.ministry === 'All church' ? c.label : e.ministry}
                    </span>
                  </span>
                </span>
                {/* milestone markers along the bottom edge, at their real dates */}
                {ms.map((m) => (
                  <span
                    key={m.id}
                    className={`tl-mark ${m.done ? 'done' : m.dueDate < today ? 'late' : ''}`}
                    style={{ left: x(m.dueDate) - left + DAY / 2, borderColor: c.color, background: m.done ? c.color : undefined }}
                    title={`${m.title} · ${format(parseISO(m.dueDate), 'MMM d')}${m.done ? ' · done' : ''}`}
                  />
                ))}
                <span className="tl-mark event" style={{ left: x(e.startDate) - left + DAY / 2, background: c.ink }} title={`Event day · ${format(parseISO(e.startDate), 'MMM d')}`} />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
