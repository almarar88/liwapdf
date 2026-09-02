import { app, type BrowserWindow } from 'electron'
// electron-updater is CommonJS; the main bundle is ESM, so the named export
// is not there at runtime — take the default and destructure.
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater

/**
 * Updates from GitHub Releases, on the user's say-so at every step.
 *
 * The check itself is the only automatic part, and only when the setting
 * allows it: it asks github.com for the latest release's manifest and
 * nothing else leaves the machine. Downloading and installing are each a
 * click, and the install happens on quit, never while a document is open.
 *
 * Unsigned builds update fine on Windows; macOS refuses to swap an unsigned
 * bundle, so there the notice links to the download page instead.
 */

import type { UpdateEvent } from '../shared/types'

let send: (event: UpdateEvent) => void = () => undefined
let wired = false

export function setupUpdater(getWindow: () => BrowserWindow | null): void {
  send = (event) => getWindow()?.webContents.send('update:event', event)
  if (wired || !app.isPackaged) return
  wired = true
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false
  autoUpdater.on('update-available', (info) => {
    const notes = typeof info.releaseNotes === 'string' ? info.releaseNotes : ''
    send({ kind: 'available', version: info.version, notes })
  })
  autoUpdater.on('update-not-available', () => send({ kind: 'none' }))
  autoUpdater.on('download-progress', (progress) => send({ kind: 'progress', percent: progress.percent }))
  autoUpdater.on('update-downloaded', (info) => send({ kind: 'ready', version: info.version }))
  autoUpdater.on('error', (error) => send({ kind: 'error', message: String(error?.message ?? error) }))
}

export async function checkForUpdates(): Promise<void> {
  if (!app.isPackaged) {
    send({ kind: 'none' })
    return
  }
  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    send({ kind: 'error', message: String((error as Error)?.message ?? error) })
  }
}

export async function downloadUpdate(): Promise<void> {
  if (!app.isPackaged) return
  try {
    await autoUpdater.downloadUpdate()
  } catch (error) {
    send({ kind: 'error', message: String((error as Error)?.message ?? error) })
  }
}

export function installUpdate(): void {
  if (!app.isPackaged) return
  autoUpdater.quitAndInstall(false, true)
}
