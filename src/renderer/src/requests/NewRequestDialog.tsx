import { useEffect, useState } from 'react'
import { tint } from '../data/tint'
import { IconClose } from '../components/Icons'
import { DELIVERABLES, REQUEST_MINISTRIES } from '../data/requests'
import type { NewRequest } from './requestStore'

/** For requests that come in by hallway conversation, email or text instead of the form. */
export function NewRequestDialog({ onClose, onCreate }: { me: string; onClose: () => void; onCreate: (r: NewRequest) => Promise<void> }) {
  const [f, setF] = useState<NewRequest>({
    title: '',
    details: '',
    deliverables: [],
    ministry: '',
    requesterName: '',
    requesterEmail: '',
    dueDate: null
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = <K extends keyof NewRequest>(k: K, v: NewRequest[K]) => setF((p) => ({ ...p, [k]: v }))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!f.title.trim()) return setError('Give the request a title.')
    if (f.requesterEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.requesterEmail)) return setError('That email doesn’t look right.')
    setBusy(true)
    try {
      await onCreate({ ...f, title: f.title.trim(), requesterEmail: f.requesterEmail.trim().toLowerCase() })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the request.')
      setBusy(false)
    }
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={submit} role="dialog" aria-label="New request">
        <div className="modal-head">
          <h2>New Request</h2>
          <button type="button" className="round-btn" onClick={onClose} aria-label="Close">
            <IconClose size={20} />
          </button>
        </div>
        <div className="modal-body">
          <label className="field">
            <span>What’s it for?</span>
            <input className="title-input" autoFocus value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Kids Birthday door banner" />
          </label>
          <div className="grid2">
            <label className="field">
              <span>Requester name</span>
              <input value={f.requesterName} onChange={(e) => set('requesterName', e.target.value)} />
            </label>
            <label className="field">
              <span>Requester church email (for Slack updates)</span>
              <input type="email" value={f.requesterEmail} onChange={(e) => set('requesterEmail', e.target.value)} placeholder="name@northstarchurch.org" />
            </label>
          </div>
          <div className="grid2">
            <label className="field">
              <span>Ministry</span>
              <select value={f.ministry} onChange={(e) => set('ministry', e.target.value)}>
                <option value="">Choose…</option>
                {REQUEST_MINISTRIES.map((m) => <option key={m}>{m}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Needed by</span>
              <input type="date" value={f.dueDate ?? ''} onChange={(e) => set('dueDate', e.target.value || null)} />
            </label>
          </div>
          <div className="field">
            <span>Deliverables</span>
            <div className="chip-toggles">
              {DELIVERABLES.map((d) => {
                const on = f.deliverables.includes(d.label)
                return (
                  <button
                    type="button"
                    key={d.label}
                    className="rq-tag big"
                    style={on ? tint(d.soft, d.ink) : undefined}
                    aria-pressed={on}
                    onClick={() => set('deliverables', on ? f.deliverables.filter((x) => x !== d.label) : [...f.deliverables, d.label])}
                  >
                    {d.label}
                  </button>
                )
              })}
            </div>
          </div>
          <label className="field">
            <span>Details</span>
            <textarea rows={4} value={f.details} onChange={(e) => set('details', e.target.value)} placeholder="Sizes, wording, audience, where it will be used…" />
          </label>
          {error && <div className="error">{error}</div>}
        </div>
        <div className="modal-foot">
          <span className="updated">The requester gets a Slack message with their tracker link.</span>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary sm" disabled={busy}>
            {busy ? 'Creating…' : 'Create Request'}
          </button>
        </div>
      </form>
    </div>
  )
}
