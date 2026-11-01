import { format, formatDistanceToNow, parseISO } from 'date-fns'
import { tint } from '../data/tint'
import { useEffect, useState } from 'react'
import { Avatar } from '../components/Avatar'
import { IconClose, IconCopy, IconEye, IconSend } from '../components/Icons'
import { FileDrop, dataUrl } from './Files'
import { DELIVERABLES, REQUEST_MINISTRIES, STAGES, assignableTeam, findMember, isImage, stageById, stageIndex, type Assignment, type MediaRequest, type RequestComment, type RequestEvent, type RequestFile, type StageId, type TeamMember } from '../data/requests'
import { STAGE_COLORS } from './RequestsPage'
import type { RequestPatch, RequestStore } from './requestStore'
import { trackerPage } from './trackerPage'
import { latest, reviewStatus, type Review } from '../data/review'
import type { ReviewStore } from '../review/reviewStore'

interface Props {
  request: MediaRequest
  history: RequestEvent[]
  files: RequestFile[]
  comments: RequestComment[]
  me: { name: string; email: string }
  team: TeamMember[]
  store: RequestStore
  /** Opens the calendar's event editor, prefilled from this request */
  /** No longer used: events are scheduled in eSpace */
  onAddToCalendar?: () => void
  /** Jumps to the linked event on the Event Calendar */
  onOpenEvent: (eventId: string) => void
  onClose: () => void
  onError: (e: unknown) => void
  reviews?: ReviewLinks
}

/** Video Review, seen from a request */
export interface ReviewLinks {
  store: ReviewStore
  open: (reviewId: string) => void
  start: (requestId: string) => void
}

function RequestReviews({ requestId, links }: { requestId: string; links: ReviewLinks }) {
  const [list, setList] = useState<Review[]>([])
  const [open, setOpen] = useState<Record<string, number>>({})
  useEffect(() => {
    const load = () =>
      links.store
        .load()
        .then((s) => {
          const mine = s.reviews.filter((r) => r.requestId === requestId)
          setList(mine)
          setOpen(Object.fromEntries(mine.map((r) => [r.id, s.comments.filter((c) => c.reviewId === r.id && !c.parentId && !c.resolved && c.versionId === latest(r).id).length])))
        })
        .catch(() => {})
    void load()
    return links.store.subscribe(load)
  }, [links.store, requestId])
  return (
    <section className="rq-section">
      <div className="section-head">
        <b>Video Review</b>
        <span>Frame-accurate comments and approvals</span>
      </div>
      {list.map((r) => {
        const st = reviewStatus(r.status)
        return (
          <button key={r.id} className="rq-review" onClick={() => links.open(r.id)}>
            <b>{r.title}</b>
            <span className="muted-sm">
              v{latest(r).n}
              {open[r.id] ? ` · ${open[r.id]} open comment${open[r.id] === 1 ? '' : 's'}` : ''}
            </span>
            <span className="status-pill xs" style={tint(st.soft, st.ink)}>
              <span className="dot" style={{ background: st.dot }} /> {st.label}
            </span>
          </button>
        )
      })}
      <button className="btn sm" onClick={() => links.start(requestId)}>
        {list.length ? 'Start Another Review' : 'Start A Review'}
      </button>
    </section>
  )
}

const KIND: Record<string, string> = {
  created: 'Request submitted',
  note: 'Message to requester',
  reply: 'Message from requester',
  partdone: 'Part done',
  proof: 'Proof added',
  final: 'Final artwork added',
  approved: 'Approved the proof',
  changes: 'Requested changes'
}

export function RequestPanel({ request: r, history, files, comments, me, team, store, onClose, onError, onAddToCalendar, onOpenEvent, reviews }: Props) {
  const [target, setTarget] = useState<StageId | null>(null)
  const [stageMsg, setStageMsg] = useState('')
  const [proof, setProof] = useState(r.proofUrl)
  const [details, setDetails] = useState(r.details)
  const [title, setTitle] = useState(r.title)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [preview, setPreview] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [comment, setComment] = useState('')
  const [previewUrls, setPreviewUrls] = useState<Map<string, string> | null>(null)
  const proofs = files.filter((f) => f.kind === 'proof')
  const finals = files.filter((f) => f.kind === 'final')
  const references = files.filter((f) => f.kind === 'reference')
  const pm = team.find((m) => m.pm)
  const firstName = (n: string) => n.split(' ')[0]
  const isMe = (name: string) => findMember(team, name)?.email === me.email.toLowerCase() || name === me.name
  const mine = r.assignees.find((a) => isMe(a.name))
  const others = r.assignees.filter((a) => !isMe(a.name))
  const allDone = r.assignees.length > 0 && r.assignees.every((a) => a.done)
  const setAssignees = (list: Assignment[]) => save({ assignees: list })
  const togglePart = (name: string) => setAssignees(r.assignees.map((a) => (a.name === name ? { ...a, done: !a.done } : a)))
  const notifyLine = [pm?.name, ...r.assignees.map((a) => a.name)]
    .filter((x): x is string => !!x && !isMe(x))
    .map(firstName)
    .filter((x, i, a) => a.indexOf(x) === i)
    .join(' and ')
  const first = (r.requesterName || 'the requester').split(' ')[0]
  const idx = stageIndex(r.stage)
  const notInSlack = history.some((h) => !h.public && h.message.includes('in Slack'))

  useEffect(() => setProof(r.proofUrl), [r.proofUrl])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.scrim') && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const save = async (patch: RequestPatch) => {
    try {
      await store.update(r.id, patch)
    } catch (e) {
      onError(e)
    }
  }

  const moveTo = async () => {
    if (!target) return
    if (target === 'proof' && !proof.trim() && !proofs.length) return onError(new Error('Add a proof link or upload a proof file first, so the requester has something to review.'))
    setBusy(true)
    await save({ stage: target, message: stageMsg.trim(), ...(proof !== r.proofUrl ? { proofUrl: proof.trim() } : {}) })
    setBusy(false)
    setTarget(null)
    setStageMsg('')
  }

  const sendNote = async () => {
    if (!note.trim()) return
    setBusy(true)
    try {
      await store.note(r.id, note.trim())
      setNote('')
    } catch (e) {
      onError(e)
    }
    setBusy(false)
  }

  const postComment = async () => {
    if (!comment.trim()) return
    setBusy(true)
    try {
      await store.comment(r.id, comment.trim())
      setComment('')
    } catch (e) {
      onError(e)
    }
    setBusy(false)
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(store.trackerUrl(r))
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      onError(new Error('Couldn’t copy. The link is ' + store.trackerUrl(r)))
    }
  }

  const toggleDeliverable = (d: string) =>
    save({ deliverables: r.deliverables.includes(d) ? r.deliverables.filter((x) => x !== d) : [...r.deliverables, d] })

  const sorted = [...history].sort((a, b) => b.at.localeCompare(a.at))

  return (
    <aside className="panel rq-panel" aria-label={`${r.title} details`}>
      <div className="panel-head">
        <button className="round-btn" onClick={onClose} aria-label="Close details">
          <IconClose size={20} />
        </button>
        <textarea
          className="title-edit"
          rows={2}
          value={title}
          onChange={(e) => setTitle(e.target.value.replace(/\n/g, ' '))}
          onBlur={() => title.trim() && title !== r.title && save({ title: title.trim() })}
          aria-label="Request title"
        />
      </div>

      <div className="requester">
        <Avatar name={r.requesterName || r.requesterEmail || '?'} size={48} />
        <div>
          <b>{r.requesterName || 'Unknown requester'}</b>
          <div className="muted-sm">{r.requesterEmail || 'No email on file'}</div>
          <div className={`slack-state ${notInSlack || !r.requesterEmail ? 'warn' : ''}`}>
            {!r.requesterEmail ? 'No email, so no Slack updates: share the tracker link' : notInSlack ? 'Not found in Slack: share the tracker link' : store.mode === 'cloud' ? 'Gets Slack updates' : 'Will get Slack updates once connected'}
          </div>
        </div>
      </div>

      <div className="tracker-actions">
        <button className="btn" onClick={copyLink}>
          <IconCopy size={18} /> {copied ? 'Copied ✓' : 'Copy Tracker Link'}
        </button>
        <button
          className="btn"
          onClick={async () => {
            const urls = new Map<string, string>()
            for (const f of files.filter(isImage)) {
              try {
                urls.set(f.id, await dataUrl(store, f))
              } catch {
                /* shows the file name instead */
              }
            }
            setPreviewUrls(urls)
            setPreview(true)
          }}
        >
          <IconEye size={18} /> Preview Tracker
        </button>
      </div>

      <div className="gauge-card">
        <div className="row">
          <h3>Status</h3>
          <span className="due">Submitted {format(parseISO(r.createdAt), 'MMM d')}</span>
        </div>
        <ol className="stepper" aria-label="Stage">
          {STAGES.map((s, n) => {
            const c = STAGE_COLORS[s.id]
            const state = n < idx ? 'done' : n === idx ? 'now' : 'todo'
            return (
              <li key={s.id}>
                <button
                  className={`step-btn ${state} ${target === s.id ? 'target' : ''}`}
                  style={state !== 'todo' ? { background: c.dot, borderColor: c.dot } : undefined}
                  onClick={() => setTarget(s.id === r.stage ? null : s.id)}
                  aria-label={`Move to ${s.label}`}
                  title={s.label}
                  aria-current={n === idx ? 'step' : undefined}
                >
                  {n < idx ? '✓' : n === idx ? s.emoji : ''}
                </button>
                <span className={n === idx || target === s.id ? 'on' : ''}>{s.label}</span>
              </li>
            )
          })}
        </ol>
        {allDone && !target && (r.stage === 'scheduled' || r.stage === 'design') && (
          <div className="all-done">
            <span>Everyone’s part is done.</span>
            <button className="btn-primary sm" onClick={() => setTarget('proof')}>
              Move To {stageById('proof').label}
            </button>
          </div>
        )}
        {target && (
          <div className="move-box">
            {target === 'proof' && (
              <label className="field">
                <span>Proof link (optional if you uploaded proof files below)</span>
                <input value={proof} onChange={(e) => setProof(e.target.value)} placeholder="https://" />
              </label>
            )}
            <label className="field">
              <span>Message to {first} (optional, sent in Slack and shown on the tracker)</span>
              <textarea rows={2} value={stageMsg} onChange={(e) => setStageMsg(e.target.value)} placeholder={stageById(target).blurb} />
            </label>
            <div className="row-btns">
              <button className="btn-primary sm" onClick={moveTo} disabled={busy}>
                Move To {stageById(target).label} & Notify
              </button>
              <button className="btn" onClick={() => setTarget(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="facts">
        <div className="fact assign-fact">
          <b>Assigned</b>
          <div className="assignees">
            {r.assignees.map((a) => (
              <span key={a.name} className={`who ${a.done ? 'done' : ''}`}>
                <button
                  className="who-check"
                  onClick={() => togglePart(a.name)}
                  aria-pressed={a.done}
                  aria-label={a.done ? `${a.name}'s part is done. Mark it not done` : `Mark ${a.name}'s part done`}
                  title={a.done ? 'Part done (click to undo)' : 'Mark this part done'}
                >
                  {a.done ? '✓' : ''}
                </button>
                <Avatar name={a.name} size={26} />
                <span className="who-name">{isMe(a.name) ? 'You' : firstName(a.name)}</span>
                <button className="who-x" onClick={() => setAssignees(r.assignees.filter((x) => x.name !== a.name))} aria-label={`Remove ${a.name}`} title="Remove">
                  ×
                </button>
              </span>
            ))}
            <select
              className="fact-input add-who"
              value=""
              onChange={(e) => e.target.value && setAssignees([...r.assignees, { name: e.target.value, done: false }])}
              aria-label="Add a person"
            >
              <option value="">{r.assignees.length ? '+ Add' : 'Unassigned'}</option>
              {assignableTeam(team)
                .filter((m) => !r.assignees.some((a) => a.name === m.name))
                .map((m) => (
                  <option key={m.name}>{m.name}</option>
                ))}
            </select>
          </div>
        </div>
        {mine && (
          <button className={`my-part ${mine.done ? 'is-done' : ''}`} onClick={() => togglePart(mine.name)}>
            {mine.done
              ? `✓ Your part is done${others.some((o) => !o.done) ? ` · ${others.filter((o) => !o.done).map((o) => firstName(o.name)).join(' & ')} still working` : ''} (undo)`
              : `My Part’s Done${others.length ? `: hand off to ${others.filter((o) => !o.done).map((o) => firstName(o.name)).join(' & ') || 'the team'}` : ''}`}
          </button>
        )}
        <div className="fact">
          <b>Needed By</b>
          <input className="fact-input" type="date" value={r.dueDate ?? ''} onChange={(e) => save({ dueDate: e.target.value || null })} />
        </div>
        <div className="fact">
          <b>Event Date</b>
          <input className="fact-input" type="date" value={r.eventDate ?? ''} onChange={(e) => save({ eventDate: e.target.value || null })} title="When the media will be used" />
        </div>
        <div className="fact">
          <b>Ministry</b>
          <select className="fact-input" value={r.ministry} onChange={(e) => save({ ministry: e.target.value })}>
            <option value="">None</option>
            {[...new Set([...REQUEST_MINISTRIES, r.ministry].filter(Boolean))].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Events are scheduled in eSpace now; requests made into events before that keep their link */}
      {r.eventId && (
        <section className="rq-section cal-link">
          <div>
            <b>On The Event Calendar</b>
            <div className="muted-sm">{r.eventDate ? format(parseISO(r.eventDate), 'EEEE, MMMM d') : 'Linked event'}</div>
          </div>
          <button className="btn" onClick={() => onOpenEvent(r.eventId!)}>
            Open Event
          </button>
        </section>
      )}

      {references.length > 0 && (
        <section className="rq-section">
          <div className="section-head">
            <b>From {first}</b>
            <span>Uploaded with the request · team only</span>
          </div>
          <FileDrop requestId={r.id} kind="reference" files={references} store={store} onError={onError} hint="" readOnly />
        </section>
      )}

      {reviews && <RequestReviews requestId={r.id} links={reviews} />}

      <section className="rq-section">
        <div className="section-head">
          <b>Proof</b>
          <span>The requester sees these on their tracker</span>
        </div>
        <label className="field">
          <span>Proof link (website, Figma, Frame.io…)</span>
          <input
            className="fact-input wide"
            value={proof}
            onChange={(e) => setProof(e.target.value)}
            onBlur={() => proof.trim() !== r.proofUrl && save({ proofUrl: proof.trim() })}
            placeholder="https://"
          />
        </label>
        <FileDrop requestId={r.id} kind="proof" files={proofs} store={store} onError={onError} hint="Drop JPG, PNG or PDF proofs here" />
      </section>

      <section className="rq-section">
        <div className="section-head">
          <b>Final Artwork</b>
          <span>{r.stage === 'delivered' ? 'Downloadable from the tracker' : 'Shared on the tracker once Delivered'}</span>
        </div>
        <FileDrop requestId={r.id} kind="final" files={finals} store={store} onError={onError} hint="Drop finished, approved files here (any type)" />
      </section>

      <section className="rq-section team-comments">
        <div className="section-head">
          <b>Team Comments</b>
          <span className="team-only">Team only</span>
        </div>
        <p className="muted-sm" style={{ margin: 0 }}>
          {first} never sees these.{notifyLine ? ` New comments notify ${notifyLine}` : ''}
          {notifyLine && comments.length ? ' and everyone in this thread.' : notifyLine ? '.' : ''}
        </p>
        {comments.length > 0 && (
          <ul className="comments">
            {[...comments].sort((a, b) => a.at.localeCompare(b.at)).map((c) => {
              const mine = c.authorEmail.toLowerCase() === me.email.toLowerCase()
              return (
                <li key={c.id} className={mine ? 'mine' : ''}>
                  <Avatar name={c.authorName} size={32} />
                  <div>
                    <div className="comment-head">
                      <b>{mine ? 'You' : c.authorName}</b>
                      <span className="muted-sm">{formatDistanceToNow(parseISO(c.at), { addSuffix: true })}</span>
                    </div>
                    <p>{c.body}</p>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        <div className="comment-compose">
          <textarea
            rows={2}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void postComment()
            }}
            placeholder={others.length ? `Message ${others.map((o) => firstName(o.name)).join(' & ')}…` : 'Write a comment for the team…'}
            aria-label="Team comment"
          />
          <button className="btn-primary sm" onClick={postComment} disabled={busy || !comment.trim()}>
            <IconSend size={16} /> Comment
          </button>
        </div>
      </section>

      <div>
        <div className="section-head">
          <b>Deliverables</b>
        </div>
        <div className="chip-toggles">
          {DELIVERABLES.map((d) => {
            const on = r.deliverables.includes(d.label)
            return (
              <button key={d.label} className="rq-tag big" style={on ? tint(d.soft, d.ink) : undefined} aria-pressed={on} onClick={() => toggleDeliverable(d.label)}>
                {d.label}
              </button>
            )
          })}
        </div>
      </div>

      <label className="field">
        <span>Details from the request</span>
        <textarea rows={5} value={details} onChange={(e) => setDetails(e.target.value)} onBlur={() => details !== r.details && save({ details })} />
      </label>

      <div className="note-box">
        <div className="section-head">
          <b>Message {first}</b>
          <span>Sent in Slack, shown on the tracker</span>
        </div>
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Quick question about sizes…" />
        <button className="btn-primary sm" onClick={sendNote} disabled={busy || !note.trim()}>
          <IconSend size={16} /> Send
        </button>
      </div>

      <div>
        <div className="section-head">
          <b>History</b>
          <span>{history.length} updates</span>
        </div>
        <ul className="timeline">
          {sorted.map((h) => (
            <li key={h.id} className={`${h.public ? '' : 'private'} ${h.kind === 'reply' ? 'reply' : ''}`}>
              <span className="dot" style={{ background: h.stage ? STAGE_COLORS[h.stage].dot : '#a1a1aa' }} />
              <div>
                <b>{h.kind === 'stage' && h.stage ? `Moved to ${stageById(h.stage).label}` : h.kind === 'partdone' ? `${h.message.split(' ')[0]}’s part is done` : KIND[h.kind] ?? 'Update'}</b>
                {!h.public && <span className="team-only">Team only</span>}
                {h.message && h.kind !== 'partdone' && <p>{h.message}</p>}
                <span className="muted-sm">
                  {h.by} · {formatDistanceToNow(parseISO(h.at), { addSuffix: true })}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div>
        {confirmDelete ? (
          <button className="btn danger" onClick={() => store.remove(r.id).then(onClose).catch(onError)}>
            Confirm Delete
          </button>
        ) : (
          <button className="btn danger" onClick={() => setConfirmDelete(true)}>
            Delete Request
          </button>
        )}
      </div>

      {preview && (
        <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && setPreview(false)}>
          <div className="modal tracker-modal" role="dialog" aria-label="Tracker preview">
            <div className="modal-head">
              <h2>What {first} Sees</h2>
              <button className="round-btn" onClick={() => setPreview(false)} aria-label="Close preview">
                <IconClose size={20} />
              </button>
            </div>
            <iframe title="Tracker preview" sandbox="" srcDoc={trackerPage(r, history, { interactive: false, fileUrl: (f) => previewUrls?.get(f.id) ?? 'about:blank' }, files)} />
          </div>
        </div>
      )}
    </aside>
  )
}
