// Video Review: Frame.io-style review of cuts and graphics, shared by the app, the backend and guest review links.

export type ReviewStatus = 'in-progress' | 'needs-review' | 'changes' | 'approved'

export const REVIEW_STATUSES: { id: ReviewStatus; label: string; soft: string; ink: string; dot: string }[] = [
  { id: 'in-progress', label: 'In Progress', soft: '#ececee', ink: '#52525b', dot: '#a1a1aa' },
  { id: 'needs-review', label: 'Needs Review', soft: '#fdf0d5', ink: '#8a5a00', dot: '#e3a21a' },
  { id: 'changes', label: 'Changes Requested', soft: '#fde2e0', ink: '#9c2b26', dot: '#e0504a' },
  { id: 'approved', label: 'Approved', soft: '#e3f6e5', ink: '#2f7a3d', dot: '#3fae5a' }
]
export const reviewStatus = (id: ReviewStatus) => REVIEW_STATUSES.find((s) => s.id === id) ?? REVIEW_STATUSES[0]

export type VersionKind = 'video' | 'image'

export interface ReviewVersion {
  id: string
  /** 1, 2, 3… in the version stack */
  n: number
  kind: VersionKind
  name: string
  size: number
  /** Seconds (videos) */
  duration: number
  /** Frames per second, for timecode and frame stepping */
  fps: number
  width: number
  height: number
  /** 'processing' while Cloudflare Stream prepares it */
  state: 'processing' | 'ready' | 'error'
  /** Where the app plays it from (a Stream/HLS address, a file route, or a data/blob URL in the preview) */
  src: string
  /** Poster frame */
  thumb: string
  uploadedBy: string
  at: string
  /** Taken off Stream to save stored minutes; the original stays in the archive (R2) and can be restored */
  archived: boolean
  /** The original file is kept in the archive, so the version can be restored */
  hasOriginal: boolean
  /** Last put back on Stream (restarts its clock) */
  restoredAt?: string | null
  /** Why it can't play (state 'error') */
  error?: string
}

/** A mark drawn on the frame. Points are 0–1 across the picture so they scale with the player. */
export interface Stroke {
  tool: 'pen' | 'arrow' | 'rect' | 'ellipse'
  color: string
  points: [number, number][]
}

export interface ReviewComment {
  id: string
  reviewId: string
  versionId: string
  /** Replies point at the comment they answer */
  parentId: string | null
  author: string
  /** Guests (from a review link) aren't on the team */
  guest: boolean
  body: string
  /** Where on the timeline (seconds); null = about the whole video / image */
  t: number | null
  /** End of a range comment */
  tEnd: number | null
  /** A pin on the picture (0–1), for images and paused frames */
  pin: [number, number] | null
  drawing: Stroke[]
  resolved: boolean
  /** emoji → names */
  reactions: Record<string, string[]>
  at: string
  editedAt: string | null
}

export interface ReviewDecision {
  id: string
  reviewId: string
  versionId: string
  by: string
  guest: boolean
  decision: 'approved' | 'changes'
  note: string
  at: string
}

export interface ShareLink {
  id: string
  reviewId: string
  /** The secret in the link */
  token: string
  label: string
  allowComments: boolean
  allowDownload: boolean
  /** false = guests only ever see the newest version */
  allVersions: boolean
  expiresAt: string | null
  active: boolean
  views: number
  createdBy: string
  createdAt: string
}

export interface Review {
  id: string
  title: string
  /** Groups reviews in the library, e.g. "Christmas 2026" */
  folder: string
  status: ReviewStatus
  /** The media request this is for */
  requestId: string | null
  /** Newest last */
  versions: ReviewVersion[]
  /** Never take this review's videos off Stream */
  keep: boolean
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface ReviewSnapshot {
  reviews: Review[]
  comments: ReviewComment[]
  decisions: ReviewDecision[]
  links: ShareLink[]
}

export const REACTIONS = ['👍', '❤️', '😂', '🎉', '👀', '🔥']
export const DRAW_COLORS = ['#ff3b30', '#ffcc00', '#34c759', '#00b7e2', '#af52de', '#ffffff']
export const FPS_CHOICES = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60]

/** 00:01:02:15 (hours:minutes:seconds:frames) */
export function timecode(sec: number, fps: number): string {
  const f = Math.max(0, Math.round(sec * fps))
  const perSec = Math.round(fps)
  const frames = f % perSec
  const total = Math.floor(f / perSec)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(Math.floor(total / 3600))}:${p(Math.floor(total / 60) % 60)}:${p(total % 60)}:${p(frames)}`
}

/** 1:02 or 1:02:03 */
export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const p = (n: number) => String(n).padStart(2, '0')
  return s >= 3600 ? `${Math.floor(s / 3600)}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}` : `${Math.floor(s / 60)}:${p(s % 60)}`
}

export const frameOf = (sec: number, fps: number) => Math.round(sec * fps)

/** @First Last mentions in a comment */
export function mentionsIn(body: string, names: string[]): string[] {
  return names.filter((n) => body.toLowerCase().includes(`@${n.toLowerCase()}`) || body.toLowerCase().includes(`@${n.split(' ')[0].toLowerCase()}`))
}

export const latest = (r: Review) => r.versions[r.versions.length - 1]

/**
 * How long playable copies stay on Cloudflare Stream (stored minutes cost money and cap uploads).
 * Originals stay in the archive (R2), so anything taken off Stream can be restored.
 */
export const RETENTION = {
  /** An older version, counted from when the next version was uploaded */
  oldVersionDays: 14,
  /** The newest version of an approved review, from its last activity */
  approvedDays: 30,
  /** Everything else, from its last activity */
  idleDays: 45,
  /** The uploader hears about it this many days before */
  warnDays: 3
}

const DAY = 86_400_000
/** When this version leaves Stream (null = kept, or already archived) */
export function leavesStreamAt(r: Review, v: ReviewVersion): Date | null {
  if (r.keep || v.archived || v.kind !== 'video') return null
  const i = r.versions.findIndex((x) => x.id === v.id)
  const next = r.versions[i + 1]
  if (next) return new Date(Math.max(Date.parse(next.at), Date.parse(v.restoredAt ?? '') || 0) + RETENTION.oldVersionDays * DAY)
  return new Date(Date.parse(r.updatedAt) + (r.status === 'approved' ? RETENTION.approvedDays : RETENTION.idleDays) * DAY)
}
export const daysLeft = (d: Date) => Math.max(0, Math.ceil((d.getTime() - Date.now()) / DAY))
