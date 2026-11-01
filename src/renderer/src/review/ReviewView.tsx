import { formatDistanceToNow, parseISO } from 'date-fns'
import { tint } from '../data/tint'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Avatar } from '../components/Avatar'
import { IconChevron, IconClose } from '../components/Icons'
import { daysLeft, DRAW_COLORS, FPS_CHOICES, latest, leavesStreamAt, RETENTION, REVIEW_STATUSES, reviewStatus, type Review, type ReviewComment, type ReviewDecision, type ReviewStatus, type ShareLink } from '../data/review'
import { fileSize } from '../data/requests'
import { Annotate, type DrawTool } from './Annotate'
import { CommentsPanel, emptyDraft, type Draft } from './CommentsPanel'
import { Player, type Marker, type PlayerHandle, type TimeFormat } from './Player'
import type { ReviewStore, Viewer } from './reviewStore'
import { ShareModal } from './ShareModal'

interface Props {
  review: Review
  comments: ReviewComment[]
  decisions: ReviewDecision[]
  links: ShareLink[]
  store: ReviewStore
  viewer: Viewer
  team: string[]
  onBack?: () => void
  onError: (msg: string) => void
  /** The media request this review is for */
  request?: { title: string; requester: string } | null
  onOpenRequest?: () => void
  /** Shares a review link with the requester on their tracker */
  onSendToRequester?: () => Promise<void>
  onPreviewGuest?: (l: ShareLink) => void
  guestName?: string
  onGuestName?: (n: string) => void
  /** Open at this comment */
  focusComment?: string | null
}

const PALETTE = ['#00b7e2', '#e05297', '#3fae5a', '#8a5cf6', '#e3a21a', '#c96f3b', '#3b82f6', '#14a3a1']
const colorFor = (name: string) => {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length]
}
const initials = (n: string) =>
  n
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

const TOOLS: { id: DrawTool; label: string; icon: string }[] = [
  { id: 'pen', label: 'Pen', icon: 'M4 20c3-1 4-3 6-6s5-8 7-9 2 1 1 3-6 8-9 10-4 2-5 2Z' },
  { id: 'arrow', label: 'Arrow', icon: 'M5 19 19 5M11 5h8v8' },
  { id: 'rect', label: 'Box', icon: 'M4 6h16v12H4z' },
  { id: 'ellipse', label: 'Circle', icon: 'M12 5c4.4 0 8 3.1 8 7s-3.6 7-8 7-8-3.1-8-7 3.6-7 8-7Z' }
]

export function ReviewView({ review, comments, decisions, links, store, viewer, team, onBack, onError, request, onOpenRequest, onSendToRequester, onPreviewGuest, guestName, onGuestName, focusComment }: Props) {
  const player = useRef<PlayerHandle>(null)
  const [versionId, setVersionId] = useState(latest(review).id)
  const [compareId, setCompareId] = useState<string | null>(null)
  const [src, setSrc] = useState('')
  const [compareSrc, setCompareSrc] = useState('')
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [timeFormat, setTimeFormat] = useState<TimeFormat>('timecode')
  const [zoom, setZoom] = useState<'fit' | 1 | 2>('fit')
  const [draft, setDraftState] = useState<Draft>(emptyDraft(true))
  const [drawing, setDrawing] = useState(false)
  const [tool, setTool] = useState<DrawTool>('arrow')
  const [color, setColor] = useState(DRAW_COLORS[0])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [allVersions, setAllVersions] = useState(false)
  const [menu, setMenu] = useState<'versions' | 'decide-approved' | 'decide-changes' | 'decisions' | null>(null)
  const [note, setNote] = useState('')
  const [sharing, setSharing] = useState(false)
  const [uploading, setUploading] = useState<number | null>(null)
  const [sending, setSending] = useState(false)
  const [title, setTitle] = useState(review.title)
  const fileRef = useRef<HTMLInputElement>(null)
  const knownLatest = useRef(latest(review).id)
  const setDraft = useCallback((fn: (d: Draft) => Draft) => setDraftState(fn), [])

  useEffect(() => setTitle(review.title), [review.title])
  // A new version arriving moves you to it (if you were on the newest)
  useEffect(() => {
    const newest = latest(review).id
    if (newest !== knownLatest.current) {
      if (versionId === knownLatest.current) setVersionId(newest)
      knownLatest.current = newest
    }
    if (!review.versions.some((v) => v.id === versionId)) setVersionId(newest)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review.versions])

  const version = review.versions.find((v) => v.id === versionId) ?? latest(review)
  const compareV = compareId ? review.versions.find((v) => v.id === compareId) ?? null : null
  const isVideo = version.kind === 'video'
  const fps = version.fps || 30
  const aspect = version.width && version.height ? version.width / version.height : 16 / 9

  useEffect(() => {
    let live = true
    setSrc('')
    store
      .mediaUrl(version)
      .then((u) => live && setSrc(u))
      .catch((e) => onError((e as Error).message))
    return () => {
      live = false
    }
  }, [version.id, version.src, store])
  useEffect(() => {
    if (!compareV) return setCompareSrc('')
    let live = true
    store.mediaUrl(compareV).then((u) => live && setCompareSrc(u))
    return () => {
      live = false
    }
  }, [compareV?.id, store])

  const mine = useMemo(() => comments.filter((c) => c.reviewId === review.id), [comments, review.id])
  const here = mine.filter((c) => !c.parentId && c.versionId === version.id)
  const selected = mine.find((c) => c.id === selectedId) ?? null

  const select = (c: ReviewComment) => {
    setSelectedId(c.id)
    if (c.versionId !== version.id) setVersionId(c.versionId)
    if (c.t != null) {
      player.current?.pause()
      // after a version switch the player needs a moment
      setTimeout(() => player.current?.seek(c.t! + 0.0001), c.versionId !== version.id ? 300 : 0)
    }
  }
  useEffect(() => {
    if (!focusComment) return
    const c = mine.find((x) => x.id === focusComment)
    if (c) select(c)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusComment])
  // Playing on past a comment lets it go
  useEffect(() => {
    if (playing && selected?.t != null && Math.abs(t - selected.t) > 1) setSelectedId(null)
  }, [t, playing, selected])

  // What's drawn on the frame right now
  const showing = useMemo(() => {
    const frame = 1.5 / fps
    const atFrame = isVideo && !playing ? here.filter((c) => c.t != null && Math.abs(c.t - t) < frame && c.drawing.length) : []
    const list = selected && selected.versionId === version.id ? [selected, ...atFrame.filter((c) => c.id !== selected.id)] : atFrame
    return list.flatMap((c) => c.drawing)
  }, [here, selected, t, playing, isVideo, fps, version.id])
  const pinNumber = (c: ReviewComment) => here.filter((x) => !x.parentId).sort((a, b) => (a.t ?? -1) - (b.t ?? -1) || a.at.localeCompare(b.at)).indexOf(c) + 1
  const pins = [
    ...here
      .filter((c) => c.pin && (!isVideo || c.id === selectedId))
      .map((c) => ({ at: c.pin!, label: String(pinNumber(c)), active: c.id === selectedId, onClick: () => select(c) })),
    ...(draft.pin ? [{ at: draft.pin, label: '+', active: true }] : [])
  ]

  const markers: Marker[] = here
    .filter((c) => c.t != null)
    .map((c) => ({ id: c.id, t: c.t!, tEnd: c.tEnd, initials: initials(c.author), color: colorFor(c.author), active: c.id === selectedId, resolved: c.resolved, title: `${c.author}: ${c.body}` }))

  async function send() {
    const useTime = isVideo && draft.useTime
    try {
      await store.addComment({
        reviewId: review.id,
        versionId: version.id,
        parentId: null,
        body: draft.text.trim(),
        t: useTime ? (draft.range ? draft.range[0] : t) : null,
        tEnd: useTime && draft.range ? draft.range[1] : null,
        pin: draft.pin,
        drawing: draft.strokes
      })
      setDraftState(emptyDraft(draft.useTime))
      setDrawing(false)
    } catch (e) {
      onError((e as Error).message)
    }
  }

  async function upload(f: File | undefined) {
    if (!f) return
    if (!/^(video|image)\//.test(f.type)) return onError(`${f.name} isn’t a video or image.`)
    setUploading(0)
    setMenu(null)
    try {
      await store.addVersion(review.id, f, setUploading)
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setUploading(null)
    }
  }

  async function decide(d: ReviewDecision['decision']) {
    try {
      await store.decide(review.id, version.id, d, note)
      setNote('')
      setMenu(null)
    } catch (e) {
      onError((e as Error).message)
    }
  }

  // Keyboard: Space/K play, J back, L faster, ←/→ frame, ⇧←/→ second, I/O range, C comment, D draw, F full screen
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.closest('input, textarea, select, [contenteditable]')) return
      const p = player.current
      if (!p) return
      const k = e.key.toLowerCase()
      if ((e.metaKey || e.ctrlKey) && k === 'z' && drawing) {
        e.preventDefault()
        setDraftState((d) => ({ ...d, strokes: d.strokes.slice(0, -1) }))
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (k === ' ' || k === 'k') {
        e.preventDefault()
        if (k === 'k') p.pause()
        else p.toggle()
      } else if (k === 'j') p.nudge(-1)
      else if (k === 'l') p.faster()
      else if (k === 'arrowleft') (e.preventDefault(), e.shiftKey ? p.nudge(-1) : p.step(-1))
      else if (k === 'arrowright') (e.preventDefault(), e.shiftKey ? p.nudge(1) : p.step(1))
      else if (k === 'i' && isVideo) setDraftState((d) => ({ ...d, useTime: true, range: [p.time, Math.max(p.time + 1 / fps, d.range?.[1] ?? p.time + 2)] }))
      else if (k === 'o' && isVideo) setDraftState((d) => ({ ...d, useTime: true, range: [Math.min(d.range?.[0] ?? Math.max(0, p.time - 2), p.time), p.time] }))
      else if (k === 'c' && viewer.canComment) (e.preventDefault(), p.pause(), document.getElementById('rc-new')?.focus())
      else if (k === 'd' && viewer.canComment) (p.pause(), setDrawing((x) => !x))
      else if (k === 'f') void document.querySelector('.rv-player')?.requestFullscreen?.()
      else if (k === 'escape') (setDrawing(false), setSelectedId(null), setMenu(null))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawing, isVideo, fps, viewer.canComment])

  const st = reviewStatus(review.status)
  const verDecisions = decisions.filter((d) => d.reviewId === review.id && d.versionId === version.id)
  const latestBy = [...new Map(verDecisions.sort((a, b) => a.at.localeCompare(b.at)).map((d) => [d.by, d])).values()]
  const approvedN = latestBy.filter((d) => d.decision === 'approved').length
  const changesN = latestBy.filter((d) => d.decision === 'changes').length
  const visibleVersions = [...review.versions].reverse()

  return (
    <div
      className="rv"
      onDragOver={(e) => viewer.canManage && e.dataTransfer.types.includes('Files') && e.preventDefault()}
      onDrop={(e) => {
        if (!viewer.canManage) return
        e.preventDefault()
        void upload(e.dataTransfer.files[0])
      }}
    >
      <div className="rv-top">
        {onBack && (
          <button className="round-btn sm" onClick={onBack} aria-label="Back to all reviews" title="All reviews">
            <IconChevron dir="left" size={18} />
          </button>
        )}
        <div className="rv-title">
          {viewer.canManage ? (
            <input
              className="rv-title-input"
              value={title}
              size={Math.max(8, title.length)}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => title.trim() && title !== review.title && void store.updateReview(review.id, { title: title.trim().slice(0, 120) })}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              aria-label="Review name"
            />
          ) : (
            <h1>{review.title}</h1>
          )}
          <div className="rv-sub">
            {review.folder && <span>{review.folder}</span>}
            {request && (
              <button className="rv-req" onClick={onOpenRequest} disabled={!onOpenRequest} title="Open the media request">
                For: {request.title}
              </button>
            )}
          </div>
        </div>

        <div className="rv-menu-wrap">
          <button className="pill rv-ver-btn" onClick={() => setMenu(menu === 'versions' ? null : 'versions')} aria-expanded={menu === 'versions'}>
            v{version.n}
            {review.versions.length > 1 && <span className="muted-sm"> of {review.versions.length}</span>}
            <IconChevron dir="down" size={14} />
          </button>
          {menu === 'versions' && (
            <div className="rv-pop rv-versions" onMouseLeave={() => setMenu(null)}>
              {visibleVersions.map((v) => (
                <div key={v.id} className={`rv-vrow ${v.id === version.id ? 'on' : ''}`}>
                  <button className="rv-vpick" onClick={() => (setVersionId(v.id), setSelectedId(null), setMenu(null))}>
                    <b>v{v.n}</b>
                    <span>
                      {v.name}
                      <small className="muted-sm">
                        {v.uploadedBy.split(' ')[0]} · {formatDistanceToNow(parseISO(v.at), { addSuffix: true })} · {fileSize(v.size)}
                        {v.state === 'processing' ? ' · processing…' : v.state === 'error' ? ' · can’t play here' : ''}
                      </small>
                      {(() => {
                        if (v.archived) return <small className="rv-archived-tag">Archived · restore to play</small>
                        const at = leavesStreamAt(review, v)
                        if (!at) return review.keep && v.kind === 'video' ? <small className="muted-sm">Kept on Stream</small> : null
                        const d = daysLeft(at)
                        return <small className={d <= RETENTION.warnDays ? 'rv-leaving' : 'muted-sm'}>{d === 0 ? 'Leaves Stream today' : `Leaves Stream in ${d} day${d === 1 ? '' : 's'}`}</small>
                      })()}
                    </span>
                  </button>
                  {review.versions.length > 1 && v.id !== version.id && !v.archived && !version.archived && (
                    <button className="rc-mini" onClick={() => (setCompareId(v.id), setMenu(null))} title={`Side by side with v${version.n}`}>
                      Compare
                    </button>
                  )}
                </div>
              ))}
              {viewer.canManage && (
                <div className="rv-vfoot">
                  {isVideo && (
                    <label className="rv-fps">
                      Frame rate
                      <select value={fps} onChange={(e) => void store.setFps(review.id, version.id, Number(e.target.value))}>
                        {FPS_CHOICES.map((f) => (
                          <option key={f} value={f}>
                            {f} fps
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <button className="btn-primary sm" onClick={() => fileRef.current?.click()}>
                    Upload New Version
                  </button>
                  {review.versions.length > 1 && (
                    <button className="btn danger sm" onClick={() => void store.deleteVersion(review.id, version.id).catch((e) => onError((e as Error).message))}>
                      Delete v{version.n}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        {compareV && (
          <button className="pill on" onClick={() => setCompareId(null)} title="Stop comparing">
            Comparing v{compareV.n} <IconClose size={14} />
          </button>
        )}

        <span className="grow" />

        {uploading != null && <span className="rv-uploading">Uploading… {uploading}%</span>}
        {viewer.canManage && review.versions.some((x) => x.kind === 'video') && (
          <button
            className={`pill rv-keep ${review.keep ? 'on' : ''}`}
            onClick={() => void store.updateReview(review.id, { keep: !review.keep })}
            title={
              review.keep
                ? 'Kept: these videos stay on Stream until you turn this off.'
                : `Videos leave Stream to save space (older versions ${RETENTION.oldVersionDays} days after a newer one; the rest after ${RETENTION.approvedDays}–${RETENTION.idleDays} days quiet). Originals stay archived. Click to keep them on Stream.`
            }
          >
            {review.keep ? '📌 Kept' : '📌 Keep'}
          </button>
        )}
        {viewer.canManage ? (
          <label className="status-pill rv-status" style={tint(st.soft, st.ink)}>
            <span className="dot" style={{ background: st.dot }} />
            <select value={review.status} onChange={(e) => void store.updateReview(review.id, { status: e.target.value as ReviewStatus })} aria-label="Status">
              {REVIEW_STATUSES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="status-pill" style={tint(st.soft, st.ink)}>
            <span className="dot" style={{ background: st.dot }} /> {st.label}
          </span>
        )}

        {latestBy.length > 0 && (
          <div className="rv-menu-wrap">
            <button className="rv-decisions" onClick={() => setMenu(menu === 'decisions' ? null : 'decisions')} title="Who approved this version">
              {approvedN > 0 && <span className="ok">✓ {approvedN}</span>}
              {changesN > 0 && <span className="no">✕ {changesN}</span>}
            </button>
            {menu === 'decisions' && (
              <div className="rv-pop" onMouseLeave={() => setMenu(null)}>
                {latestBy.map((d) => (
                  <div key={d.id} className="rv-drow">
                    <Avatar name={d.by} size={26} />
                    <span>
                      <b>{d.by}</b> {d.decision === 'approved' ? 'approved' : 'requested changes'} v{version.n}
                      {d.note && <q>{d.note}</q>}
                      <small className="muted-sm"> · {formatDistanceToNow(parseISO(d.at), { addSuffix: true })}</small>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {viewer.canDecide && (
          <div className="rv-menu-wrap">
            <div className="rv-decide">
              <button className="btn sm ok" onClick={() => setMenu(menu === 'decide-approved' ? null : 'decide-approved')}>
                ✓ Approve
              </button>
              <button className="btn sm no" onClick={() => setMenu(menu === 'decide-changes' ? null : 'decide-changes')}>
                Request Changes
              </button>
            </div>
            {(menu === 'decide-approved' || menu === 'decide-changes') && (
              <div className="rv-pop rv-decide-pop">
                <b>{menu === 'decide-approved' ? `Approve v${version.n}?` : `Request changes on v${version.n}`}</b>
                <textarea
                  rows={3}
                  autoFocus
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                  placeholder={menu === 'decide-approved' ? 'Add a note (optional)' : 'What should change? (your comments are included)'}
                />
                <div className="row-btns">
                  <button className="btn-primary sm" onClick={() => void decide(menu === 'decide-approved' ? 'approved' : 'changes')}>
                    {menu === 'decide-approved' ? 'Approve' : 'Send'}
                  </button>
                  <button className="btn sm" onClick={() => setMenu(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {viewer.canManage && request && onSendToRequester && (
          <button
            className="btn sm"
            disabled={sending}
            onClick={() => {
              setSending(true)
              onSendToRequester()
                .catch((e) => onError((e as Error).message))
                .finally(() => setSending(false))
            }}
            title={`Put a review link on ${request.requester.split(' ')[0]}’s tracker and move the request to Proof Ready`}
          >
            {sending ? 'Sending…' : `Send To ${request.requester.split(' ')[0] || 'Requester'}`}
          </button>
        )}
        {viewer.canManage && (
          <button className="btn-primary sm" onClick={() => setSharing(true)}>
            Share
          </button>
        )}
        {viewer.canDownload && (
          <button
            className="btn sm"
            title="Download the original file"
            onClick={() =>
              void store
                .downloadUrl(version)
                .then((u) => {
                  const a = document.createElement('a')
                  a.href = u
                  a.download = version.name
                  a.click()
                })
                .catch((e) => onError((e as Error).message))
            }
          >
            ↓
          </button>
        )}
        <input ref={fileRef} type="file" accept="video/*,image/*" hidden onChange={(e) => void upload(e.target.files?.[0]).then(() => (e.target.value = ''))} />
      </div>

      <div className="rv-body">
        <div className="rv-left">
          {drawing && (
            <div className="rv-drawbar" role="toolbar" aria-label="Drawing tools">
              {TOOLS.map((x) => (
                <button key={x.id} className={tool === x.id ? 'on' : ''} onClick={() => setTool(x.id)} title={x.label} aria-label={x.label}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d={x.icon} />
                  </svg>
                </button>
              ))}
              <span className="rv-sep" />
              {DRAW_COLORS.map((c) => (
                <button key={c} className={`rv-swatch ${color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={`Color ${c}`} />
              ))}
              <span className="rv-sep" />
              <button onClick={() => setDraftState((d) => ({ ...d, strokes: d.strokes.slice(0, -1) }))} disabled={!draft.strokes.length} title="Undo (⌘Z)">
                Undo
              </button>
              <button onClick={() => setDraftState((d) => ({ ...d, strokes: [] }))} disabled={!draft.strokes.length}>
                Clear
              </button>
              <button className="done" onClick={() => setDrawing(false)}>
                Done
              </button>
            </div>
          )}
          {version.state === 'processing' ? (
            <div className="rv-loading">Getting v{version.n} ready to stream… it’ll play in a minute or two.</div>
          ) : version.state === 'error' && version.kind === 'video' && store.mode === 'cloud' ? (
            <div className="rv-loading rv-archived">
              <b>v{version.n} can’t play yet</b>
              <span>{version.error || 'Cloudflare Stream couldn’t prepare this video.'} The original file is saved.</span>
              {viewer.canManage && (
                <button className="btn-primary sm" onClick={() => void store.restoreVersion(review.id, version.id).catch((e) => onError((e as Error).message))}>
                  Try Again
                </button>
              )}
            </div>
          ) : version.archived ? (
            <div className="rv-loading rv-archived">
              <b>v{version.n} is archived</b>
              <span>
                It was taken off streaming to save space. {version.hasOriginal ? 'The original file is safe, and every comment is still here.' : 'Its comments are still here.'}
              </span>
              {viewer.canManage && version.hasOriginal ? (
                <button
                  className="btn-primary sm"
                  onClick={() => void store.restoreVersion(review.id, version.id).catch((e) => onError((e as Error).message))}
                >
                  Restore v{version.n}
                </button>
              ) : !viewer.canManage ? (
                <span className="muted-sm">Ask the creative team to restore it.</span>
              ) : null}
            </div>
          ) : src ? (
            <Player
              ref={player}
              main={{
                version,
                src,
                label: compareV ? `v${version.n}` : undefined,
                overlay: (
                  <Annotate
                    aspect={aspect}
                    strokes={[...showing, ...draft.strokes]}
                    pins={pins}
                    mode={drawing ? 'draw' : !isVideo && viewer.canComment ? 'pin' : 'view'}
                    tool={tool}
                    color={color}
                    onStroke={(s) => setDraftState((d) => ({ ...d, strokes: [...d.strokes, s] }))}
                    onPin={(p) => {
                      setSelectedId(null)
                      setDraftState((d) => ({ ...d, pin: p }))
                      setTimeout(() => document.getElementById('rc-new')?.focus(), 0)
                    }}
                  />
                )
              }}
              compare={compareV && compareSrc ? { version: compareV, src: compareSrc, label: `v${compareV.n}` } : null}
              markers={markers}
              range={draft.useTime ? draft.range : null}
              timeFormat={timeFormat}
              onTimeFormat={setTimeFormat}
              zoom={zoom}
              onZoom={setZoom}
              onTime={setT}
              onPlaying={setPlaying}
              onMarker={(id) => {
                const c = mine.find((x) => x.id === id)
                if (c) select(c)
              }}
              thumbAt={(x) => store.thumbAt(version, x)}
            />
          ) : (
            <div className="rv-loading">Loading…</div>
          )}
        </div>

        <CommentsPanel
          comments={mine}
          versions={review.versions}
          versionId={version.id}
          allVersions={allVersions}
          onAllVersions={setAllVersions}
          selectedId={selectedId}
          onSelect={select}
          viewer={viewer}
          team={team}
          isVideo={isVideo}
          fps={fps}
          timeFormat={timeFormat}
          now={t}
          draft={draft}
          setDraft={setDraft}
          drawing={drawing}
          onDrawing={(on) => {
            player.current?.pause()
            setDrawing(on)
          }}
          onSend={() => void send()}
          onTyping={() => player.current?.pause()}
          onReply={(parent, body) =>
            void store
              .addComment({ reviewId: review.id, versionId: parent.versionId, parentId: parent.id, body, t: null, tEnd: null, pin: null, drawing: [] })
              .catch((e) => onError((e as Error).message))
          }
          onReact={(c, e) => void store.react(c.id, e).catch((x) => onError((x as Error).message))}
          onResolve={(c, r) => void store.updateComment(c.id, { resolved: r })}
          onEdit={(c, body) => body.trim() && void store.updateComment(c.id, { body: body.trim() })}
          onDelete={(c) => void store.deleteComment(c.id)}
          guestName={guestName}
          onGuestName={onGuestName}
        />
      </div>

      {sharing && (
        <ShareModal
          review={review}
          links={links.filter((l) => l.reviewId === review.id)}
          store={store}
          onClose={() => setSharing(false)}
          onError={onError}
          onPreview={(l) => {
            setSharing(false)
            onPreviewGuest?.(l)
          }}
        />
      )}
    </div>
  )
}
