import { addDays, format, parseISO } from 'date-fns'
import { useEffect, useState } from 'react'
import { IconClose, IconCopy } from '../components/Icons'
import type { Review, ShareLink } from '../data/review'
import type { ReviewStore } from './reviewStore'

interface Props {
  review: Review
  links: ShareLink[]
  store: ReviewStore
  onClose: () => void
  onError: (msg: string) => void
  /** See the review the way a guest on this link will */
  onPreview: (l: ShareLink) => void
}

/** Review links for people outside the team: no sign-in, comments and approvals by name. */
export function ShareModal({ review, links, store, onClose, onError, onPreview }: Props) {
  const [label, setLabel] = useState('')
  const [allowComments, setAllowComments] = useState(true)
  const [allowDownload, setAllowDownload] = useState(false)
  const [allVersions, setAllVersions] = useState(false)
  const [expires, setExpires] = useState<'never' | '7' | '30'>('never')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const copy = async (l: ShareLink) => {
    try {
      await navigator.clipboard.writeText(store.linkUrl(l))
      setCopied(l.id)
      setTimeout(() => setCopied(null), 1600)
    } catch {
      onError('Couldn’t copy. Select the link and copy it instead.')
    }
  }

  async function create() {
    setBusy(true)
    try {
      const l = await store.createLink(review.id, {
        label: label.trim() || 'Review link',
        allowComments,
        allowDownload,
        allVersions,
        expiresAt: expires === 'never' ? null : addDays(new Date(), Number(expires)).toISOString()
      })
      setLabel('')
      void copy(l)
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const expired = (l: ShareLink) => !!l.expiresAt && new Date(l.expiresAt) < new Date()

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal share-modal" role="dialog" aria-label="Share review">
        <div className="modal-head">
          <h2>Share “{review.title}”</h2>
          <button type="button" className="round-btn" onClick={onClose} aria-label="Close">
            <IconClose size={20} />
          </button>
        </div>
        <div className="modal-body">
          <p className="muted-sm">Anyone with a review link can watch without signing in. They type their name once to comment or approve.</p>
          <div className="share-new">
            <label className="field">
              <span>Who’s it for?</span>
              <input id="link-label" value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="e.g. Pastor Mike, Kids Ministry" />
            </label>
            <div className="share-opts">
              <label className="check-row">
                <input type="checkbox" checked={allowComments} onChange={(e) => setAllowComments(e.target.checked)} />
                <span>Can comment and approve</span>
              </label>
              <label className="check-row">
                <input type="checkbox" checked={allowDownload} onChange={(e) => setAllowDownload(e.target.checked)} />
                <span>Can download</span>
              </label>
              <label className="check-row">
                <input type="checkbox" checked={allVersions} onChange={(e) => setAllVersions(e.target.checked)} />
                <span>Can see earlier versions</span>
              </label>
              <label className="share-exp">
                Link expires
                <select value={expires} onChange={(e) => setExpires(e.target.value as 'never' | '7' | '30')}>
                  <option value="never">Never</option>
                  <option value="7">In 7 days</option>
                  <option value="30">In 30 days</option>
                </select>
              </label>
            </div>
            <button className="btn-primary sm" disabled={busy} onClick={create}>
              Create & Copy Link
            </button>
          </div>

          {links.length > 0 && (
            <div className="share-list">
              <b>Links</b>
              {links.map((l) => (
                <div key={l.id} className={`share-row ${!l.active || expired(l) ? 'off' : ''}`}>
                  <div className="share-info">
                    <b>{l.label}</b>
                    <small className="muted-sm">
                      {[l.allowComments ? 'Comments on' : 'View only', l.allowDownload ? 'downloads on' : '', l.allVersions ? 'all versions' : 'newest version', `${l.views} view${l.views === 1 ? '' : 's'}`, l.expiresAt ? `${expired(l) ? 'expired' : 'expires'} ${format(parseISO(l.expiresAt), 'MMM d')}` : '']
                        .filter(Boolean)
                        .join(' · ')}
                    </small>
                  </div>
                  <button className="btn sm" onClick={() => onPreview(l)} title="See what they’ll see">
                    Preview
                  </button>
                  <button className="btn sm" onClick={() => void copy(l)} disabled={!l.active}>
                    <IconCopy size={15} /> {copied === l.id ? 'Copied' : 'Copy'}
                  </button>
                  <button className="btn sm" onClick={() => void store.updateLink(l.id, { active: !l.active })}>
                    {l.active ? 'Turn Off' : 'Turn On'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
