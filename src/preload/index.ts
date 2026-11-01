import { contextBridge, ipcRenderer } from 'electron'

const config = ipcRenderer.sendSync('hub:config') as { hubUrl: string }

const listen = (channel: string) => (cb: (value: any) => void) => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const handler = (_e: unknown, value: unknown) => cb(value)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

// The only bridge between the app's screens and the rest of the computer.
contextBridge.exposeInMainWorld('hub', {
  isDesktop: true,
  platform: process.platform,
  hubUrl: config.hubUrl,
  api: (method: string, path: string, body?: unknown) => ipcRenderer.invoke('hub:api', { method, path, body }),
  upload: (path: string, bytes: ArrayBuffer, contentType: string) => ipcRenderer.invoke('hub:upload', { path, bytes, contentType }),
  download: (path: string) => ipcRenderer.invoke('hub:download', path),
  signIn: () => ipcRenderer.invoke('hub:signIn'),
  signOut: () => ipcRenderer.invoke('hub:signOut'),
  live: (on: boolean) => ipcRenderer.send('hub:live', on),
  onLive: listen('hub:live-msg'),
  onLiveStatus: listen('hub:live-status'),
  version: ipcRenderer.sendSync('updates:version') as string,
  updateReady: () => ipcRenderer.sendSync('updates:state') as string | null,
  onUpdateReady: listen('updates:ready'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  setBadge: (count: number) => ipcRenderer.send('app:badge', count),
  focus: () => ipcRenderer.send('app:focus')
})
