import { addDays, format } from 'date-fns'
import { call, download, subscribeLive, upload } from '../data/cloudStore'
import { newId } from '../data/constants'
import { DEFAULT_TEAM, normalizeAssignees, primaryAssignee, type FileKind, type MediaRequest, type Notification, type RequestComment, type RequestEvent, type RequestFile, type RequestsSnapshot, type StageId, type TeamMember } from '../data/requests'

export type RequestPatch = Partial<
  Pick<MediaRequest, 'title' | 'details' | 'deliverables' | 'ministry' | 'requesterName' | 'requesterEmail' | 'dueDate' | 'eventDate' | 'eventId' | 'assignees' | 'proofUrl' | 'stage' | 'sortOrder'>
> & {
  /** Sent to the requester with a stage change */
  message?: string
}

export type NewRequest = Pick<MediaRequest, 'title' | 'details' | 'deliverables' | 'ministry' | 'requesterName' | 'requesterEmail' | 'dueDate'> & { eventDate?: string | null }

export interface RequestStore {
  mode: 'demo' | 'cloud'
  load(): Promise<RequestsSnapshot>
  subscribe(onChange: () => void): () => void
  create(input: NewRequest): Promise<MediaRequest>
  update(id: string, patch: RequestPatch): Promise<void>
  /** A note to the requester without changing the stage */
  note(id: string, message: string): Promise<void>
  remove(id: string): Promise<void>
  trackerUrl(r: MediaRequest): string
  upload(id: string, kind: FileKind, file: File): Promise<RequestFile>
  removeFile(id: string, fileId: string): Promise<void>
  /** The stored file's bytes, for thumbnails and downloads */
  fileBlob(f: RequestFile): Promise<Blob>
  /** Team-only comment; notifies the project manager and the assigned team member */
  comment(id: string, body: string): Promise<void>
  notifications: NotificationStore
  /** The creative team roster (names, emails, project manager) */
  team(): Promise<TeamMember[]>
}

export interface NotificationStore {
  list(): Promise<Notification[]>
  markRead(ids: string[] | null): Promise<void>
  subscribe(onChange: () => void): () => void
}

export function createCloudRequestStore(): RequestStore {
  const base = () => window.hub?.hubUrl || location.origin
  return {
    mode: 'cloud',
    load: () => call<RequestsSnapshot>('/api/requests'),
    subscribe: (onChange) => subscribeLive(['requests'], onChange),
    create: (input) => call<MediaRequest>('/api/requests', 'POST', input),
    async update(id, patch) {
      await call(`/api/requests/${id}`, 'PATCH', patch)
    },
    async note(id, message) {
      await call(`/api/requests/${id}/note`, 'POST', { message })
    },
    async remove(id) {
      await call(`/api/requests/${id}`, 'DELETE')
    },
    trackerUrl: (r) => `${base()}/track/${r.token}`,
    upload: (id, kind, file) => upload<RequestFile>(`/api/requests/${id}/files?kind=${kind}&name=${encodeURIComponent(file.name)}`, file),
    async removeFile(id, fileId) {
      await call(`/api/requests/${id}/files/${fileId}`, 'DELETE')
    },
    fileBlob: (f) => download(`/api/requests/${f.requestId}/files/${f.id}`),
    async comment(id, body) {
      await call(`/api/requests/${id}/comments`, 'POST', { body })
    },
    team: () => call<TeamMember[]>('/api/team'),
    notifications: {
      list: () => call<Notification[]>('/api/notifications'),
      async markRead(ids) {
        await call('/api/notifications/read', 'POST', ids ? { ids } : {})
      },
      subscribe: (onChange) => subscribeLive(['notifications'], onChange)
    }
  }
}

// ---------- demo mode: sample requests saved only on this computer ----------

const KEY = 'constellation.requests.v6'

function demoSnapshot(): RequestsSnapshot {
  const day = (n: number) => format(addDays(new Date(), n), 'yyyy-MM-dd')
  const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString()
  const seeds: [string, string[], string, string, string, number | null, StageId, string, number][] = [
    ['Branded Thank You Cards - Community Style', ['Branding', 'Print'], 'Community', 'Lauren Price', 'lauren.price', 30, 'received', '', 30],
    ['Kids Birthday door banner', ['Graphic', 'Signage', 'Branding'], 'Kids', 'Megan Ross', 'megan.ross', 14, 'received', '', 5],
    ['NorthStar en Español event 11/13/2026', ['Website/App', 'Photo', 'Social', 'Graphic'], 'Community', 'Daniel Ortiz', 'daniel.ortiz', 19, 'scheduled', 'Sarah Vanderheyden', 50],
    ['Community Sign-ups tutorial', ['Video', 'Photo'], 'Community', 'Lauren Price', 'lauren.price', 21, 'scheduled', 'Jeremy Thompson', 70],
    ['Thrive Ministry branding', ['Website/App', 'Branding'], 'Kids', 'Megan Ross', 'megan.ross', 40, 'design', 'Sarah Vanderheyden', 120],
    ['Married Small Grp. Commercial', ['Graphic', 'Video', 'Branding'], 'Small Groups', 'Chris Bennett', 'chris.bennett', 16, 'design', 'Jeremy Thompson+Kendrick Banks', 96],
    ['Married Date Night promo', ['Graphic', 'Video', 'Signage', 'Social', 'Print'], 'Small Groups', 'Chris Bennett', 'chris.bennett', 9, 'proof', 'Sarah Vanderheyden', 200],
    ['2026-27 Legacy Makers dates', ['Website/App'], 'Small Groups', 'Pam Whitaker', 'pam.whitaker', 12, 'approved', 'Jeremy Thompson', 260],
    ['Membership Dates YTG 2026', ['Website/App'], 'Connections', 'Tasha Green', 'tasha.green', null, 'delivered', 'Jeremy Thompson', 400]
  ]
  const requests: MediaRequest[] = []
  const history: RequestEvent[] = []
  const order = ['received', 'scheduled', 'design', 'proof', 'approved', 'delivered'] as StageId[]
  seeds.forEach(([title, deliverables, ministry, name, email, due, stage, assignee, hoursAgo], i) => {
    const id = newId()
    const created = ago(hoursAgo)
    requests.push({
      id,
      token: `demo-${i}-${id.slice(0, 8)}`,
      title,
      details: `Requested through the media request form.\nAudience: ${ministry} ministry families and guests.`,
      deliverables,
      ministry,
      requesterName: name,
      requesterEmail: `${email}@northstarchurch.org`,
      dueDate: due === null ? null : day(due),
      // Requests for events carry the event date (a few days after the due date in the demo).
      eventDate: due === null || deliverables.includes('Website/App') ? null : day(due + 5),
      eventId: null,
      stage,
      // "A+B" in the seeds = two people on it; in the demo the first one has finished their part.
      assignees: assignee ? assignee.split('+').map((name, n, all) => ({ name, done: all.length > 1 && n === 0 })) : [],
      assignee: assignee.split('+').pop() ?? '',
      proofUrl: order.indexOf(stage) >= 3 ? 'https://www.figma.com/' : '',
      publicNote: stage === 'proof' ? 'Two options in the file. Let us know which one you like!' : '',
      sortOrder: i,
      source: 'typeform',
      createdAt: created,
      updatedAt: created,
      updatedBy: assignee.split('+')[0] || name
    })
    history.push({ id: newId(), requestId: id, at: created, kind: 'created', stage: 'received', message: '', by: name, public: true })
    for (let s = 1; s <= order.indexOf(stage); s++) {
      history.push({ id: newId(), requestId: id, at: ago(hoursAgo - s * 6), kind: 'stage', stage: order[s], message: '', by: assignee.split('+')[0] || 'Jeremy Thompson', public: true })
    }
  })
  return { requests, history, files: [], comments: [] }
}

/** Demo-mode file bytes live in memory only (they vanish on reload). */
const demoBlobs = new Map<string, Blob>()

export function createLocalRequestStore(me: string, meEmail = 'jeremy.thompson@northstarchurch.org'): RequestStore {
  let state: RequestsSnapshot
  try {
    state = JSON.parse(localStorage.getItem(KEY) ?? 'null') ?? demoSnapshot()
    state.files ??= []
    state.comments ??= []
  } catch {
    state = demoSnapshot()
  }
  const listeners = new Set<() => void>()
  const commit = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state))
    } catch {
      /* in memory only */
    }
    listeners.forEach((l) => l())
  }
  const event = (requestId: string, kind: RequestEvent['kind'], stage: StageId | null, message: string, isPublic = true): RequestEvent => ({
    id: newId(),
    requestId,
    at: new Date().toISOString(),
    kind,
    stage,
    message,
    by: me,
    public: isPublic
  })

  return {
    mode: 'demo',
    load: async () => structuredClone(state),
    subscribe(onChange) {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    },
    async create(input) {
      const now = new Date().toISOString()
      const r: MediaRequest = {
        ...input,
        eventDate: input.eventDate ?? null,
        eventId: null,
        id: newId(),
        token: `demo-${newId()}`,
        stage: 'received',
        assignee: '',
        assignees: [],
        proofUrl: '',
        publicNote: '',
        sortOrder: Date.now(),
        source: 'manual',
        createdAt: now,
        updatedAt: now,
        updatedBy: me
      }
      state = { ...state, requests: [...state.requests, r], history: [...state.history, event(r.id, 'created', 'received', '')] }
      commit()
      return r
    },
    async update(id, patch) {
      const before = state.requests.find((r) => r.id === id)
      if (!before) return
      const { message = '', ...fields } = patch
      if (fields.proofUrl && !/^https?:\/\//i.test(fields.proofUrl)) throw new Error('Proof link must be a web address starting with https://')
      if (fields.stage === 'proof' && before.stage !== 'proof' && !(fields.proofUrl ?? before.proofUrl) && !state.files.some((f) => f.requestId === id && f.kind === 'proof')) {
        throw new Error('Add a proof link or upload a proof file first, so the requester has something to review.')
      }
      const after: MediaRequest = { ...before, ...fields, updatedAt: new Date().toISOString(), updatedBy: me }
      if (fields.assignees) after.assignees = normalizeAssignees(fields.assignees)
      after.assignee = primaryAssignee(after.assignees)
      const added: RequestEvent[] = []
      for (const a of after.assignees) {
        if (a.done && !before.assignees.some((o) => o.name === a.name && o.done)) added.push(event(id, 'partdone', null, a.name, false))
      }
      if (after.stage !== before.stage) {
        after.publicNote = message
        added.push(event(id, 'stage', after.stage, message))
      }
      if (after.proofUrl && after.proofUrl !== before.proofUrl) added.push(event(id, 'proof', null, '', after.stage === 'proof'))
      state = { ...state, requests: state.requests.map((r) => (r.id === id ? after : r)), history: [...state.history, ...added] }
      commit()
    },
    async note(id, message) {
      state = {
        ...state,
        requests: state.requests.map((r) => (r.id === id ? { ...r, publicNote: message } : r)),
        history: [...state.history, event(id, 'note', null, message)]
      }
      commit()
    },
    async remove(id) {
      state = { requests: state.requests.filter((r) => r.id !== id), history: state.history.filter((h) => h.requestId !== id), files: state.files.filter((f) => f.requestId !== id), comments: state.comments.filter((c) => c.requestId !== id) }
      commit()
    },
    trackerUrl: (r) => `https://constellation.northstarchurch.org/track/${r.token}`,
    async upload(id, kind, file) {
      if (kind === 'proof' && !['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'].includes(file.type)) {
        throw new Error('Proofs can be JPG, PNG, GIF, WebP or PDF. Use Final Artwork for other file types.')
      }
      const f: RequestFile = { id: newId(), requestId: id, kind, name: file.name, contentType: file.type || 'application/octet-stream', size: file.size, uploadedBy: me, at: new Date().toISOString() }
      demoBlobs.set(f.id, file)
      state = { ...state, files: [...state.files, f], history: [...state.history, event(id, kind === 'proof' ? 'proof' : 'final', null, file.name, kind === 'proof')] }
      commit()
      return f
    },
    async removeFile(_id, fileId) {
      demoBlobs.delete(fileId)
      state = { ...state, files: state.files.filter((f) => f.id !== fileId) }
      commit()
    },
    async fileBlob(f) {
      const b = demoBlobs.get(f.id)
      if (!b) throw new Error('Demo files are kept only until the app reloads.')
      return b
    },
    async comment(id, body) {
      const c: RequestComment = { id: newId(), requestId: id, authorName: me, authorEmail: meEmail, body: body.trim(), at: new Date().toISOString() }
      state = { ...state, comments: [...state.comments, c] }
      commit()
    },
    team: async () => DEFAULT_TEAM,
    notifications: {
      list: async () => [],
      markRead: async () => {},
      subscribe: () => () => {}
    }
  }
}
