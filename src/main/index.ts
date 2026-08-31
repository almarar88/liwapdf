import { app, shell, BrowserWindow, nativeTheme, Menu } from 'electron'
import { join } from 'node:path'
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
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
      webSecurity: true
    }
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

function buildMenu(): void {
  if (!isMac) {
    // The renderer draws its own menus; the native bar would only add chrome.
    Menu.setApplicationMenu(null)
    return
  }
  const send = (channel: string, payload?: unknown): void =>
    mainWindow?.webContents.send(channel, payload)

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Alcode Editor',
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { label: 'Settings…', accelerator: 'Cmd+,', click: () => send('menu:navigate', 'settings') },
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
        label: 'File',
        submenu: [
          { label: 'Open…', accelerator: 'Cmd+O', click: () => send('menu:action', 'open') },
          { label: 'Save', accelerator: 'Cmd+S', click: () => send('menu:action', 'save') },
          { label: 'Save As…', accelerator: 'Shift+Cmd+S', click: () => send('menu:action', 'save-as') },
          { type: 'separator' },
          { label: 'Close Document', accelerator: 'Cmd+W', click: () => send('menu:action', 'close-doc') }
        ]
      },
      {
        label: 'Edit',
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
        label: 'View',
        submenu: [
          { label: 'Command Palette', accelerator: 'Cmd+K', click: () => send('menu:action', 'palette') },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
          { role: 'toggleDevTools' }
        ]
      },
      { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'front' }] }
    ])
  )
}

function fileFromArgv(argv: string[]): string | null {
  const candidate = argv
    .slice(1)
    .find((arg) => !arg.startsWith('-') && /\.(pdf|docx|doc|txt|md|rtf|png|jpe?g)$/i.test(arg))
  return candidate ?? null
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const file = fileFromArgv(argv)
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

  app.whenReady().then(() => {
    app.setAppUserModelId('app.alcode.editor')

    const saved = settings().get()
    nativeTheme.themeSource = saved.theme

    const startupFile = fileFromArgv(process.argv)
    if (startupFile) setPendingOpenFile(startupFile)

    registerIpc(() => mainWindow)
    mainWindow = createWindow()
    buildMenu()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (!isMac) app.quit()
  })
}
