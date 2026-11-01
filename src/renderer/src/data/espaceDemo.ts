// Preview only: what eSpace would send. Replaced by the real eSpace sync once it's connected.
import type { CategoryId, EspaceBooker, EspaceCategory, TeamEvent } from './types'
import { ESPACE_STAFF } from './espaceStaff'

export const ESPACE_CATEGORIES: { id: number; name: string; mapTo: CategoryId | null }[] = [
  { id: 11, name: 'Ministry Event', mapTo: 'ministry' },
  { id: 12, name: 'Staff Use/Meeting', mapTo: 'staff' },
  { id: 13, name: 'Wedding / Funeral', mapTo: null },
  { id: 14, name: 'Outside Rental', mapTo: null },
  { id: 15, name: 'Facility Maintenance', mapTo: null }
]

/** Who booked each sample event. Real staff from the list, plus one made-up person (Jordan) who isn't on it */
const PEOPLE: Record<string, string> = Object.fromEntries([...ESPACE_STAFF.map((p) => [p.email.split('.')[0], p.name]), ['jordan', 'Jordan Lee']])
const emailOf = (k: string) => ESPACE_STAFF.find((p) => p.email.split('.')[0] === k)?.email ?? `${PEOPLE[k].toLowerCase().replace(' ', '.')}@northstarchurch.org`

export type BookerMap = Record<string, { name: string; ministry: string | null }>
export const defaultBookers = (): BookerMap => Object.fromEntries(ESPACE_STAFF.map((p) => [p.email, { name: p.name, ministry: p.ministry }]))

interface Occ {
  cat: number
  title: string
  date: string
  start?: string
  end?: string
  spaces: string[]
  by: string
  notes?: string
  /** Occurrences of one recurring eSpace event share this */
  series?: number
}

const weekly = (title: string, dates: string[], start: string, end: string, spaces: string[], series: number, by = 'ca', cat = 12): Occ[] =>
  dates.map((date) => ({ cat, title, date, start, end, spaces, by, series }))

const OCCURRENCES: Occ[] = [
  { cat: 11, title: 'Baptism Sunday', date: '2026-11-08', start: '09:00', end: '12:30', spaces: ['Auditorium', 'Baptistry'], by: 'essy' },
  { cat: 11, title: 'Men’s Breakfast', date: '2026-11-14', start: '08:00', end: '10:00', spaces: ['Fellowship Hall', 'Kitchen'], by: 'greg' },
  { cat: 11, title: 'Marriage Night', date: '2026-11-20', start: '18:30', end: '21:00', spaces: ['Fellowship Hall'], by: 'zach' },
  { cat: 11, title: 'Serve Day', date: '2026-11-28', start: '08:30', end: '13:00', spaces: ['Lobby', 'Parking Lot'], by: 'megan' },
  { cat: 11, title: 'Volunteer Appreciation Dinner', date: '2026-12-05', start: '17:30', end: '20:00', spaces: ['Fellowship Hall', 'Kitchen'], by: 'essy' },
  { cat: 11, title: 'Kids Christmas Musical', date: '2026-12-13', start: '16:00', end: '17:30', spaces: ['Auditorium', 'Green Room'], by: 'keilly' },
  { cat: 12, title: 'Elder Meeting', date: '2026-11-09', start: '18:30', end: '20:30', spaces: ['Board Room'], by: 'ca' },
  { cat: 12, title: 'Christmas Planning Huddle', date: '2026-11-12', start: '13:00', end: '15:00', spaces: ['Conference Room'], by: 'ca' },
  { cat: 12, title: 'Budget Review', date: '2026-11-18', start: '10:00', end: '11:30', spaces: ['Board Room'], by: 'ca' },
  ...weekly('Staff Meeting', ['2026-11-03', '2026-11-10', '2026-11-17', '2026-12-01', '2026-12-08', '2026-12-15'], '10:00', '11:00', ['Conference Room'], 7001),
  ...weekly('Kids Wednesday Night', ['2026-11-04', '2026-11-11', '2026-11-18', '2026-12-02', '2026-12-09', '2026-12-16'], '18:15', '19:30', ['Kids Wing'], 7002, 'heather', 11),
  { cat: 11, title: 'HSM Night of Worship', date: '2026-11-18', start: '19:00', end: '21:00', spaces: ['Student Center'], by: 'wilson' },
  { cat: 11, title: 'Middle School Game Night', date: '2026-11-13', start: '18:30', end: '20:30', spaces: ['Student Center', 'Gym'], by: 'jordan' },
  { cat: 11, title: '678 Lock-In', date: '2026-12-04', start: '19:00', end: '23:00', spaces: ['Gym', 'Student Center'], by: 'terri' },
  { cat: 11, title: 'Kids Volunteer Training', date: '2026-11-22', start: '12:30', end: '14:00', spaces: ['Kids Wing'], by: 'haley' },
  { cat: 11, title: 'Young Pros Mixer', date: '2026-11-19', start: '19:00', end: '21:00', spaces: ['Café'], by: 'kayla' },
  { cat: 11, title: 'Imagine Info Night', date: '2026-12-02', start: '18:30', end: '20:00', spaces: ['Room 104'], by: 'rebecca' },
  { cat: 11, title: 'Night of Worship', date: '2026-11-22', start: '18:00', end: '20:00', spaces: ['Auditorium'], by: 'seth' },
  { cat: 11, title: 'WAVE Bonfire', date: '2026-11-07', start: '19:00', end: '21:30', spaces: ['Fire Pit', 'Student Center'], by: 'sellers' },
  { cat: 13, title: 'Hart / Delgado Wedding', date: '2026-11-07', start: '14:00', end: '18:00', spaces: ['Chapel'], by: 'ca' },
  { cat: 14, title: 'Homeschool Co-op', date: '2026-11-11', start: '09:00', end: '12:00', spaces: ['Classrooms 201–204'], by: 'ca' },
  { cat: 15, title: 'HVAC Filter Change', date: '2026-11-16', start: '07:00', end: '09:00', spaces: ['Auditorium'], by: 'ca' }
]

const stamp = '2026-10-30T15:00:00.000Z'

/** Events eSpace would send for the categories that are switched on. */
export function espaceEvents(mapping: Record<number, CategoryId | null>, bookers: BookerMap): TeamEvent[] {
  return OCCURRENCES.flatMap((o, i) => {
    const mapTo = mapping[o.cat]
    if (!mapTo) return []
    const cat = ESPACE_CATEGORIES.find((c) => c.id === o.cat)!
    return [
      {
        id: `espace-${1000 + i}`,
        title: o.title,
        category: mapTo,
        ministry: bookers[emailOf(o.by)]?.ministry ?? 'All church',
        startDate: o.date,
        endDate: null,
        startTime: o.start ?? null,
        endTime: o.end ?? null,
        location: o.spaces.join(', '),
        owner: '',
        notes: o.notes ?? '',
        templateId: null,
        updatedAt: stamp,
        updatedBy: 'eSpace',
        espace: { eventId: o.series ?? 5000 + i, occurrenceId: 90000 + i, category: cat.name, spaces: o.spaces, url: 'https://app.espace.cool', bookedBy: PEOPLE[o.by], bookedByEmail: emailOf(o.by) }
      }
    ]
  })
}

export function espaceCategories(mapping: Record<number, CategoryId | null>): EspaceCategory[] {
  return ESPACE_CATEGORIES.map((c) => ({ id: c.id, name: c.name, mapTo: mapping[c.id] ?? null, count: OCCURRENCES.filter((o) => o.cat === c.id).length }))
}

export const defaultEspaceMapping = (): Record<number, CategoryId | null> => Object.fromEntries(ESPACE_CATEGORIES.map((c) => [c.id, c.mapTo]))

/** Everyone who has booked a brought-in event, plus everyone on the list */
export function espaceBookers(mapping: Record<number, CategoryId | null>, bookers: BookerMap): EspaceBooker[] {
  const counts = new Map<string, number>()
  for (const o of OCCURRENCES) if (mapping[o.cat]) counts.set(emailOf(o.by), (counts.get(emailOf(o.by)) ?? 0) + 1)
  const emails = new Set([...Object.keys(bookers), ...counts.keys()])
  const nameOf = (email: string) => bookers[email]?.name ?? PEOPLE[Object.keys(PEOPLE).find((k) => emailOf(k) === email) ?? ''] ?? email
  return [...emails]
    .map((email) => ({ email, name: nameOf(email), ministry: bookers[email]?.ministry ?? null, count: counts.get(email) ?? 0 }))
    .sort((a, b) => (a.ministry ? 1 : 0) - (b.ministry ? 1 : 0) || a.name.localeCompare(b.name))
}
