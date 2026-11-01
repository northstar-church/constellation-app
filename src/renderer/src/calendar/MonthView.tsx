import { addDays, endOfMonth, endOfWeek, format, isSameMonth, isWeekend, startOfMonth, startOfWeek } from 'date-fns'
import { tint, tintBg } from '../data/tint'
import { useState } from 'react'
import { IconPlus } from '../components/Icons'
import { categoryById, eventSwatch } from '../data/constants'
import type { Milestone, TeamEvent } from '../data/types'
import { occursOn, timeLabel, todayStr, ymd } from './util'

interface Props {
  month: Date
  events: TeamEvent[]
  milestones: Milestone[]
  eventsById: Map<string, TeamEvent>
  showMilestones: boolean
  onOpen: (eventId: string) => void
  onNew: (date: string) => void
}

const MAX = 4

export function MonthView({ month, events, milestones, eventsById, showMilestones, onOpen, onNew }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const start = startOfWeek(startOfMonth(month))
  const end = endOfWeek(endOfMonth(month))
  const days: Date[] = []
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d)
  const today = todayStr()

  return (
    <div className="month-wrap">
      <div className="month">
        <div className="month-head">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
            <div key={d} className="dow">{d}</div>
          ))}
        </div>
        <div className="month-grid">
          {days.map((d) => {
            const key = ymd(d)
            const dayEvents = events
              .filter((e) => occursOn(e, key))
              .sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''))
            const dayMs = showMilestones ? milestones.filter((m) => m.dueDate === key) : []
            const total = dayEvents.length + dayMs.length
            const open = expanded === key
            const limit = open ? Infinity : total > MAX ? MAX - 1 : MAX
            let shown = 0
            return (
              <div
                key={key}
                className={`cell ${isSameMonth(d, month) ? '' : 'other'} ${key === today ? 'today' : ''} ${isWeekend(d) ? 'weekend' : ''}`}
                onDoubleClick={(e) => e.target === e.currentTarget && onNew(key)}
              >
                <div className="cell-top">
                  <span className="daynum">{format(d, 'd')}</span>
                  <button className="add-here" aria-label={`Add event on ${format(d, 'MMMM d')}`} onClick={() => onNew(key)}>
                    <IconPlus size={15} />
                  </button>
                </div>
                {dayEvents.map((e) => {
                  if (shown++ >= limit) return null
                  const c = { ...categoryById(e.category), ...eventSwatch(e) }
                  const continues = e.startDate !== key
                  // Multi-day events (sermon series): full chip on the first day and at the start of each week row,
                  // a slim band on the days in between.
                  if (continues && d.getDay() !== 0) {
                    return (
                      <button key={e.id} className="span-band" style={{ background: tintBg(c.soft, c.ink) }} title={e.title} aria-label={`${e.title} (continues)`} onClick={() => onOpen(e.id)} />
                    )
                  }
                  return (
                    <button
                      key={e.id}
                      className={`chip ${e.espace ? 'from-es' : ''}`}
                      style={tint(c.soft, c.ink)}
                      title={`${e.title}${e.location ? ` · ${e.location}` : ''}${e.espace ? ' · from eSpace' : ''}`}
                      onClick={() => onOpen(e.id)}
                    >
                      {!continues && e.startTime && <span className="t">{timeLabel(e.startTime)}</span>}
                      {continues ? `↳ ${e.title}` : e.title}
                    </button>
                  )
                })}
                {dayMs.map((m) => {
                  if (shown++ >= limit) return null
                  const ev = eventsById.get(m.eventId)
                  const color = ev ? eventSwatch(ev).color : '#999'
                  return (
                    <button key={m.id} className={`ms ${m.done ? 'done' : ''}`} title={`${m.title}${ev ? ` · ${ev.title}` : ''}`} onClick={() => onOpen(m.eventId)}>
                      <span className="dot" style={{ background: color }} />
                      {m.title}
                    </button>
                  )
                })}
                {total > limit && (
                  <button className="more" onClick={() => setExpanded(key)}>+{total - limit} more</button>
                )}
                {open && total > MAX && (
                  <button className="more" onClick={() => setExpanded(null)}>show less</button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
