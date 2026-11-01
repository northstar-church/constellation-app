import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'

/**
 * Automatic updates. The app checks the team hub (HUB_URL/updates) at launch and every few hours,
 * downloads a new version quietly, and installs it the next time the app quits. When one is ready,
 * the header shows a "Restart to update" button.
 */
export function setupUpdates(hubUrl: string): void {
  let ready: string | null = null
  ipcMain.on('updates:state', (e) => (e.returnValue = ready))
  ipcMain.on('updates:version', (e) => (e.returnValue = app.getVersion()))
  ipcMain.handle('updates:install', () => autoUpdater.quitAndInstall())
  if (!app.isPackaged || !hubUrl) return

  autoUpdater.setFeedURL({ provider: 'generic', url: `${hubUrl}/updates` })
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.disableDifferentialDownload = true
  autoUpdater.on('update-downloaded', (info) => {
    ready = info.version
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('updates:ready', info.version)
  })
  autoUpdater.on('error', (err) => console.warn('Update check failed:', err?.message ?? err))

  const check = () => autoUpdater.checkForUpdates().catch(() => {})
  setTimeout(check, 10_000)
  setInterval(check, 4 * 60 * 60 * 1000)
}
