import { format, formatDistanceToNow, parseISO } from 'date-fns'
import { tintBg } from '../data/tint'
import { useEffect, useMemo, useState } from 'react'
import { IconChevron, IconClose, IconLock, IconPeople, IconPlus } from '../components/Icons'
import { platformById, type SocialPost } from '../data/social'
import { canChangeVisibility, CARD_COLORS, cardColor, rootBoard, TEMPLATES, type BoardVisibility, type StudioBoard, type StudioMedia, type StudioSnapshot, type TemplateId } from '../data/studio'
import { PlatformIcon } from '../social/PlatformIcon'
import type { SocialStore } from '../social/socialStore'
import type { TeamMember } from '../data/requests'
import { BoardCanvas } from './BoardCanvas'
import { PostFromBoard } from './PostFromBoard'
import type { StudioStore } from './studioStore'

interface Props {
  store: StudioStore
  query: string
  /** The signed-in person's name (owner of their private boards) */
  me: string
  /** Posting Calendar, for making posts from boards and showing linked posts */
  social?: SocialStore | null
  /** Open this board (from a post) */
  focus?: { boardId: string; n: number } | null
  onCreatePost?: (seed: Partial<SocialPost>) => void
  /** Only the social media director makes posts */
  canPost?: boolean
  /** Preview only: switch who you're looking as */
  viewingAs?: { name: string; team: TeamMember[]; set: (name: string) => void }
  onOpenPost?: (id: string) => void
}

function Cover({ media, store }: { media: StudioMedia | null; store: StudioStore }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    if (media) store.mediaUrl(media).then(setSrc).catch(() => {})
  }, [media, store])
  return src ? <img src={src} alt="" /> : null
}

export function StudioPage({ store, query, me, social, focus, onCreatePost, onOpenPost, canPost = false, viewingAs }: Props) {
  const [snap, setSnap] = useState<StudioSnapshot | null>(null)
  const [path, setPath] = useState<string[]>([]) // open board and the boards above it
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [menu, setMenu] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [posts, setPosts] = useState<SocialPost[]>([])
  const [makingPost, setMakingPost] = useState(false)

  useEffect(() => {
    if (!social) return
    const load = () => social.load().then(setPosts).catch(() => {})
    void load()
    return social.subscribe(load)
  }, [social])

  useEffect(() => {
    const load = () => store.load().then(setSnap).catch((e) => setError((e as Error).message))
    void load()
    return store.subscribe(load)
  }, [store, me])
  useEffect(() => {
    if (!error) return
    const t = setTimeout(() => setError(''), 6000)
    return () => clearTimeout(t)
  }, [error])

  const boards = snap?.boards ?? []
  const current = boards.find((b) => b.id === path[path.length - 1]) ?? null
  // If the open board disappears (a teammate deleted it), go back to the list
  useEffect(() => {
    if (snap && path.length && !current) setPath([])
  }, [snap, path, current])

  const openBoardIn = (list: StudioBoard[], id: string) => {
    const chain: string[] = []
    let b = list.find((x) => x.id === id)
    while (b && !chain.includes(b.id)) {
      chain.unshift(b.id)
      b = b.parentId ? list.find((x) => x.id === b!.parentId) : undefined
    }
    setPath(chain.length ? chain : [id])
  }
  const openBoard = (id: string) => openBoardIn(boards, id)

  // A post's "Open in Studio": load fresh (the board may have just been made), then open it
  useEffect(() => {
    if (!focus) return
    store
      .load()
      .then((s) => {
        setSnap(s)
        if (s.boards.some((b) => b.id === focus.boardId)) openBoardIn(s.boards, focus.boardId)
        else setError('That board is private, or it was deleted.')
      })
      .catch((e) => setError((e as Error).message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.n])

  const isPrivate = (id: string) => rootBoard(boards, id)?.visibility === 'private'
  const toggleVisibility = (b: StudioBoard) =>
    void store.updateBoard(b.id, { visibility: b.visibility === 'private' ? 'team' : 'private' }).catch((e) => setError((e as Error).message))

  const coverOf = (id: string) => snap?.cards.find((c) => c.boardId === id && (c.type === 'image' || c.type === 'shot' || c.type === 'slide') && c.data.media)?.data.media ?? null
  const countOf = (id: string) => snap?.cards.filter((c) => c.boardId === id).length ?? 0
  const q = query.trim().toLowerCase()
  const listed = useMemo(() => {
    const top = boards.filter((b) => !b.parentId || q)
    if (!q) return top
    // Searching looks inside boards too: titles and card text
    return boards.filter((b) => b.title.toLowerCase().includes(q) || snap?.cards.some((c) => c.boardId === b.id && JSON.stringify(c.data).toLowerCase().includes(q)))
  }, [boards, q, snap])

  const linked = current ? posts.filter((p) => p.boardId === current.id) : []

  if (current && snap) {
    return (
      <main className="main studio">
        <div className="page-head studio-head">
          <nav className="studio-crumbs" aria-label="Boards">
            <button onClick={() => setPath([])}>Creative Studio</button>
            {path.map((id) => {
              const b = boards.find((x) => x.id === id)
              return b ? (
                <span key={id} className="crumb">
                  <IconChevron dir="right" size={16} />
                  {id === current.id ? (
                    <TitleInput board={b} store={store} />
                  ) : (
                    <button onClick={() => setPath(path.slice(0, path.indexOf(id) + 1))}>{b.title}</button>
                  )}
                </span>
              ) : null
            })}
          </nav>
          <span className="grow" />
          {(() => {
            const root = rootBoard(boards, current.id) ?? current
            const priv = root.visibility === 'private'
            const top = !current.parentId
            const can = top && canChangeVisibility(current, me)
            return (
              <button
                className={`vis-pill ${priv ? 'private' : ''}`}
                disabled={!can}
                onClick={() => toggleVisibility(current)}
                title={
                  !top
                    ? `Follows “${root.title}”: ${priv ? 'only you can see it' : 'the whole team can see it'}`
                    : !can
                      ? `${current.owner.split(' ')[0]} made this board; only they can change who sees it`
                      : priv
                        ? 'Only you can see this board. Click to share it with the team.'
                        : 'The whole team can see this board. Click to make it private.'
                }
              >
                {priv ? <IconLock size={16} /> : <IconPeople size={16} />} {priv ? 'Private' : 'Team'}
              </button>
            )
          })()}
          {linked.map((p) => (
            <button key={p.id} className="linked-post" onClick={() => onOpenPost?.(p.id)} title={`${platformById(p.platform).label} post${p.date ? ` · ${format(parseISO(p.date), 'MMM d')}` : ''} · ${p.status}`}>
              <PlatformIcon id={p.platform} size={18} />
              {p.date ? format(parseISO(p.date), 'MMM d') : 'No date'}
            </button>
          ))}
          {social && onCreatePost && canPost && (
            <button className="btn-primary sm" onClick={() => setMakingPost(true)}>
              Create Post <IconPlus size={16} />
            </button>
          )}
        </div>
        {error && <div className="banner warn">{error}</div>}
        {makingPost && social && onCreatePost && (
          <PostFromBoard
            board={current}
            snap={snap}
            studio={store}
            social={social}
            onClose={() => setMakingPost(false)}
            onError={setError}
            onContinue={(seed) => {
              setMakingPost(false)
              onCreatePost(seed)
            }}
          />
        )}
        <BoardCanvas key={current.id} board={current} snap={snap} store={store} onOpenBoard={openBoard} onError={(m) => setError(m)} />
      </main>
    )
  }

  const teamBoards = listed.filter((b) => !isPrivate(b.id))
  const privateBoards = listed.filter((b) => isPrivate(b.id))

  const tiles = (list: StudioBoard[]) => (
    <div className="board-grid">
      {list.map((b) => {
        const col = cardColor(b.color)
        const priv = isPrivate(b.id)
        return (
          <div key={b.id} className="board-tile-card">
            <button className="btc-open" onClick={() => openBoard(b.id)}>
              <span className="btc-cover" style={{ background: col.soft ? tintBg(col.soft, col.color) : 'var(--surface-2)' }}>
                <Cover media={coverOf(b.id)} store={store} />
                {!coverOf(b.id) && <span className="board-glyph" style={{ background: col.id ? col.color : 'var(--faint)' }} />}
                {priv && (
                  <span className="btc-lock" title="Private: only you can see it">
                    <IconLock size={15} />
                  </span>
                )}
              </span>
              <span className="btc-text">
                <b>{b.title}</b>
                <span className="muted-sm">
                  {countOf(b.id)} cards · {b.updatedBy.split(' ')[0]} {formatDistanceToNow(parseISO(b.updatedAt), { addSuffix: true })}
                  {b.parentId ? ` · in ${boards.find((x) => x.id === b.parentId)?.title ?? 'a board'}` : ''}
                </span>
              </span>
            </button>
            <button className="btc-menu" onClick={() => setMenu(menu === b.id ? null : b.id)} aria-label={`Options for ${b.title}`}>
              •••
            </button>
            {menu === b.id && (
              <div className="btc-pop" onMouseLeave={() => (setMenu(null), setConfirmDelete(null))}>
                <div className="tint-row">
                  {CARD_COLORS.map((k) => (
                    <button
                      key={k.id || 'none'}
                      className={`tint-dot ${b.color === k.id ? 'on' : ''}`}
                      style={{ background: k.id ? k.color : 'var(--surface)' }}
                      onClick={() => void store.updateBoard(b.id, { color: k.id })}
                      aria-label={`${k.label} color`}
                    />
                  ))}
                </div>
                {!b.parentId && canChangeVisibility(b, me) && (
                  <button
                    className="btn"
                    onClick={() => {
                      toggleVisibility(b)
                      setMenu(null)
                    }}
                  >
                    {b.visibility === 'private' ? (
                      <>
                        <IconPeople size={16} /> Share With Team
                      </>
                    ) : (
                      <>
                        <IconLock size={16} /> Make Private
                      </>
                    )}
                  </button>
                )}
                {confirmDelete === b.id ? (
                  <button className="btn danger" onClick={() => void store.deleteBoard(b.id).then(() => setMenu(null))}>
                    Delete board and {countOf(b.id)} cards
                  </button>
                ) : (
                  <button className="btn danger" onClick={() => setConfirmDelete(b.id)}>
                    Delete Board
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )

  return (
    <main className="main studio">
      <div className="page-head">
        <h1>Creative Studio</h1>
        <button className="btn-primary" onClick={() => setCreating(true)}>
          New Board <IconPlus size={18} />
        </button>
      </div>
      {store.mode === 'demo' && (
        <div className="banner demo-as">
          <span>Preview with sample boards, saved only in this browser.</span>
          {viewingAs && (
            <label>
              Viewing as{' '}
              <select value={viewingAs.name} onChange={(e) => viewingAs.set(e.target.value)} aria-label="Viewing as">
                {viewingAs.team.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      {error && <div className="banner warn">{error}</div>}
      {q && <div className="banner">Boards matching “{query}” · {listed.length}</div>}
      <div className="content">
        {!snap ? (
          <div className="empty">Loading…</div>
        ) : !listed.length ? (
          <div className="empty">{q ? 'No boards match.' : 'No boards yet. Start one from a template.'}</div>
        ) : q ? (
          tiles(listed)
        ) : (
          <>
            <section className="board-section">
              <h2>
                <IconPeople size={20} /> Team Boards <span className="muted-sm">Everyone on the creative team can see and edit these.</span>
              </h2>
              {teamBoards.length ? tiles(teamBoards) : <div className="empty sm">No team boards yet.</div>}
            </section>
            <section className="board-section">
              <h2>
                <IconLock size={20} /> Private <span className="muted-sm">Only you can see these.</span>
              </h2>
              {privateBoards.length ? tiles(privateBoards) : <div className="empty sm">Boards you make private show up here, just for you.</div>}
            </section>
          </>
        )}
      </div>
      {creating && (
        <NewBoard
          onClose={() => setCreating(false)}
          onCreate={async (title, t, visibility) => {
            try {
              const b = await store.createBoard(title, '', t, undefined, visibility)
              // Have the new board (and its template cards) in hand before opening it
              setSnap(await store.load())
              setCreating(false)
              setPath([b.id])
            } catch (e) {
              setError((e as Error).message)
            }
          }}
        />
      )}
    </main>
  )
}

function TitleInput({ board, store }: { board: StudioBoard; store: StudioStore }) {
  const [v, setV] = useState(board.title)
  useEffect(() => setV(board.title), [board.title])
  return (
    <input
      className="board-title-input"
      value={v}
      size={Math.max(8, v.length)}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v.trim() && v !== board.title && void store.updateBoard(board.id, { title: v.trim().slice(0, 120) })}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      aria-label="Board name"
    />
  )
}

function NewBoard({ onClose, onCreate }: { onClose: () => void; onCreate: (title: string, t: TemplateId, visibility: BoardVisibility) => void }) {
  const [t, setT] = useState<TemplateId>('brief')
  const [visibility, setVisibility] = useState<BoardVisibility>('team')
  const [title, setTitle] = useState('')
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="modal"
        role="dialog"
        aria-label="New board"
        onSubmit={(e) => {
          e.preventDefault()
          onCreate(title || TEMPLATES.find((x) => x.id === t)!.label, t, visibility)
        }}
      >
        <div className="modal-head">
          <h2>New Board</h2>
          <button type="button" className="round-btn" onClick={onClose} aria-label="Close">
            <IconClose size={20} />
          </button>
        </div>
        <div className="modal-body">
          <label className="field">
            <span>Name</span>
            <input id="board-name" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Easter 2027: Brief" />
          </label>
          <div className="field">
            <span>Who can see it</span>
            <div className="vis-choice" role="radiogroup" aria-label="Who can see it">
              <button type="button" role="radio" aria-checked={visibility === 'team'} className={visibility === 'team' ? 'on' : ''} onClick={() => setVisibility('team')}>
                <IconPeople size={20} />
                <b>Team</b>
                <span className="muted-sm">Everyone on the creative team can see and edit it.</span>
              </button>
              <button type="button" role="radio" aria-checked={visibility === 'private'} className={visibility === 'private' ? 'on' : ''} onClick={() => setVisibility('private')}>
                <IconLock size={20} />
                <b>Private</b>
                <span className="muted-sm">Only you. Share it with the team anytime.</span>
              </button>
            </div>
          </div>
          <div className="field">
            <span>Start from</span>
            <div className="template-grid" role="radiogroup" aria-label="Template">
              {TEMPLATES.map((x) => (
                <button key={x.id} type="button" role="radio" aria-checked={t === x.id} className={`template ${t === x.id ? 'on' : ''}`} onClick={() => setT(x.id)}>
                  <span className={`template-art t-${x.id}`} aria-hidden="true">
                    {Array.from({ length: x.id === 'carousel' ? 5 : x.id === 'storyboard' ? 4 : x.id === 'brief' ? 3 : x.id === 'mood' ? 6 : 0 }, (_, i) => (
                      <i key={i} />
                    ))}
                  </span>
                  <b>{x.label}</b>
                  <span className="muted-sm">{x.blurb}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <span className="grow" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary sm" type="submit">
            Create Board
          </button>
        </div>
      </form>
    </div>
  )
}
