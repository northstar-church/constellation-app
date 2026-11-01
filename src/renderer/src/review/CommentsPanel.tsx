import { formatDistanceToNow, parseISO } from 'date-fns'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Avatar } from '../components/Avatar'
import { REACTIONS, type ReviewComment, type ReviewVersion, type Stroke } from '../data/review'
import { formatTime, type TimeFormat } from './Player'
import type { Viewer } from './reviewStore'

export interface Draft {
  text: string
  /** Attach the comment to the current frame (or the in/out range) */
  useTime: boolean
  range: [number, number] | null
  strokes: Stroke[]
  pin: [number, number] | null
}
export const emptyDraft = (useTime: boolean): Draft => ({ text: '', useTime, range: null, strokes: [], pin: null })

type Filter = 'all' | 'open' | 'resolved' | 'marks' | 'mine'

interface Props {
  comments: ReviewComment[]
  versions: ReviewVersion[]
  versionId: string
  allVersions: boolean
  onAllVersions: (v: boolean) => void
  selectedId: string | null
  onSelect: (c: ReviewComment) => void
  viewer: Viewer
  team: string[]
  isVideo: boolean
  fps: number
  timeFormat: TimeFormat
  now: number
  draft: Draft
  setDraft: (fn: (d: Draft) => Draft) => void
  drawing: boolean
  onDrawing: (on: boolean) => void
  onSend: () => void
  onTyping: () => void
  onReply: (parent: ReviewComment, body: string) => void
  onReact: (c: ReviewComment, emoji: string) => void
  onResolve: (c: ReviewComment, resolved: boolean) => void
  onEdit: (c: ReviewComment, body: string) => void
  onDelete: (c: ReviewComment) => void
  /** Guests type their name once */
  guestName?: string
  onGuestName?: (name: string) => void
}

/** "@Sarah" and "#color" stand out in comments */
function Body({ text }: { text: string }) {
  const parts = text.split(/(@[A-Za-z][\w.-]*(?:\s[A-Z][\w.-]*)?|#[\w-]+)/g)
  return (
    <p className="rc-body">
      {parts.map((p, i) => (p.startsWith('@') || p.startsWith('#') ? <mark key={i}>{p}</mark> : <Fragment key={i}>{p}</Fragment>))}
    </p>
  )
}

function MentionBox({
  value,
  onChange,
  team,
  placeholder,
  onEnter,
  onFocus,
  autoFocus,
  id
}: {
  value: string
  onChange: (v: string) => void
  team: string[]
  placeholder: string
  onEnter: () => void
  onFocus?: () => void
  autoFocus?: boolean
  id?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [caret, setCaret] = useState(value.length)
  const m = /@([\w.-]*)$/.exec(value.slice(0, Math.min(caret, value.length)))
  const matches = m ? team.filter((n) => n.toLowerCase().includes(m[1].toLowerCase())).slice(0, 5) : []
  const [pick, setPick] = useState(0)
  useEffect(() => setPick(0), [m?.[1]])
  const insert = (name: string) => {
    const pos = Math.min(caret, value.length)
    const before = value.slice(0, pos).replace(/@[\w.-]*$/, `@${name.split(' ')[0]} `)
    onChange(before + value.slice(pos))
    setCaret(before.length)
    requestAnimationFrame(() => ref.current?.focus())
  }
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(160, el.scrollHeight)}px`
  }, [value])
  return (
    <div className="mention-box">
      <textarea
        id={id}
        ref={ref}
        rows={1}
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onFocus={onFocus}
        onChange={(e) => (onChange(e.target.value), setCaret(e.target.selectionStart ?? e.target.value.length))}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
        onKeyDown={(e) => {
          e.stopPropagation() // the player's shortcuts don't fire while typing
          if (matches.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault()
            setPick((p) => (p + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length)
            return
          }
          if (matches.length && (e.key === 'Enter' || e.key === 'Tab')) {
            e.preventDefault()
            insert(matches[pick])
            return
          }
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            onEnter()
          }
        }}
      />
      {matches.length > 0 && (
        <div className="mention-pop" role="listbox">
          {matches.map((n, i) => (
            <button key={n} type="button" className={i === pick ? 'on' : ''} onMouseDown={(e) => (e.preventDefault(), insert(n))}>
              <Avatar name={n} size={22} /> {n}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function CommentsPanel(props: Props) {
  const { comments, versions, versionId, allVersions, onAllVersions, selectedId, onSelect, viewer, team, isVideo, fps, timeFormat, now, draft, setDraft, drawing, onDrawing, onSend } = props
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<'time' | 'newest'>('time')
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [reply, setReply] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [reacting, setReacting] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  const vn = (id: string) => versions.find((v) => v.id === id)?.n ?? 0
  const top = useMemo(() => {
    let list = comments.filter((c) => !c.parentId && (allVersions || c.versionId === versionId))
    if (filter === 'open') list = list.filter((c) => !c.resolved)
    if (filter === 'resolved') list = list.filter((c) => c.resolved)
    if (filter === 'marks') list = list.filter((c) => c.drawing.length || c.pin)
    if (filter === 'mine') list = list.filter((c) => c.author === viewer.name)
    return [...list].sort((a, b) => (sort === 'newest' ? b.at.localeCompare(a.at) : vn(a.versionId) - vn(b.versionId) || (a.t ?? -1) - (b.t ?? -1) || a.at.localeCompare(b.at)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comments, allVersions, versionId, filter, sort, viewer.name])
  const repliesOf = (id: string) => comments.filter((c) => c.parentId === id).sort((a, b) => a.at.localeCompare(b.at))
  const open = comments.filter((c) => !c.parentId && !c.resolved && c.versionId === versionId).length

  // Keep the selected comment in view
  useEffect(() => {
    if (!selectedId) return
    listRef.current?.querySelector(`[data-comment="${selectedId}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedId])

  const stamp = (c: Pick<ReviewComment, 't' | 'tEnd'>, versionFps = fps) =>
    c.t == null ? null : c.tEnd != null ? `${formatTime(c.t, versionFps, timeFormat)} → ${formatTime(c.tEnd, versionFps, timeFormat)}` : formatTime(c.t, versionFps, timeFormat)

  const copyAll = async () => {
    const lines = top.map((c) => {
      const v = versions.find((x) => x.id === c.versionId)
      const head = [`v${v?.n ?? '?'}`, stamp(c, v?.fps ?? fps), c.author].filter(Boolean).join(' · ')
      const reps = repliesOf(c.id).map((r) => `    ↳ ${r.author}: ${r.body}`)
      return [`${c.resolved ? '[x]' : '[ ]'} ${head}`, `    ${c.body}`, ...reps].join('\n')
    })
    try {
      await navigator.clipboard.writeText(lines.join('\n\n'))
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard blocked */
    }
  }

  const needName = viewer.guest && !props.guestName
  const canSend = (draft.text.trim() || draft.strokes.length) && !needName

  return (
    <aside className="rv-comments" aria-label="Comments">
      <div className="rc-head">
        <b>
          Comments <span className="muted-sm">{open} open</span>
        </b>
        <span className="grow" />
        <button className="rc-mini" onClick={copyAll} title="Copy every comment as a checklist">
          {copied ? 'Copied' : 'Copy All'}
        </button>
      </div>
      <div className="rc-filters">
        <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Show">
          <option value="all">All comments</option>
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
          <option value="marks">With drawings or pins</option>
          <option value="mine">Mine</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as 'time' | 'newest')} aria-label="Sort">
          <option value="time">By timecode</option>
          <option value="newest">Newest first</option>
        </select>
        {versions.length > 1 && (
          <label className="rc-check">
            <input type="checkbox" checked={allVersions} onChange={(e) => onAllVersions(e.target.checked)} /> All versions
          </label>
        )}
      </div>

      <div className="rc-list" ref={listRef}>
        {!top.length && <div className="empty sm">{comments.length ? 'Nothing matches.' : isVideo ? 'No comments yet. Pause anywhere and leave the first one.' : 'No comments yet. Click the image to pin a note.'}</div>}
        {top.map((c, i) => {
          const reps = repliesOf(c.id)
          const v = versions.find((x) => x.id === c.versionId)
          const s = stamp(c, v?.fps ?? fps)
          return (
            <div key={c.id} data-comment={c.id} className={`rc-item ${selectedId === c.id ? 'selected' : ''} ${c.resolved ? 'resolved' : ''}`}>
              <div className="rc-row" onClick={() => onSelect(c)}>
                <span className="rc-num">{i + 1}</span>
                <Avatar name={c.author} size={30} />
                <div className="rc-main">
                  <div className="rc-meta">
                    <b>{c.author}</b>
                    {c.guest && <span className="rc-guest">Guest</span>}
                    {allVersions && <span className="rc-ver">v{v?.n}</span>}
                    <span className="muted-sm">{formatDistanceToNow(parseISO(c.at), { addSuffix: true })}</span>
                  </div>
                  {(s || c.drawing.length > 0 || c.pin) && (
                    <div className="rc-tags">
                      {s && <span className="rc-time">{s}</span>}
                      {c.drawing.length > 0 && <span className="rc-tag">✎ Drawing</span>}
                      {c.pin && <span className="rc-tag">● Pin</span>}
                    </div>
                  )}
                  {editing === c.id ? (
                    <div onClick={(e) => e.stopPropagation()}>
                      <MentionBox value={editText} onChange={setEditText} team={team} placeholder="" autoFocus onEnter={() => (props.onEdit(c, editText), setEditing(null))} />
                      <div className="row-btns sm">
                        <button className="btn-primary sm" onClick={() => (props.onEdit(c, editText), setEditing(null))}>
                          Save
                        </button>
                        <button className="btn sm" onClick={() => setEditing(null)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <Body text={c.body} />
                  )}
                  {c.editedAt && <span className="muted-sm">(edited)</span>}
                </div>
                {viewer.canManage && (
                  <label className="rc-resolve" title={c.resolved ? 'Reopen' : 'Mark done'} onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={c.resolved} onChange={(e) => props.onResolve(c, e.target.checked)} aria-label="Done" />
                  </label>
                )}
              </div>

              <div className="rc-actions">
                {Object.entries(c.reactions).map(([emo, who]) => (
                  <button key={emo} className={`rc-react ${who.includes(viewer.name) ? 'mine' : ''}`} title={who.join(', ')} onClick={() => props.onReact(c, emo)} disabled={!viewer.canComment}>
                    {emo} {who.length}
                  </button>
                ))}
                {viewer.canComment && (
                  <span className="rc-react-add">
                    <button className="rc-mini" onClick={() => setReacting(reacting === c.id ? null : c.id)} aria-label="Add a reaction">
                      ☺︎+
                    </button>
                    {reacting === c.id && (
                      <span className="rc-react-pop" onMouseLeave={() => setReacting(null)}>
                        {REACTIONS.map((e) => (
                          <button key={e} onClick={() => (props.onReact(c, e), setReacting(null))}>
                            {e}
                          </button>
                        ))}
                      </span>
                    )}
                  </span>
                )}
                {viewer.canComment && (
                  <button className="rc-mini" onClick={() => (setReplyTo(replyTo === c.id ? null : c.id), setReply(''))}>
                    Reply
                  </button>
                )}
                {c.author === viewer.name && !viewer.guest && editing !== c.id && (
                  <>
                    <button className="rc-mini" onClick={() => (setEditing(c.id), setEditText(c.body))}>
                      Edit
                    </button>
                    <button className="rc-mini danger" onClick={() => props.onDelete(c)}>
                      Delete
                    </button>
                  </>
                )}
              </div>

              {reps.length > 0 && (
                <div className="rc-replies">
                  {reps.map((r) => (
                    <div key={r.id} className="rc-reply">
                      <Avatar name={r.author} size={24} />
                      <div className="rc-main">
                        <div className="rc-meta">
                          <b>{r.author}</b>
                          {r.guest && <span className="rc-guest">Guest</span>}
                          <span className="muted-sm">{formatDistanceToNow(parseISO(r.at), { addSuffix: true })}</span>
                          {r.author === viewer.name && !viewer.guest && (
                            <button className="rc-mini danger" onClick={() => props.onDelete(r)}>
                              Delete
                            </button>
                          )}
                        </div>
                        <Body text={r.body} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {replyTo === c.id && (
                <div className="rc-reply-box">
                  <MentionBox
                    value={reply}
                    onChange={setReply}
                    team={team}
                    autoFocus
                    placeholder="Reply…"
                    onEnter={() => {
                      if (!reply.trim()) return
                      props.onReply(c, reply.trim())
                      setReply('')
                      setReplyTo(null)
                    }}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {viewer.canComment ? (
        <div className="rc-composer">
          {needName ? (
            <form
              className="rc-guestname"
              onSubmit={(e) => {
                e.preventDefault()
                const n = new FormData(e.currentTarget).get('name')?.toString().trim()
                if (n) props.onGuestName?.(n)
              }}
            >
              <span>Your name, so the team knows who’s commenting</span>
              <div className="posted-row">
                <input name="name" placeholder="First and last name" autoFocus />
                <button className="btn-primary sm">Continue</button>
              </div>
            </form>
          ) : (
            <>
              <MentionBox
                id="rc-new"
                value={draft.text}
                onChange={(text) => setDraft((d) => ({ ...d, text }))}
                team={team}
                placeholder={isVideo ? 'Leave a comment at this frame…  (@ to mention)' : 'Leave a comment…  (@ to mention)'}
                onFocus={props.onTyping}
                onEnter={() => canSend && onSend()}
              />
              <div className="rc-compose-bar">
                {isVideo && (
                  <button
                    className={`rc-chip ${draft.useTime ? 'on' : ''}`}
                    onClick={() => setDraft((d) => ({ ...d, useTime: !d.useTime, range: d.useTime ? null : d.range }))}
                    title={draft.useTime ? 'Attached to this moment. Click to make it about the whole video.' : 'About the whole video. Click to attach it to this moment.'}
                  >
                    ⏱ {draft.useTime ? (draft.range ? `${formatTime(draft.range[0], fps, timeFormat)} → ${formatTime(draft.range[1], fps, timeFormat)}` : formatTime(now, fps, timeFormat)) : 'Whole video'}
                  </button>
                )}
                {isVideo && draft.useTime && (
                  <button
                    className={`rc-chip ${draft.range ? 'on' : ''}`}
                    onClick={() => setDraft((d) => ({ ...d, range: d.range ? null : [now, now + 2] }))}
                    title="Comment on a stretch of time. Set the start and end with I and O."
                  >
                    {draft.range ? 'Range ✓' : 'Range'}
                  </button>
                )}
                <button className={`rc-chip ${drawing ? 'on' : ''}`} onClick={() => onDrawing(!drawing)} title="Draw on the frame">
                  ✎ {draft.strokes.length ? `Drawing (${draft.strokes.length})` : 'Draw'}
                </button>
                {draft.pin && (
                  <button className="rc-chip on" onClick={() => setDraft((d) => ({ ...d, pin: null }))} title="Remove the pin">
                    ● Pin ✕
                  </button>
                )}
                <span className="grow" />
                <button className="btn-primary sm" disabled={!canSend} onClick={onSend}>
                  Send
                </button>
              </div>
              {props.guestName && <small className="muted-sm">Commenting as {props.guestName}</small>}
            </>
          )}
        </div>
      ) : (
        <div className="rc-composer muted-sm">Comments are turned off for this link.</div>
      )}
    </aside>
  )
}
