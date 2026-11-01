import { format, parseISO } from 'date-fns'
import { tint } from '../data/tint'
import { useEffect } from 'react'
import { Avatar } from '../components/Avatar'
import { IconClose, IconPencil } from '../components/Icons'
import { categoryById, ministryColor } from '../data/constants'
import type { Milestone, TeamEvent } from '../data/types'
import { byDue, eventEnd, timeLabel, todayStr } from './util'

export interface Progress {
  total: number
  done: number
  late: number
  upcoming: number
  pct: number
}

export function progressOf(ms: Milestone[], today = todayStr()): Progress {
  const done = ms.filter((m) => m.done).length
  const late = ms.filter((m) => !m.done && m.dueDate < today).length
  return { total: ms.length, done, late, upcoming: ms.length - done - late, pct: ms.length ? Math.round((done / ms.length) * 100) : 0 }
}

export function statusOf(e: TeamEvent, p: Progress): string {
  const today = todayStr()
  if (eventEnd(e) < today) return 'Past'
  if (p.total && p.done === p.total) return 'Ready'
  if (p.late) return 'Behind'
  if (p.done) return 'In progress'
  return p.total ? 'Not started' : 'Scheduled'
}

const SEG = { done: '#00b7e2', upcoming: '#f7e39a', late: '#f4a3a6', empty: 'var(--surface-3)' }

/** Half-circle gauge split into done / upcoming / overdue. */
function Gauge({ p }: { p: Progress }) {
  const cx = 150
  const cy = 150
  const r = 118
  const pt = (deg: number) => [cx - r * Math.cos((deg * Math.PI) / 180), cy - r * Math.sin((deg * Math.PI) / 180)]
  const arc = (a: number, b: number) => {
    const [x1, y1] = pt(a)
    const [x2, y2] = pt(b)
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`
  }
  const parts = [
    { n: p.done, c: SEG.done },
    { n: p.upcoming, c: SEG.upcoming },
    { n: p.late, c: SEG.late }
  ].filter((x) => x.n > 0)
  const gap = parts.length > 1 ? 7 : 0
  const usable = 180 - gap * (parts.length - 1)
  let at = 0
  const segs = parts.map((x) => {
    const span = (x.n / p.total) * usable
    const s = { a: at, b: at + span, c: x.c }
    at += span + gap
    return s
  })

  return (
    <svg className="gauge" width="300" height="172" viewBox="0 0 300 172" role="img" aria-label={`${p.pct}% of milestones done`}>
      {segs.length === 0 && <path d={arc(0, 180)} stroke={SEG.empty} strokeWidth="24" strokeLinecap="round" fill="none" />}
      {segs.map((s, i) => (
        <path key={i} d={arc(s.a, Math.max(s.a + 0.5, s.b))} stroke={s.c} strokeWidth="24" strokeLinecap="round" fill="none" />
      ))}
      <text className="pct" x={cx} y={cy - 18} textAnchor="middle">
        {p.total ? `${p.pct}%` : '—'}
      </text>
      <text className="lbl" x={cx} y={cy + 14} textAnchor="middle">
        {p.total ? 'Done' : 'No milestones'}
      </text>
    </svg>
  )
}

interface Props {
  event: TeamEvent
  milestones: Milestone[]
  onClose: () => void
  onEdit: () => void
  onToggle: (m: Milestone) => void
  /** The media request this event was made from, if any */
  linkedRequest?: { id: string; title: string; requesterName: string; stage: string } | null
  onOpenRequest?: (requestId: string) => void
  /** Upcoming dates of the same recurring eSpace event */
  seriesDates?: number
}

export function EventPanel({ event, milestones, onClose, onEdit, onToggle, linkedRequest, onOpenRequest, seriesDates = 0 }: Props) {
  const c = categoryById(event.category)
  const ms = [...milestones].sort(byDue)
  const p = progressOf(ms)
  const today = todayStr()
  const when =
    event.endDate && event.endDate !== event.startDate
      ? `${format(parseISO(event.startDate), 'MMM d')} – ${format(parseISO(event.endDate), 'MMM d')}`
      : format(parseISO(event.startDate), 'EEE, MMM d')
  /** eSpace events are just for seeing what's on: no owner or milestones */
  const es = !!event.espace
  const time = event.startTime ? `${timeLabel(event.startTime)}${event.endTime ? `–${timeLabel(event.endTime)}` : ''}` : 'All day'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.scrim') && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <aside className="panel" aria-label={`${event.title} details`}>
      <div className="panel-head">
        <button className="round-btn" onClick={onClose} aria-label="Close details">
          <IconClose size={20} />
        </button>
        <h2>{event.title}</h2>
        <button className="round-btn" onClick={onEdit} aria-label="Edit event" title="Edit event">
          <IconPencil size={20} />
        </button>
      </div>

      {!es && (
      <div className="gauge-card">
        <div className="row">
          <h3>Progress</h3>
          <span className="due">Event: {format(parseISO(event.startDate), 'MMMM d')}</span>
        </div>
        <Gauge p={p} />
        <div className="gauge-legend">
          <span><i className="dot" style={{ background: SEG.done }} /> Done</span>
          <span><i className="dot" style={{ background: SEG.upcoming }} /> Upcoming</span>
          <span><i className="dot" style={{ background: SEG.late }} /> Overdue</span>
        </div>
      </div>
      )}

      <div className="facts">
        <div className="fact">
          <b>Category</b>
          <span className="tag lg" style={tint(c.soft, c.ink)}>{c.label}</span>
        </div>
        {!es && (
        <div className="fact">
          <b>Owner</b>
          <span className="owner">
            {event.owner || 'Unassigned'} <Avatar name={event.owner || '?'} size={44} />
          </span>
        </div>
        )}
        <div className="fact">
          <b>When</b>
          <span>
            {when}
            <br />
            {time}
          </span>
        </div>
        {seriesDates > 1 && (
          <div className="fact">
            <b>Repeats</b>
            <span>{seriesDates} upcoming dates</span>
          </div>
        )}
        {event.location && (
          <div className="fact">
            <b>Where</b>
            <span>{event.location}</span>
          </div>
        )}
        <div className="fact">
          <b>Ministry</b>
          <span className="tag lg" style={tint(ministryColor(event.ministry).soft, ministryColor(event.ministry).ink)}>{event.ministry}</span>
        </div>
        {!es && (
        <div className="fact">
          <b>Status</b>
          <span className="status-pill" style={p.late && statusOf(event, p) === 'Behind' ? { background: 'var(--danger-soft)', color: 'var(--danger)' } : undefined}>
            {statusOf(event, p)}
          </span>
        </div>
        )}
      </div>

      {event.espace && (
        <section className="rq-section cal-link es-link">
          <div>
            <b>From eSpace · {event.espace.category}</b>
            <div className="muted-sm">
              Booked by {event.espace.bookedBy}
              {event.espace.ministryByHand ? '' : event.ministry === 'All church' ? ' (no ministry set for them yet)' : ` (${event.ministry})`}. Name, time and rooms are managed in eSpace and update here automatically.
              {event.espace.alsoBooked?.length ? (
                <>
                  <br />
                  <b className="es-twice">
                    Booked {event.espace.alsoBooked.length + 1} times in eSpace (also event #{event.espace.alsoBooked.join(', #')}), so it shows here once. If that’s a leftover booking, cancel it in eSpace.
                  </b>
                </>
              ) : null}
            </div>
          </div>
          <a className="btn" href={event.espace.url} target="_blank" rel="noreferrer">
            Open In eSpace
          </a>
        </section>
      )}

      {linkedRequest && (
        <section className="rq-section cal-link">
          <div>
            <b>From A Media Request</b>
            <div className="muted-sm">
              {linkedRequest.title}
              {linkedRequest.requesterName ? ` · ${linkedRequest.requesterName}` : ''} · {linkedRequest.stage}
            </div>
          </div>
          {onOpenRequest && (
            <button className="btn" onClick={() => onOpenRequest(linkedRequest.id)}>
              Open Request
            </button>
          )}
        </section>
      )}

      {event.notes && <p className="notes">{event.notes}</p>}

      {!es && (
        <>
      <div className="section-head">
        <b>Milestones</b>
        <span>{p.total ? `${p.done} of ${p.total} done` : 'None yet'}</span>
      </div>
      <div className="subtasks">
        {ms.map((m) => {
          const late = !m.done && m.dueDate < today
          return (
            <label key={m.id} className={`subtask ${m.done ? 'done' : ''}`}>
              <input type="checkbox" className="cbox" checked={m.done} onChange={() => onToggle(m)} />
              <span className="what">{m.title}</span>
              <span className={`when ${late ? 'late' : ''}`}>{format(parseISO(m.dueDate), 'MMM d')}</span>
            </label>
          )
        })}
        {!ms.length && (
          <button className="btn" onClick={onEdit} style={{ justifySelf: 'start' }}>
            Add A Promo Timeline
          </button>
        )}
      </div>
        </>
      )}
    </aside>
  )
}
