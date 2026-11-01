import { BrowserWindow, ipcMain, session, type WebContents } from 'electron'
import WebSocket from 'ws'

/**
 * Connects the installed app to the team hub on Cloudflare.
 *
 * The app's screens are bundled locally; only shared data goes over the network. Sign-in
 * happens in a small app window (Cloudflare Access emails a one-time code). The resulting
 * session cookie lives in a private, persistent partition, and every API call and the live
 * connection are made here in the main process with that cookie, so the page never handles it.
 */

const PARTITION = 'persist:constellation'
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
const API_PATH = /^\/api\/[A-Za-z0-9/_-]*$/

export interface ApiResult {
  /** 0 = couldn't reach the hub (offline); 401 = needs sign-in */
  status: number
  data?: unknown
}

export function setupHub(hubUrl: string): void {
  const ses = () => session.fromPartition(PARTITION)

  ipcMain.on('hub:config', (e) => {
    e.returnValue = { hubUrl }
  })

  async function api(method: string, path: string, body?: unknown): Promise<ApiResult> {
    if (!hubUrl) return { status: 0 }
    if (!METHODS.has(method) || !API_PATH.test(path)) return { status: 400, data: { error: 'Bad request' } }
    let res: Response
    try {
      res = await ses().fetch(hubUrl + path, {
        method,
        headers: { 'x-constellation-app': '1', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body)
      })
    } catch {
      return { status: 0 }
    }
    const text = await res.text()
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch {
      // A sign-in page answered instead of our JSON.
      return { status: 401 }
    }
    // Signed in: keep the session key in this app's private cookie jar (a year; renewed while used) and never hand it to the page
    if (path === '/api/auth/verify' && res.ok && data && typeof data === 'object' && typeof (data as { token?: unknown }).token === 'string') {
      const { token, ...rest } = data as { token: string }
      await ses().cookies.set({ url: hubUrl, name: 'cs_session', value: token, secure: true, httpOnly: true, sameSite: 'lax', expirationDate: Math.floor(Date.now() / 1000) + 400 * 86400 })
      data = rest
    }
    return { status: res.status, data }
  }

  ipcMain.handle('hub:api', (_e, req: { method: string; path: string; body?: unknown }) => api(req.method, req.path, req.body))

  // Uploads (proofs, final artwork): raw bytes straight to the hub.
  ipcMain.handle('hub:upload', async (_e, req: { path: string; bytes: ArrayBuffer; contentType: string }): Promise<ApiResult> => {
    if (!hubUrl) return { status: 0 }
    if (!API_PATH.test(req.path.split('?')[0])) return { status: 400, data: { error: 'Bad request' } }
    try {
      const res = await ses().fetch(hubUrl + req.path, {
        method: 'POST',
        headers: { 'content-type': req.contentType || 'application/octet-stream' },
        body: Buffer.from(req.bytes)
      })
      const text = await res.text()
      try {
        return { status: res.status, data: JSON.parse(text) }
      } catch {
        return { status: 401 }
      }
    } catch {
      return { status: 0 }
    }
  })

  // Downloads (thumbnails, file downloads): bytes back to the page.
  ipcMain.handle('hub:download', async (_e, path: string): Promise<{ status: number; contentType?: string; bytes?: ArrayBuffer }> => {
    if (!hubUrl || !API_PATH.test(path.split('?')[0])) return { status: 400 }
    try {
      const res = await ses().fetch(hubUrl + path)
      const contentType = res.headers.get('content-type') ?? 'application/octet-stream'
      if (res.status === 200 && contentType.startsWith('text/html')) return { status: 401 }
      const buf = await res.arrayBuffer()
      return { status: res.status, contentType, bytes: buf }
    } catch {
      return { status: 0 }
    }
  })

  // ---------- sign in / out ----------

  let signingIn: Promise<boolean> | null = null
  ipcMain.handle('hub:signIn', (e) => {
    if (!hubUrl) return false
    signingIn ??= new Promise<boolean>((resolve) => {
      const parent = BrowserWindow.fromWebContents(e.sender) ?? undefined
      const win = new BrowserWindow({
        width: 460,
        height: 680,
        parent,
        modal: process.platform !== 'darwin',
        title: 'Sign in to Constellation',
        backgroundColor: '#f4f4f5',
        webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true }
      })
      let finished = false
      const finish = (ok: boolean) => {
        if (finished) return
        finished = true
        signingIn = null
        if (!win.isDestroyed()) win.close()
        resolve(ok)
      }
      const target = `${hubUrl}/api/me`
      // After the emailed code is accepted, Access sends the window back to /api/me.
      // Matched by path, not address: if the hub ever moves, the old address forwards here on another host.
      win.webContents.on('did-navigate', async (_ev, url) => {
        let path = ''
        try {
          path = new URL(url).pathname
        } catch {
          return
        }
        if (path !== '/api/me') return
        const me = await api('GET', '/api/me')
        if (me.status === 200) finish(true)
      })
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      win.on('closed', () => finish(false))
      win.loadURL(`${hubUrl}/signin?next=/api/me`).catch(() => finish(false))
    })
    return signingIn
  })

  ipcMain.handle('hub:signOut', async () => {
    stopLive()
    try {
      await ses().fetch(`${hubUrl}/api/auth/signout`, { method: 'POST' })
    } catch {
      /* offline: clearing the local session is enough */
    }
    await ses().clearStorageData({ storages: ['cookies', 'localstorage'] })
    return true
  })

  // ---------- live updates ----------

  let sock: WebSocket | null = null
  let listener: WebContents | null = null
  let retry = 1000
  let retryTimer: NodeJS.Timeout | undefined
  let ping: NodeJS.Timeout | undefined

  const send = (channel: string, value: unknown) => {
    if (listener && !listener.isDestroyed()) listener.send(channel, value)
  }

  async function connect() {
    if (!listener || !hubUrl) return
    const cookies = await ses().cookies.get({ url: hubUrl })
    const ws = new WebSocket(`${hubUrl.replace(/^http/, 'ws')}/api/live`, {
      headers: { Cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; ') }
    })
    sock = ws
    ws.on('open', () => {
      if (retry > 1000) send('hub:live-msg', 'reconnected')
      retry = 1000
      send('hub:live-status', true)
      clearInterval(ping)
      ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('ping'), 30_000)
    })
    ws.on('message', (data) => {
      const text = data.toString()
      if (text !== 'pong') send('hub:live-msg', text)
    })
    ws.on('error', () => {
      /* handled by close */
    })
    ws.on('close', () => {
      clearInterval(ping)
      if (sock !== ws) return
      sock = null
      send('hub:live-status', false)
      if (!listener) return
      retryTimer = setTimeout(connect, retry)
      retry = Math.min(retry * 2, 30_000)
    })
  }

  function stopLive() {
    listener = null
    clearTimeout(retryTimer)
    clearInterval(ping)
    const s = sock
    sock = null
    s?.close()
  }

  ipcMain.on('hub:live', (e, on: boolean) => {
    if (!on) return stopLive()
    if (listener === e.sender && sock) return
    stopLive()
    listener = e.sender
    retry = 1000
    e.sender.once('destroyed', () => listener === e.sender && stopLive())
    void connect()
  })
}
