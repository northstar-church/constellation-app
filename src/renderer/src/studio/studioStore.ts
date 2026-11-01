import { newId } from '../data/constants'
import type { PostMedia } from '../data/social'
import { CARD_DEFAULT_WIDTH, cardsFromTemplate, rootBoard, type BoardVisibility, type CardData, type StudioBoard, type StudioCard, type StudioLine, type StudioMedia, type StudioSnapshot, type TemplateId } from '../data/studio'
import { call, download, subscribeLive, upload } from '../data/cloudStore'
import { art } from '../social/socialStore'

export type NewCard = Pick<StudioCard, 'boardId' | 'type' | 'x' | 'y'> & Partial<Omit<StudioCard, 'id' | 'boardId' | 'type' | 'x' | 'y' | 'updatedAt' | 'updatedBy'>>

export interface StudioStore {
  mode: 'demo' | 'cloud'
  load(): Promise<StudioSnapshot>
  subscribe(onChange: () => void): () => void
  /** A new board (inside `parentId` when given, with a board card placed at x/y there) */
  createBoard(title: string, parentId: string, template: TemplateId, at?: { x: number; y: number }, visibility?: BoardVisibility): Promise<StudioBoard>
  /** A new top-level board filled with the given cards (used to plan a post in Studio) */
  seedBoard(title: string, visibility: BoardVisibility, cards: Omit<NewCard, 'boardId'>[]): Promise<StudioBoard>
  updateBoard(id: string, patch: Partial<Pick<StudioBoard, 'title' | 'color' | 'parentId' | 'visibility'>>): Promise<void>
  /** Deletes the board, everything on it and every board inside it */
  deleteBoard(id: string): Promise<void>
  addCard(card: NewCard): Promise<StudioCard>
  updateCard(id: string, patch: Partial<Omit<StudioCard, 'id' | 'data'>>): Promise<void>
  /** Saves just the changed fields of a card's content (so two people editing different fields don't collide) */
  saveData(id: string, data: Partial<CardData>): Promise<void>
  /** Several cards at once (moving a column, reordering a stack) */
  updateCards(patches: { id: string; patch: Partial<Omit<StudioCard, 'id'>> }[]): Promise<void>
  /** Removes cards (a column's cards go with it) and their lines; returns what was removed, for undo */
  deleteCards(ids: string[]): Promise<{ cards: StudioCard[]; lines: StudioLine[] }>
  /** Puts back what deleteCards removed */
  restore(removed: { cards: StudioCard[]; lines: StudioLine[] }): Promise<void>
  addLine(line: Omit<StudioLine, 'id'>): Promise<StudioLine>
  updateLine(id: string, label: string): Promise<void>
  deleteLine(id: string): Promise<void>
  addMedia(file: File): Promise<StudioMedia>
  mediaUrl(m: StudioMedia): Promise<string>
  /** Copies a post's images into Studio so they can go on a board */
  importPostMedia(media: PostMedia[]): Promise<StudioMedia[]>
}

// ---------- cloud: shared with the team, live ----------

export function createCloudStudioStore(): StudioStore {
  const blobs = new Map<string, Promise<string>>()
  const patchCards = (patches: { id: string; patch: Partial<Omit<StudioCard, 'id'>> }[]) => call('/api/studio/cards', 'PATCH', { patches }).then(() => undefined)
  return {
    mode: 'cloud',
    load: () => call<StudioSnapshot>('/api/studio'),
    subscribe: (onChange) => subscribeLive(['studio'], onChange),
    createBoard: (title, parentId, template, at, visibility) => call<StudioBoard>('/api/studio/boards', 'POST', { title, parentId, template, at, visibility }),
    seedBoard: (title, visibility, cards) => call<StudioBoard>('/api/studio/boards', 'POST', { title, parentId: '', template: 'blank', visibility, cards }),
    updateBoard: (id, patch) => call(`/api/studio/boards/${id}`, 'PATCH', patch).then(() => undefined),
    deleteBoard: (id) => call(`/api/studio/boards/${id}`, 'DELETE').then(() => undefined),
    addCard: (card) => call<StudioCard>('/api/studio/cards', 'POST', card),
    updateCard: (id, patch) => patchCards([{ id, patch }]),
    saveData: (id, data) => call(`/api/studio/cards/${id}/data`, 'PATCH', data).then(() => undefined),
    updateCards: patchCards,
    deleteCards: (ids) => call<{ cards: StudioCard[]; lines: StudioLine[] }>('/api/studio/cards/delete', 'POST', { ids }),
    restore: (removed) => call('/api/studio/restore', 'POST', removed).then(() => undefined),
    addLine: (line) => call<StudioLine>('/api/studio/lines', 'POST', line),
    updateLine: (id, label) => call(`/api/studio/lines/${id}`, 'PATCH', { label }).then(() => undefined),
    deleteLine: (id) => call(`/api/studio/lines/${id}`, 'DELETE').then(() => undefined),
    addMedia: (file) => upload<StudioMedia>(`/api/studio/media?name=${encodeURIComponent(file.name)}`, file),
    mediaUrl(m) {
      if (!m.url.startsWith('/api/')) return Promise.resolve(m.url)
      let p = blobs.get(m.id)
      if (!p) {
        p = download(m.url).then((b) => URL.createObjectURL(b))
        p.catch(() => blobs.delete(m.id))
        blobs.set(m.id, p)
      }
      return p
    },
    importPostMedia: async (media) => {
      const ids = media.filter((m) => m.kind === 'image').map((m) => m.id)
      return ids.length ? (await call<{ media: StudioMedia[] }>('/api/studio/media/from-posts', 'POST', { ids })).media : []
    }
  }
}

// ---------- demo: sample boards saved only in this browser ----------

const KEY = 'constellation.studio.v3'

function demoSnapshot(): StudioSnapshot {
  const by = 'Jeremy Thompson'
  const now = new Date().toISOString()
  const board = (title: string, color = '', parentId = '', visibility: BoardVisibility = 'team'): StudioBoard => ({ id: newId(), title, parentId, color, visibility, owner: by, createdAt: now, updatedAt: now, updatedBy: by })
  const img = (label: string, hue: number, w = 1000, h = 800): StudioMedia => ({ id: newId(), name: `${label}.jpg`, url: art(label, hue, w, h) })

  const brief = board('Christmas at NorthStar: Brief', 'sun')
  const refs = board('Christmas References', 'rose', brief.id)
  const story = board('Christmas Promo Video', 'sky')
  const carousel = board('Advent Carousel', 'leaf')
  const mood = board('Christmas Mood Board', 'plum')
  const blank = board('WAVE Fall Kickoff Ideas', '', '', 'private')

  const cards: StudioCard[] = []
  const fill = (b: StudioBoard, t: TemplateId, edit: (cs: StudioCard[]) => void) => {
    const cs = cardsFromTemplate(b.id, t, by)
    edit(cs)
    cards.push(...cs)
  }
  fill(brief, 'brief', (cs) => {
    const note = (start: string) => cs.find((c) => c.type === 'note' && c.data.text?.startsWith(start))!
    note('Project').data.text = 'Project: Christmas at NorthStar\nRequested by: Stephanie Ford\nDue: Nov 16'
    note('## Goal').data.text = '## Goal\nInvite the whole community to Christmas services, especially people who haven’t been to church in a while.'
    note('## Audience').data.text = '## Audience\n- Families with young kids\n- Members inviting neighbors\n- People searching “Christmas Eve service near me”'
    note('## Key message').data.text = '## Key message\n**There’s a seat for you this Christmas.**'
    note('## Deliverables').data.text = '## Deliverables\n- Balcony banners (2)\n- Invite cards\n- Social carousel + 2 reels\n- Website hero'
    note('## Tone').data.text = '## Tone & feel\nWarm, homecoming, joyful'
    cs.push({ ...cs[0], id: newId(), type: 'board', x: 1020, y: 330, w: 200, color: 'rose', data: { boardId: refs.id }, parentId: null, order: 0 })
    cs.push({ ...cs[0], id: newId(), type: 'image', x: 1020, y: 600, w: 300, data: { media: img('Lobby lights', 30), caption: 'Last year’s lobby' }, parentId: null, order: 0 })
  })
  fill(refs, 'blank', (cs) => {
    const base = { boardId: refs.id, parentId: null, order: 0, color: '', updatedAt: now, updatedBy: by }
    cs.push(
      { ...base, id: newId(), type: 'image', x: 60, y: 60, w: 280, data: { media: img('Candlelight', 40), caption: '' } },
      { ...base, id: newId(), type: 'image', x: 370, y: 60, w: 280, data: { media: img('Warm wreath', 355), caption: '' } },
      { ...base, id: newId(), type: 'link', x: 680, y: 60, w: 260, data: { url: 'https://northstarchurch.org/christmas', title: 'Christmas page (current)' } }
    )
  })
  fill(story, 'storyboard', (cs) => {
    const shots = cs.filter((c) => c.type === 'shot')
    const plan: [string, string, string, string, number][] = [
      ['Family walks up to the doors at dusk, lights glowing.', '(Music builds)', 'Wide', '4', 210],
      ['Greeter opens the door, smiles at camera.', '“Welcome home.”', 'Medium', '3', 30],
      ['Kids light candles in the auditorium.', 'VO: “This Christmas, there’s a seat for you.”', 'Close-up', '4', 45],
      ['Title card with service times.', 'VO: “Christmas at NorthStar.”', 'Insert', '3', 200]
    ]
    shots.forEach((s, i) => {
      const [action, dialogue, camera, duration, hue] = plan[i]
      s.data = { ...s.data, action, dialogue, camera, duration, media: i < 3 ? img(`Shot ${i + 1}`, hue, 960, 540) : null }
    })
    cs.find((c) => c.type === 'note')!.data.text = 'Length: 0:15\nAspect: 16:9 (cut a 9:16 for reels)\nMusic: piano, builds at shot 3'
  })
  fill(carousel, 'carousel', (cs) => {
    const caps = ['Christmas is coming ✨', 'Dec 21–24 · 4 services', 'Kids programs at every service', 'Bring someone with you', 'Find a time: link in bio']
    cs.filter((c) => c.type === 'slide').forEach((s, i) => (s.data = { ...s.data, caption: caps[i], media: i < 4 ? img(`Slide ${i + 1}`, 140 + i * 25, 800, 1000) : null }))
  })
  fill(mood, 'mood', (cs) => {
    const base = { boardId: mood.id, parentId: null, order: 0, color: '', updatedAt: now, updatedBy: by }
    cs.push(
      { ...base, id: newId(), type: 'image', x: 760, y: 140, w: 300, data: { media: img('Golden hour', 35), caption: '' } },
      { ...base, id: newId(), type: 'image', x: 760, y: 420, w: 300, data: { media: img('Snow', 210), caption: '' } },
      { ...base, id: newId(), type: 'color', x: 600, y: 140, w: 140, data: { hex: '#c99a0e', name: 'Gold' } }
    )
  })
  fill(blank, 'blank', (cs) => {
    const base = { boardId: blank.id, parentId: null, order: 0, updatedAt: now, updatedBy: by }
    cs.push(
      { ...base, id: newId(), type: 'note', x: 80, y: 80, w: 260, color: 'sky', data: { text: '## Theme ideas\n- Glow night\n- Back to school bash' } },
      { ...base, id: newId(), type: 'todo', x: 380, y: 80, w: 260, color: '', data: { title: 'To do', items: [{ id: newId(), text: 'Book the gym', done: true }, { id: newId(), text: 'Shirt design', done: false }] } }
    )
  })

  const lines: StudioLine[] = []
  const shots = cards.filter((c) => c.boardId === story.id && c.type === 'shot')
  for (let i = 0; i < shots.length - 1; i++) lines.push({ id: newId(), boardId: story.id, from: shots[i].id, to: shots[i + 1].id, label: '' })
  return { boards: [brief, refs, story, carousel, mood, blank], cards, lines }
}

export function createLocalStudioStore(me: () => string): StudioStore {
  let state: StudioSnapshot
  try {
    state = JSON.parse(localStorage.getItem(KEY) ?? 'null') ?? demoSnapshot()
  } catch {
    state = demoSnapshot()
  }
  const listeners = new Set<() => void>()
  const commit = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state))
    } catch {
      /* storage full or blocked: changes last until the page reloads */
    }
    listeners.forEach((l) => l())
  }
  const stamp = () => ({ updatedAt: new Date().toISOString(), updatedBy: me() })
  const boardTree = (id: string): string[] => [id, ...state.boards.filter((b) => b.parentId === id).flatMap((b) => boardTree(b.id))]

  return {
    mode: 'demo',
    load: async () => {
      // Private boards (and everything inside them) only show for their owner
      const hidden = new Set(state.boards.filter((b) => rootBoard(state.boards, b.id)?.visibility === 'private' && rootBoard(state.boards, b.id)?.owner !== me()).map((b) => b.id))
      return structuredClone({
        boards: state.boards.filter((b) => !hidden.has(b.id)),
        cards: state.cards.filter((c) => !hidden.has(c.boardId)),
        lines: state.lines.filter((l) => !hidden.has(l.boardId))
      })
    },
    subscribe(onChange) {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    },
    async createBoard(title, parentId, template, at, visibility = 'team') {
      const now = new Date().toISOString()
      const b: StudioBoard = { id: newId(), title: title.trim() || 'Untitled Board', parentId, color: '', visibility: parentId ? 'team' : visibility, owner: me(), createdAt: now, updatedAt: now, updatedBy: me() }
      const cards = cardsFromTemplate(b.id, template, me())
      if (parentId) cards.push({ id: newId(), boardId: parentId, type: 'board', x: at?.x ?? 80, y: at?.y ?? 80, w: CARD_DEFAULT_WIDTH.board, parentId: null, order: 0, color: '', data: { boardId: b.id }, ...stamp() })
      state = { ...state, boards: [...state.boards, b], cards: [...state.cards, ...cards] }
      commit()
      return b
    },
    async seedBoard(title, visibility, seeds) {
      const now = new Date().toISOString()
      const b: StudioBoard = { id: newId(), title: title.trim() || 'Untitled Board', parentId: '', color: '', visibility, owner: me(), createdAt: now, updatedAt: now, updatedBy: me() }
      const cards = seeds.map((c): StudioCard => ({ w: CARD_DEFAULT_WIDTH[c.type], parentId: null, order: 0, color: '', data: {}, ...c, boardId: b.id, id: newId(), ...stamp() }))
      state = { ...state, boards: [...state.boards, b], cards: [...state.cards, ...cards] }
      commit()
      return b
    },
    async updateBoard(id, patch) {
      state = { ...state, boards: state.boards.map((b) => (b.id === id ? { ...b, ...patch, ...stamp() } : b)) }
      commit()
    },
    async deleteBoard(id) {
      const gone = new Set(boardTree(id))
      state = {
        boards: state.boards.filter((b) => !gone.has(b.id)),
        cards: state.cards.filter((c) => !gone.has(c.boardId) && !(c.type === 'board' && c.data.boardId && gone.has(c.data.boardId))),
        lines: state.lines.filter((l) => !gone.has(l.boardId))
      }
      commit()
    },
    async addCard(card) {
      const c: StudioCard = { w: CARD_DEFAULT_WIDTH[card.type], parentId: null, order: 0, color: '', data: {}, ...card, id: newId(), ...stamp() }
      state = { ...state, cards: [...state.cards, c] }
      commit()
      return c
    },
    async updateCard(id, patch) {
      state = { ...state, cards: state.cards.map((c) => (c.id === id ? { ...c, ...patch, ...stamp() } : c)) }
      commit()
    },
    async saveData(id, data) {
      state = { ...state, cards: state.cards.map((c) => (c.id === id ? { ...c, data: { ...c.data, ...data }, ...stamp() } : c)) }
      commit()
    },
    async updateCards(patches) {
      const m = new Map(patches.map((p) => [p.id, p.patch]))
      state = { ...state, cards: state.cards.map((c) => (m.has(c.id) ? { ...c, ...m.get(c.id), ...stamp() } : c)) }
      commit()
    },
    async deleteCards(ids) {
      const set = new Set(ids)
      for (const c of state.cards) if (c.parentId && set.has(c.parentId)) set.add(c.id)
      const cards = state.cards.filter((c) => set.has(c.id))
      const lines = state.lines.filter((l) => set.has(l.from) || set.has(l.to))
      state = { ...state, cards: state.cards.filter((c) => !set.has(c.id)), lines: state.lines.filter((l) => !lines.includes(l)) }
      commit()
      return { cards, lines }
    },
    async restore(removed) {
      state = { ...state, cards: [...state.cards, ...removed.cards], lines: [...state.lines, ...removed.lines] }
      commit()
    },
    async addLine(line) {
      const l = { ...line, id: newId() }
      state = { ...state, lines: [...state.lines, l] }
      commit()
      return l
    },
    async updateLine(id, label) {
      state = { ...state, lines: state.lines.map((l) => (l.id === id ? { ...l, label } : l)) }
      commit()
    },
    async deleteLine(id) {
      state = { ...state, lines: state.lines.filter((l) => l.id !== id) }
      commit()
    },
    async addMedia(file) {
      // Small images survive a reload in the preview; larger ones last for this session.
      const url =
        file.size < 900_000
          ? await new Promise<string>((res, rej) => {
              const r = new FileReader()
              r.onload = () => res(String(r.result))
              r.onerror = () => rej(new Error('Couldn’t read that image.'))
              r.readAsDataURL(file)
            })
          : URL.createObjectURL(file)
      return { id: newId(), name: file.name, url }
    },
    mediaUrl: async (m) => m.url,
    importPostMedia: async (media) => media.filter((m) => m.kind === 'image').map((m) => ({ id: newId(), name: m.name, url: m.url }))
  }
}
