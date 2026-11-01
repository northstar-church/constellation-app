import { createContext, Fragment, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { tintBg } from '../data/tint'
import { newId } from '../data/constants'
import { CAMERA_SHOTS, cardColor, type CardData, type StudioCard, type StudioMedia } from '../data/studio'

/** What every card needs from the board: saving, uploads, opening boards, loading media. */
export interface CardActions {
  save(id: string, data: Partial<CardData>): void
  upload(file: File): Promise<StudioMedia>
  mediaUrl(m: StudioMedia): Promise<string>
  openBoard(boardId: string): void
  boardTitle(boardId: string): string
  boardCount(boardId: string): number
  boardCover(boardId: string): StudioMedia | null
  onError(msg: string): void
}
export const CardContext = createContext<CardActions | null>(null)
const useActions = () => useContext(CardContext)!

// ---------- small building blocks ----------

/** Text that saves when you click away; follows teammates' edits while you're not typing in it. */
function useDraft(value: string, onSave: (v: string) => void) {
  const [draft, setDraft] = useState(value)
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setDraft(value)
  }, [value])
  return {
    value: draft,
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onFocus: () => (focused.current = true),
    onBlur: () => {
      focused.current = false
      if (draft !== value) onSave(draft)
    }
  }
}

function AutoText({ value, onSave, className, placeholder, autoFocus, rows = 1, label }: { value: string; onSave: (v: string) => void; className?: string; placeholder?: string; autoFocus?: boolean; rows?: number; label: string }) {
  const d = useDraft(value, onSave)
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [d.value])
  return <textarea ref={ref} className={`auto-text ${className ?? ''}`} rows={rows} placeholder={placeholder} autoFocus={autoFocus} aria-label={label} {...d} />
}

function Line({ value, onSave, className, placeholder, label }: { value: string; onSave: (v: string) => void; className?: string; placeholder?: string; label: string }) {
  const d = useDraft(value, onSave)
  return <input className={`line-input ${className ?? ''}`} placeholder={placeholder} aria-label={label} {...d} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
}

function useMedia(m: StudioMedia | null | undefined) {
  const { mediaUrl } = useActions()
  const [src, setSrc] = useState(m && !m.url.startsWith('/api/') ? m.url : '')
  useEffect(() => {
    let live = true
    if (m) mediaUrl(m).then((u) => live && setSrc(u)).catch(() => {})
    else setSrc('')
    return () => {
      live = false
    }
  }, [m, mediaUrl])
  return src
}

/** An image area: shows the picture, or a button to add one. Replace by dropping a new image on it. */
function Frame({ media, ratio, onChange, emptyLabel }: { media: StudioMedia | null | undefined; ratio: string; onChange: (m: StudioMedia | null) => void; emptyLabel: string }) {
  const { upload, onError } = useActions()
  const src = useMedia(media)
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const take = async (files: FileList | null) => {
    const f = files?.[0]
    if (!f) return
    if (!f.type.startsWith('image/')) return onError('Use an image file (JPG, PNG, GIF or WebP).')
    setBusy(true)
    try {
      onChange(await upload(f))
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div
      className={`frame ${media ? '' : 'empty'}`}
      style={{ aspectRatio: ratio }}
      onDragOver={(e) => e.dataTransfer.types.includes('Files') && (e.preventDefault(), e.stopPropagation())}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return
        e.preventDefault()
        e.stopPropagation()
        void take(e.dataTransfer.files)
      }}
    >
      {src ? <img src={src} alt={media?.name ?? ''} draggable={false} /> : null}
      <button className={`frame-btn no-drag ${media ? 'replace' : ''}`} onClick={() => input.current?.click()} disabled={busy}>
        {busy ? 'Uploading…' : media ? 'Replace' : emptyLabel}
      </button>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => void take(e.target.files).then(() => (e.target.value = ''))} />
    </div>
  )
}

/** Light formatting for notes: "# " and "## " headings, "- " bullets, **bold**. */
export function NoteText({ text }: { text: string }) {
  const out: ReactNode[] = []
  let bullets: string[] = []
  const bold = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>))
  const flush = () => {
    if (bullets.length) out.push(<ul key={`u${out.length}`}>{bullets.map((b, i) => <li key={i}>{bold(b)}</li>)}</ul>)
    bullets = []
  }
  text.split('\n').forEach((line, i) => {
    if (/^\s*[-•]\s?/.test(line)) return bullets.push(line.replace(/^\s*[-•]\s?/, ''))
    flush()
    if (line.startsWith('## ')) out.push(<h4 key={i}>{bold(line.slice(3))}</h4>)
    else if (line.startsWith('# ')) out.push(<h3 key={i}>{bold(line.slice(2))}</h3>)
    else if (line.trim()) out.push(<p key={i}>{bold(line)}</p>)
    else out.push(<div key={i} className="note-gap" />)
  })
  flush()
  return <>{out}</>
}

// ---------- card bodies ----------

function NoteCard({ c, editing, setEditing }: { c: StudioCard; editing: boolean; setEditing: (on: boolean) => void }) {
  const { save } = useActions()
  if (editing || !c.data.text)
    return (
      <div className="note-edit no-drag" onBlur={() => setEditing(false)}>
        <AutoText value={c.data.text ?? ''} onSave={(text) => save(c.id, { text })} autoFocus={editing} placeholder="Write something… (## heading, - bullet, **bold**)" label="Note" rows={3} />
      </div>
    )
  return (
    <div className="note-text" onDoubleClick={() => setEditing(true)} title="Double-click to edit">
      <NoteText text={c.data.text} />
    </div>
  )
}

function TodoCard({ c }: { c: StudioCard }) {
  const { save } = useActions()
  const items = c.data.items ?? []
  const setItems = (next: typeof items) => save(c.id, { items: next })
  const done = items.filter((i) => i.done).length
  return (
    <div className="todo">
      <div className="todo-head">
        <Line className="todo-title" value={c.data.title ?? ''} onSave={(title) => save(c.id, { title })} placeholder="To-do list" label="List title" />
        {items.length > 0 && (
          <span className="todo-count">
            {done}/{items.length}
          </span>
        )}
      </div>
      <ul>
        {items.map((it) => (
          <li key={it.id} className={it.done ? 'done' : ''}>
            <input type="checkbox" className="no-drag" checked={it.done} onChange={() => setItems(items.map((x) => (x.id === it.id ? { ...x, done: !x.done } : x)))} aria-label={it.text || 'Item'} />
            <TodoText
              value={it.text}
              onSave={(text) => setItems(items.map((x) => (x.id === it.id ? { ...x, text } : x)))}
              onEnter={() => setItems([...items, { id: newId(), text: '', done: false }])}
              onRemove={() => setItems(items.filter((x) => x.id !== it.id))}
            />
          </li>
        ))}
      </ul>
      <button className="todo-add no-drag" onClick={() => setItems([...items, { id: newId(), text: '', done: false }])}>
        + Add item
      </button>
    </div>
  )
}

function TodoText({ value, onSave, onEnter, onRemove }: { value: string; onSave: (v: string) => void; onEnter: () => void; onRemove: () => void }) {
  const d = useDraft(value, onSave)
  return (
    <input
      className="line-input todo-text no-drag"
      placeholder="To do"
      aria-label="Item"
      autoFocus={!value}
      {...d}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          ;(e.target as HTMLInputElement).blur()
          onEnter()
        }
        if (e.key === 'Backspace' && !d.value) onRemove()
      }}
    />
  )
}

function LinkCard({ c }: { c: StudioCard }) {
  const { save } = useActions()
  const url = c.data.url ?? ''
  let host = ''
  try {
    host = url ? new URL(url).hostname.replace(/^www\./, '') : ''
  } catch {
    host = ''
  }
  return (
    <div className="link-card">
      <div className="link-top">
        <span className="link-icon" aria-hidden="true">
          ↗
        </span>
        <span className="link-host">{host || 'Link'}</span>
        {host && (
          <a className="link-open no-drag" href={url} target="_blank" rel="noreferrer">
            Open
          </a>
        )}
      </div>
      <Line value={c.data.title ?? ''} onSave={(title) => save(c.id, { title })} placeholder="Title" label="Link title" className="link-title" />
      <Line
        value={url}
        onSave={(v) => save(c.id, { url: v && !/^https?:\/\//i.test(v) ? `https://${v}` : v })}
        placeholder="Paste a web address"
        label="Web address"
        className="link-url"
      />
    </div>
  )
}

function ImageCard({ c }: { c: StudioCard }) {
  const { save } = useActions()
  return (
    <div className="image-card">
      <Frame media={c.data.media} ratio={c.data.media ? 'auto' : '4 / 3'} onChange={(media) => save(c.id, { media })} emptyLabel="Add image" />
      <Line value={c.data.caption ?? ''} onSave={(caption) => save(c.id, { caption })} placeholder="Add a caption" label="Caption" className="caption" />
    </div>
  )
}

function ColorCard({ c }: { c: StudioCard }) {
  const { save } = useActions()
  const hex = /^#[0-9a-f]{6}$/i.test(c.data.hex ?? '') ? c.data.hex! : '#cccccc'
  return (
    <div className="color-card">
      <label className="swatch no-drag" style={{ background: hex }} title="Pick a color">
        <input type="color" value={hex} onChange={(e) => save(c.id, { hex: e.target.value })} aria-label="Color" />
      </label>
      <Line value={c.data.name ?? ''} onSave={(name) => save(c.id, { name })} placeholder="Name" label="Color name" className="color-name" />
      <Line value={hex.toUpperCase()} onSave={(v) => /^#?[0-9a-f]{6}$/i.test(v.trim()) && save(c.id, { hex: `#${v.trim().replace('#', '').toLowerCase()}` })} label="Hex value" className="color-hex" />
    </div>
  )
}

function BoardCard({ c }: { c: StudioCard }) {
  const { openBoard, boardTitle, boardCount, boardCover, mediaUrl } = useActions()
  const id = c.data.boardId ?? ''
  const cover = boardCover(id)
  const [src, setSrc] = useState('')
  useEffect(() => {
    if (cover) mediaUrl(cover).then(setSrc).catch(() => {})
  }, [cover, mediaUrl])
  const col = cardColor(c.color)
  return (
    <div className="board-card" title="Double-click to open">
      <div className="board-tile" style={{ background: col.soft ? tintBg(col.soft, col.color) : 'var(--surface-2)' }}>
        {src ? <img src={src} alt="" draggable={false} /> : <span className="board-glyph" style={{ background: col.color === 'transparent' ? 'var(--faint)' : col.color }} />}
      </div>
      <b>{boardTitle(id)}</b>
      <span className="muted-sm">{boardCount(id)} cards</span>
      <button className="board-open no-drag" onClick={() => openBoard(id)}>
        Open
      </button>
    </div>
  )
}

function ShotCard({ c }: { c: StudioCard }) {
  const { save } = useActions()
  const d = c.data
  return (
    <div className="shot">
      <div className="shot-head">
        <span>Shot</span>
        <Line value={d.number ?? ''} onSave={(number) => save(c.id, { number })} label="Shot number" className="shot-num" />
        <label className="shot-dur no-drag">
          <Line value={d.duration ?? ''} onSave={(duration) => save(c.id, { duration: duration.replace(/[^\d.]/g, '') })} label="Length in seconds" className="dur-input" />s
        </label>
      </div>
      <Frame media={d.media} ratio="16 / 9" onChange={(media) => save(c.id, { media })} emptyLabel="Add frame" />
      <label className="shot-field">
        <span>Action</span>
        <AutoText value={d.action ?? ''} onSave={(action) => save(c.id, { action })} placeholder="What happens on screen" label="Action" />
      </label>
      <label className="shot-field">
        <span>Dialogue / VO</span>
        <AutoText value={d.dialogue ?? ''} onSave={(dialogue) => save(c.id, { dialogue })} placeholder="What’s said or heard" label="Dialogue or voiceover" />
      </label>
      <label className="shot-field row">
        <span>Camera</span>
        <select className="no-drag" value={d.camera ?? ''} onChange={(e) => save(c.id, { camera: e.target.value })} aria-label="Camera">
          <option value="">—</option>
          {[...new Set([...CAMERA_SHOTS, d.camera ?? ''])].filter(Boolean).map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
    </div>
  )
}

function SlideCard({ c }: { c: StudioCard }) {
  const { save } = useActions()
  return (
    <div className="slide">
      <div className="shot-head">
        <span>Slide</span>
        <Line value={c.data.number ?? ''} onSave={(number) => save(c.id, { number })} label="Slide number" className="shot-num" />
      </div>
      <Frame media={c.data.media} ratio="4 / 5" onChange={(media) => save(c.id, { media })} emptyLabel="Add slide image" />
      <AutoText value={c.data.caption ?? ''} onSave={(caption) => save(c.id, { caption })} placeholder="Text on this slide" label="Slide text" />
    </div>
  )
}

/** The inside of a card (columns render their own stack around this). */
export function CardBody({ c, editing, setEditing }: { c: StudioCard; editing: boolean; setEditing: (on: boolean) => void }) {
  const { save } = useActions()
  switch (c.type) {
    case 'note':
      return <NoteCard c={c} editing={editing} setEditing={setEditing} />
    case 'heading':
      return <AutoText className="heading-text" value={c.data.text ?? ''} onSave={(text) => save(c.id, { text })} placeholder="Heading" label="Heading" />
    case 'todo':
      return <TodoCard c={c} />
    case 'link':
      return <LinkCard c={c} />
    case 'image':
      return <ImageCard c={c} />
    case 'color':
      return <ColorCard c={c} />
    case 'board':
      return <BoardCard c={c} />
    case 'shot':
      return <ShotCard c={c} />
    case 'slide':
      return <SlideCard c={c} />
    case 'column':
      return <Line className="column-title" value={c.data.title ?? ''} onSave={(title) => save(c.id, { title })} placeholder="Column title" label="Column title" />
  }
}
