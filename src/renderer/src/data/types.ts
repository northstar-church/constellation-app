// Dates are stored as 'yyyy-MM-dd' strings, times as 'HH:mm' (local church time).

export type CategoryId = 'ministry' | 'series' | 'staff'

export interface Category {
  id: CategoryId
  label: string
  /** Accent: card strips, progress bars, dots */
  color: string
  /** Pastel fill for tags and chips */
  soft: string
  /** Text on the pastel fill */
  ink: string
}

export interface TeamEvent {
  id: string
  title: string
  category: CategoryId
  ministry: string
  startDate: string
  endDate: string | null
  startTime: string | null
  endTime: string | null
  location: string
  owner: string
  notes: string
  templateId: string | null
  updatedAt: string
  updatedBy: string
  /** Set when the event comes from eSpace: name, times and rooms are managed there */
  espace?: EspaceLink | null
}

export interface EspaceLink {
  eventId: number
  occurrenceId: number
  /** eSpace category it came in under */
  category: string
  /** Rooms booked in eSpace */
  spaces: string[]
  /** Opens the event in eSpace */
  url: string
  /** Staff member who booked it in eSpace */
  bookedBy: string
  bookedByEmail: string
  /** Someone picked the ministry in Constellation, so the booker's ministry no longer applies */
  ministryByHand?: boolean
  /** Other eSpace events with the same name, day and times that were folded into this one (likely double bookings) */
  alsoBooked?: number[]
}

/** A staff member who books events in eSpace, and the ministry their events belong to */
export interface EspaceBooker {
  email: string
  name: string
  /** null = not set yet: their events come in as All church */
  ministry: string | null
  /** Their upcoming events */
  count: number
}

/** One eSpace category and what Constellation does with it */
export interface EspaceCategory {
  id: number
  name: string
  /** null = not brought in */
  mapTo: CategoryId | null
  /** Approved upcoming events in this category */
  count: number
}

export interface EspaceStatus {
  connected: boolean
  lastSync: string | null
  lastError: string | null
  categories: EspaceCategory[]
  bookers: EspaceBooker[]
  /** eSpace's own ministry list (separate from the Media Request ministries) */
  ministries: string[]
}

export interface Milestone {
  id: string
  eventId: string
  title: string
  dueDate: string
  done: boolean
  owner: string
  sortOrder: number
}

export interface CalendarSnapshot {
  events: TeamEvent[]
  milestones: Milestone[]
}

/** A subscribe link (webcal/.ics) with its own filter. */
export interface Feed {
  id: string
  token: string
  name: string
  /** null = every category */
  categories: CategoryId[] | null
  includeMilestones: boolean
  createdAt: string
  createdBy: string
}

export interface TimelineStep {
  title: string
  /** Days relative to the event date. Negative = before. */
  offset: number
}

export interface TimelineTemplate {
  id: string
  name: string
  description: string
  steps: TimelineStep[]
}
