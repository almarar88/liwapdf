import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  session,
  shell,
  clipboard
} from 'electron'
import { readFile, writeFile, mkdir, stat, unlink } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  AppSettings,
  OpenDialogOptions,
  PdfPrintOptions,
  PickedFile,
  PrinterOption,
  PrintJobOptions,
  RecentFile,
  SaveDialogOptions,
  SaveResult
} from '../shared/types'
import {
  clearDraft,
  clearRecents,
  coerceSettings,
  draft,
  pushRecent,
  readDraft,
  recents,
  settings
} from './store'

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
  // Save-in-place writes back over a file the user themselves opened.
  openedFiles.add(resolve(path))
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

function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((settle, fail) => {
    const timer = setTimeout(() => fail(new Error(`print-timeout:${label}`)), ms)
    work.then(
      (value) => {
        clearTimeout(timer)
        settle(value)
      },
      (error) => {
        clearTimeout(timer)
        fail(error)
      }
    )
  })
}

/**
 * Renders HTML to PDF bytes using an offscreen Chromium window — this is what
 * powers Word/Markdown/HTML -> PDF conversion, fully offline.
 *
 * The HTML reaching this function is not trustworthy: the "HTML to PDF"
 * converter hands over a user-picked .html file verbatim, and mammoth's DOCX
 * output can carry whatever the document author put in it. So the window it
 * renders in is locked down rather than trusted:
 *
 * - `javascript: false` — nothing the printable templates produce needs script,
 *   and without it the page cannot phone home, stall the print, or read files.
 * - a throwaway session whose request filter cancels everything that is not
 *   `file:`/`data:`/`blob:`, so the app's offline guarantee holds even for a
 *   document stuffed with remote images and tracking pixels.
 * - hard wall-clock limits on load and print, and teardown that cannot be
 *   skipped, so one pathological file can never hang the renderer.
 */
async function htmlToPdf(html: string, options: PdfPrintOptions = {}): Promise<Uint8Array> {
  const dir = join(app.getPath('userData'), 'render')
  await mkdir(dir, { recursive: true })
  const token = randomUUID()
  const file = join(dir, `${token}.html`)
  await writeFile(file, html, 'utf8')

  const partition = `print-${token}`
  const printSession = session.fromPartition(partition)
  printSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
    const local = /^(file|data|blob|devtools):/i.test(details.url)
    callback({ cancel: !local })
  })
  printSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))

  let offscreen: BrowserWindow | null = null
  try {
    offscreen = new BrowserWindow({
      show: false,
      width: 1200,
      height: 1600,
      webPreferences: {
        offscreen: true,
        javascript: false,
        images: true,
        webgl: false,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        partition
      }
    })
    offscreen.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    offscreen.webContents.on('will-navigate', (event) => event.preventDefault())

    const window_ = offscreen
    await withTimeout(window_.loadFile(file), 20_000, 'load')
    // With scripting off we cannot ask the page when its fonts settled, so we
    // give the compositor a fixed, short grace period instead.
    await new Promise((done) => setTimeout(done, 120))

    const size = PAGE_SIZES[options.pageSize ?? 'A4'] ?? PAGE_SIZES.A4
    const marginInches = (options.marginsMm ?? 18) / 25.4
    const data = await withTimeout(
      window_.webContents.printToPDF({
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
      }),
      60_000,
      'render'
    )
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  } finally {
    if (offscreen && !offscreen.isDestroyed()) offscreen.destroy()
    await unlink(file).catch(() => undefined)
    await printSession.clearStorageData().catch(() => undefined)
  }
}

/**
 * Sends a document to a real printer.
 *
 * "Print" used to write a temp copy and hand it to the OS file handler — which,
 * since this app registers itself for .pdf, was frequently Alcode, so Print
 * re-opened the file. The pages are rasterised by the renderer and laid out
 * here at their exact page size, then printed through the same hardened
 * offscreen window the PDF exporter uses: no scripting, a throwaway session
 * that cancels every non-local request, and guaranteed teardown.
 */
async function printPages(options: PrintJobOptions): Promise<boolean> {
  if (options.pages.length === 0) return false

  const first = options.pages[0]
  const body = options.pages
    .map(
      (page) =>
        `<div class="sheet"><img src="${page.dataUrl}" width="${page.widthPt}" height="${page.heightPt}" /></div>`
    )
    .join('')
  const html =
    `<!doctype html><html><head><meta charset="utf-8"><style>` +
    `@page{size:${first.widthPt}pt ${first.heightPt}pt;margin:0}` +
    `html,body{margin:0;padding:0;background:#fff}` +
    `.sheet{page-break-after:always;break-after:page;display:block;line-height:0}` +
    `.sheet:last-child{page-break-after:auto;break-after:auto}` +
    `img{display:block}` +
    `</style></head><body>${body}</body></html>`

  const dir = join(app.getPath('userData'), 'render')
  await mkdir(dir, { recursive: true })
  const token = randomUUID()
  const file = join(dir, `${token}.html`)
  await writeFile(file, html, 'utf8')

  const partition = `print-${token}`
  const printSession = session.fromPartition(partition)
  printSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) =>
    callback({ cancel: !/^(file|data|blob):/i.test(details.url) })
  )

  let offscreen: BrowserWindow | null = null
  try {
    offscreen = new BrowserWindow({
      show: false,
      width: Math.ceil(first.widthPt),
      height: Math.ceil(first.heightPt),
      webPreferences: {
        javascript: false,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        partition
      }
    })
    offscreen.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    const window_ = offscreen
    await withTimeout(window_.loadFile(file), 30_000, 'load')
    await new Promise((done) => setTimeout(done, 150))

    return await new Promise<boolean>((resolve) => {
      window_.webContents.print(
        {
          silent: options.silent ?? false,
          printBackground: true,
          color: options.color ?? true,
          landscape: options.landscape ?? false,
          copies: Math.max(1, options.copies ?? 1),
          deviceName: options.deviceName,
          margins: { marginType: 'none' }
        },
        (success) => resolve(success)
      )
    })
  } finally {
    if (offscreen && !offscreen.isDestroyed()) offscreen.destroy()
    await unlink(file).catch(() => undefined)
    await printSession.clearStorageData().catch(() => undefined)
  }
}

/**
 * Paths the user has consented to write, collected from the save dialogs.
 *
 * Every legitimate write in the app follows a native Save/Choose-folder
 * dialog, so gating `fs:write` on that consent costs nothing and removes the
 * renderer's unrestricted write primitive: a compromised renderer (the process
 * that parses every hostile file format the app opens) can no longer overwrite
 * a shell profile or a startup script.
 */
const consentedFiles = new Set<string>()
const consentedDirectories = new Set<string>()

function grantWrite(path: string): void {
  consentedFiles.add(resolve(path))
  // Keep the set from growing without bound over a long session.
  if (consentedFiles.size > 512) {
    const oldest = consentedFiles.values().next().value
    if (oldest) consentedFiles.delete(oldest)
  }
}

function mayWrite(path: string): boolean {
  const target = resolve(path)
  if (consentedFiles.has(target)) return true
  if (consentedDirectories.has(dirname(target))) return true
  // Files the user opened may be saved back over themselves.
  return openedFiles.has(target)
}

const openedFiles = new Set<string>()

export function registerIpc(
  getWindow: () => BrowserWindow | null,
  rebuildMenu: () => void = () => undefined,
  applySpellcheck: (enabled: boolean) => void = () => undefined,
  forceClose: () => void = () => undefined
): void {
  /* ---------------------------------------------------------------- files */

  /** A window that has been closed is no longer a valid dialog parent. */
  const liveWindow = (): BrowserWindow | undefined => {
    const window = getWindow()
    return window && !window.isDestroyed() ? window : undefined
  }

  ipcMain.handle('dialog:open', async (_e, options: OpenDialogOptions): Promise<PickedFile[]> => {
    const parent = liveWindow()
    const request = {
      title: options.title,
      properties: (options.multiple
        ? ['openFile', 'multiSelections']
        : ['openFile']) as ('openFile' | 'multiSelections')[],
      filters: options.filters
    }
    const result = parent
      ? await dialog.showOpenDialog(parent, request)
      : await dialog.showOpenDialog(request)
    if (result.canceled) return []
    return Promise.all(result.filePaths.map(readAsPicked))
  })

  ipcMain.handle('dialog:save', async (_e, options: SaveDialogOptions): Promise<SaveResult> => {
    const parent = liveWindow()
    const request = {
      title: options.title,
      defaultPath: options.defaultName
        ? join(settings().get().defaultExportDir ?? app.getPath('documents'), options.defaultName)
        : undefined,
      filters: options.filters
    }
    const result = parent
      ? await dialog.showSaveDialog(parent, request)
      : await dialog.showSaveDialog(request)
    if (!result.canceled && result.filePath) grantWrite(result.filePath)
    return { canceled: result.canceled, path: result.filePath }
  })

  ipcMain.handle('dialog:directory', async (): Promise<string | null> => {
    const parent = liveWindow()
    const request = { properties: ['openDirectory', 'createDirectory'] as const }
    const result = parent
      ? await dialog.showOpenDialog(parent, { properties: [...request.properties] })
      : await dialog.showOpenDialog({ properties: [...request.properties] })
    if (result.canceled) return null
    const directory = result.filePaths[0] ?? null
    if (directory) consentedDirectories.add(resolve(directory))
    return directory
  })

  ipcMain.handle('fs:read', async (_e, path: string): Promise<PickedFile> => {
    const picked = await readAsPicked(path)
    openedFiles.add(resolve(path))
    return picked
  })

  ipcMain.handle('fs:write', async (_e, path: string, data: Uint8Array): Promise<void> => {
    if (!mayWrite(path)) throw new Error('write-not-permitted')
    await writeFile(path, Buffer.from(data))
  })

  ipcMain.handle('fs:writeText', async (_e, path: string, text: string): Promise<void> => {
    if (!mayWrite(path)) throw new Error('write-not-permitted')
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

  ipcMain.handle('shell:reveal', async (_e, path: string): Promise<void> => {
    shell.showItemInFolder(path)
  })

  ipcMain.handle('shell:external', async (_e, url: string): Promise<void> => {
    if (/^https?:/i.test(url)) await shell.openExternal(url)
  })

  ipcMain.handle('clipboard:writeText', (_e, text: string): void => clipboard.writeText(text))

  /* ------------------------------------------------------------- settings */

  ipcMain.handle('settings:get', (): AppSettings => settings().get())

  ipcMain.handle('settings:set', (_e, patch: Partial<AppSettings>): AppSettings => {
    const before = settings().get()
    const next = settings().replace(coerceSettings({ ...before, ...patch }))
    nativeTheme.themeSource = next.theme
    // The macOS menu bar is built from these strings, so it has to follow a
    // language change rather than staying in whatever language it launched in.
    if (next.language !== before.language) rebuildMenu()
    if (next.spellcheck !== before.spellcheck) applySpellcheck(next.spellcheck)
    return next
  })

  ipcMain.handle('recents:list', (): RecentFile[] => recents().get().items)
  ipcMain.handle('recents:clear', (): RecentFile[] => clearRecents())

  /* ---------------------------------------------------------------- draft */

  ipcMain.handle('draft:save', (_event, value: unknown) => {
    // Never let a bad payload from the renderer throw here: autosave runs on a
    // timer, and a throw on a timer is an unhandled rejection every few seconds.
    try {
      draft().replace(value as never)
      return true
    } catch {
      return false
    }
  })
  ipcMain.handle('draft:read', () => readDraft())
  ipcMain.handle('draft:clear', () => {
    clearDraft()
    return true
  })

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

  ipcMain.handle('print:job', async (_e, options: PrintJobOptions): Promise<boolean> =>
    printPages(options)
  )

  ipcMain.handle('print:printers', async (): Promise<PrinterOption[]> => {
    const window = liveWindow()
    if (!window) return []
    const printers = await window.webContents.getPrintersAsync()
    return printers.map((printer) => ({
      name: printer.name,
      displayName: printer.displayName || printer.name,
      isDefault: printer.isDefault
    }))
  })

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
  // Called by the renderer once it has confirmed there is nothing to lose.
  ipcMain.handle('window:forceClose', () => forceClose())
  ipcMain.handle('window:isMaximized', () => getWindow()?.isMaximized() ?? false)

  nativeTheme.on('updated', () => {
    // The OS fires this whenever the system appearance changes, including
    // after our window is gone — dereferencing a destroyed window here is a
    // hard main-process crash.
    liveWindow()?.webContents.send('theme:changed', nativeTheme.shouldUseDarkColors)
  })
}
