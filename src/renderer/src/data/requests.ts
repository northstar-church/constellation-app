// Media requests: shared by the app, the backend and the requester's tracker page.

export type StageId = 'received' | 'scheduled' | 'design' | 'proof' | 'approved' | 'delivered'

export interface Stage {
  id: StageId
  label: string
  /** What the requester sees on their tracker and in Slack */
  blurb: string
  emoji: string
}

export const STAGES: Stage[] = [
  { id: 'received', label: 'Received', blurb: 'We have your request and will review it shortly.', emoji: '📥' },
  { id: 'scheduled', label: 'Scheduled', blurb: 'Your request is on the schedule and assigned to a team member.', emoji: '🗓️' },
  { id: 'design', label: 'In Design', blurb: 'Our team is working on it now.', emoji: '🎨' },
  { id: 'proof', label: 'Proof Ready', blurb: 'A proof is ready for you to review.', emoji: '👀' },
  { id: 'approved', label: 'Approved', blurb: 'You approved it. We’re preparing final files.', emoji: '✅' },
  { id: 'delivered', label: 'Delivered', blurb: 'All done. Your files have been delivered.', emoji: '🎉' }
]

export const stageIndex = (id: StageId) => STAGES.findIndex((s) => s.id === id)
export const stageById = (id: StageId) => STAGES[Math.max(0, stageIndex(id))]

export interface Tag {
  label: string
  soft: string
  ink: string
}

/** Deliverable types, colored like the Notion board. */
export const DELIVERABLES: Tag[] = [
  { label: 'Graphic', soft: '#fbefc9', ink: '#8a6510' },
  { label: 'Video', soft: '#e3f6e5', ink: '#3b934b' },
  { label: 'Photo', soft: '#ececec', ink: '#555555' },
  { label: 'Print', soft: '#fde5ef', ink: '#c23b70' },
  { label: 'Signage', soft: '#e1ecfb', ink: '#3a6fb5' },
  { label: 'Social', soft: '#f1e6fb', ink: '#8a4cc2' },
  { label: 'Website/App', soft: '#ececec', ink: '#555555' },
  { label: 'Branding', soft: '#f3e7dd', ink: '#8b5a35' },
  { label: 'Merch', soft: '#fde3dc', ink: '#c2502f' }
]

/** Same list and order as the "Ministry Area" question on the Media Request typeform. */
export const REQUEST_MINISTRIES = [
  'Kids',
  'HSM',
  '678',
  'WAVE',
  'Community',
  'Missions',
  'Small Groups',
  'Connections',
  'Care + Support',
  'Prayer',
  'Apprenticeships',
  'Internships',
  'Executive Team',
  'Facilities',
  'Sunday AM'
]

const NEUTRAL: Tag = { label: '', soft: '#ececec', ink: '#555555' }
export const deliverableTag = (label: string): Tag => DELIVERABLES.find((d) => d.label.toLowerCase() === label.toLowerCase()) ?? { ...NEUTRAL, label }
export const ministryTag = (label: string): Tag => ({ label, soft: '#eeeae2', ink: '#6b5a3e' })

/** One person's share of a request: design, social, photo… */
export interface Assignment {
  name: string
  done: boolean
}

/** Reads an assignee list from stored JSON / an API body, falling back to the old single assignee. */
export function normalizeAssignees(list: unknown, legacy = ''): Assignment[] {
  const out: Assignment[] = []
  if (Array.isArray(list)) {
    for (const a of list) {
      const name = typeof a?.name === 'string' ? a.name.trim().slice(0, 80) : ''
      if (name && !out.some((o) => o.name.toLowerCase() === name.toLowerCase())) out.push({ name, done: a.done === true })
    }
  }
  if (!out.length && legacy.trim()) out.push({ name: legacy.trim(), done: false })
  return out.slice(0, 6)
}
/** The single-assignee value older app versions understand: first person still working, else the first person. */
export const primaryAssignee = (list: Assignment[]) => (list.find((a) => !a.done) ?? list[0])?.name ?? ''
/** "Jeremy", "Jeremy & Kendrick", "Jeremy, Sarah & Kendrick" (first names) */
export function joinNames(names: string[]): string {
  const first = names.map((n) => n.trim().split(/\s+/)[0]).filter(Boolean)
  return first.length <= 1 ? first.join('') : `${first.slice(0, -1).join(', ')} & ${first[first.length - 1]}`
}

export interface MediaRequest {
  id: string
  /** Secret part of the requester's tracker link */
  token: string
  title: string
  details: string
  deliverables: string[]
  ministry: string
  requesterName: string
  requesterEmail: string
  dueDate: string | null
  /** When the media will be used, often the event date (yyyy-MM-dd) */
  eventDate: string | null
  /** The team-calendar event created from this request */
  eventId: string | null
  stage: StageId
  /** First assignee still working on it (kept for older app versions; use assignees) */
  assignee: string
  /** Everyone working on the request; each checks off their own part */
  assignees: Assignment[]
  proofUrl: string
  /** Latest note to the requester, shown on the tracker */
  publicNote: string
  sortOrder: number
  source: 'typeform' | 'manual' | 'import'
  createdAt: string
  updatedAt: string
  updatedBy: string
}

export type HistoryKind = 'created' | 'stage' | 'note' | 'reply' | 'partdone' | 'approved' | 'changes' | 'proof' | 'final'

export interface RequestEvent {
  id: string
  requestId: string
  at: string
  kind: HistoryKind
  stage: StageId | null
  message: string
  by: string
  /** true = shown to the requester on their tracker */
  public: boolean
}

/** proof + final: uploaded by the team. reference: what the requester attached to the form (team only). */
export type FileKind = 'proof' | 'final' | 'reference'

export interface RequestFile {
  id: string
  requestId: string
  kind: FileKind
  name: string
  contentType: string
  size: number
  uploadedBy: string
  at: string
}

/** Team-only discussion on a request. Never shown to the requester. */
export interface RequestComment {
  id: string
  requestId: string
  authorName: string
  authorEmail: string
  body: string
  at: string
}

export interface RequestsSnapshot {
  requests: MediaRequest[]
  history: RequestEvent[]
  files: RequestFile[]
  comments: RequestComment[]
}

export interface Notification {
  id: string
  requestId: string
  requestTitle: string
  /** reply = the requester wrote back (Slack or tracker) */
  kind: 'comment' | 'assigned' | 'reply' | 'partdone' | 'post-review' | 'post-approved' | 'post-sentback' | 'post-due' | 'review-comment' | 'review-decision' | 'review-version' | 'review-expiring'
  actor: string
  message: string
  at: string
  read: boolean
}

export interface TeamMember {
  name: string
  email: string
  /** The project manager hears about every comment, on every request. */
  pm?: boolean
  /** false: on the team (signs in, comments) but not offered in the Assigned list. */
  assignable?: boolean
  /** The social media director: approves posts on the Posting Calendar */
  socialLead?: boolean
  /** Can add and remove people and change roles (Team screen) */
  admin?: boolean
}

/**
 * The creative team as it was first set up. The live list is edited on the Team screen (stored on the server).
 * Emails are how Constellation finds people in Slack and recognizes them at sign-in.
 */
export const DEFAULT_TEAM: TeamMember[] = [
  { name: 'Jeremy Thompson', email: 'jeremy.thompson@northstarchurch.org', admin: true },
  { name: 'Sarah Vanderheyden', email: 'sarah.vanderheyden@northstarchurch.org', socialLead: true },
  { name: 'C.A. Phillips', email: 'ca.phillips@northstarchurch.org', pm: true, assignable: false },
  { name: 'Kendrick Banks', email: 'kendrick.banks@northstarchurch.org' },
  { name: 'Stephanie Ford', email: 'stephanie.ford@northstarchurch.org', assignable: false, admin: true },
  { name: 'Ryan Hoffer', email: 'ryan.hoffer@northstarchurch.org' },
  { name: 'Will Compton', email: 'will.compton@northstarchurch.org', assignable: false },
  { name: 'Bryan McIntyre', email: 'bryan.mcintyre@northstarchurch.org', assignable: false },
  { name: 'Anne Linch', email: 'anne.linch@northstarchurch.org', assignable: false }
]
export const assignableTeam = (team: TeamMember[]) => team.filter((m) => m.assignable !== false)
export const findMember = (team: TeamMember[], name: string) => team.find((m) => m.name.toLowerCase() === name.trim().toLowerCase())

/** Reads a roster from JSON, keeping only well-formed entries. */
export function parseTeam(json: string | undefined): TeamMember[] | null {
  if (!json) return null
  try {
    const list = JSON.parse(json) as unknown
    if (!Array.isArray(list)) return null
    const team = list
      .filter((m): m is TeamMember => !!m && typeof m === 'object' && typeof (m as TeamMember).name === 'string')
      .map((m) => ({ name: m.name.trim(), email: typeof m.email === 'string' ? m.email.trim().toLowerCase() : '', pm: !!m.pm, assignable: m.assignable !== false, socialLead: m.socialLead === true, admin: m.admin === true }))
      .filter((m) => m.name)
    return team.length ? team : null
  } catch {
    return null
  }
}

/** Proof files the requester can view in the browser. */
export const PROOF_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf']
export const MAX_UPLOAD_BYTES = 95 * 1024 * 1024
export const isImage = (f: Pick<RequestFile, 'contentType'>) => f.contentType.startsWith('image/')
export const fileSize = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)
