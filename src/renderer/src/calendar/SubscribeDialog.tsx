import { useEffect, useState } from 'react'
import { IconClose, IconPlus } from '../components/Icons'
import { CATEGORIES, categoryById } from '../data/constants'
import type { FeedApi } from '../data/store'
import type { Feed } from '../data/types'

/** Manage subscribe links that people add to Outlook, Google Calendar or their phone. */
export function SubscribeDialog({ feeds, onClose }: { feeds?: FeedApi; onClose: () => void }) {
  const [list, setList] = useState<Feed[] | null>(null)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [cats, setCats] = useState<string[]>(CATEGORIES.map((c) => c.id))
  const [withMs, setWithMs] = useState(false)
  const [copied, setCopied] = useState('')
  const [confirmId, setConfirmId] = useState('')

  useEffect(() => {
    feeds?.list().then(setList).catch((e: Error) => setError(e.message))
  }, [feeds])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!feeds) return
    setError('')
    try {
      const f = await feeds.create({ name, categories: cats.length === CATEGORIES.length ? null : cats, includeMilestones: withMs })
      setList((l) => [...(l ?? []), f])
      setCreating(false)
      setName('')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const copy = async (f: Feed) => {
    try {
      await navigator.clipboard.writeText(feeds!.url(f))
      setCopied(f.id)
      setTimeout(() => setCopied(''), 1800)
    } catch {
      setError('Couldn’t copy. Select the link and copy it manually.')
    }
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Subscribe">
        <div className="modal-head">
          <h2>Subscribe To The Calendar</h2>
          <button className="round-btn" onClick={onClose} aria-label="Close"><IconClose size={20} /></button>
        </div>
        <div className="modal-body">
          {!feeds ? (
            <p style={{ margin: 0, color: 'var(--muted)' }}>
              Subscribe links work once the app is connected to the Event Calendar. Each link can be added to Outlook, Google Calendar or an
              iPhone, and refreshes automatically as events change.
            </p>
          ) : (
            <>
              <p style={{ margin: 0, color: 'var(--muted)' }}>
                Anyone with a link can see the events it includes, so make a separate link for each audience. Outlook and Google refresh
                subscribed calendars every few hours; phones are usually quicker.
              </p>
              {list === null && !error && <div className="empty" style={{ padding: 20 }}>Loading…</div>}
              {list?.length === 0 && !creating && <div style={{ color: 'var(--muted)' }}>No subscribe links yet.</div>}
              {list?.map((f) => (
                <div key={f.id} className="feed">
                  <div className="feed-top">
                    <b>{f.name}</b>
                    <span className="spacer" />
                    <button className="btn" onClick={() => copy(f)}>{copied === f.id ? 'Copied ✓' : 'Copy Link'}</button>
                    <a className="btn" href={feeds.url(f).replace(/^https?:/, 'webcal:')}>Open In Calendar</a>
                    {confirmId === f.id ? (
                      <button className="btn danger" onClick={() => feeds.remove(f.id).then(() => setList((l) => l!.filter((x) => x.id !== f.id)))}>
                        Confirm
                      </button>
                    ) : (
                      <button className="btn danger" onClick={() => setConfirmId(f.id)} title="Deleting stops this link working for everyone who added it">
                        Delete
                      </button>
                    )}
                  </div>
                  <div className="feed-meta">
                    {f.categories ? f.categories.map((c) => categoryById(c).label).join(', ') : 'All categories'}
                    {f.includeMilestones ? ' · with milestones' : ''} · made by {f.createdBy}
                  </div>
                  <input className="feed-url" readOnly value={feeds.url(f)} onFocus={(e) => e.target.select()} />
                </div>
              ))}
              {creating ? (
                <form className="feed" onSubmit={create}>
                  <label className="field">
                    <span>Name (shows as the calendar’s name in Outlook)</span>
                    <input autoFocus required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. NorthStar Events" />
                  </label>
                  <div className="field">
                    <span>Include these categories</span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                      {CATEGORIES.map((c) => (
                        <label key={c.id} className="check" style={{ color: 'var(--text)' }}>
                          <input
                            type="checkbox"
                            className="cbox"
                            checked={cats.includes(c.id)}
                            onChange={(e) => setCats((l) => (e.target.checked ? [...l, c.id] : l.filter((x) => x !== c.id)))}
                          />
                          <span className="dot" style={{ background: c.color }} /> {c.label}
                        </label>
                      ))}
                    </div>
                  </div>
                  <label className="check" style={{ color: 'var(--text)' }}>
                    <input type="checkbox" className="cbox" checked={withMs} onChange={(e) => setWithMs(e.target.checked)} /> Include promo milestones (best for staff
                    links)
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn-primary sm" disabled={!cats.length}>Create Link</button>
                    <button type="button" className="btn" onClick={() => setCreating(false)}>Cancel</button>
                  </div>
                </form>
              ) : (
                <div>
                  <button className="btn" onClick={() => setCreating(true)}><IconPlus size={16} /> New Subscribe Link</button>
                </div>
              )}
            </>
          )}
          {error && <div className="error">{error}</div>}
        </div>
      </div>
    </div>
  )
}
