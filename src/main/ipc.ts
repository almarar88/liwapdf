import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell, clipboard } from 'electron'
import { readFile, writeFile, mkdir, stat, unlink } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import {
  AppSettings,
  OpenDialogOptions,
  PdfPrintOptions,
  PickedFile,
  RecentFile,
  SaveDialogOptions,
  SaveResult
} from '../shared/types'
import { clearRecents, pushRecent, recents, settings } from './store'

let pendingOpenFile: string | null = null

export function setPendingOpenFile(path: string): void {
  pendingOpenFile = path
}

function kindOf(path: string): RecentFile['kind'] {
  const ext = extname(path).toLowerCase()
  if (ext === '.pdf') return 'pdf'
  if (ext === '.docx' || ext === '.doc') return 'docx'
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(ext)) return 'image'
  if (['.txt', '.md', '.rtf', '.html'].includes(ext)) return 'text'
  return 'other'
}

async function readAsPicked(path: string): Promise<PickedFile> {
  const [buffer, info] = await Promise.all([readFile(path), stat(path)])
  await recordRecent(path, info.size)
  return {
    path,
    name: basename(path),
    size: info.size,
    data: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  }
}

async function recordRecent(path: string, size: number): Promise<void> {
  pushRecent({ path, name: basename(path), kind: kindOf(path), size, openedAt: Date.now() })
}

const PAGE_SIZES: Record<string, { width: number; height: number }> = {
  A4: { width: 8.27, height: 11.69 },
  A3: { width: 11.69, height: 16.54 },
  Letter: { width: 8.5, height: 11 },
  Legal: { width: 8.5, height: 14 },
  Tabloid: { width: 11, height: 17 }
}

/**
 * Renders arbitrary HTML to PDF bytes using an offscreen Chromium window.
 * This is what powers Word/Markdown/HTML -> PDF conversion, fully offline.
 */
async function htmlToPdf(html: string, options: PdfPrintOptions = {}): Promise<Uint8Array> {
  const dir = join(app.getPath('userData'), 'render')
  await mkdir(dir, { recursive: true })
  const file = join(dir, `${randomUUID()}.html`)
  await writeFile(file, html, 'utf8')

  const offscreen = new BrowserWindow({
    show: false,
    width: 1200,
    height: 1600,
    webPreferences: { offscreen: true, javascript: true, sandbox: true, contextIsolation: true }
  })

  try {
    await offscreen.loadFile(file)
    // Give webfonts and images a chance to settle before snapshotting.
    await offscreen.webContents.executeJavaScript(
      `new Promise((r) => { const done = () => setTimeout(r, 80);
         if (document.fonts && document.fonts.ready) document.fonts.ready.then(done).catch(done); else done(); })`
    )
    const size = PAGE_SIZES[options.pageSize ?? 'A4'] ?? PAGE_SIZES.A4
    const marginInches = (options.marginsMm ?? 18) / 25.4
    const data = await offscreen.webContents.printToPDF({
      landscape: options.landscape ?? false,
      printBackground: options.printBackground ?? true,
      displayHeaderFooter: options.headerFooter ?? false,
      pageSize: { width: size.width, height: size.height },
      margins: {
        top: marginInches,
        bottom: marginInches,
        left: marginInches,
        right: marginInches
      }
    })
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  } finally {
    offscreen.destroy()
    await unlink(file).catch(() => undefined)
  }
}

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  /* ---------------------------------------------------------------- files */

  ipcMain.handle('dialog:open', async (_e, options: OpenDialogOptions): Promise<PickedFile[]> => {
    const window = getWindow()
    const result = await dialog.showOpenDialog(window!, {
      title: options.title,
      properties: options.multiple ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: options.filters
    })
    if (result.canceled) return []
    return Promise.all(result.filePaths.map(readAsPicked))
  })

  ipcMain.handle('dialog:save', async (_e, options: SaveDialogOptions): Promise<SaveResult> => {
    const window = getWindow()
    const result = await dialog.showSaveDialog(window!, {
      title: options.title,
      defaultPath: options.defaultName
        ? join(settings().get().defaultExportDir ?? app.getPath('documents'), options.defaultName)
        : undefined,
      filters: options.filters
    })
    return { canceled: result.canceled, path: result.filePath }
  })

  ipcMain.handle('dialog:directory', async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog(getWindow()!, { properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle('fs:read', async (_e, path: string): Promise<PickedFile> => readAsPicked(path))

  ipcMain.handle('fs:write', async (_e, path: string, data: Uint8Array): Promise<void> => {
    await writeFile(path, Buffer.from(data))
  })

  ipcMain.handle('fs:writeText', async (_e, path: string, text: string): Promise<void> => {
    await writeFile(path, text, 'utf8')
  })

  ipcMain.handle('fs:exists', async (_e, path: string): Promise<boolean> => {
    try {
      await stat(path)
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle(
    'fs:saveTempAndOpen',
    async (_e, name: string, data: Uint8Array): Promise<string> => {
      const file = join(tmpdir(), `alcode-${Date.now()}-${name}`)
      await writeFile(file, Buffer.from(data))
      await shell.openPath(file)
      return file
    }
  )

  ipcMain.handle('shell:reveal', async (_e, path: string): Promise<void> => {
    shell.showItemInFolder(path)
  })

  ipcMain.handle('shell:open', async (_e, path: string): Promise<void> => {
    await shell.openPath(path)
  })

  ipcMain.handle('shell:external', async (_e, url: string): Promise<void> => {
    if (/^https?:/i.test(url)) await shell.openExternal(url)
  })

  ipcMain.handle('clipboard:writeText', (_e, text: string): void => clipboard.writeText(text))

  /* ------------------------------------------------------------- settings */

  ipcMain.handle('settings:get', (): AppSettings => settings().get())

  ipcMain.handle('settings:set', (_e, patch: Partial<AppSettings>): AppSettings => {
    const next = settings().set(patch)
    if (patch.theme) nativeTheme.themeSource = patch.theme
    return next
  })

  ipcMain.handle('recents:list', (): RecentFile[] => recents().get().items)
  ipcMain.handle('recents:clear', (): RecentFile[] => clearRecents())

  /* --------------------------------------------------------------- system */

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    documentsDir: app.getPath('documents')
  }))

  ipcMain.handle('app:takePendingFile', (): string | null => {
    const file = pendingOpenFile
    pendingOpenFile = null
    return file
  })

  ipcMain.handle('theme:isDark', (): boolean => nativeTheme.shouldUseDarkColors)

  ipcMain.handle('print:html', async (_e, html: string, options: PdfPrintOptions) =>
    htmlToPdf(html, options)
  )

  /* --------------------------------------------------------------- window */

  ipcMain.handle('window:minimize', () => getWindow()?.minimize())
  ipcMain.handle('window:toggleMaximize', () => {
    const window = getWindow()
    if (!window) return false
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
    return window.isMaximized()
  })
  ipcMain.handle('window:close', () => getWindow()?.close())
  ipcMain.handle('window:isMaximized', () => getWindow()?.isMaximized() ?? false)

  nativeTheme.on('updated', () => {
    getWindow()?.webContents.send('theme:changed', nativeTheme.shouldUseDarkColors)
  })
}
