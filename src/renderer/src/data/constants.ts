import { REQUEST_MINISTRIES } from './requests'
import { addDays, format, parseISO } from 'date-fns'
import type { Category, CategoryId, Milestone, TimelineTemplate } from './types'

export const CATEGORIES: Category[] = [
  { id: 'ministry', label: 'Ministry Event', color: '#a1a1aa', soft: '#ececef', ink: '#3f3f46' },
  { id: 'series', label: 'Sermon Series', color: '#f29bbd', soft: '#fde5ef', ink: '#cf3f7a' },
  { id: 'staff', label: 'Staff Use / Meeting', color: '#9fb6d8', soft: '#e7eef8', ink: '#45628f' }
]

export const categoryById = (id: CategoryId): Category =>
  CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[0]

/** Calendar ministries: the Media Request form's Ministry Areas, plus All church. */
export const MINISTRIES = ['All church', ...REQUEST_MINISTRIES]

type Swatch = Pick<Category, 'color' | 'soft' | 'ink'>
/** Each ministry's color on the Event Calendar. Ministry events use these; Sermon Series and Staff keep their category color. */
export const MINISTRY_COLORS: Record<string, Swatch> = {
  'All church': { color: '#b9b9c3', soft: '#ececef', ink: '#52525b' },
  Kids: { color: '#f6b04f', soft: '#fdf0db', ink: '#9a5c06' },
  HSM: { color: '#7c9cf0', soft: '#e6ecfd', ink: '#3651b8' },
  '678': { color: '#b48cf0', soft: '#f0e7fd', ink: '#6d3fc0' },
  WAVE: { color: '#4fc3c8', soft: '#dcf4f5', ink: '#1d7f84' },
  Community: { color: '#86d493', soft: '#e3f6e5', ink: '#3b934b' },
  Missions: { color: '#e9845f', soft: '#fbe6dd', ink: '#b2482a' },
  'Small Groups': { color: '#d59be0', soft: '#f6e6f9', ink: '#96429f' },
  Connections: { color: '#efc94c', soft: '#fcf4d6', ink: '#866700' },
  'Care + Support': { color: '#f08c8c', soft: '#fde4e4', ink: '#b53a3a' },
  Prayer: { color: '#8fcbef', soft: '#e3f3fc', ink: '#25729e' },
  Apprenticeships: { color: '#c2b280', soft: '#f2eee1', ink: '#6f6236' },
  Internships: { color: '#a7c96b', soft: '#eef5e1', ink: '#55731f' },
  'Executive Team': { color: '#8a94a6', soft: '#eceef2', ink: '#474f60' },
  Facilities: { color: '#b7a18f', soft: '#f1ebe6', ink: '#6a5444' },
  'Sunday AM': { color: '#5fb3a1', soft: '#e0f2ee', ink: '#24705f' },
  // eSpace's own ministries
  'Next Steps': { color: '#efc94c', soft: '#fcf4d6', ink: '#866700' },
  'Young Pros': { color: '#8fcbef', soft: '#e3f3fc', ink: '#25729e' },
  Students: { color: '#f08c8c', soft: '#fde4e4', ink: '#b53a3a' },
  Imagine: { color: '#a7c96b', soft: '#eef5e1', ink: '#55731f' },
  'Creative/Worship': { color: '#b7a18f', soft: '#f1ebe6', ink: '#6a5444' }
}
/** Ministries added later get a color from the palette, the same one every time */
const PALETTE = Object.values(MINISTRY_COLORS).slice(1)
export const ministryColor = (m: string): Swatch => {
  if (MINISTRY_COLORS[m]) return MINISTRY_COLORS[m]
  if (!m || m === 'All church') return MINISTRY_COLORS['All church']
  let h = 0
  for (const ch of m) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length]
}

/** What color an event shows in: its ministry for Ministry Events, otherwise its category. */
export const eventSwatch = (e: { category: CategoryId; ministry: string }): Swatch =>
  e.category === 'ministry' ? ministryColor(e.ministry) : categoryById(e.category)


export const TEMPLATES: TimelineTemplate[] = [
  {
    id: 'series',
    name: 'Sermon series (5 weeks)',
    description: 'Series art, bumper and promo before week one',
    steps: [
      { title: 'Series brief due', offset: -35 },
      { title: 'Series art due', offset: -28 },
      { title: 'Bumper video due', offset: -21 },
      { title: 'Stage graphics + slides final', offset: -14 },
      { title: 'Social teaser', offset: -7 },
      { title: 'Series launch post', offset: 0 },
      { title: 'Weekly recap posts', offset: 7 }
    ]
  },
  {
    id: 'major',
    name: 'Major event (6 weeks)',
    description: 'Easter, Christmas, big launches',
    steps: [
      { title: 'Creative brief due', offset: -49 },
      { title: 'Save-the-date post', offset: -42 },
      { title: 'Design files due', offset: -35 },
      { title: 'Print order placed', offset: -28 },
      { title: 'Registration / page live', offset: -28 },
      { title: 'Stage announcement begins', offset: -21 },
      { title: 'Social push: post 1', offset: -21 },
      { title: 'Social push: post 2', offset: -14 },
      { title: 'Email blast', offset: -10 },
      { title: 'Reminder post', offset: -7 },
      { title: 'Final reminder + stories', offset: -1 },
      { title: 'Day-of coverage', offset: 0 },
      { title: 'Recap post + photos', offset: 2 }
    ]
  },
  {
    id: 'standard',
    name: 'Standard event (4 weeks)',
    description: 'Ministry nights, classes, gatherings',
    steps: [
      { title: 'Creative brief due', offset: -28 },
      { title: 'Design files due', offset: -21 },
      { title: 'First social post', offset: -14 },
      { title: 'Stage / bulletin announcement', offset: -10 },
      { title: 'Reminder post', offset: -7 },
      { title: 'Final reminder', offset: -1 },
      { title: 'Day-of coverage', offset: 0 }
    ]
  },
  {
    id: 'quick',
    name: 'Quick promo (2 weeks)',
    description: 'Small or short-notice events',
    steps: [
      { title: 'Graphic due', offset: -14 },
      { title: 'Social post', offset: -7 },
      { title: 'Final reminder', offset: -1 }
    ]
  }
]

export const templateById = (id: string | null) => TEMPLATES.find((t) => t.id === id) ?? null

export const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)

export function milestonesFromTemplate(
  templateId: string,
  eventId: string,
  eventDate: string,
  owner: string
): Milestone[] {
  const t = templateById(templateId)
  if (!t) return []
  const base = parseISO(eventDate)
  return t.steps.map((s, i) => ({
    id: newId(),
    eventId,
    title: s.title,
    dueDate: format(addDays(base, s.offset), 'yyyy-MM-dd'),
    done: false,
    owner,
    sortOrder: i
  }))
}
