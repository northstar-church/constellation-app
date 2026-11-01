import type { CalendarStore } from './store'
import type { CalendarSnapshot, Feed, EspaceStatus } from './types'

export interface Me {
  email: string
  name: string
}

/** Couldn't reach the team hub. */
export class OfflineError extends Error {
  constructor() {
    super('You’re offline. Changes can’t be saved until you reconnect.')
  }
}
/** The sign-in has expired. */
export class SignInError extends Error {
  constructor() {
    super('Your sign-in has expired.')
  }
}

const desktop = () => (window.hub?.hubUrl ? window.hub : null)

/**
 * One way in to the hub's API. In the Mac app requests go through the app (which holds the
 * sign-in); in a browser they go straight to the same site.
 */
export async function call<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const d = desktop()
  if (d) {
    const r = await d.api(method, path, body)
    if (r.status === 0) throw new OfflineError()
    if (r.status === 401) throw new SignInError()
    const data = (r.data ?? {}) as T & { error?: string }
    if (r.status >= 400) throw new Error(data.error ?? `Request failed (${r.status})`)
    return data
  }
  let res: Response
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin'
    })
  } catch {
    throw new OfflineError()
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (res.status === 401) throw new SignInError()
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`)
  return data
}

/** Uploads raw bytes (a file) to the hub. */
export async function upload<T>(path: string, file: Blob): Promise<T> {
  const d = desktop()
  const type = file.type || 'application/octet-stream'
  if (d) {
    const r = await d.upload(path, await file.arrayBuffer(), type)
    if (r.status === 0) throw new OfflineError()
    if (r.status === 401) throw new SignInError()
    const data = (r.data ?? {}) as T & { error?: string }
    if (r.status >= 400) throw new Error(data.error ?? `Upload failed (${r.status})`)
    return data
  }
  let res: Response
  try {
    res = await fetch(path, { method: 'POST', headers: { 'content-type': type }, body: file, credentials: 'same-origin' })
  } catch {
    throw new OfflineError()
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (res.status === 401) throw new SignInError()
  if (!res.ok) throw new Error(data.error ?? `Upload failed (${res.status})`)
  return data
}

/** Fetches a stored file from the hub as a Blob. */
export async function download(path: string): Promise<Blob> {
  const d = desktop()
  if (d) {
    const r = await d.download(path)
    if (r.status === 0) throw new OfflineError()
    if (r.status === 401) throw new SignInError()
    if (r.status !== 200 || !r.bytes) throw new Error('Couldn’t load that file.')
    return new Blob([r.bytes], { type: r.contentType })
  }
  const res = await fetch(path, { credentials: 'same-origin' }).catch(() => null)
  if (!res) throw new OfflineError()
  if (res.status === 401) throw new SignInError()
  if (!res.ok) throw new Error('Couldn’t load that file.')
  return res.blob()
}

export type Connection =
  | { state: 'demo' }
  | { state: 'signedIn'; me: Me }
  | { state: 'signedOut' }
  | { state: 'offline' }

/** Works out whether to show the team calendar, a sign-in screen, an offline screen or the demo. */
export async function connect(): Promise<Connection> {
  // Shareable preview builds always run on sample data.
  if (import.meta.env.VITE_PREVIEW === '1') return { state: 'demo' }
  const d = desktop()
  if (!d && !/^https?:$/.test(location.protocol)) return { state: 'demo' }
  if (!d && window.hub) return { state: 'demo' } // Mac app built without a hub address
  try {
    return { state: 'signedIn', me: await call<Me>('/api/me') }
  } catch (e) {
    if (e instanceof SignInError) return { state: 'signedOut' }
    if (e instanceof OfflineError && d) return { state: 'offline' }
    return { state: 'demo' } // a browser page with no hub behind it (e.g. the dev server)
  }
}

type LiveListener = { onMessage: (what: string) => void; onStatus?: (live: boolean) => void }
const listeners = new Set<LiveListener>()
let stopLive: (() => void) | null = null

function startLive() {
  const emit = (what: string) => listeners.forEach((l) => l.onMessage(what))
  const status = (ok: boolean) => listeners.forEach((l) => l.onStatus?.(ok))
  const parse = (raw: string) => {
    if (raw === 'reconnected') return emit('*')
    try {
      emit((JSON.parse(raw) as { changed?: string }).changed ?? '*')
    } catch {
      emit('*')
    }
  }
  const d = desktop()
  if (d) {
    const off1 = d.onLive(parse)
    const off2 = d.onLiveStatus(status)
    d.live(true)
    return () => {
      off1()
      off2()
      d.live(false)
    }
  }
  let ws: WebSocket | null = null
  let closed = false
  let retry = 1000
  let ping: ReturnType<typeof setInterval> | undefined
  const open = () => {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/live`)
    ws.onopen = () => {
      if (retry > 1000) emit('*')
      retry = 1000
      status(true)
      ping = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send('ping'), 30_000)
    }
    ws.onmessage = (e) => e.data !== 'pong' && parse(String(e.data))
    ws.onclose = () => {
      clearInterval(ping)
      status(false)
      if (closed) return
      setTimeout(open, retry)
      retry = Math.min(retry * 2, 30_000)
    }
  }
  open()
  return () => {
    closed = true
    clearInterval(ping)
    ws?.close()
  }
}

/**
 * One live connection shared by every section. `topics` picks which changes matter
 * ('*' = reconnected, so reload everything).
 */
export function subscribeLive(topics: string[], onChange: () => void, onStatus?: (live: boolean) => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const l: LiveListener = {
    onMessage: (what) => {
      if (what !== '*' && !topics.includes(what)) return
      clearTimeout(timer)
      timer = setTimeout(onChange, 150) // coalesce bursts into one reload
    },
    onStatus
  }
  listeners.add(l)
  if (listeners.size === 1) stopLive = startLive()
  return () => {
    clearTimeout(timer)
    listeners.delete(l)
    if (!listeners.size) {
      stopLive?.()
      stopLive = null
    }
  }
}

/** Shared team calendar on Cloudflare, with live updates from teammates. */
export function createCloudStore(): CalendarStore {
  return {
    mode: 'cloud',
    load: () => call<CalendarSnapshot>('/api/calendar'),

    subscribe(onChange, onStatus) {
      return subscribeLive(['events', 'milestones'], onChange, onStatus)
    },

    async saveEvent(event, milestones) {
      await call(`/api/events/${event.id}`, 'PUT', { event, milestones })
    },
    async deleteEvent(id) {
      await call(`/api/events/${id}`, 'DELETE')
    },
    async setMilestoneDone(id, done) {
      await call(`/api/milestones/${id}`, 'PATCH', { done })
    },

    feeds: {
      list: () => call<Feed[]>('/api/feeds'),
      create: (input) => call<Feed>('/api/feeds', 'POST', input),
      async remove(id) {
        await call(`/api/feeds/${id}`, 'DELETE')
      },
      url: (feed) => `${desktop()?.hubUrl ?? location.origin}/feed/${feed.token}.ics`
    },

    staffLink: {
      get: async () => `${desktop()?.hubUrl ?? location.origin}/track/calendar/${(await call<{ token: string }>('/api/calendar/staff-link')).token}`,
      rotate: async () => `${desktop()?.hubUrl ?? location.origin}/track/calendar/${(await call<{ token: string }>('/api/calendar/staff-link', 'POST')).token}`
    },

    espace: {
      status: () => call<EspaceStatus>('/api/espace'),
      async setMapping(categoryId, mapTo) {
        await call(`/api/espace/categories/${categoryId}`, 'PUT', { mapTo })
      },
      async syncNow() {
        await call('/api/espace/sync', 'POST')
      },
      async setBooker(email, name, ministry) {
        await call('/api/espace/bookers', 'PUT', { email, name, ministry })
      },
      async setMinistries(list) {
        await call('/api/espace/ministries', 'PUT', { list })
      }
    }
  }
}
