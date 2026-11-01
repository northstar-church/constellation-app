import { formatDistanceToNow, parseISO } from 'date-fns'
import { tint } from '../data/tint'
import { useEffect, useMemo, useRef, useState } from 'react'
import { IconClose, IconPlus } from '../components/Icons'
import type { MediaRequest } from '../data/requests'
import { clock, daysLeft, latest, leavesStreamAt, RETENTION, REVIEW_STATUSES, reviewStatus, type Review, type ReviewSnapshot, type ReviewStatus, type ShareLink } from '../data/review'
import type { RequestStore } from '../requests/requestStore'
import type { ReviewStore, Viewer } from './reviewStore'
import { ReviewView } from './ReviewView'

interface Props {
  store: ReviewStore
  requests: RequestStore
  query: string
  me: string
  team: string[]
  /** Open this review (from a request or a notification) */
  focus?: { reviewId: string; commentId?: string; n: number } | null
  /** Start a new review for this request */
  startFor?: { requestId: string; n: number } | null
  onOpenRequest?: (id: string) => void
  /** Preview only: comment as a guest while previewing a review link */
  onActAsGuest?: (name: string | null) => void
}

function Thumb({ review, store }: { review: Review; store: ReviewStore }) {
  const v = latest(review)
  const [src, setSrc] = useState('')
  useEffect(() => {
    let live = true
    ;(v.thumb ? store.thumbUrl(v) : v.archived ? Promise.resolve('') : store.mediaUrl(v)).then((u) => live && setSrc(u)).catch(() => {})
    return () => {
      live = false
    }
  }, [v.id, v.thumb, store])
  if (!src) return <span className="rl-noimg" />
  if (v.thumb || v.kind === 'image') return <img src={src} alt="" loading="lazy" />
  if (/\.m3u8/.test(src)) return <span className="rl-noimg" />
  return <video src={`${src}#t=1`} muted preload="metadata" playsInline />
}

const TEAM_VIEWER = (name: string): Viewer => ({ name, guest: false, canComment: true, canDownload: true, canDecide: true, canManage: true })

export function ReviewPage({ store, requests, query, me, team, focus, startFor, onOpenRequest, onActAsGuest }: Props) {
  const [snap, setSnap] = useState<ReviewSnapshot | null>(null)
  const [reqs, setReqs] = useState<MediaRequest[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [focusComment, setFocusComment] = useState<string | null>(null)
  const [status, setStatus] = useState<ReviewStatus | 'all'>('all')
  const [creating, setCreating] = useState<{ requestId: string | null; file?: File } | null>(null)
  const [error, setError] = useState('')
  const [guest, setGuest] = useState<{ link: ShareLink; name: string } | null>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const [dropOn, setDropOn] = useState<string | null>(null)
  const [busyCard, setBusyCard] = useState<{ id: string; pct: number } | null>(null)

  useEffect(() => {
    const load = () => store.load().then(setSnap).catch((e) => setError((e as Error).message))
    void load()
    return store.subscribe(load)
  }, [store])
  useEffect(() => {
    const load = () => requests.load().then((s) => setReqs(s.requests)).catch(() => {})
    void load()
    return requests.subscribe(load)
  }, [requests])
  useEffect(() => {
    if (!error) return
    const t = setTimeout(() => setError(''), 6000)
    return () => clearTimeout(t)
  }, [error])
  useEffect(() => {
    if (!focus) return
    setOpenId(focus.reviewId)
    setFocusComment(focus.commentId ?? null)
  }, [focus?.n])
  useEffect(() => {
    if (startFor) setCreating({ requestId: startFor.requestId })
  }, [startFor?.n])
  // Leaving the guest preview puts you back as yourself
  useEffect(() => () => onActAsGuest?.(null), [])

  const reviews = snap?.reviews ?? []
  const open = reviews.find((r) => r.id === openId) ?? null
  const reqOf = (id: string | null) => (id ? reqs.find((r) => r.id === id) ?? null : null)

  const q = query.trim().toLowerCase()
  const listed = useMemo(
    () =>
      reviews.filter(
        (r) =>
          (status === 'all' || r.status === status) &&
          (!q || r.title.toLowerCase().includes(q) || r.folder.toLowerCase().includes(q) || (snap?.comments ?? []).some((c) => c.reviewId === r.id && c.body.toLowerCase().includes(q)))
      ),
    [reviews, status, q, snap]
  )
  const folders = [...new Set(listed.map((r) => r.folder))].sort((a, b) => (!a ? 1 : !b ? -1 : a.localeCompare(b)))
  const allFolders = [...new Set(reviews.map((r) => r.folder).filter(Boolean))].sort()
  const openCount = (r: Review) => (snap?.comments ?? []).filter((c) => c.reviewId === r.id && !c.parentId && !c.resolved && c.versionId === latest(r).id).length

  async function sendToRequester(r: Review) {
    const req = reqOf(r.requestId)
    if (!req) return
    const link = (snap?.links ?? []).find((l) => l.reviewId === r.id && l.active && l.label === req.requesterName) ?? (await store.createLink(r.id, { label: req.requesterName || 'Requester', allowComments: true, allowDownload: false, allVersions: false, expiresAt: null }))
    const url = store.linkUrl(link)
    await requests.update(req.id, {
      proofUrl: url,
      stage: 'proof',
      message: `Your video “${r.title}” is ready to review. Watch it, leave comments right on the video, and approve it here: ${url}`
    })
    await store.updateReview(r.id, { status: 'needs-review' })
  }

  async function addVersionTo(r: Review, f: File) {
    if (!/^(video|image)\//.test(f.type)) return setError(`${f.name} isn’t a video or image.`)
    setBusyCard({ id: r.id, pct: 0 })
    try {
      await store.addVersion(r.id, f, (pct) => setBusyCard({ id: r.id, pct }))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusyCard(null)
    }
  }

  // ---------- guest preview ----------
  if (guest && snap) {
    const r = reviews.find((x) => x.id === guest.link.reviewId)
    if (r) {
      const shown: Review = guest.link.allVersions ? r : { ...r, versions: [latest(r)] }
      const viewer: Viewer = { name: guest.name || 'Guest', guest: true, canComment: guest.link.allowComments, canDownload: guest.link.allowDownload, canDecide: guest.link.allowComments, canManage: false }
      return (
        <main className="main review guest-preview">
          <div className="banner demo-as">
            <span>
              Previewing the review link for <b>{guest.link.label}</b>. This is what they see, without signing in.
            </span>
            <button
              className="btn sm"
              onClick={() => {
                setGuest(null)
                onActAsGuest?.(null)
              }}
            >
              Exit Preview
            </button>
          </div>
          {error && <div className="banner warn">{error}</div>}
          <ReviewView
            review={shown}
            comments={snap.comments}
            decisions={snap.decisions}
            links={[]}
            store={store}
            viewer={viewer}
            team={[]}
            onError={setError}
            guestName={guest.name}
            onGuestName={(name) => {
              setGuest((g) => (g ? { ...g, name } : g))
              onActAsGuest?.(name)
            }}
          />
        </main>
      )
    }
  }

  // ---------- one review ----------
  if (open && snap) {
    const req = reqOf(open.requestId)
    return (
      <main className="main review">
        {error && <div className="banner warn">{error}</div>}
        <ReviewView
          key={open.id}
          review={open}
          comments={snap.comments}
          decisions={snap.decisions}
          links={snap.links}
          store={store}
          viewer={TEAM_VIEWER(me)}
          team={team}
          onBack={() => setOpenId(null)}
          onError={setError}
          request={req ? { title: req.title, requester: req.requesterName } : null}
          onOpenRequest={req && onOpenRequest ? () => onOpenRequest(req.id) : undefined}
          onSendToRequester={req ? () => sendToRequester(open) : undefined}
          onPreviewGuest={(link) => {
            setGuest({ link, name: '' })
            onActAsGuest?.(null)
          }}
          focusComment={focusComment}
        />
      </main>
    )
  }

  // ---------- library ----------
  return (
    <main
      className="main review"
      onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        const f = e.dataTransfer.files[0]
        if (f) setCreating({ requestId: null, file: f })
      }}
    >
      <div className="page-head">
        <h1>Video Review</h1>
        <button className="btn-primary" onClick={() => setCreating({ requestId: null })}>
          New Review <IconPlus size={18} />
        </button>
        <div className="pill-group" role="tablist" aria-label="Status" style={{ marginLeft: 'auto' }}>
          <button className={status === 'all' ? 'on' : ''} onClick={() => setStatus('all')}>
            All
          </button>
          {REVIEW_STATUSES.map((s) => {
            const n = reviews.filter((r) => r.status === s.id).length
            return (
              <button key={s.id} className={status === s.id ? 'on' : ''} onClick={() => setStatus(s.id)}>
                {s.label}
                {n > 0 && <span className="pill-n">{n}</span>}
              </button>
            )
          })}
        </div>
      </div>
      {store.mode === 'demo' && <div className="banner">Preview with sample reviews, saved only in this browser. Drop a video or image anywhere to start a review.</div>}
      <div className="rl-retention">
        To save streaming space, older versions leave Stream {RETENTION.oldVersionDays} days after a newer one is uploaded, approved reviews after {RETENTION.approvedDays} quiet days, and everything else after {RETENTION.idleDays}. Originals and comments are kept, so anything can be restored. 📌 Keep a review to leave it on Stream.
      </div>
      {error && <div className="banner warn">{error}</div>}
      <div className="content">
        {!snap ? (
          <div className="empty">Loading…</div>
        ) : !listed.length ? (
          <div className="empty">{q || status !== 'all' ? 'No reviews match.' : 'No reviews yet. Drop a cut or a graphic here to start one.'}</div>
        ) : (
          folders.map((folder) => (
            <section key={folder || '-'} className="board-section">
              <h2>{folder || 'No Folder'}</h2>
              <div className="board-grid rl-grid">
                {listed
                  .filter((r) => r.folder === folder)
                  .map((r) => {
                    const v = latest(r)
                    const st = reviewStatus(r.status)
                    const req = reqOf(r.requestId)
                    const n = openCount(r)
                    return (
                      <div
                        key={r.id}
                        className={`board-tile-card rl-card ${dropOn === r.id ? 'drop' : ''}`}
                        onDragOver={(e) => {
                          if (!e.dataTransfer.types.includes('Files')) return
                          e.preventDefault()
                          e.stopPropagation()
                          setDropOn(r.id)
                        }}
                        onDragLeave={() => setDropOn((d) => (d === r.id ? null : d))}
                        onDrop={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          setDropOn(null)
                          const f = e.dataTransfer.files[0]
                          if (f) void addVersionTo(r, f)
                        }}
                      >
                        <button className="btc-open" onClick={() => (setOpenId(r.id), setFocusComment(null))}>
                          <span className={`btc-cover rl-cover ${v.archived ? 'archived' : ''}`}>
                            <Thumb review={r} store={store} />
                            <span className="rl-badge">{v.archived ? 'Archived' : v.kind === 'video' ? clock(v.duration) : 'Image'}</span>
                            {(() => {
                              const at = leavesStreamAt(r, v)
                              const d = at ? daysLeft(at) : 99
                              return d <= RETENTION.warnDays ? <span className="rl-leaving">Leaves Stream in {d}d</span> : null
                            })()}
                            {r.keep && <span className="rl-keep" title="Kept on Stream">📌</span>}
                            {r.versions.length > 1 && <span className="rl-ver">v{v.n}</span>}
                            {dropOn === r.id && <span className="rl-drop">Drop to add v{v.n + 1}</span>}
                            {busyCard?.id === r.id && <span className="rl-drop">Uploading v{v.n + 1}… {busyCard.pct}%</span>}
                          </span>
                          <span className="btc-text">
                            <b>{r.title}</b>
                            <span className="rl-meta">
                              <span className="status-pill xs" style={tint(st.soft, st.ink)}>
                                <span className="dot" style={{ background: st.dot }} /> {st.label}
                              </span>
                              {n > 0 && <span className="rl-count">💬 {n}</span>}
                            </span>
                            <span className="muted-sm">
                              {v.uploadedBy.split(' ')[0]} · {formatDistanceToNow(parseISO(r.updatedAt), { addSuffix: true })}
                              {req ? ` · for ${req.title}` : ''}
                            </span>
                          </span>
                        </button>
                        <button className="btc-menu" onClick={() => setMenu(menu === r.id ? null : r.id)} aria-label={`Options for ${r.title}`}>
                          •••
                        </button>
                        {menu === r.id && <CardMenu review={r} folders={allFolders} store={store} onClose={() => setMenu(null)} onError={setError} />}
                      </div>
                    )
                  })}
              </div>
            </section>
          ))
        )}
      </div>

      {creating && (
        <NewReview
          initial={creating}
          folders={allFolders}
          requests={reqs.filter((r) => r.stage !== 'delivered' || r.id === creating.requestId)}
          store={store}
          onClose={() => setCreating(null)}
          onCreated={(r) => {
            setCreating(null)
            setOpenId(r.id)
          }}
        />
      )}
    </main>
  )
}

function CardMenu({ review, folders, store, onClose, onError }: { review: Review; folders: string[]; store: ReviewStore; onClose: () => void; onError: (m: string) => void }) {
  const [folder, setFolder] = useState(review.folder)
  const [confirm, setConfirm] = useState(false)
  return (
    <div className="btc-pop" onMouseLeave={onClose}>
      <label className="field">
        <span>Folder</span>
        <input
          list="review-folders"
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
          onBlur={() => folder.trim() !== review.folder && void store.updateReview(review.id, { folder: folder.trim() })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          placeholder="e.g. Christmas 2026"
        />
        <datalist id="review-folders">
          {folders.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
      </label>
      {confirm ? (
        <button className="btn danger" onClick={() => void store.deleteReview(review.id).then(onClose).catch((e) => onError((e as Error).message))}>
          Delete {review.versions.length > 1 ? `all ${review.versions.length} versions` : 'it'} and its comments
        </button>
      ) : (
        <button className="btn danger" onClick={() => setConfirm(true)}>
          Delete Review
        </button>
      )}
    </div>
  )
}

function NewReview({
  initial,
  folders,
  requests,
  store,
  onClose,
  onCreated
}: {
  initial: { requestId: string | null; file?: File }
  folders: string[]
  requests: MediaRequest[]
  store: ReviewStore
  onClose: () => void
  onCreated: (r: Review) => void
}) {
  const req = requests.find((r) => r.id === initial.requestId)
  const [file, setFile] = useState<File | null>(initial.file ?? null)
  const [title, setTitle] = useState(req?.title ?? initial.file?.name.replace(/\.[^.]+$/, '') ?? '')
  const [folder, setFolder] = useState('')
  const [requestId, setRequestId] = useState(initial.requestId ?? '')
  const [pct, setPct] = useState<number | null>(null)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const pick = (f: File | undefined) => {
    if (!f) return
    if (!/^(video|image)\//.test(f.type)) return setError(`${f.name} isn’t a video or image.`)
    setError('')
    setFile(f)
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ''))
  }

  async function go() {
    if (!file) return setError('Pick a video or image.')
    setPct(0)
    try {
      const r = await store.createReview({ title, folder, requestId: requestId || null }, file, setPct)
      onCreated(r)
    } catch (e) {
      setError((e as Error).message)
      setPct(null)
    }
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && pct == null && onClose()}>
      <div className="modal new-review" role="dialog" aria-label="New review">
        <div className="modal-head">
          <h2>New Review</h2>
          <button type="button" className="round-btn" onClick={onClose} aria-label="Close" disabled={pct != null}>
            <IconClose size={20} />
          </button>
        </div>
        <div className="modal-body">
          <button
            type="button"
            className={`nr-drop ${file ? 'has' : ''}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              pick(e.dataTransfer.files[0])
            }}
          >
            {file ? (
              <>
                <b>{file.name}</b>
                <span className="muted-sm">{(file.size / 1024 / 1024).toFixed(1)} MB · click to pick another</span>
              </>
            ) : (
              <>
                <b>Drop a video or image</b>
                <span className="muted-sm">MP4, MOV (including ProRes), JPG, PNG… or click to choose</span>
              </>
            )}
          </button>
          <input ref={fileRef} type="file" accept="video/*,image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
          <label className="field">
            <span>Name</span>
            <input id="nr-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Christmas Promo :30" />
          </label>
          <div className="field-row">
            <label className="field">
              <span>Folder</span>
              <input list="nr-folders" value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="e.g. Christmas 2026" />
              <datalist id="nr-folders">
                {folders.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
            </label>
            <label className="field">
              <span>For a media request</span>
              <select value={requestId} onChange={(e) => setRequestId(e.target.value)}>
                <option value="">None</option>
                {requests.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {error && <div className="banner warn">{error}</div>}
          {pct != null && (
            <div className="nr-progress" aria-label="Upload progress">
              <span style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
        <div className="modal-foot">
          <span className="grow" />
          <button className="btn" onClick={onClose} disabled={pct != null}>
            Cancel
          </button>
          <button className="btn-primary sm" onClick={go} disabled={!file || pct != null}>
            {pct != null ? `Uploading… ${pct}%` : 'Upload & Open'}
          </button>
        </div>
      </div>
    </div>
  )
}
