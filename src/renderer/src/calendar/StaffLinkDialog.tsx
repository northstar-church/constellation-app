import { useEffect, useState } from 'react'
import { IconClose } from '../components/Icons'

/** The read-only Event Calendar page for all staff: one private link, no sign-in */
export function StaffLinkDialog({ link: api, onClose }: { link: { get(): Promise<string>; rotate(): Promise<string> }; onClose: () => void }) {
  const [link, setLink] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [confirm, setConfirm] = useState(false)
  useEffect(() => {
    api.get().then(setLink).catch((e: Error) => setError(e.message))
  }, [api])
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Share the Event Calendar with staff">
        <div className="modal-head">
          <h2>Share With Staff</h2>
          <button className="round-btn" onClick={onClose} aria-label="Close"><IconClose size={20} /></button>
        </div>
        <div className="modal-body">
          <p style={{ margin: 0, color: 'var(--muted)' }}>
            A read-only web page of the Event Calendar for everyone on staff, in the same colors. No sign-in, and no adding or changing events. Staff see each event’s name, ministry, date, time and
            rooms, but not notes. It has a Subscribe button for Outlook, Google Calendar or a phone. Anyone with the link can see it.
          </p>
          <div className="feed">
            <div className="feed-top">
              <b>Staff link</b>
              <span className="spacer" />
              <button
                className="btn"
                disabled={!link}
                onClick={() =>
                  navigator.clipboard.writeText(link).then(() => {
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1800)
                  })
                }
              >
                {copied ? 'Copied ✓' : 'Copy Link'}
              </button>
              <a className="btn" href={link || undefined} target="_blank" rel="noreferrer">Open</a>
              {confirm ? (
                <button className="btn danger" onClick={() => api.rotate().then((l) => (setLink(l), setConfirm(false))).catch((e: Error) => setError(e.message))}>Confirm New Link</button>
              ) : (
                <button className="btn" onClick={() => setConfirm(true)}>New Link</button>
              )}
            </div>
            {confirm && <div className="feed-meta">The current link stops working right away (and so do calendars subscribed to it), so share the new one.</div>}
            <input className="feed-url" readOnly value={link || 'Loading…'} onFocus={(e) => e.target.select()} />
          </div>
          {error && <div className="error">{error}</div>}
        </div>
      </div>
    </div>
  )
}
