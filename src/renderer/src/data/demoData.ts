import { milestonesFromTemplate, newId } from './constants'
import type { CalendarSnapshot, CategoryId, Milestone, TeamEvent } from './types'

interface Seed {
  title: string
  category: CategoryId
  ministry: string
  startDate: string
  endDate?: string
  startTime?: string
  endTime?: string
  location: string
  owner: string
  notes?: string
  templateId?: string
  /** Mark milestones due before this date as done, to make the demo realistic. */
  doneBefore?: string
}

// Sample events for the demo only. Replaced by real team data once the team hub is connected.
const SEEDS: Seed[] = [
  { title: 'Unshaken', category: 'series', ministry: 'All church', startDate: '2026-10-04', endDate: '2026-10-25', location: 'All campuses', owner: 'JT', notes: 'Four-week series on Psalms.' },
  { title: 'Kids Fall Fest', category: 'ministry', ministry: 'Kids', startDate: '2026-10-31', startTime: '16:00', endTime: '19:00', location: 'Main campus lawn', owner: 'Sarah', templateId: 'standard', doneBefore: '2026-10-24' },
  { title: 'Better Together', category: 'series', ministry: 'All church', startDate: '2026-11-01', endDate: '2026-11-22', location: 'All campuses', owner: 'JT', templateId: 'series', doneBefore: '2026-10-25', notes: 'Series on community and small groups. Groups launch push in week 3.' },
  { title: 'Women’s Night of Worship', category: 'ministry', ministry: 'Small Groups', startDate: '2026-11-13', startTime: '19:00', endTime: '21:00', location: 'Auditorium', owner: 'Rachel', templateId: 'quick', doneBefore: '2026-10-25' },
  { title: 'Thanksgiving Food Drive', category: 'ministry', ministry: 'Missions', startDate: '2026-11-21', location: 'Lobby + partner pantry', owner: 'Marcus', templateId: 'standard', doneBefore: '2026-10-24' },
  { title: 'Staff Thanksgiving Lunch', category: 'ministry', ministry: 'All church', startDate: '2026-11-24', startTime: '12:00', endTime: '13:30', location: 'Fellowship hall', owner: 'Dana' },
  { title: 'Advent: Hope Has A Name', category: 'series', ministry: 'All church', startDate: '2026-11-29', endDate: '2026-12-20', location: 'All campuses', owner: 'JT', templateId: 'series', doneBefore: '2026-10-28', notes: 'Series art + bumper video. Coordinate with worship on set list.' },
  { title: 'Students Winter Retreat', category: 'ministry', ministry: 'HSM', startDate: '2027-01-15', endDate: '2027-01-17', location: 'Camp Wilderness', owner: 'Tyler', templateId: 'standard' },
  { title: 'Christmas Eve Services', category: 'ministry', ministry: 'All church', startDate: '2026-12-24', startTime: '14:00', endTime: '20:00', location: 'All campuses', owner: 'JT', templateId: 'major', doneBefore: '2026-10-26', notes: 'Five services. Invite cards, mailer, outdoor banners, paid social.' }
]

export function demoSnapshot(): CalendarSnapshot {
  const events: TeamEvent[] = []
  const milestones: Milestone[] = []
  for (const s of SEEDS) {
    const id = newId()
    events.push({
      id,
      title: s.title,
      category: s.category,
      ministry: s.ministry,
      startDate: s.startDate,
      endDate: s.endDate ?? null,
      startTime: s.startTime ?? null,
      endTime: s.endTime ?? null,
      location: s.location,
      owner: s.owner,
      notes: s.notes ?? '',
      templateId: s.templateId ?? null,
      updatedAt: new Date().toISOString(),
      updatedBy: s.owner
    })
    if (s.templateId) {
      for (const m of milestonesFromTemplate(s.templateId, id, s.startDate, s.owner)) {
        milestones.push({ ...m, done: !!s.doneBefore && m.dueDate < s.doneBefore })
      }
    }
  }
  return { events, milestones }
}
