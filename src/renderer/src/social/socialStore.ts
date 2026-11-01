import { addDays, format, startOfWeek } from 'date-fns'
import { call, download, subscribeLive, upload } from '../data/cloudStore'
import { newId } from '../data/constants'
import { prepareImage } from '../data/media'
import { canAutoPublish, platformById, type PlatformId, type PostActivity, type PostCategoryId, type PostMedia, type PostStatus, type SocialAccount, type SocialPost } from '../data/social'
import type { StudioMedia } from '../data/studio'

/** Which category each sample campaign falls under. */
const SAMPLE_CATEGORY: Record<string, PostCategoryId> = {
  'Sunday Recap': 'sunday-recap',
  WAVE: 'students',
  'Christmas at NorthStar': 'sunday-services',
  'Sermon Series': 'sunday-services',
  Kids: 'kids',
  Missions: 'missions',
  Connections: 'community'
}

export type PostDraft = Omit<SocialPost, 'id' | 'activity' | 'createdAt' | 'updatedAt' | 'author' | 'reviewNote' | 'postUrl' | 'publishState' | 'publishError'> &
  Partial<Pick<SocialPost, 'postUrl' | 'reviewNote' | 'publishState' | 'publishError'>>

/** Which account each platform's post goes to, when making posts for several platforms at once */
export type AccountChoice = Partial<Record<PlatformId, string>>

export interface SocialStore {
  mode: 'demo' | 'cloud'
  load(): Promise<SocialPost[]>
  subscribe(onChange: () => void): () => void
  /** One post per selected platform; returns the new posts */
  create(draft: Omit<PostDraft, 'platform' | 'account'>, platforms: PlatformId[], what: string, accounts?: AccountChoice): Promise<SocialPost[]>
  /** Saves edits; `what` (e.g. "submitted for review") is logged in the post's activity */
  update(id: string, patch: Partial<PostDraft>, what?: string, note?: string): Promise<SocialPost>
  remove(id: string): Promise<void>
  /** Makes an uploaded file usable in a post */
  addMedia(file: File): Promise<PostMedia>
  /** An address the screen can show the media from */
  mediaUrl(m: PostMedia): Promise<string>
  /** Accounts the app can publish to (empty until they're connected) */
  accounts(): Promise<SocialAccount[]>
  /** Publishes a scheduled Instagram/Facebook post right away */
  publishNow(id: string): Promise<SocialPost>
  /** Copies Creative Studio images into a post */
  mediaFromStudio(media: StudioMedia[]): Promise<PostMedia[]>
}

/** The post's date + time as an ISO moment in this computer's time zone (for posting reminders). */
const atOf = (p: { date?: string; time?: string }) => (p.date && p.time ? new Date(`${p.date}T${p.time}`).toISOString() : null)

// ---------- team: shared posts on Cloudflare, live for everyone ----------

export function createCloudSocialStore(): SocialStore {
  const blobs = new Map<string, Promise<string>>()
  return {
    mode: 'cloud',
    load: async () => (await call<{ posts: SocialPost[] }>('/api/social')).posts,
    subscribe: (onChange) => subscribeLive(['social'], onChange),
    async create(draft, platforms, what, accounts) {
      return (await call<{ posts: SocialPost[] }>('/api/social', 'POST', { draft: { ...draft, at: atOf(draft) }, platforms, what, accounts })).posts
    },
    async update(id, patch, what, note) {
      const withAt = 'date' in patch || 'time' in patch ? { ...patch, at: atOf(patch) } : patch
      return call<SocialPost>(`/api/social/${id}`, 'PATCH', { patch: withAt, what, note })
    },
    async remove(id) {
      await call(`/api/social/${id}`, 'DELETE')
    },
    async addMedia(original) {
      const { file, w, h } = await prepareImage(original)
      const m = await upload<PostMedia>(`/api/social/media?name=${encodeURIComponent(file.name)}`, file)
      return w && h ? { ...m, w, h } : m
    },
    accounts: async () => (await call<{ accounts: SocialAccount[] }>('/api/social/accounts')).accounts,
    publishNow: (id) => call<SocialPost>(`/api/social/${id}/publish`, 'POST'),
    mediaFromStudio: async (media) => (media.length ? (await call<{ media: PostMedia[] }>('/api/social/media/from-studio', 'POST', { ids: media.map((m) => m.id) })).media : []),
    mediaUrl(m) {
      if (!m.url.startsWith('/api/')) return Promise.resolve(m.url)
      let p = blobs.get(m.id)
      if (!p) {
        p = download(m.url).then((b) => URL.createObjectURL(b))
        p.catch(() => blobs.delete(m.id))
        blobs.set(m.id, p)
      }
      return p
    }
  }
}

// ---------- demo: sample posts saved only in this browser ----------

const KEY = 'constellation.social.v5'

/** Sample connected accounts for the preview (the real list comes from Meta once it's connected). */
export const DEMO_ACCOUNTS: SocialAccount[] = [
  { id: 'ig-kennesaw', platform: 'instagram', name: 'NorthStar Church', handle: 'nsckennesaw', connected: true },
  { id: 'ig-students', platform: 'instagram', name: 'NorthStar Students', handle: 'nsc.students', connected: true },
  { id: 'fb-church', platform: 'facebook', name: 'NorthStar Church', handle: 'northstarchurch', connected: true }
]
const demoAccountFor = (platform: PlatformId, campaign: string) =>
  platform === 'facebook' ? 'fb-church' : platform !== 'instagram' ? '' : campaign === 'WAVE' ? 'ig-students' : 'ig-kennesaw'

/** Placeholder artwork for the sample posts (drawn here, no outside images). */
export function art(label: string, hue: number, w: number, h: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 70% 58%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360} 75% 38%)"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/><circle cx="${w * 0.78}" cy="${h * 0.22}" r="${Math.min(w, h) * 0.16}" fill="rgba(255,255,255,.18)"/><text x="${w * 0.08}" y="${h * 0.86}" font-family="Helvetica Neue,Arial" font-weight="700" font-size="${Math.round(Math.min(w, h) * 0.065)}" fill="#fff" letter-spacing="-1">${label}</text></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

function demoPosts(): SocialPost[] {
  // Spread around today: some already posted, some coming up.
  const wk = startOfWeek(new Date())
  const day = (n: number) => format(addDays(wk, n), 'yyyy-MM-dd')
  const now = new Date().toISOString()
  type Seed = [PlatformId, number, string, PostStatus, string, string, string, [string, number, 'image' | 'video'] | null, string?]
  const seeds: Seed[] = [
    ['instagram', 1, '09:00', 'posted', 'Sunday Recap', 'Sarah Vanderheyden', 'What a Sunday! 🙌 Thank you to everyone who served this weekend. See you next week.', ['Sunday Recap', 200, 'image']],
    ['facebook', 1, '09:30', 'posted', 'Sunday Recap', 'Sarah Vanderheyden', 'What a Sunday! Thank you to everyone who served this weekend. Catch the message online anytime.', ['Sunday Recap', 200, 'image']],
    ['tiktok', 3, '18:00', 'scheduled', 'WAVE', 'Sarah Vanderheyden', 'POV: it’s Wednesday night at WAVE 🌊 #studentministry', ['WAVE Night', 280, 'video']],
    ['instagram', 4, '12:00', 'review', 'Christmas at NorthStar', 'Kendrick Banks', 'Save the date 🎄 Christmas at NorthStar is coming. Service times at the link in bio.', ['Christmas at NorthStar', 350, 'image']],
    ['facebook', 4, '12:15', 'review', 'Christmas at NorthStar', 'Kendrick Banks', 'Save the date! Christmas at NorthStar is coming. Service times and details: northstarchurch.org/christmas', ['Christmas at NorthStar', 350, 'image']],
    ['youtube', 6, '10:00', 'scheduled', 'Sermon Series', 'Jeremy Thompson', 'This week we continue our series. Grab your Bible and join us.\n\nChapters:\n0:00 Welcome\n4:10 Worship\n28:30 Message', ['Message: Week 3', 15, 'video'], 'Finding Our Way Home | Week 3'],
    ['instagram', 8, '08:00', 'draft', 'Sermon Series', 'Jeremy Thompson', 'Quote card from Sunday’s message.', ['Quote Card', 15, 'image']],
    ['tiktok', 9, '17:30', 'draft', 'Kids', 'Sarah Vanderheyden', 'Kids worship but make it loud 🎶', null],
    ['facebook', 10, '', 'idea', 'Christmas at NorthStar', 'Sarah Vanderheyden', 'Volunteer call-out for Christmas services', null],
    ['instagram', 11, '19:00', 'scheduled', 'Christmas at NorthStar', 'Sarah Vanderheyden', 'Two weeks out! Invite someone to Christmas at NorthStar ✨', ['Christmas at NorthStar', 350, 'image']],
    ['youtube', 13, '10:00', 'draft', 'Sermon Series', 'Jeremy Thompson', 'Week 4 of our series.', null, 'Finding Our Way Home | Week 4'],
    ['facebook', -2, '11:00', 'posted', 'Missions', 'Sarah Vanderheyden', 'Operation Christmas Child boxes are here! Pick one up after any service.', ['Shoebox Drive', 140, 'image']],
    ['instagram', -6, '17:00', 'posted', 'WAVE', 'Sarah Vanderheyden', 'Baptism Sunday at WAVE 💧 So proud of these students.', ['Baptisms', 190, 'image']],
    ['youtube', -8, '10:00', 'posted', 'Sermon Series', 'Jeremy Thompson', 'Week 1 of our new series.', ['Message: Week 1', 15, 'video'], 'Finding Our Way Home | Week 1'],
    ['tiktok', -11, '18:30', 'posted', 'Kids', 'Sarah Vanderheyden', 'Kids camp highlights ☀️', ['Kids Camp', 45, 'video']],
    ['facebook', 5, '15:00', 'scheduled', 'Respite Night', 'Sarah Vanderheyden', 'Christmas Respite Night is Nov 12 for kids and adults with special needs and their siblings. Register at the link!', ['Respite Night', 210, 'image']],
    ['facebook', -13, '09:00', 'posted', 'Connections', 'Kendrick Banks', 'New here? Join us for Starting Point after the 11am service.', ['Starting Point', 175, 'image']],
    ['instagram', 16, '12:00', 'idea', 'Christmas at NorthStar', 'Kendrick Banks', 'Behind the scenes: building the Christmas set', null],
    ['facebook', 18, '10:00', 'draft', 'Christmas at NorthStar', 'Kendrick Banks', 'One week until Christmas at NorthStar! Bring a friend.', ['Christmas at NorthStar', 350, 'image']]
  ]
  // One that didn't publish, to show what that looks like
  seeds.push(['instagram', 0, '07:00', 'scheduled', 'Sunday Recap', 'Sarah Vanderheyden', 'Throwback to Sunday’s baptisms 💧', ['Baptisms', 190, 'image']])
  return seeds.map(([platform, d, time, status, campaign, poster, caption, media, title], i) => {
    const failed = i === seeds.length - 1
    const pl = platformById(platform)
    const [w, h] = pl.aspect === '9/16' ? [540, 960] : pl.aspect === '16/9' ? [960, 540] : pl.aspect === '4/5' ? [800, 1000] : [1000, 800]
    const activity: PostActivity[] = [{ at: now, by: poster, what: 'created' }]
    if (status === 'review') activity.push({ at: now, by: poster, what: 'submitted for review' })
    if (status === 'scheduled' || status === 'posted') activity.push({ at: now, by: 'Sarah Vanderheyden', what: 'scheduled' })
    if (status === 'posted') activity.push({ at: now, by: poster, what: 'marked posted' })
    return {
      id: newId(),
      platform,
      title: title ?? '',
      caption,
      media: media ? [{ id: newId(), name: `${media[0]}.${media[2] === 'video' ? 'mp4' : 'jpg'}`, kind: media[2], url: art(media[0], media[1], w, h) }] : [],
      date: day(d),
      time,
      status,
      campaign,
      // A couple of samples show the other categories too.
      category: /Respite|special needs/i.test(caption) ? 'special-needs' : /quote card|week 1 of our new series/i.test(caption) ? 'discipleship' : SAMPLE_CATEGORY[campaign] ?? '',
      poster,
      author: poster,
      postUrl: status === 'posted' ? `https://www.${platform}.com/` : '',
      reviewNote: '',
      activity,
      account: demoAccountFor(platform, campaign),
      autoPublish: canAutoPublish(platform) && (status === 'scheduled' || status === 'posted'),
      publishState: failed ? 'failed' : '',
      publishError: failed ? 'Instagram couldn’t download the image in time. Try again.' : '',
      boardId: '',
      createdAt: now,
      updatedAt: now
    }
  })
}

export function createLocalSocialStore(me: () => string): SocialStore {
  let posts: SocialPost[]
  try {
    posts = JSON.parse(localStorage.getItem(KEY) ?? 'null') ?? demoPosts()
  } catch {
    posts = demoPosts()
  }
  const listeners = new Set<() => void>()
  const commit = () => {
    try {
      // Uploaded files only live for this session in the preview; keep the rest.
      localStorage.setItem(KEY, JSON.stringify(posts.map((p) => ({ ...p, media: p.media.filter((m) => !m.url.startsWith('blob:')) }))))
    } catch {
      /* storage full or blocked: changes last until the page reloads */
    }
    listeners.forEach((l) => l())
  }
  const log = (what: string, note?: string): PostActivity => ({ at: new Date().toISOString(), by: me(), what, ...(note ? { note } : {}) })
  const published = (p: SocialPost, what: string): SocialPost => {
    const acct = DEMO_ACCOUNTS.find((a) => a.id === p.account)
    return {
      ...p,
      status: 'posted',
      publishState: '',
      publishError: '',
      postUrl: p.platform === 'instagram' ? `https://www.instagram.com/${acct?.handle ?? 'nsckennesaw'}/` : 'https://www.facebook.com/',
      activity: [...p.activity, { at: new Date().toISOString(), by: 'Constellation', what: `${what} to ${platformById(p.platform).label}${acct && p.platform === 'instagram' ? ` (@${acct.handle})` : ''}` }],
      updatedAt: new Date().toISOString()
    }
  }

  return {
    mode: 'demo',
    load: async () => {
      // Stand-in for the server: auto-publish posts whose time has come
      const due = posts.filter((p) => p.status === 'scheduled' && p.autoPublish && !p.publishState && p.date && p.time && new Date(`${p.date}T${p.time}`) <= new Date())
      if (due.length) {
        posts = posts.map((p) => (due.includes(p) ? published(p, 'published automatically') : p))
        commit()
      }
      return structuredClone(posts)
    },
    subscribe(onChange) {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    },
    async create(draft, platforms, what, accounts) {
      const now = new Date().toISOString()
      const made = platforms.map(
        (platform): SocialPost => ({
          postUrl: '',
          reviewNote: '',
          ...draft,
          platform,
          account: accounts?.[platform] ?? '',
          autoPublish: draft.autoPublish && canAutoPublish(platform),
          publishState: '',
          publishError: '',
          title: platform === 'youtube' ? draft.title : '',
          id: newId(),
          author: me(),
          activity: [log('created'), ...(what && what !== 'created' ? [log(what)] : [])],
          createdAt: now,
          updatedAt: now
        })
      )
      posts = [...posts, ...made]
      commit()
      return made
    },
    async update(id, patch, what, note) {
      const before = posts.find((p) => p.id === id)
      if (!before) throw new Error('That post no longer exists.')
      const after: SocialPost = { ...before, ...patch, updatedAt: new Date().toISOString(), activity: what ? [...before.activity, log(what, note)] : before.activity }
      posts = posts.map((p) => (p.id === id ? after : p))
      commit()
      return after
    },
    async remove(id) {
      posts = posts.filter((p) => p.id !== id)
      commit()
    },
    accounts: async () => DEMO_ACCOUNTS,
    async publishNow(id) {
      const p = posts.find((x) => x.id === id)
      if (!p) throw new Error('That post no longer exists.')
      await new Promise((r) => setTimeout(r, 1200)) // feels like the real thing
      const after = published(p, 'published')
      posts = posts.map((x) => (x.id === id ? after : x))
      commit()
      return after
    },
    mediaFromStudio: async (media) => media.map((m) => ({ id: newId(), name: m.name, kind: 'image' as const, url: m.url })),
    async addMedia(original) {
      const { file, w, h } = await prepareImage(original)
      const kind = file.type.startsWith('video/') ? 'video' : 'image'
      // Small images survive a reload in the preview; everything else is kept for this session.
      const url =
        kind === 'image' && file.size < 900_000
          ? await new Promise<string>((res, rej) => {
              const r = new FileReader()
              r.onload = () => res(String(r.result))
              r.onerror = () => rej(new Error('Couldn’t read that file.'))
              r.readAsDataURL(file)
            })
          : URL.createObjectURL(file)
      return { id: newId(), name: file.name, kind, url, ...(w && h ? { w, h } : {}) }
    },
    mediaUrl: async (m) => m.url
  }
}
