import { addDays, differenceInCalendarDays, format, formatDistanceToNow, parseISO } from 'date-fns'
import { useEffect, useState } from 'react'
import { IconClose, IconPlus } from '../components/Icons'
import { CATEGORIES, MINISTRIES, TEMPLATES, milestonesFromTemplate, newId } from '../data/constants'
import type { Milestone, TeamEvent } from '../data/types'
import { byDue, relativeLabel } from './util'

interface Props {
  initial: TeamEvent
  initialMilestones: Milestone[]
  isNew: boolean
  me: string
  onSave: (e: TeamEvent, ms: Milestone[]) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onClose: () => void
  /** eSpace events pick from eSpace's own ministry list */
  espaceMinistries?: string[]
}

export function EventEditor({ initial, initialMilestones, isNew, me, onSave, onDelete, onClose, espaceMinistries = [] }: Props) {
  const [ev, setEv] = useState<TeamEvent>(initial)
  const [ms, setMs] = useState<Milestone[]>([...initialMilestones].sort(byDue))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const multiDay = ev.endDate !== null
  /** eSpace manages the name, date, time and rooms; everything else is ours */
  const locked = !!initial.espace

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const set = <K extends keyof TeamEvent>(k: K, v: TeamEvent[K]) => setEv((p) => ({ ...p, [k]: v }))

  // Moving the event date moves its whole promo timeline with it.
  const changeDate = (next: string) => {
    if (!next) return
    const delta = differenceInCalendarDays(parseISO(next), parseISO(ev.startDate))
    setEv((p) => ({
      ...p,
      startDate: next,
      endDate: p.endDate ? format(addDays(parseISO(p.endDate), delta), 'yyyy-MM-dd') : null
    }))
    if (delta) setMs((list) => list.map((m) => ({ ...m, dueDate: format(addDays(parseISO(m.dueDate), delta), 'yyyy-MM-dd') })))
  }

  const applyTemplate = (id: string) => {
    if (id && ms.length && !window.confirm('Replace the current milestones with this template?')) return
    set('templateId', id || null)
    setMs(id ? milestonesFromTemplate(id, ev.id, ev.startDate, ev.owner) : [])
  }

  const updateMs = (id: string, patch: Partial<Milestone>) =>
    setMs((list) => list.map((m) => (m.id === id ? { ...m, ...patch } : m)))

  const addMs = () =>
    setMs((list) => [
      ...list,
      { id: newId(), eventId: ev.id, title: '', dueDate: ev.startDate, done: false, owner: ev.owner, sortOrder: list.length }
    ])

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!ev.title.trim()) return setError('Give the event a title.')
    if (ev.endDate && ev.endDate < ev.startDate) return setError('End date is before the start date.')
    setBusy(true)
    setError('')
    try {
      const cleaned = ms
        .filter((m) => m.title.trim())
        .sort(byDue)
        .map((m, i) => ({ ...m, title: m.title.trim(), sortOrder: i }))
      // Picking a different ministry by hand on an eSpace event keeps it, even if the booker's ministry changes later
      const espace = ev.espace && ev.ministry !== initial.ministry ? { ...ev.espace, ministryByHand: true } : ev.espace
      await onSave({ ...ev, espace, title: ev.title.trim(), updatedAt: new Date().toISOString(), updatedBy: me }, cleaned)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.')
      setBusy(false)
    }
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={save} role="dialog" aria-label={isNew ? 'New event' : 'Edit event'}>
        <div className="modal-head">
          <h2>{isNew ? 'New Event' : 'Edit Event'}</h2>
          <button type="button" className="round-btn" onClick={onClose} aria-label="Close"><IconClose size={20} /></button>
        </div>
        <div className="modal-body">
          {locked && (
            <div className="banner es-banner">
              <i className="es-dot" /> From eSpace ({initial.espace!.category}). Change the name, date, time or rooms in eSpace and they update here within 15 minutes. Here you can set the ministry (for every date, if it repeats) and add notes.
            </div>
          )}
          <label className="field">
            <span>Title</span>
            <input className="title-input" autoFocus={!locked} disabled={locked} value={ev.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Easter services" />
          </label>

          <div className="grid2">
            <label className="field">
              <span>Category</span>
              <select value={ev.category} disabled={locked} title={locked ? 'Set by the eSpace category' : undefined} onChange={(e) => set('category', e.target.value as TeamEvent['category'])}>
                {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Ministry</span>
              <select value={ev.ministry} onChange={(e) => set('ministry', e.target.value)}>
                {[...new Set([...(locked ? ['All church', ...espaceMinistries] : MINISTRIES), ev.ministry].filter(Boolean))].map((m) => <option key={m}>{m}</option>)}
              </select>
            </label>
          </div>

          <div className="grid4">
            <label className="field">
              <span>{multiDay ? 'Starts' : 'Date'}</span>
              <input type="date" disabled={locked} value={ev.startDate} onChange={(e) => changeDate(e.target.value)} />
            </label>
            {multiDay ? (
              <label className="field">
                <span>Ends</span>
                <input type="date" disabled={locked} value={ev.endDate ?? ''} min={ev.startDate} onChange={(e) => set('endDate', e.target.value || null)} />
              </label>
            ) : locked ? (
              <div className="field" />
            ) : (
              <div className="field">
                <span>&nbsp;</span>
                <button type="button" className="btn" disabled={locked} onClick={() => set('endDate', ev.startDate)}>+ End Date</button>
              </div>
            )}
            <label className="field">
              <span>Start time</span>
              <input type="time" disabled={locked} value={ev.startTime ?? ''} onChange={(e) => set('startTime', e.target.value || null)} />
            </label>
            <label className="field">
              <span>End time</span>
              <input type="time" disabled={locked} value={ev.endTime ?? ''} onChange={(e) => set('endTime', e.target.value || null)} />
            </label>
          </div>

          <div className="grid2">
            <label className="field">
              <span>{locked ? 'Rooms' : 'Location'}</span>
              <input disabled={locked} value={ev.location} onChange={(e) => set('location', e.target.value)} placeholder="Auditorium, campus, offsite…" />
            </label>
            {!locked && (
              <label className="field">
                <span>Owner</span>
                <input value={ev.owner} onChange={(e) => set('owner', e.target.value)} placeholder="Who’s running point" />
              </label>
            )}
          </div>

          <label className="field">
            <span>Notes</span>
            <textarea rows={3} value={ev.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Goals, audience, deliverables, links…" />
          </label>

          {!locked && (
            <>
          <div className="section-title">
            <b>Promo Timeline</b>
            <span className="sub">Milestones move with the event date.</span>
            <span className="spacer" />
            <select value={ev.templateId ?? ''} onChange={(e) => applyTemplate(e.target.value)} aria-label="Timeline template">
              <option value="">No template</option>
              {TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div className="ms-list">
            {ms.map((m) => (
              <div key={m.id} className="ms-row">
                <input type="checkbox" className="cbox" checked={m.done} onChange={(e) => updateMs(m.id, { done: e.target.checked })} aria-label="Done" />
                <input value={m.title} onChange={(e) => updateMs(m.id, { title: e.target.value })} placeholder="Milestone" />
                <input type="date" value={m.dueDate} onChange={(e) => e.target.value && updateMs(m.id, { dueDate: e.target.value })} />
                <input value={m.owner} onChange={(e) => updateMs(m.id, { owner: e.target.value })} placeholder="Owner" />
                <button type="button" className="x" onClick={() => setMs((l) => l.filter((x) => x.id !== m.id))} aria-label="Remove milestone"><IconClose size={16} /></button>
                <span />
                <span className="rel">{relativeLabel(m.dueDate, ev.startDate)}</span>
              </div>
            ))}
            <div>
              <button type="button" className="btn" onClick={addMs}><IconPlus size={16} /> Add Milestone</button>
            </div>
          </div>
            </>
          )}
          {error && <div className="error">{error}</div>}
        </div>
        <div className="modal-foot">
          {!isNew && (
            <span className="updated">
              Updated {formatDistanceToNow(parseISO(initial.updatedAt), { addSuffix: true })} by {initial.updatedBy}
            </span>
          )}
          {isNew && <span className="spacer" />}
          {!isNew && !locked &&
            (confirmDelete ? (
              <button type="button" className="btn danger" onClick={async () => { await onDelete(ev.id); onClose() }}>
                Confirm Delete
              </button>
            ) : (
              <button type="button" className="btn danger" onClick={() => setConfirmDelete(true)}>Delete</button>
            ))}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn-primary sm" disabled={busy}>{busy ? 'Saving…' : 'Save Event'}</button>
        </div>
      </form>
    </div>
  )
}
