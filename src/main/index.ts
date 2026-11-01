import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { setupHub } from './hub'
import { setupUpdates } from './updates'

/**
 * The team hub's address, e.g. https://constellation.northstarchurch.org. Set MAIN_VITE_HUB_URL in .env
 * before building the Mac app (CONSTELLATION_HUB_URL overrides it at run time, for testing).
 * Left empty, the app runs in demo mode with sample data saved on this computer.
 */
const PREVIEW = process.env.CONSTELLATION_PREVIEW === '1'
const HUB_URL = PREVIEW ? '' : (process.env.CONSTELLATION_HUB_URL || (import.meta.env.MAIN_VITE_HUB_URL as string | undefined) || '').replace(/\/$/, '')

// preview.command: sample data, and its own settings folder so it never touches the installed app's sign-in or data.
if (PREVIEW) app.setPath('userData', join(app.getPath('appData'), 'Constellation Preview'))

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 680,
    title: PREVIEW ? 'Constellation (Preview)' : 'Constellation',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#f4f4f5',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true
    }
  })
  // Keep "(Preview)" in the title bar instead of the page's own title.
  if (PREVIEW) win.on('page-title-updated', (e) => e.preventDefault())
  win.once('ready-to-show', () => {
    win.show()
    // After an update the Mac reopens the app in the background; bring it forward so it's clearly back.
    if (process.platform === 'darwin') app.focus({ steal: true })
  })

  // Links (vendor sites, Figma, webcal:// subscribe links) open outside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|webcal|mailto):/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) {
      e.preventDefault()
      if (/^(https?|webcal|mailto):/.test(url)) shell.openExternal(url)
    }
  })

  // The app's screens ship inside the app; only shared data comes from the hub.
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  setupHub(HUB_URL)
  // Unread notifications as a red number on the Dock icon
  ipcMain.on('app:badge', (_e, count: unknown) => {
    const n = Math.max(0, Math.min(999, Math.floor(Number(count) || 0)))
    app.setBadgeCount(n)
  })
  // Clicking a notification banner brings Constellation to the front
  ipcMain.on('app:focus', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender)
    if (w?.isMinimized()) w.restore()
    w?.show()
    w?.focus()
    app.focus({ steal: true })
  })
  setupUpdates(HUB_URL)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
