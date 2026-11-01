import { addDays, format, parseISO } from 'date-fns'
import { tint } from '../data/tint'
import { Avatar } from '../components/Avatar'
import { categoryById, eventSwatch } from '../data/constants'
import type { Milestone, TeamEvent } from '../data/types'
import { byDue, occursOn, todayStr, whenLabel, ymd } from './util'

interface Props {
  events: TeamEvent[]
  milestones: Milestone[]
  eventsById: Map<string, TeamEvent>
  showMilestones: boolean
  onOpen: (eventId: string) => void
  onToggle: (m: Milestone) => void
}

const DAYS_AHEAD = 120

function MsLine({ m, ev, onToggle, overdue }: { m: Milestone; ev?: TeamEvent; onToggle: (m: Milestone) => void; overdue?: boolean }) {
  const color = ev ? eventSwatch(ev).color : '#999'
  return (
    <div className={`agenda-ms ${m.done ? 'done' : ''}`}>
      <label>
        <input type="checkbox" className="cbox" checked={m.done} onChange={() => onToggle(m)} />
        <span className="dot" style={{ background: color }} />
        <span className="what">{m.title}</span>
        {ev && <span className="for">· {ev.title}</span>}
        {overdue && <span className="overdue">due {format(parseISO(m.dueDate), 'MMM d')}</span>}
      </label>
      {m.owner && <Avatar name={m.owner} size={28} />}
    </div>
  )
}

export function AgendaView({ events, milestones, eventsById, showMilestones, onOpen, onToggle }: Props) {
  const today = todayStr()
  const overdue = showMilestones ? milestones.filter((m) => !m.done && m.dueDate < today).sort(byDue) : []

  const days: { date: string; ev: TeamEvent[]; ms: Milestone[] }[] = []
  for (let i = 0; i <= DAYS_AHEAD; i++) {
    const date = ymd(addDays(parseISO(today), i))
    const ev = events.filter((e) => occursOn(e, date) && (e.startDate === date || date === today))
    const ms = showMilestones ? milestones.filter((m) => m.dueDate === date).sort(byDue) : []
    if (ev.length || ms.length) days.push({ date, ev, ms })
  }

  if (!days.length && !overdue.length) {
    return <div className="empty">Nothing on the calendar in the next {DAYS_AHEAD} days.</div>
  }

  return (
    <div className="agenda">
      {overdue.length > 0 && (
        <div className="agenda-day late">
          <div className="agenda-date">
            <div className="d">Overdue</div>
            <div className="w">{overdue.length} item{overdue.length > 1 ? 's' : ''}</div>
          </div>
          <div>
            {overdue.map((m) => (
              <MsLine key={m.id} m={m} ev={eventsById.get(m.eventId)} onToggle={onToggle} overdue />
            ))}
          </div>
        </div>
      )}
      {days.map(({ date, ev, ms }) => {
        const d = parseISO(date)
        return (
          <div key={date} className="agenda-day">
            <div className={`agenda-date ${date === today ? 'today' : ''}`}>
              <div className="d">{format(d, 'd')}</div>
              <div className="w">{date === today ? 'Today' : format(d, 'EEE · MMM')}</div>
            </div>
            <div>
              {ev.map((e) => {
                const c = { ...categoryById(e.category), ...eventSwatch(e) }
                return (
                  <button key={e.id} className="agenda-item" onClick={() => onOpen(e.id)}>
                    <span className="bar" style={{ background: c.color }} />
                    <span className="info">
                      <div className="title">{e.title}</div>
                      <div className="meta">
                        {whenLabel(e)}
                        {e.location && ` · ${e.location}`}
                      </div>
                    </span>
                    <span className="tag" style={tint(c.soft, c.ink)}>{e.ministry === 'All church' ? c.label : e.ministry}</span>
                    {e.owner && <Avatar name={e.owner} size={32} />}
                  </button>
                )
              })}
              {ms.map((m) => (
                <MsLine key={m.id} m={m} ev={eventsById.get(m.eventId)} onToggle={onToggle} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
