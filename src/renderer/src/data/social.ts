// Posting Calendar: social posts planned by the team, one post per platform.

export type PlatformId = 'facebook' | 'instagram' | 'tiktok' | 'youtube'

export interface Platform {
  id: PlatformId
  label: string
  /** Brand color, for the platform badge */
  color: string
  /** Caption limit (YouTube: description) */
  limit: number
  /** YouTube posts also need a video title */
  titleLimit?: number
  /** Shape of the media in previews */
  aspect: '1/1' | '4/5' | '9/16' | '16/9' | 'auto'
  /** What the post needs before it can be posted */
  needsMedia: 'optional' | 'image-or-video' | 'video'
}

export const PLATFORMS: Platform[] = [
  { id: 'facebook', label: 'Facebook', color: '#0866ff', limit: 63206, aspect: 'auto', needsMedia: 'optional' },
  { id: 'instagram', label: 'Instagram', color: '#ff0069', limit: 2200, aspect: '4/5', needsMedia: 'image-or-video' },
  { id: 'tiktok', label: 'TikTok', color: '#000000', limit: 4000, aspect: '9/16', needsMedia: 'video' },
  { id: 'youtube', label: 'YouTube', color: '#ff0000', limit: 5000, titleLimit: 100, aspect: '16/9', needsMedia: 'video' }
]
export const platformById = (id: PlatformId) => PLATFORMS.find((p) => p.id === id) ?? PLATFORMS[0]

/**
 * idea → draft → review (waiting on the social media director) → scheduled → posted.
 * Only the social media director moves a post from review to scheduled; her own posts can skip review.
 */
export type PostStatus = 'idea' | 'draft' | 'review' | 'scheduled' | 'posted'

export const POST_STATUSES: { id: PostStatus; label: string; soft: string; ink: string; dot: string }[] = [
  { id: 'idea', label: 'Idea', soft: '#f1eef8', ink: '#6a4fa3', dot: '#8f74c9' },
  { id: 'draft', label: 'Draft', soft: '#ececee', ink: '#52525b', dot: '#a1a1aa' },
  { id: 'review', label: 'Pending Review', soft: '#fdf0d5', ink: '#8a5a00', dot: '#e3a21a' },
  { id: 'scheduled', label: 'Scheduled', soft: '#dff6fc', ink: '#00799a', dot: '#00b7e2' },
  { id: 'posted', label: 'Posted', soft: '#e3f6e5', ink: '#2f7a3d', dot: '#3fae5a' }
]
export const postStatus = (id: PostStatus) => POST_STATUSES.find((s) => s.id === id) ?? POST_STATUSES[1]

/** Ministry categories: each post is color-coded by one. */
export type PostCategoryId = 'kids' | 'students' | 'discipleship' | 'community' | 'missions' | 'special-needs' | 'sunday-recap' | 'sunday-services'

export const POST_CATEGORIES: { id: PostCategoryId; label: string; color: string; soft: string; ink: string }[] = [
  { id: 'kids', label: 'Kids', color: '#f08c2e', soft: '#fdecd9', ink: '#8f4700' },
  { id: 'students', label: 'Students', color: '#8a5cf6', soft: '#ece5fe', ink: '#5426b8' },
  { id: 'discipleship', label: 'Discipleship', color: '#14a3a1', soft: '#d8f2f1', ink: '#0a605f' },
  { id: 'community', label: 'Community', color: '#3fae5a', soft: '#e0f3e4', ink: '#256f37' },
  { id: 'missions', label: 'Missions', color: '#e0504a', soft: '#fde2e0', ink: '#9c2b26' },
  { id: 'special-needs', label: 'Special Needs', color: '#3b82f6', soft: '#dfeafe', ink: '#1c50ad' },
  { id: 'sunday-recap', label: 'Sunday Recap', color: '#e05297', soft: '#fce3ee', ink: '#9d2560' },
  { id: 'sunday-services', label: 'Sunday Services', color: '#c99a0e', soft: '#faf0cf', ink: '#6f5500' }
]
/** A post without a category gets a neutral look. */
export const NO_CATEGORY = { id: '' as const, label: 'No Category', color: '#a1a1aa', soft: '', ink: '' }
export const postCategory = (id: string) => POST_CATEGORIES.find((c) => c.id === id) ?? NO_CATEGORY

export interface PostMedia {
  id: string
  name: string
  kind: 'image' | 'video'
  /** Where the app can show it from (a blob: or data: URL in the preview; a file route once on the server) */
  url: string
  /** Pixel size, when known (Instagram only takes images between 4:5 tall and 1.91:1 wide) */
  w?: number
  h?: number
}

/** A connected account the app can publish to (one Facebook Page, several Instagram accounts). */
export interface SocialAccount {
  id: string
  platform: PlatformId
  /** e.g. "NorthStar Kids" */
  name: string
  /** e.g. "nsckennesaw" (no @) */
  handle: string
  /** Constellation can publish to it (Meta is connected); otherwise it's just for picking */
  connected: boolean
}

/** Platforms Constellation can publish to by itself. TikTok and YouTube stay on reminders for now. */
export const AUTO_PLATFORMS: PlatformId[] = ['instagram', 'facebook']
export const canAutoPublish = (pf: PlatformId) => AUTO_PLATFORMS.includes(pf)

export interface PostActivity {
  at: string
  by: string
  /** e.g. "submitted for review", "approved", "sent back", "marked posted" */
  what: string
  note?: string
}

export interface SocialPost {
  id: string
  platform: PlatformId
  /** YouTube video title */
  title: string
  caption: string
  media: PostMedia[]
  /** Local date + time the post should go out: "2026-11-02" and "09:30" (time may be empty for ideas) */
  date: string
  time: string
  /** The same moment as an ISO time (set by the app from date + time), so the server knows when to remind */
  at?: string | null
  status: PostStatus
  /** Color-codes the post on the calendar */
  category: PostCategoryId | ''
  /** Groups posts that belong together, e.g. "Christmas at NorthStar" */
  campaign: string
  /** Who will post it */
  poster: string
  author: string
  /** Link to the live post once it's up */
  postUrl: string
  /** The social media director's note when sending a post back */
  reviewNote: string
  activity: PostActivity[]
  /** The account it goes to (required for Instagram: there are several) */
  account: string
  /** Publish on its own at the scheduled time (Instagram and Facebook only) */
  autoPublish: boolean
  /** '' normally; 'failed' when publishing didn't work (publishError says why) */
  publishState: '' | 'publishing' | 'failed'
  publishError: string
  /** The Creative Studio board this post was planned on */
  boardId: string
  createdAt: string
  updatedAt: string
}

/** Characters Instagram/TikTok count: emoji and other astral characters count once. */
export const charCount = (s: string) => [...s].length

/** Problems that would stop this post going out on its platform. */
export function postProblems(p: Pick<SocialPost, 'platform' | 'caption' | 'title' | 'media' | 'date' | 'time'> & Partial<Pick<SocialPost, 'account' | 'autoPublish'>>): string[] {
  const pl = platformById(p.platform)
  const out: string[] = []
  if (charCount(p.caption) > pl.limit) out.push(`${pl.label} allows ${pl.limit.toLocaleString()} characters; this is ${charCount(p.caption).toLocaleString()}.`)
  if (pl.titleLimit && !p.title.trim()) out.push('YouTube needs a video title.')
  if (pl.titleLimit && charCount(p.title) > pl.titleLimit) out.push(`YouTube titles allow ${pl.titleLimit} characters.`)
  const hasVideo = p.media.some((m) => m.kind === 'video')
  if (pl.needsMedia === 'video' && !hasVideo) out.push(`${pl.label} posts need a video.`)
  if (pl.needsMedia === 'image-or-video' && !p.media.length) out.push(`${pl.label} posts need an image or video.`)
  if (p.platform === 'instagram' && p.account === '') out.push('Pick which Instagram account it goes to.')
  if (p.autoPublish && p.platform === 'instagram') {
    if (p.media.length > 20) out.push('Instagram carousels hold up to 20 images or videos.')
    const odd = p.media.find((m) => m.kind === 'image' && m.w && m.h && (m.w / m.h < 0.8 - 0.005 || m.w / m.h > 1.91 + 0.005))
    if (odd) out.push(`${odd.name} is too tall or too wide for an Instagram post. Crop it between 4:5 (portrait) and 1.91:1 (landscape).`)
    if (p.media.some((m) => m.kind === 'image' && /\.(heic|heif)$/i.test(m.name))) out.push('Instagram can’t publish HEIC photos. Export them as JPG.')
  }
  if (!p.date) out.push('Pick a date.')
  if (!p.time) out.push('Pick a time.')
  return out
}

/** Campaign → a stable soft color for its label. */
const CAMPAIGN_HUES = [200, 330, 150, 30, 265, 95, 5, 180]
export function campaignColor(name: string): { soft: string; ink: string } {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const hue = CAMPAIGN_HUES[h % CAMPAIGN_HUES.length]
  return { soft: `hsl(${hue} 70% 93%)`, ink: `hsl(${hue} 55% 32%)` }
}
