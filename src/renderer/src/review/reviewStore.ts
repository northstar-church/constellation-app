import { newId } from '../data/constants'
import { leavesStreamAt, type Review, type ReviewComment, type ReviewDecision, type ReviewSnapshot, type ReviewVersion, type ShareLink } from '../data/review'
import { call, download, subscribeLive, upload } from '../data/cloudStore'
import { probeFile } from './probe'

export type NewComment = Pick<ReviewComment, 'reviewId' | 'versionId' | 'parentId' | 'body' | 't' | 'tEnd' | 'pin' | 'drawing'>
export type LinkOptions = Pick<ShareLink, 'label' | 'allowComments' | 'allowDownload' | 'allVersions' | 'expiresAt'>

/** Who is looking: a teammate, or a guest from a review link */
export interface Viewer {
  name: string
  guest: boolean
  canComment: boolean
  canDownload: boolean
  /** Guests on a link can approve; teammates always can */
  canDecide: boolean
  /** Only the team manages status, versions and links */
  canManage: boolean
}

export interface ReviewStore {
  mode: 'demo' | 'cloud'
  load(): Promise<ReviewSnapshot>
  subscribe(onChange: () => void): () => void
  /** A new review with its first version */
  createReview(input: { title: string; folder: string; requestId: string | null }, file: File, onProgress?: (pct: number) => void): Promise<Review>
  /** Uploads v2, v3… onto a review */
  addVersion(reviewId: string, file: File, onProgress?: (pct: number) => void): Promise<void>
  updateReview(id: string, patch: Partial<Pick<Review, 'title' | 'folder' | 'status' | 'requestId' | 'keep'>>): Promise<void>
  /** Puts an archived version back on Stream from its original (takes a minute or two) */
  restoreVersion(reviewId: string, versionId: string): Promise<void>
  deleteReview(id: string): Promise<void>
  deleteVersion(reviewId: string, versionId: string): Promise<void>
  setFps(reviewId: string, versionId: string, fps: number): Promise<void>
  addComment(c: NewComment): Promise<ReviewComment>
  updateComment(id: string, patch: Partial<Pick<ReviewComment, 'body' | 'resolved'>>): Promise<void>
  deleteComment(id: string): Promise<void>
  /** Adds or removes the viewer's reaction */
  react(id: string, emoji: string): Promise<void>
  decide(reviewId: string, versionId: string, decision: ReviewDecision['decision'], note: string): Promise<void>
  createLink(reviewId: string, opts: LinkOptions): Promise<ShareLink>
  updateLink(id: string, patch: Partial<Pick<ShareLink, 'active' | 'allowComments' | 'allowDownload' | 'allVersions' | 'expiresAt' | 'label'>>): Promise<void>
  /** The address a review link opens */
  linkUrl(l: ShareLink): string
  /** Where the player loads the version from */
  mediaUrl(v: ReviewVersion): Promise<string>
  /** A still of the video at a moment, for timeline hover (null = the player makes its own) */
  thumbAt(v: ReviewVersion, t: number): string | null
  /** The poster frame, ready for an <img> */
  thumbUrl(v: ReviewVersion): Promise<string>
  /** The original file, ready to save */
  downloadUrl(v: ReviewVersion): Promise<string>
}

// ---------- demo: sample reviews saved only in this browser ----------

const KEY = 'constellation.review.v2'
type Samples = { v1: string; v2: string; still: string }
let samples: Promise<Samples> | null = null
const loadSamples = () =>
  (samples ??= Promise.all([import('./samples/v1.mp4?inline'), import('./samples/v2.mp4?inline'), import('./samples/still.jpg?inline')]).then(([a, b, c]) => ({
    v1: a.default,
    v2: b.default,
    still: c.default
  })))

function demoSnapshot(): ReviewSnapshot {
  const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString()
  const ver = (n: number, src: string, name: string, by: string, h: number, kind: 'video' | 'image' = 'video'): ReviewVersion => ({
    id: newId(),
    n,
    kind,
    name,
    size: kind === 'video' ? 58_000_000 : 2_400_000,
    duration: kind === 'video' ? 12 : 0,
    fps: 30,
    width: kind === 'video' ? 1920 : 1080,
    height: kind === 'video' ? 1080 : 1350,
    state: 'ready',
    src,
    thumb: '',
    uploadedBy: by,
    at: ago(h),
    archived: false,
    hasOriginal: true
  })
  const promo: Review = {
    id: newId(),
    title: 'Christmas Promo :15',
    folder: 'Christmas 2026',
    status: 'needs-review',
    requestId: null,
    versions: [ver(1, 'sample:v1', 'Christmas_Promo_v1.mp4', 'Kendrick Banks', 50), ver(2, 'sample:v2', 'Christmas_Promo_v2.mp4', 'Kendrick Banks', 5)],
    createdBy: 'Kendrick Banks',
    createdAt: ago(50),
    updatedAt: ago(5),
    keep: false
  }
  const graphic: Review = {
    id: newId(),
    title: 'Advent Series IG Graphic',
    folder: 'Christmas 2026',
    status: 'changes',
    requestId: null,
    versions: [ver(1, 'sample:still', 'Advent_IG_4x5.jpg', 'Jeremy Thompson', 20, 'image')],
    createdBy: 'Jeremy Thompson',
    createdAt: ago(20),
    updatedAt: ago(3),
    keep: false
  }
  const recap: Review = {
    id: newId(),
    title: 'Baptism Sunday Recap',
    folder: 'Sunday Recaps',
    status: 'approved',
    requestId: null,
    versions: [ver(1, 'sample:v1', 'Baptism_Recap_v1.mp4', 'Kendrick Banks', 90)],
    createdBy: 'Kendrick Banks',
    createdAt: ago(90),
    updatedAt: ago(70),
    keep: false
  }
  // From last spring: long since taken off Stream, still restorable
  const easter: Review = {
    id: newId(),
    title: 'Easter Sunday Opener',
    folder: 'Easter 2026',
    status: 'approved',
    requestId: null,
    versions: [{ ...ver(1, 'sample:v1', 'Easter_Opener_v1.mp4', 'Kendrick Banks', 24 * 200), archived: true }, { ...ver(2, 'sample:v2', 'Easter_Opener_v2.mp4', 'Kendrick Banks', 24 * 190), archived: true }],
    createdBy: 'Kendrick Banks',
    createdAt: ago(24 * 200),
    updatedAt: ago(24 * 185),
    keep: false
  }
  const [p1, p2] = promo.versions
  const c = (r: Review, v: ReviewVersion, author: string, body: string, t: number | null, extra: Partial<ReviewComment> = {}): ReviewComment => ({
    id: newId(),
    reviewId: r.id,
    versionId: v.id,
    parentId: null,
    author,
    guest: false,
    body,
    t,
    tEnd: null,
    pin: null,
    drawing: [],
    resolved: false,
    reactions: {},
    at: ago(4),
    editedAt: null,
    ...extra
  })
  const titleNote = c(promo, p2, 'Jeremy Thompson', 'Can we make the title a touch bigger and hold it 10 more frames?', 1.2, {
    drawing: [{ tool: 'rect', color: '#ffcc00', points: [[0.13, 0.33], [0.87, 0.47]] }],
    reactions: { '👍': ['Sarah Vanderheyden'] }
  })
  const comments: ReviewComment[] = [
    c(promo, p1, 'Jeremy Thompson', 'Colors feel flat in the first shot. Warm it up?', 0.5, { resolved: true, at: ago(40) }),
    c(promo, p1, 'Sarah Vanderheyden', 'Music hits late here; cut on the beat.', 6.0, { resolved: true, at: ago(39) }),
    titleNote,
    { ...c(promo, p2, 'Kendrick Banks', 'On it. Will bump to 40pt.', 1.2), parentId: titleNote.id, at: ago(3) },
    c(promo, p2, 'Sarah Vanderheyden', 'Love this transition 🔥', 3.0, { tEnd: 3.8, reactions: { '❤️': ['Jeremy Thompson', 'Kendrick Banks'] } }),
    c(promo, p2, 'Pastor Mike', 'Can the last shot say “Dec 21–24” instead of the date range?', 10.5, {
      guest: true,
      drawing: [{ tool: 'arrow', color: '#ff3b30', points: [[0.75, 0.75], [0.55, 0.55]] }]
    }),
    c(graphic, graphic.versions[0], 'Sarah Vanderheyden', 'The subtitle gets cut off on the grid view. Nudge everything up a bit.', null, { pin: [0.5, 0.52] }),
    c(graphic, graphic.versions[0], 'Jeremy Thompson', 'Add the church logo bottom center.', null, {
      pin: [0.5, 0.9],
      drawing: [{ tool: 'ellipse', color: '#00b7e2', points: [[0.38, 0.84], [0.62, 0.96]] }]
    }),
    c(recap, recap.versions[0], 'Sarah Vanderheyden', 'Perfect. Posting Sunday afternoon.', null, { resolved: true, at: ago(70) })
  ]
  const decisions: ReviewDecision[] = [
    { id: newId(), reviewId: recap.id, versionId: recap.versions[0].id, by: 'Sarah Vanderheyden', guest: false, decision: 'approved', note: '', at: ago(70) },
    { id: newId(), reviewId: graphic.id, versionId: graphic.versions[0].id, by: 'Sarah Vanderheyden', guest: false, decision: 'changes', note: 'Two small fixes, see comments.', at: ago(3) }
  ]
  const links: ShareLink[] = [
    {
      id: newId(),
      reviewId: promo.id,
      token: 'demo-' + newId().slice(0, 8),
      label: 'Pastor Mike',
      allowComments: true,
      allowDownload: false,
      allVersions: false,
      expiresAt: null,
      active: true,
      views: 3,
      createdBy: 'Jeremy Thompson',
      createdAt: ago(5)
    }
  ]
  return { reviews: [promo, graphic, recap, easter], comments, decisions, links }
}

export function createLocalReviewStore(actor: () => { name: string; guest: boolean }): ReviewStore {
  const me = () => actor().name
  let state: ReviewSnapshot
  try {
    state = JSON.parse(localStorage.getItem(KEY) ?? 'null') ?? demoSnapshot()
  } catch {
    state = demoSnapshot()
  }
  // Files picked in the preview only last for this session
  const dropBlobs = (s: ReviewSnapshot): ReviewSnapshot => {
    const reviews = s.reviews.map((r) => ({ ...r, versions: r.versions.filter((v) => !v.src.startsWith('blob:')) })).filter((r) => r.versions.length)
    return { ...s, reviews }
  }
  const listeners = new Set<() => void>()
  const commit = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(dropBlobs(state)))
    } catch {
      /* storage full or blocked */
    }
    listeners.forEach((l) => l())
  }
  const now = () => new Date().toISOString()
  const touch = (id: string, patch: Partial<Review> = {}) => {
    state = { ...state, reviews: state.reviews.map((r) => (r.id === id ? { ...r, ...patch, updatedAt: now() } : r)) }
  }
  async function makeVersion(file: File, n: number, onProgress?: (p: number) => void): Promise<ReviewVersion> {
    const p = await probeFile(file)
    // A pretend upload, so the progress bar can be seen in the preview
    for (let i = 1; i <= 5; i++) {
      await new Promise((r) => setTimeout(r, 120))
      onProgress?.(i * 20)
    }
    return {
      id: newId(),
      n,
      kind: p.kind,
      name: file.name,
      size: file.size,
      duration: p.duration,
      fps: 30,
      width: p.width,
      height: p.height,
      state: p.playable ? 'ready' : 'error',
      src: URL.createObjectURL(file),
      thumb: p.thumb,
      uploadedBy: me(),
      at: now(),
      archived: false,
      hasOriginal: true
    }
  }

  return {
    mode: 'demo',
    load: async () => {
      // Stand-in for Cloudflare: past their date, videos leave Stream
      let changed = false
      state = {
        ...state,
        reviews: state.reviews.map((r) => {
          const versions = r.versions.map((v) => {
            const at = leavesStreamAt(r, v)
            if (at && at.getTime() < Date.now()) {
              changed = true
              return { ...v, archived: true }
            }
            return v
          })
          return changed ? { ...r, versions } : r
        })
      }
      if (changed) commit()
      return structuredClone(state)
    },
    subscribe(onChange) {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    },
    async createReview(input, file, onProgress) {
      const v = await makeVersion(file, 1, onProgress)
      const r: Review = { id: newId(), title: input.title.trim() || file.name.replace(/\.[^.]+$/, ''), folder: input.folder.trim(), status: 'in-progress', requestId: input.requestId, versions: [v], keep: false, createdBy: me(), createdAt: now(), updatedAt: now() }
      state = { ...state, reviews: [r, ...state.reviews] }
      commit()
      return r
    },
    async addVersion(reviewId, file, onProgress) {
      const r = state.reviews.find((x) => x.id === reviewId)
      if (!r) throw new Error('That review no longer exists.')
      const v = await makeVersion(file, Math.max(0, ...r.versions.map((x) => x.n)) + 1, onProgress)
      touch(reviewId, { versions: [...r.versions, v], status: 'needs-review' })
      commit()
    },
    async updateReview(id, patch) {
      touch(id, patch)
      commit()
    },
    async restoreVersion(reviewId, versionId) {
      const r = state.reviews.find((x) => x.id === reviewId)
      if (!r) return
      touch(reviewId, { versions: r.versions.map((v) => (v.id === versionId ? { ...v, state: 'processing' } : v)) })
      commit()
      await new Promise((res) => setTimeout(res, 1500)) // Stream re-importing the original
      const again = state.reviews.find((x) => x.id === reviewId)!
      // Restoring counts as activity, and an old version gets a fresh 14 days
      touch(reviewId, { versions: again.versions.map((v) => (v.id === versionId ? { ...v, state: 'ready', archived: false, restoredAt: now() } : v)) })
      commit()
    },
    async deleteReview(id) {
      state = {
        reviews: state.reviews.filter((r) => r.id !== id),
        comments: state.comments.filter((c) => c.reviewId !== id),
        decisions: state.decisions.filter((d) => d.reviewId !== id),
        links: state.links.filter((l) => l.reviewId !== id)
      }
      commit()
    },
    async deleteVersion(reviewId, versionId) {
      const r = state.reviews.find((x) => x.id === reviewId)
      if (!r || r.versions.length < 2) throw new Error('A review needs at least one version. Delete the review instead.')
      touch(reviewId, { versions: r.versions.filter((v) => v.id !== versionId) })
      state = { ...state, comments: state.comments.filter((c) => c.versionId !== versionId) }
      commit()
    },
    async setFps(reviewId, versionId, fps) {
      const r = state.reviews.find((x) => x.id === reviewId)
      if (!r) return
      touch(reviewId, { versions: r.versions.map((v) => (v.id === versionId ? { ...v, fps } : v)) })
      commit()
    },
    async addComment(input) {
      const c: ReviewComment = { ...input, id: newId(), author: me(), guest: actor().guest, resolved: false, reactions: {}, at: now(), editedAt: null }
      state = { ...state, comments: [...state.comments, c] }
      touch(input.reviewId)
      commit()
      return c
    },
    async updateComment(id, patch) {
      state = { ...state, comments: state.comments.map((c) => (c.id === id ? { ...c, ...patch, ...('body' in patch ? { editedAt: now() } : {}) } : c)) }
      commit()
    },
    async deleteComment(id) {
      state = { ...state, comments: state.comments.filter((c) => c.id !== id && c.parentId !== id) }
      commit()
    },
    async react(id, emoji) {
      const who = me()
      state = {
        ...state,
        comments: state.comments.map((c) => {
          if (c.id !== id) return c
          const list = c.reactions[emoji] ?? []
          const next = list.includes(who) ? list.filter((n) => n !== who) : [...list, who]
          const reactions = { ...c.reactions, [emoji]: next }
          if (!next.length) delete reactions[emoji]
          return { ...c, reactions }
        })
      }
      commit()
    },
    async decide(reviewId, versionId, decision, note) {
      const d: ReviewDecision = { id: newId(), reviewId, versionId, by: me(), guest: actor().guest, decision, note: note.trim(), at: now() }
      state = { ...state, decisions: [...state.decisions, d] }
      touch(reviewId, { status: decision === 'approved' ? 'approved' : 'changes' })
      commit()
    },
    async createLink(reviewId, opts) {
      const l: ShareLink = { ...opts, id: newId(), reviewId, token: newId().replace(/-/g, '').slice(0, 20), active: true, views: 0, createdBy: me(), createdAt: now() }
      state = { ...state, links: [...state.links, l] }
      commit()
      return l
    },
    async updateLink(id, patch) {
      state = { ...state, links: state.links.map((l) => (l.id === id ? { ...l, ...patch } : l)) }
      commit()
    },
    linkUrl: (l) => `https://constellation.northstar-creative.workers.dev/review/${l.token}`,
    async mediaUrl(v) {
      if (v.src.startsWith('sample:')) return (await loadSamples())[v.src.slice(7) as keyof Samples]
      return v.src
    },
    thumbAt: () => null,
    thumbUrl: async (v) => v.thumb,
    async downloadUrl(v) {
      if (v.src.startsWith('sample:')) return (await loadSamples())[v.src.slice(7) as keyof Samples]
      return v.src
    }
  }
}


// ---------- team: shared on Cloudflare (originals in R2, playback from Stream) ----------

/** Stream's still at a moment, from a version's HLS address */
export const streamThumb = (v: ReviewVersion, t: number) =>
  /\/manifest\/video\.m3u8/.test(v.src) ? v.src.replace(/\/manifest\/video\.m3u8.*$/, `/thumbnails/thumbnail.jpg?time=${Math.max(0, t).toFixed(2)}s&height=120`) : null

export function createCloudReviewStore(): ReviewStore {
  const blobs = new Map<string, Promise<string>>()
  const blobUrl = (path: string) => {
    let p = blobs.get(path)
    if (!p) {
      p = download(path).then((b) => URL.createObjectURL(b))
      p.catch(() => blobs.delete(path))
      blobs.set(path, p)
    }
    return p
  }
  let processing = false
  const base = () => (window.hub?.hubUrl || location.origin).replace(/\/$/, '')

  /** Sends a file up in 50 MB pieces (so long videos fit), then creates the review or the next version. */
  async function send(file: File, extra: Record<string, unknown>, onProgress?: (p: number) => void): Promise<Review> {
    const probe = await probeFile(file)
    const start = await call<{ id: string; partSize: number }>('/api/review/upload/start', 'POST', { name: file.name, contentType: file.type, size: file.size })
    const count = Math.max(1, Math.ceil(file.size / start.partSize))
    for (let i = 0; i < count; i++) {
      const piece = file.slice(i * start.partSize, Math.min(file.size, (i + 1) * start.partSize), 'application/octet-stream')
      for (let attempt = 1; ; attempt++) {
        try {
          await upload(`/api/review/upload/${start.id}/part?n=${i + 1}`, piece)
          break
        } catch (e) {
          if (attempt >= 3) throw e
          await new Promise((r) => setTimeout(r, 1500 * attempt))
        }
      }
      onProgress?.(Math.round(((i + 1) / count) * 95))
    }
    const r = await call<Review>(`/api/review/upload/${start.id}/finish`, 'POST', { ...extra, duration: probe.duration, width: probe.width, height: probe.height, thumb: probe.thumb })
    onProgress?.(100)
    return r
  }

  return {
    mode: 'cloud',
    async load() {
      const s = await call<ReviewSnapshot>('/api/review')
      processing = s.reviews.some((r) => r.versions.some((v) => v.state === 'processing'))
      return s
    },
    subscribe(onChange) {
      const off = subscribeLive(['review'], onChange)
      // Stream doesn't call us when a video is ready, so look again while something is processing
      const id = setInterval(() => processing && onChange(), 12_000)
      return () => {
        off()
        clearInterval(id)
      }
    },
    createReview: (input, file, onProgress) => send(file, { title: input.title, folder: input.folder, requestId: input.requestId }, onProgress),
    async addVersion(reviewId, file, onProgress) {
      await send(file, { reviewId }, onProgress)
    },
    updateReview: (id, patch) => call(`/api/review/${id}`, 'PATCH', patch).then(() => undefined),
    restoreVersion: (reviewId, versionId) => call(`/api/review/${reviewId}/versions/${versionId}/restore`, 'POST').then(() => undefined),
    deleteReview: (id) => call(`/api/review/${id}`, 'DELETE').then(() => undefined),
    deleteVersion: (reviewId, versionId) => call(`/api/review/${reviewId}/versions/${versionId}`, 'DELETE').then(() => undefined),
    setFps: (reviewId, versionId, fps) => call(`/api/review/${reviewId}/versions/${versionId}/fps`, 'POST', { fps }).then(() => undefined),
    addComment: (c) => call<ReviewComment>('/api/review/comments', 'POST', c),
    updateComment: (id, patch) => call(`/api/review/comments/${id}`, 'PATCH', patch).then(() => undefined),
    deleteComment: (id) => call(`/api/review/comments/${id}`, 'DELETE').then(() => undefined),
    react: (id, emoji) => call(`/api/review/comments/${id}/react`, 'POST', { emoji }).then(() => undefined),
    decide: (reviewId, versionId, decision, note) => call(`/api/review/${reviewId}/decide`, 'POST', { versionId, decision, note }).then(() => undefined),
    createLink: (reviewId, opts) => call<ShareLink>(`/api/review/${reviewId}/links`, 'POST', opts),
    updateLink: (id, patch) => call(`/api/review/links/${id}`, 'PATCH', patch).then(() => undefined),
    linkUrl: (l) => `${base()}/track/review/${l.token}`,
    mediaUrl: async (v) => (v.kind === 'video' ? v.src : blobUrl(v.src)),
    thumbAt: streamThumb,
    thumbUrl: (v) => (v.thumb ? blobUrl(v.thumb) : Promise.resolve('')),
    downloadUrl: (v) => blobUrl(`/api/review/download/${v.id}`)
  }
}
