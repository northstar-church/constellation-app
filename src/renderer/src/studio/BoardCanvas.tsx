import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CARD_COLORS, CARD_DEFAULT_WIDTH, cardColor, type CardType, type StudioBoard, type StudioCard, type StudioLine, type StudioMedia, type StudioSnapshot } from '../data/studio'
import { CardBody, CardContext, type CardActions } from './StudioCards'
import type { StudioStore } from './studioStore'

interface Props {
  board: StudioBoard
  snap: StudioSnapshot
  store: StudioStore
  onOpenBoard: (id: string) => void
  onError: (msg: string) => void
}

type Rect = { x: number; y: number; w: number; h: number }
type Drag = { id: string; offX: number; offY: number; x: number; y: number; moved: boolean; startX: number; startY: number; fromColumn: boolean }
type Linking = { from: string; x: number; y: number }

const TOOLS: { type: CardType | 'line'; label: string; icon: string }[] = [
  { type: 'note', label: 'Note', icon: 'M5 4h14v12l-4 4H5z M15 20v-4h4' },
  { type: 'heading', label: 'Heading', icon: 'M6 5v14 M18 5v14 M6 12h12' },
  { type: 'todo', label: 'To-do', icon: 'M4 6l2 2 3-3 M4 13l2 2 3-3 M12 7h8 M12 14h8 M12 20h8' },
  { type: 'link', label: 'Link', icon: 'M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1 M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1' },
  { type: 'image', label: 'Image', icon: 'M4 5h16v14H4z M4 16l5-5 4 4 3-3 4 4 M15.5 9.5h.01' },
  { type: 'color', label: 'Color', icon: 'M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.6 0-1.2-1-1.4-1-2.4 0-.9.7-1.5 1.6-1.5H16a5 5 0 0 0 5-5c0-4-4-7.5-9-7.5z M7.5 11h.01 M10 7h.01 M15 7.5h.01' },
  { type: 'column', label: 'Column', icon: 'M7 3h10v18H7z M7 8h10 M7 13h10' },
  { type: 'board', label: 'Board', icon: 'M4 5h16v14H4z M8 9h4v4H8z' },
  { type: 'shot', label: 'Shot', icon: 'M3 7h13v10H3z M16 10l5-3v10l-5-3' },
  { type: 'slide', label: 'Slide', icon: 'M7 3h10v18H7z M3 6v12 M21 6v12' },
  { type: 'line', label: 'Line', icon: 'M5 19L19 5 M13 5h6v6' }
]

export function BoardCanvas({ board, snap, store, onOpenBoard, onError }: Props) {
  const [zoom, setZoom] = useState(1)
  const [selected, setSelected] = useState<string | null>(null)
  const [selectedLine, setSelectedLine] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [linking, setLinking] = useState<Linking | null>(null)
  const [lineMode, setLineMode] = useState(false)
  const [rects, setRects] = useState<Record<string, Rect>>({})
  const [undo, setUndo] = useState<{ label: string; removed: Awaited<ReturnType<StudioStore['deleteCards']>> } | null>(null)
  const [dropCol, setDropCol] = useState<{ id: string; index: number } | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const plane = useRef<HTMLDivElement>(null)
  const cardEls = useRef(new Map<string, HTMLElement>())
  const fileInput = useRef<HTMLInputElement>(null)
  const pendingImage = useRef<{ x: number; y: number } | null>(null)

  const cards = useMemo(() => snap.cards.filter((c) => c.boardId === board.id), [snap.cards, board.id])
  const lines = useMemo(() => snap.lines.filter((l) => l.boardId === board.id), [snap.lines, board.id])
  const free = cards.filter((c) => !c.parentId)
  const childrenOf = (colId: string) => cards.filter((c) => c.parentId === colId).sort((a, b) => a.order - b.order)
  const size = useMemo(() => {
    const maxX = Math.max(1600, ...free.map((c) => c.x + c.w + 600))
    const maxY = Math.max(1100, ...free.map((c) => c.y + 900))
    return { w: maxX, h: maxY }
  }, [free])

  // ---------- coordinates ----------
  const toPlane = (clientX: number, clientY: number) => {
    const r = plane.current!.getBoundingClientRect()
    return { x: (clientX - r.left) / zoom, y: (clientY - r.top) / zoom }
  }
  const visibleCenter = () => {
    const s = scroller.current!
    return { x: (s.scrollLeft + s.clientWidth / 2) / zoom - 130, y: (s.scrollTop + s.clientHeight / 3) / zoom }
  }

  // Measure cards (for drawing lines between them)
  useLayoutEffect(() => {
    const p = plane.current
    if (!p) return
    const pr = p.getBoundingClientRect()
    const next: Record<string, Rect> = {}
    cardEls.current.forEach((el, id) => {
      const r = el.getBoundingClientRect()
      next[id] = { x: (r.left - pr.left) / zoom, y: (r.top - pr.top) / zoom, w: r.width / zoom, h: r.height / zoom }
    })
    setRects((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next))
  })

  // ---------- actions ----------
  const actions: CardActions = useMemo(
    () => ({
      save: (id, data) => void store.saveData(id, data).catch((e) => onError((e as Error).message)),
      upload: (f) => store.addMedia(f),
      mediaUrl: (m) => store.mediaUrl(m),
      openBoard: onOpenBoard,
      boardTitle: (id) => snap.boards.find((b) => b.id === id)?.title ?? 'Deleted board',
      boardCount: (id) => snap.cards.filter((c) => c.boardId === id).length,
      boardCover: (id) => snap.cards.find((c) => c.boardId === id && (c.type === 'image' || c.type === 'shot' || c.type === 'slide') && c.data.media)?.data.media ?? null,
      onError
    }),
    [snap, store, onOpenBoard, onError]
  )

  const addCard = useCallback(
    async (type: CardType, at?: { x: number; y: number }) => {
      const p = at ?? visibleCenter()
      const pos = { x: Math.max(20, Math.round(p.x)), y: Math.max(20, Math.round(p.y)) }
      try {
        if (type === 'board') {
          await store.createBoard('New Board', board.id, 'blank', pos)
          return
        }
        if (type === 'image') {
          pendingImage.current = pos
          fileInput.current?.click()
          return
        }
        const data =
          type === 'todo'
            ? { title: '', items: [] }
            : type === 'color'
              ? { hex: '#00b7e2', name: '' }
              : type === 'shot'
                ? { number: String(cards.filter((c) => c.type === 'shot').length + 1), camera: 'Medium', duration: '3', media: null }
                : type === 'slide'
                  ? { number: String(cards.filter((c) => c.type === 'slide').length + 1), media: null }
                  : {}
        const c = await store.addCard({ boardId: board.id, type, ...pos, w: CARD_DEFAULT_WIDTH[type], data })
        setSelected(c.id)
        if (type === 'note') setEditing(c.id)
      } catch (e) {
        onError((e as Error).message)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, board.id, cards, zoom]
  )

  async function addImages(files: FileList | File[], at: { x: number; y: number }) {
    let i = 0
    for (const f of Array.from(files)) {
      if (!f.type.startsWith('image/')) {
        onError(`${f.name} isn’t an image. Studio boards take images; share videos as links.`)
        continue
      }
      try {
        const media: StudioMedia = await store.addMedia(f)
        await store.addCard({ boardId: board.id, type: 'image', x: Math.round(at.x + i * 30), y: Math.round(at.y + i * 30), data: { media, caption: '' } })
        i++
      } catch (e) {
        onError((e as Error).message)
      }
    }
  }

  async function remove(ids: string[]) {
    if (!ids.length) return
    const kinds = ids.map((id) => cards.find((c) => c.id === id)?.type)
    if (kinds.includes('board')) {
      // Removing a board card leaves the board itself (it can be opened from Studio's list).
      const c = cards.find((x) => ids.includes(x.id) && x.type === 'board')
      if (c?.data.boardId) {
        const b = snap.boards.find((x) => x.id === c.data.boardId)
        if (b) await store.updateBoard(b.id, { parentId: '' })
      }
    }
    const removed = await store.deleteCards(ids)
    setSelected(null)
    setUndo({ label: removed.cards.length > 1 ? `Deleted ${removed.cards.length} cards` : 'Deleted a card', removed })
  }

  // Keyboard: delete, escape, duplicate
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, [contenteditable]')) return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
        e.preventDefault()
        void remove([selected])
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedLine) {
        e.preventDefault()
        void store.deleteLine(selectedLine)
        setSelectedLine(null)
      }
      if (e.key === 'Escape') {
        setSelected(null)
        setSelectedLine(null)
        setLineMode(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  useEffect(() => {
    if (!undo) return
    const t = setTimeout(() => setUndo(null), 7000)
    return () => clearTimeout(t)
  }, [undo])

  // ---------- dragging cards ----------
  function startDrag(e: React.PointerEvent, c: StudioCard) {
    if (e.button !== 0) return
    // Line mode: press anywhere on a card to start a line from it
    if (lineMode) {
      e.preventDefault()
      e.stopPropagation()
      const r = rects[c.id]
      setLinking({ from: c.id, x: r ? r.x + r.w / 2 : 0, y: r ? r.y + r.h / 2 : 0 })
      return
    }
    const t = e.target as HTMLElement
    if (t.closest('input, textarea, select, button, a, label, .no-drag, .connector')) return
    const el = cardEls.current.get(c.id)
    if (!el) return
    const r = el.getBoundingClientRect()
    const p = toPlane(e.clientX, e.clientY)
    const cardPos = toPlane(r.left, r.top)
    setDrag({ id: c.id, offX: p.x - cardPos.x, offY: p.y - cardPos.y, x: cardPos.x, y: cardPos.y, moved: false, startX: e.clientX, startY: e.clientY, fromColumn: !!c.parentId })
  }

  function onPointerMove(e: React.PointerEvent) {
    if (linking) {
      const p = toPlane(e.clientX, e.clientY)
      setLinking({ ...linking, x: p.x, y: p.y })
      return
    }
    if (!drag) return
    const moved = drag.moved || Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY) > 4
    const p = toPlane(e.clientX, e.clientY)
    setDrag({ ...drag, x: p.x - drag.offX, y: p.y - drag.offY, moved })
    if (moved) setDropCol(columnUnder(e.clientX, e.clientY, drag.id))
  }

  /** The column (and position in it) under the pointer, if a card can go there. */
  function columnUnder(clientX: number, clientY: number, dragId: string): { id: string; index: number } | null {
    const dragged = cards.find((c) => c.id === dragId)
    if (!dragged || dragged.type === 'column') return null
    const el = document.elementsFromPoint(clientX, clientY).find((n) => (n as HTMLElement).dataset?.col) as HTMLElement | undefined
    if (!el) return null
    const colId = el.dataset.col!
    const kids = childrenOf(colId).filter((k) => k.id !== dragId)
    let index = kids.length
    for (let i = 0; i < kids.length; i++) {
      const kr = cardEls.current.get(kids[i].id)?.getBoundingClientRect()
      if (kr && clientY < kr.top + kr.height / 2) {
        index = i
        break
      }
    }
    return { id: colId, index }
  }

  async function onPointerUp(e: React.PointerEvent) {
    if (linking) {
      const target = (document.elementsFromPoint(e.clientX, e.clientY).find((n) => (n as HTMLElement).dataset?.card) as HTMLElement | undefined)?.dataset.card
      if (target && target !== linking.from && !lines.some((l) => (l.from === linking.from && l.to === target) || (l.to === linking.from && l.from === target))) {
        await store.addLine({ boardId: board.id, from: linking.from, to: target, label: '' }).catch((err) => onError((err as Error).message))
      }
      setLinking(null)
      return
    }
    if (!drag) return
    const d = drag
    setDrag(null)
    setDropCol(null)
    const c = cards.find((x) => x.id === d.id)
    if (!c) return
    if (!d.moved) {
      setSelected(c.id)
      setSelectedLine(null)
      return
    }
    try {
      // Onto a board card: move it into that board
      const boardEl = document.elementsFromPoint(e.clientX, e.clientY).find((n) => (n as HTMLElement).dataset?.boardDrop && (n as HTMLElement).dataset.card !== c.id) as HTMLElement | undefined
      if (boardEl && c.type !== 'column') {
        const target = boardEl.dataset.boardDrop!
        if (target !== board.id && !(c.type === 'board' && c.data.boardId === target)) {
          await store.updateCard(c.id, { boardId: target, parentId: null, x: 80, y: 80 })
          if (c.type === 'board' && c.data.boardId) await store.updateBoard(c.data.boardId, { parentId: target })
          setUndo(null)
          onError('') // clears any message
          return
        }
      }
      // Into a column: insert at the drop position and renumber
      const col = columnUnder(e.clientX, e.clientY, c.id)
      if (col) {
        const kids = childrenOf(col.id).filter((k) => k.id !== c.id)
        kids.splice(col.index, 0, c)
        await store.updateCards(kids.map((k, i) => ({ id: k.id, patch: k.id === c.id ? { parentId: col.id, order: i } : { order: i } })))
        return
      }
      // Anywhere else: place it on the board
      await store.updateCard(c.id, { parentId: null, x: Math.max(0, Math.round(d.x)), y: Math.max(0, Math.round(d.y)) })
    } catch (err) {
      onError((err as Error).message)
    }
  }

  // ---------- rendering ----------
  const renderCard = (c: StudioCard, inColumn = false) => {
    const col = cardColor(c.color)
    const isDragging = drag?.id === c.id && drag.moved
    const style: React.CSSProperties = inColumn
      ? {}
      : { left: isDragging ? drag!.x : c.x, top: isDragging ? drag!.y : c.y, width: c.w }
    if (isDragging && inColumn) return <div key={c.id} className="col-placeholder" />
    const cls = `s-card s-${c.type} ${selected === c.id ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${inColumn ? 'in-col' : ''} ${col.soft ? 'tinted' : ''}`
    return (
      <div
        key={c.id}
        ref={(el) => {
          if (el) cardEls.current.set(c.id, el)
          else cardEls.current.delete(c.id)
        }}
        className={cls}
        style={{ ...style, ...(col.soft ? ({ '--tint': col.soft, '--tint-edge': col.color } as React.CSSProperties) : {}) }}
        data-card={c.id}
        data-board-drop={c.type === 'board' ? c.data.boardId : undefined}
        onPointerDown={(e) => startDrag(e, c)}
        onDoubleClick={(e) => {
          if (c.type === 'note' && !(e.target as HTMLElement).closest('textarea')) setEditing(c.id)
          if (c.type === 'board' && c.data.boardId && !(e.target as HTMLElement).closest('button')) onOpenBoard(c.data.boardId)
        }}
      >
        {c.type === 'column' ? (
          <>
            <div className="col-head">
              <CardBody c={c} editing={false} setEditing={() => {}} />
              <span className="col-count">{childrenOf(c.id).length}</span>
            </div>
            <div className={`col-body ${dropCol?.id === c.id ? 'drop' : ''}`} data-col={c.id}>
              {childrenOf(c.id).map((k, i) => (
                <div key={k.id} className="col-slot">
                  {dropCol?.id === c.id && dropCol.index === i && <div className="drop-marker" />}
                  {renderCard(k, true)}
                </div>
              ))}
              {dropCol?.id === c.id && dropCol.index >= childrenOf(c.id).filter((k) => k.id !== drag?.id).length && <div className="drop-marker" />}
              {!childrenOf(c.id).length && <div className="col-empty">Drag cards here</div>}
            </div>
          </>
        ) : (
          <CardBody c={c} editing={editing === c.id} setEditing={(on) => setEditing(on ? c.id : null)} />
        )}
        {!lineMode && (
          <button
            className="connector no-drag"
            aria-label="Draw a line from this card"
            title="Drag to another card to connect them"
            onPointerDown={(e) => {
              e.stopPropagation()
              e.preventDefault()
              const r = rects[c.id]
              setLinking({ from: c.id, x: r ? r.x + r.w : 0, y: r ? r.y : 0 })
            }}
          />
        )}
        {selected === c.id && !isDragging && (
          <div className="card-bar no-drag" onPointerDown={(e) => e.stopPropagation()}>
            {['note', 'column', 'board', 'todo', 'link'].includes(c.type) &&
              CARD_COLORS.map((k) => (
                <button
                  key={k.id || 'none'}
                  className={`tint-dot ${c.color === k.id ? 'on' : ''}`}
                  style={{ background: k.id ? k.color : 'var(--surface)' }}
                  onClick={() => void store.updateCard(c.id, { color: k.id })}
                  aria-label={`${k.label} color`}
                  title={k.label}
                />
              ))}
            {!c.parentId && (
              <button className="bar-btn" onClick={() => void store.updateCard(c.id, { w: Math.max(140, c.w - 40) })} aria-label="Narrower" title="Narrower">
                −
              </button>
            )}
            {!c.parentId && (
              <button className="bar-btn" onClick={() => void store.updateCard(c.id, { w: Math.min(900, c.w + 40) })} aria-label="Wider" title="Wider">
                +
              </button>
            )}
            {c.parentId && (
              <button className="bar-btn text" onClick={() => void store.updateCard(c.id, { parentId: null, x: (rects[c.parentId!]?.x ?? 0) + (rects[c.parentId!]?.w ?? 300) + 30, y: rects[c.id]?.y ?? 80 })}>
                Take Out
              </button>
            )}
            <button
              className="bar-btn text"
              onClick={() => void store.addCard({ boardId: board.id, type: c.type, x: (rects[c.id]?.x ?? c.x) + 30, y: (rects[c.id]?.y ?? c.y) + 30, w: c.w, color: c.color, data: structuredClone(c.data) })}
            >
              Duplicate
            </button>
            <button className="bar-btn text danger" onClick={() => void remove([c.id])}>
              Delete
            </button>
          </div>
        )}
      </div>
    )
  }

  /** Where a line from rect a toward point p leaves a's edge. */
  const edgePoint = (a: Rect, px: number, py: number) => {
    const cx = a.x + a.w / 2
    const cy = a.y + a.h / 2
    const dx = px - cx
    const dy = py - cy
    if (!dx && !dy) return { x: cx, y: cy }
    const s = Math.min(Math.abs(a.w / 2 / (dx || 1e-9)), Math.abs(a.h / 2 / (dy || 1e-9)))
    return { x: cx + dx * s, y: cy + dy * s }
  }

  const lineGeom = (l: StudioLine) => {
    const a = rects[l.from]
    const b = rects[l.to]
    if (!a || !b) return null
    const p1 = edgePoint(a, b.x + b.w / 2, b.y + b.h / 2)
    const p2 = edgePoint(b, a.x + a.w / 2, a.y + a.h / 2)
    return { p1, p2, mx: (p1.x + p2.x) / 2, my: (p1.y + p2.y) / 2 }
  }

  return (
    <CardContext.Provider value={actions}>
      <div className="studio-board">
        <div className="studio-tools" role="toolbar" aria-label="Add to board">
          {TOOLS.map((t) => (
            <button
              key={t.type}
              className={`tool ${t.type === 'line' && lineMode ? 'on' : ''}`}
              draggable={t.type !== 'line'}
              onDragStart={(e) => {
                e.dataTransfer.setData('application/x-studio-card', t.type)
                e.dataTransfer.effectAllowed = 'copy'
              }}
              onClick={() => (t.type === 'line' ? setLineMode((v) => !v) : void addCard(t.type as CardType))}
              title={t.type === 'line' ? 'Line: drag from one card to another' : `${t.label}: click, or drag onto the board`}
              aria-pressed={t.type === 'line' ? lineMode : undefined}
            >
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                <path d={t.icon} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        <div
          ref={scroller}
          className={`studio-scroll ${lineMode ? 'line-mode' : ''}`}
          onPointerMove={onPointerMove}
          onPointerUp={(e) => void onPointerUp(e)}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('application/x-studio-card') || e.dataTransfer.types.includes('Files')) e.preventDefault()
          }}
          onDrop={(e) => {
            const type = e.dataTransfer.getData('application/x-studio-card') as CardType
            const p = toPlane(e.clientX, e.clientY)
            if (type) {
              e.preventDefault()
              void addCard(type, { x: p.x - 40, y: p.y - 20 })
            } else if (e.dataTransfer.files.length) {
              e.preventDefault()
              void addImages(e.dataTransfer.files, p)
            }
          }}
        >
          <div className="studio-sizer" style={{ width: size.w * zoom, height: size.h * zoom }}>
            <div
              ref={plane}
              className="studio-plane"
              style={{ width: size.w, height: size.h, transform: `scale(${zoom})` }}
              onPointerDown={(e) => {
                if (e.target === e.currentTarget) {
                  setSelected(null)
                  setSelectedLine(null)
                  setEditing(null)
                }
              }}
              onDoubleClick={(e) => {
                if (e.target !== e.currentTarget) return
                const p = toPlane(e.clientX, e.clientY)
                void addCard('note', { x: p.x - 20, y: p.y - 20 })
              }}
            >
              <svg className="studio-lines" width={size.w} height={size.h} aria-hidden="true">
                <defs>
                  <marker id="arrowhead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M0 0L10 5L0 10z" fill="currentColor" />
                  </marker>
                </defs>
                {lines.map((l) => {
                  const g = lineGeom(l)
                  if (!g) return null
                  return (
                    <g key={l.id} className={`s-line ${selectedLine === l.id ? 'on' : ''}`}>
                      <line x1={g.p1.x} y1={g.p1.y} x2={g.p2.x} y2={g.p2.y} className="hit" onPointerDown={() => (setSelectedLine(l.id), setSelected(null))} />
                      <line x1={g.p1.x} y1={g.p1.y} x2={g.p2.x} y2={g.p2.y} markerEnd="url(#arrowhead)" />
                    </g>
                  )
                })}
                {linking && rects[linking.from] && (
                  <line className="s-line pending" x1={rects[linking.from].x + rects[linking.from].w / 2} y1={rects[linking.from].y + rects[linking.from].h / 2} x2={linking.x} y2={linking.y} markerEnd="url(#arrowhead)" />
                )}
              </svg>
              {lines.map((l) => {
                const g = lineGeom(l)
                if (!g || (!l.label && selectedLine !== l.id)) return null
                return selectedLine === l.id ? (
                  <div key={l.id} className="line-edit" style={{ left: g.mx, top: g.my }}>
                    <input
                      autoFocus
                      defaultValue={l.label}
                      placeholder="Label"
                      aria-label="Line label"
                      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                      onBlur={(e) => e.target.value !== l.label && void store.updateLine(l.id, e.target.value.slice(0, 80))}
                    />
                    <button onClick={() => (void store.deleteLine(l.id), setSelectedLine(null))}>Delete Line</button>
                  </div>
                ) : (
                  <span key={l.id} className="line-label" style={{ left: g.mx, top: g.my }} onPointerDown={() => setSelectedLine(l.id)}>
                    {l.label}
                  </span>
                )
              })}
              {free.map((c) => renderCard(c))}
              {drag?.moved && drag.fromColumn && (() => {
                const c = cards.find((x) => x.id === drag.id)
                return c ? <div className="s-card dragging ghost" style={{ left: drag.x, top: drag.y, width: rects[c.id]?.w ?? c.w }}><CardBody c={c} editing={false} setEditing={() => {}} /></div> : null
              })()}
              {!cards.length && <div className="studio-empty">Double-click anywhere to write a note, or drag something in from the toolbar.</div>}
            </div>
          </div>
        </div>

        <div className="zoom-bar" role="group" aria-label="Zoom">
          <button onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.1).toFixed(1)))} aria-label="Zoom out">
            −
          </button>
          <button className="pct" onClick={() => setZoom(1)} title="Back to 100%">
            {Math.round(zoom * 100)}%
          </button>
          <button onClick={() => setZoom((z) => Math.min(1.6, +(z + 0.1).toFixed(1)))} aria-label="Zoom in">
            +
          </button>
        </div>
        {lineMode && <div className="mode-hint">Drag from one card to another to connect them. Press Esc when you’re done.</div>}
        {undo && (
          <div className="undo-toast" role="status">
            {undo.label}
            <button
              onClick={() => {
                void store.restore(undo.removed)
                setUndo(null)
              }}
            >
              Undo
            </button>
          </div>
        )}
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) void addImages(e.target.files, pendingImage.current ?? visibleCenter())
            e.target.value = ''
          }}
        />
      </div>
    </CardContext.Provider>
  )
}
