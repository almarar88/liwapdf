import { app, shell, BrowserWindow, dialog, nativeTheme, Menu, session } from 'electron'
import { existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerIpc, setPendingOpenFile } from './ipc'
import { settings } from './store'
import { checkForUpdates, setupUpdater } from './updater'

const isMac = process.platform === 'darwin'
const isDev = !app.isPackaged

let mainWindow: BrowserWindow | null = null
/**
 * Set once the renderer has confirmed there is nothing to lose. Until then the
 * close is intercepted: the confirmation resolves through a React modal, so a
 * synchronous main-process check cannot ask the question.
 */
let closeConfirmed = false
/** True once a quit is under way, so a confirmed close can finish it. */
let quitting = false

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
      // See applySpellcheck: enabling this on Windows/Linux makes Chromium
      // fetch a dictionary from Google's CDN, so it follows the user's choice
      // rather than being on by default.
      spellcheck: isMac || settings().get().spellcheck,
      webSecurity: true
    }
  })

  attachContextMenu(window.webContents)

  window.on('close', (event) => {
    if (closeConfirmed) return
    // Covers every route out: the title-bar button, the native traffic light,
    // Cmd+Q and the taskbar. Only the renderer knows whether work is pending.
    event.preventDefault()
    window.webContents.send('menu:action', 'confirm-quit')
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

/**
 * "Works offline" is a promise, so it is enforced rather than assumed.
 *
 * Chromium does a surprising amount of talking on its own — component updates,
 * domain reliability, network-time — none of which this app wants or needs.
 * The switches turn those off, and the request filter below is the backstop:
 * it cancels every http(s)/ws request from any session, whatever asked for it.
 * `file:` and `data:` are untouched, because that is how the app loads itself.
 */
for (const flag of [
  'disable-background-networking',
  'disable-component-update',
  'disable-domain-reliability',
  'no-pings',
  'disable-breakpad',
  'disable-sync'
]) {
  app.commandLine.appendSwitch(flag)
}
app.commandLine.appendSwitch(
  'disable-features',
  'MediaRouter,OptimizationGuideModelDownloading,Translate,NetworkTimeServiceQuerying'
)

/**
 * Hosts the updater talks to, and nothing else: GitHub's release manifest
 * and its asset store. Allowed only while the update setting is on, so the
 * "no network" promise holds the moment it is switched off.
 */
const UPDATE_HOSTS = ['github.com', 'api.github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']

function blockOutboundRequests(): void {
  const filter = { urls: ['*://*/*'] }
  session.defaultSession.webRequest.onBeforeRequest(filter, (details, callback) => {
    if (settings().get().checkUpdates) {
      try {
        const host = new URL(details.url).hostname
        if (UPDATE_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
          callback({ cancel: false })
          return
        }
      } catch {
        // Not a URL we can judge; blocked below.
      }
    }
    callback({ cancel: true })
  })
}

/**
 * Chromium's Hunspell spellchecker downloads its dictionary from Google's CDN
 * the first time it runs, which is a network request this app promises not to
 * make. So it stays off unless the user turns it on — except on macOS, where
 * the system spellchecker is used and nothing is fetched.
 */
export /**
 * Electron ships no context menu at all, so the red squiggles spellcheck draws
 * were undismissable decoration: there was no way to reach a suggestion, add a
 * word, or even copy and paste with the mouse. Chromium hands the suggestions
 * over on the event; this turns them into the menu people expect.
 */
function attachContextMenu(contents: Electron.WebContents): void {
  contents.on('context-menu', (_event, params) => {
    const arabic = settings().get().language === 'ar'
    const label = (ar: string, en: string): string => (arabic ? ar : en)
    const items: Electron.MenuItemConstructorOptions[] = []

    for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
      items.push({ label: suggestion, click: () => contents.replaceMisspelling(suggestion) })
    }
    if (params.misspelledWord) {
      if (items.length === 0) {
        items.push({ label: label('لا توجد اقتراحات', 'No suggestions'), enabled: false })
      }
      items.push({
        label: label('أضف إلى القاموس', 'Add to dictionary'),
        click: () => contents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
      })
      items.push({ type: 'separator' })
    }

    const editable = params.isEditable
    items.push(
      { label: label('تراجع', 'Undo'), role: 'undo', enabled: editable && params.editFlags.canUndo },
      { label: label('إعادة', 'Redo'), role: 'redo', enabled: editable && params.editFlags.canRedo },
      { type: 'separator' },
      { label: label('قص', 'Cut'), role: 'cut', enabled: params.editFlags.canCut },
      { label: label('نسخ', 'Copy'), role: 'copy', enabled: params.editFlags.canCopy },
      { label: label('لصق', 'Paste'), role: 'paste', enabled: params.editFlags.canPaste },
      {
        // Pasting from Word otherwise brings its markup with it, which is the
        // usual way a clean document acquires someone else's fonts and colours.
        label: label('لصق بدون تنسيق', 'Paste without formatting'),
        role: 'pasteAndMatchStyle',
        enabled: params.editFlags.canPaste
      },
      { type: 'separator' },
      { label: label('تحديد الكل', 'Select all'), role: 'selectAll' }
    )

    Menu.buildFromTemplate(items).popup({ window: BrowserWindow.fromWebContents(contents) ?? undefined })
  })
}

function applySpellcheck(enabled: boolean): void {
  const on = isMac || enabled
  try {
    session.defaultSession.setSpellCheckerEnabled(on)
    if (!on) {
      // Disabling the checker is not enough on its own: the session still
      // resolves its default language list and fetches that dictionary. An
      // empty language list is what actually stops the request.
      session.defaultSession.setSpellCheckerLanguages([])
    }
    // Whatever happens, the dictionary may only come from this machine.
    session.defaultSession.setSpellCheckerDictionaryDownloadURL(
      new URL('dictionaries/', pathToFileURL(join(__dirname, '../renderer/')).href).href
    )
  } catch {
    /* older Electron or a headless session; spellcheck is a nicety */
  }
}

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
      blockOutboundRequests()
      applySpellcheck(settings().get().spellcheck)

      const saved = settings().get()
      nativeTheme.themeSource = saved.theme

      const startupFile = fileFromArgv(process.argv, process.cwd())
      if (startupFile) setPendingOpenFile(startupFile)

      // The update check waits until the window has been up a while: startup
      // is for opening the document the user launched with.
      setupUpdater(() => mainWindow)
      setTimeout(() => {
        if (settings().get().checkUpdates) void checkForUpdates()
      }, 12000)

      registerIpc(() => mainWindow, buildMenu, applySpellcheck, () => {
        closeConfirmed = true
        mainWindow?.destroy()
        // Cmd+Q asks the window to close first; preventing that aborted the
        // quit, so it has to be resumed once the answer comes back.
        if (quitting) app.quit()
      })

      app.on('before-quit', () => {
        quitting = true
      })
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
