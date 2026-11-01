import { newId } from './constants'

// Creative Studio: Milanote-style boards of cards on a free canvas.

export type CardType = 'note' | 'heading' | 'todo' | 'link' | 'image' | 'color' | 'column' | 'board' | 'shot' | 'slide'

export interface StudioMedia {
  id: string
  name: string
  url: string
}

export interface TodoItem {
  id: string
  text: string
  done: boolean
}

/** Everything a card can hold; each type uses its own fields. */
export interface CardData {
  text?: string // note, heading
  title?: string // todo, link, column
  items?: TodoItem[] // todo
  url?: string // link
  media?: StudioMedia | null // image, shot, slide
  caption?: string // image, slide
  hex?: string // color
  name?: string // color
  boardId?: string // board (the board it opens)
  number?: string // shot, slide
  action?: string // shot
  dialogue?: string // shot
  camera?: string // shot
  duration?: string // shot (seconds)
}

export interface StudioCard {
  id: string
  boardId: string
  type: CardType
  /** Position on the board (ignored while the card sits in a column) */
  x: number
  y: number
  w: number
  /** The column it's stacked in, if any */
  parentId: string | null
  /** Order inside a column */
  order: number
  /** Accent color for notes/boards, from CARD_COLORS ('' = none) */
  color: string
  data: CardData
  updatedAt: string
  updatedBy: string
}

export type BoardVisibility = 'team' | 'private'

export interface StudioBoard {
  id: string
  title: string
  /** The board this one lives inside ('' = top level) */
  parentId: string
  color: string
  /** 'team' boards are shared with everyone; 'private' ones only show for their owner. Boards inside another board follow the top board. */
  visibility: BoardVisibility
  /** Who made it (the only one who sees it while it's private) */
  owner: string
  createdAt: string
  updatedAt: string
  updatedBy: string
}

export interface StudioLine {
  id: string
  boardId: string
  from: string
  to: string
  label: string
}

export interface StudioSnapshot {
  boards: StudioBoard[]
  cards: StudioCard[]
  lines: StudioLine[]
}

/** The top board a board lives in (itself when it's top level). Its privacy applies to everything inside. */
export function rootBoard(boards: StudioBoard[], id: string): StudioBoard | undefined {
  let b = boards.find((x) => x.id === id)
  const seen = new Set<string>()
  while (b && b.parentId && !seen.has(b.id)) {
    seen.add(b.id)
    const up = boards.find((x) => x.id === b!.parentId)
    if (!up) break
    b = up
  }
  return b
}

/** Can this person change who sees the board? The owner can; boards from before owners existed are open to anyone. */
export const canChangeVisibility = (b: StudioBoard, me: string) => !b.owner || b.owner === me

/** Accent colors a note or board can carry (Milanote's colored notes), in Constellation's palette. */
export const CARD_COLORS: { id: string; label: string; color: string; soft: string }[] = [
  { id: '', label: 'None', color: 'transparent', soft: '' },
  { id: 'sky', label: 'Sky', color: '#00b7e2', soft: '#dff6fc' },
  { id: 'sun', label: 'Sun', color: '#e3a21a', soft: '#fdf0d5' },
  { id: 'rose', label: 'Rose', color: '#e05297', soft: '#fce3ee' },
  { id: 'leaf', label: 'Leaf', color: '#3fae5a', soft: '#e0f3e4' },
  { id: 'plum', label: 'Plum', color: '#8a5cf6', soft: '#ece5fe' },
  { id: 'clay', label: 'Clay', color: '#c96f3b', soft: '#f8e6da' },
  { id: 'ink', label: 'Ink', color: '#231f20', soft: '#e6e5e1' }
]
export const cardColor = (id: string) => CARD_COLORS.find((c) => c.id === id) ?? CARD_COLORS[0]

export const CAMERA_SHOTS = ['Wide', 'Medium', 'Close-up', 'Extreme close-up', 'Over the shoulder', 'Insert', 'Overhead', 'Drone', 'Tracking', 'Handheld']

export const CARD_DEFAULT_WIDTH: Record<CardType, number> = {
  note: 260,
  heading: 360,
  todo: 260,
  link: 260,
  image: 280,
  color: 160,
  column: 300,
  board: 200,
  shot: 300,
  slide: 240
}

export type TemplateId = 'blank' | 'brief' | 'storyboard' | 'carousel' | 'mood'
export const TEMPLATES: { id: TemplateId; label: string; blurb: string }[] = [
  { id: 'brief', label: 'Creative Brief', blurb: 'Goal, audience, message, deliverables, tone, timeline and references, ready to fill in.' },
  { id: 'storyboard', label: 'Video Storyboard', blurb: 'A row of numbered shots with frame, action, dialogue, camera and length.' },
  { id: 'carousel', label: 'Social Carousel', blurb: 'Numbered 4:5 slides with captions for a multi-image post.' },
  { id: 'mood', label: 'Mood Board', blurb: 'A free canvas for images, colors, type and notes.' },
  { id: 'blank', label: 'Blank Board', blurb: 'Start from an empty canvas.' }
]

type CardSeed = Pick<StudioCard, 'type' | 'x' | 'y'> & Partial<Pick<StudioCard, 'w' | 'color' | 'parentId' | 'order' | 'data'>> & { key?: string }

/** Starting cards for a new board. Keys let cards point at their column before they have ids. */
export function templateCards(t: TemplateId): CardSeed[] {
  if (t === 'brief') {
    const section = (key: string, x: number, title: string, notes: [string, string][]) => [
      { key, type: 'column' as const, x, y: 140, w: 300, data: { title } },
      ...notes.map(([text, color], i) => ({ type: 'note' as const, x: 0, y: 0, parentId: key, order: i, color, data: { text } }))
    ]
    return [
      { type: 'heading', x: 60, y: 40, w: 640, data: { text: 'Creative Brief' } },
      { type: 'note', x: 720, y: 40, w: 340, color: 'sun', data: { text: 'Project: \nRequested by: \nDue: ' } },
      ...section('c1', 60, 'The Ask', [
        ['## Goal\nWhat should this accomplish?', 'sky'],
        ['## Audience\nWho is it for? What do they care about?', ''],
        ['## Key message\nThe one thing people should remember.', '']
      ]),
      ...section('c2', 380, 'The Work', [
        ['## Deliverables\n- \n- ', 'leaf'],
        ['## Tone & feel\nThree words: ', ''],
        ['## Must include\nLogos, dates, links, scripture, legal…', '']
      ]),
      ...section('c3', 700, 'Timeline', [
        ['## Milestones\n- First draft: \n- Review: \n- Final: ', 'plum']
      ]),
      { type: 'todo', x: 700, y: 420, w: 300, data: { title: 'Sign-off', items: [{ id: 't1', text: 'Requester approved the brief', done: false }, { id: 't2', text: 'Creative team approved', done: false }] } },
      { type: 'heading', x: 1020, y: 140, w: 300, data: { text: 'References' } },
      { type: 'note', x: 1020, y: 210, w: 300, data: { text: 'Drop images, links and colors here.' } }
    ]
  }
  if (t === 'storyboard') {
    return [
      { type: 'heading', x: 60, y: 40, w: 600, data: { text: 'Video Storyboard' } },
      { type: 'note', x: 680, y: 40, w: 320, color: 'sun', data: { text: 'Length: \nAspect: 16:9\nMusic: ' } },
      ...[1, 2, 3, 4].map((n, i) => ({
        type: 'shot' as const,
        x: 60 + i * 330,
        y: 180,
        data: { number: String(n), action: '', dialogue: '', camera: i === 0 ? 'Wide' : 'Medium', duration: '3', media: null }
      }))
    ]
  }
  if (t === 'carousel') {
    return [
      { type: 'heading', x: 60, y: 40, w: 600, data: { text: 'Social Carousel' } },
      { type: 'note', x: 680, y: 40, w: 320, color: 'rose', data: { text: 'Post caption:\n\nPlatform: Instagram' } },
      ...[1, 2, 3, 4, 5].map((n, i) => ({ type: 'slide' as const, x: 60 + i * 260, y: 180, data: { number: String(n), caption: '', media: null } }))
    ]
  }
  if (t === 'mood') {
    return [
      { type: 'heading', x: 60, y: 40, w: 600, data: { text: 'Mood Board' } },
      { type: 'color', x: 60, y: 140, data: { hex: '#00b7e2', name: 'Primary' } },
      { type: 'color', x: 240, y: 140, data: { hex: '#231f20', name: 'Ink' } },
      { type: 'color', x: 420, y: 140, data: { hex: '#e2e2da', name: 'Paper' } },
      { type: 'note', x: 60, y: 330, w: 340, data: { text: '## Feeling\nWarm, hopeful, homecoming.' } },
      { type: 'note', x: 420, y: 330, w: 300, color: 'sky', data: { text: '## Type\nHelvetica Neue Bold, tight tracking.' } }
    ]
  }
  return []
}

/** Fills in a template's cards for a board, resolving column keys to the new column ids. */
export function cardsFromTemplate(boardId: string, t: TemplateId, by: string): StudioCard[] {
  const now = new Date().toISOString()
  const keyToId = new Map<string, string>()
  const seeds = templateCards(t)
  for (const s of seeds) if (s.key) keyToId.set(s.key, newId())
  return seeds.map((s) => ({
    id: s.key ? keyToId.get(s.key)! : newId(),
    boardId,
    type: s.type,
    x: s.x,
    y: s.y,
    w: s.w ?? CARD_DEFAULT_WIDTH[s.type],
    parentId: s.parentId ? keyToId.get(s.parentId) ?? null : null,
    order: s.order ?? 0,
    color: s.color ?? '',
    data: structuredClone(s.data ?? {}),
    updatedAt: now,
    updatedBy: by
  }))
}

