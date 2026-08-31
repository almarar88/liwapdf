import { app, shell, BrowserWindow, dialog, nativeTheme, Menu } from 'electron'
import { existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { registerIpc, setPendingOpenFile } from './ipc'
import { settings } from './store'

const isMac = process.platform === 'darwin'
const isDev = !app.isPackaged

let mainWindow: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    title: 'Alcode Editor',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b0d12' : '#f2f3f7',
    // A single custom chrome across platforms: on macOS we keep the native
    // traffic lights (inset into our own bar), on Windows/Linux we draw them.
    frame: isMac,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: isMac ? { x: 18, y: 20 } : undefined,
    vibrancy: isMac ? 'sidebar' : undefined,
    visualEffectState: isMac ? 'active' : undefined,
    autoHideMenuBar: true,
    icon: join(__dirname, '../../build/icon.png'),
    webPreferences: {
      // A CommonJS preload (see electron.vite.config.ts) is what lets the
      // renderer run inside the OS sandbox: this is the process that parses
      // every hostile file format the app opens, so it should have the least
      // authority the platform can give it. The preload itself only needs
      // contextBridge/ipcRenderer/webUtils, all of which are sandbox-safe.
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
      webSecurity: true
    }
  })

  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  window.on('ready-to-show', () => {
    window.show()
    if (isDev) window.webContents.openDevTools({ mode: 'detach' })
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Never let the app navigate away from its own bundle.
  window.webContents.on('will-navigate', (event, url) => {
    const dev = process.env['ELECTRON_RENDERER_URL']
    if (dev && url.startsWith(dev)) return
    event.preventDefault()
    if (/^https?:/i.test(url)) void shell.openExternal(url)
  })

  const notifyState = (): void =>
    window.webContents.send('window:state', {
      maximized: window.isMaximized(),
      focused: window.isFocused()
    })
  window.on('maximize', notifyState)
  window.on('unmaximize', notifyState)
  window.on('enter-full-screen', notifyState)
  window.on('leave-full-screen', notifyState)
  window.on('focus', notifyState)
  window.on('blur', notifyState)

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (isDev && devUrl) {
    void window.loadURL(devUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

/**
 * The macOS application menu, in the app's own language.
 *
 * Only the labels we author are translated: the `role:` items are supplied by
 * Electron already localized for the system, so hard-coding English there
 * would make them *less* correct, not more.
 */
const MENU_STRINGS = {
  ar: {
    settings: 'الإعدادات…',
    file: 'ملف',
    open: 'فتح…',
    save: 'حفظ',
    saveAs: 'حفظ باسم…',
    close: 'إغلاق المستند',
    edit: 'تحرير',
    view: 'عرض',
    palette: 'لوحة الأوامر',
    window: 'نافذة'
  },
  en: {
    settings: 'Settings…',
    file: 'File',
    open: 'Open…',
    save: 'Save',
    saveAs: 'Save As…',
    close: 'Close Document',
    edit: 'Edit',
    view: 'View',
    palette: 'Command Palette',
    window: 'Window'
  }
} as const

function buildMenu(): void {
  if (!isMac) {
    // The renderer draws its own menus; the native bar would only add chrome.
    Menu.setApplicationMenu(null)
    return
  }
  const send = (channel: string, payload?: unknown): void =>
    mainWindow?.webContents.send(channel, payload)
  const language = settings().get().language === 'ar' ? 'ar' : 'en'
  const label = MENU_STRINGS[language]

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Alcode Editor',
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { label: label.settings, accelerator: 'Cmd+,', click: () => send('menu:navigate', 'settings') },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' }
        ]
      },
      {
        label: label.file,
        submenu: [
          { label: label.open, accelerator: 'Cmd+O', click: () => send('menu:action', 'open') },
          { label: label.save, accelerator: 'Cmd+S', click: () => send('menu:action', 'save') },
          { label: label.saveAs, accelerator: 'Shift+Cmd+S', click: () => send('menu:action', 'save-as') },
          { type: 'separator' },
          { label: label.close, accelerator: 'Cmd+W', click: () => send('menu:action', 'close-doc') }
        ]
      },
      {
        label: label.edit,
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' }
        ]
      },
      {
        label: label.view,
        submenu: [
          { label: label.palette, accelerator: 'Cmd+K', click: () => send('menu:action', 'palette') },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
          { role: 'toggleDevTools' }
        ]
      },
      { label: label.window, submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'front' }] }
    ])
  )
}

/**
 * The document a launch was asked to open, resolved against the directory the
 * launch happened in — a shell passing a relative path is the normal case for
 * `alcode report.pdf`, and resolving it against the app's own cwd opens
 * nothing.
 */
function fileFromArgv(argv: string[], workingDirectory: string): string | null {
  const candidate = argv
    .slice(1)
    .filter((arg) => !arg.startsWith('-'))
    .map((arg) => resolve(workingDirectory || process.cwd(), arg))
    .find((path) => OPENABLE.test(path) && existsSync(path) && statSync(path).isFile())
  return candidate ?? null
}

const OPENABLE =
  /\.(pdf|docx?|rtf|odt|txt|md|markdown|html?|json|xml|ya?ml|log|csv|tsv|xlsx?|ods|pptx|ppsx|epub|png|jpe?g|webp|gif|bmp)$/i

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv, workingDirectory) => {
    const file = fileFromArgv(argv, workingDirectory)
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
      if (file) mainWindow.webContents.send('app:open-path', file)
    } else if (file) {
      setPendingOpenFile(file)
    }
  })

  // macOS: double-clicking an associated document.
  app.on('open-file', (event, path) => {
    event.preventDefault()
    if (mainWindow) mainWindow.webContents.send('app:open-path', path)
    else setPendingOpenFile(path)
  })

  app
    .whenReady()
    .then(() => {
      app.setAppUserModelId('app.alcode.editor')

      const saved = settings().get()
      nativeTheme.themeSource = saved.theme

      const startupFile = fileFromArgv(process.argv, process.cwd())
      if (startupFile) setPendingOpenFile(startupFile)

      registerIpc(() => mainWindow, buildMenu)
      mainWindow = createWindow()
      buildMenu()

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
      })
    })
    .catch((error: unknown) => {
      // Without this the app dies silently with no window and no message.
      dialog.showErrorBox(
        'Alcode Editor failed to start',
        String((error as Error)?.stack ?? error)
      )
      app.quit()
    })

  app.on('window-all-closed', () => {
    if (!isMac) app.quit()
  })
}
