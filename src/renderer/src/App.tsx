import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import {
  FileText,
  FolderOpen,
  Home,
  LayoutGrid,
  PenLine,
  Repeat2,
  Save,
  Settings as SettingsIcon,
  UploadCloud,
  Wrench
} from 'lucide-react'
import { useApp, type Route } from './store/app'
import { useDocumentActions } from './hooks/useDocumentActions'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { CommandPalette, type Command } from './components/CommandPalette'
import { BusyVeil, Button, Field, Modal, TextInput, Toasts } from './components/ui'
import { HomeView } from './views/HomeView'
import { TOOLS } from './views/toolRegistry'

// Only the home screen is needed to paint the first frame; the rest — and the
// document libraries they pull in — load when the user actually goes there,
// which is what keeps the startup bundle from carrying every format at once.
const ViewerView = lazy(() => import('./views/ViewerView').then((m) => ({ default: m.ViewerView })))
const OrganizeView = lazy(() =>
  import('./views/OrganizeView').then((m) => ({ default: m.OrganizeView }))
)
const AnnotateView = lazy(() =>
  import('./views/AnnotateView').then((m) => ({ default: m.AnnotateView }))
)
const EditorView = lazy(() => import('./views/EditorView').then((m) => ({ default: m.EditorView })))
const ConvertView = lazy(() =>
  import('./views/ConvertView').then((m) => ({ default: m.ConvertView }))
)
const ToolsView = lazy(() => import('./views/ToolsView').then((m) => ({ default: m.ToolsView })))
const SettingsView = lazy(() =>
  import('./views/SettingsView').then((m) => ({ default: m.SettingsView }))
)

export default function App(): React.JSX.Element {
  const init = useApp((state) => state.init)
  const setDark = useApp((state) => state.setDark)
  const route = useApp((state) => state.route)
  const navigate = useApp((state) => state.navigate)
  const collapsed = useApp((state) => state.sidebarCollapsed)
  const setPaletteOpen = useApp((state) => state.setPaletteOpen)
  const openTool = useApp((state) => state.openTool)
  const reduceMotion = useApp((state) => state.settings.reduceMotion)
  const t = useApp((state) => state.t)
  const { openDialog, openPaths, saveActive, saveActiveAs } = useDocumentActions()

  const [platform, setPlatform] = useState('win32')
  const [dragging, setDragging] = useState(false)

  // Files can be dropped anywhere in the window, not only on the two zones
  // that draw a dashed border. The zones keep their own handlers: they call
  // preventDefault on the drop, and the window listener yields to that.
  useEffect(() => {
    let depth = 0
    const hasFiles = (event: DragEvent): boolean =>
      Array.from(event.dataTransfer?.types ?? []).includes('Files')
    const onEnter = (event: DragEvent): void => {
      if (!hasFiles(event)) return
      depth += 1
      setDragging(true)
    }
    const onLeave = (): void => {
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const onOver = (event: DragEvent): void => {
      if (hasFiles(event)) event.preventDefault()
    }
    const onDrop = (event: DragEvent): void => {
      depth = 0
      setDragging(false)
      if (event.defaultPrevented || !hasFiles(event)) return
      event.preventDefault()
      const paths = Array.from(event.dataTransfer?.files ?? [])
        .map((file) => {
          try {
            return window.alcode.pathForFile(file)
          } catch {
            return ''
          }
        })
        .filter(Boolean)
      if (paths.length > 0) void openPaths(paths)
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('dragover', onOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [openPaths])

  useEffect(() => {
    void init()
    // Chromium hands initial focus to the first enabled control when the
    // window is activated, which is a title-bar button — and that paints a
    // keyboard focus ring on a fresh launch nobody pressed a key for. Until
    // the first key or pointer, focus arriving in the title bar is not the
    // user's doing and is dropped.
    let interacted = false
    const onInput = (): void => {
      interacted = true
    }
    const onFocusIn = (event: FocusEvent): void => {
      const target = event.target
      if (!interacted && target instanceof HTMLElement && target.closest('.titlebar')) target.blur()
    }
    window.addEventListener('keydown', onInput, true)
    window.addEventListener('pointerdown', onInput, true)
    window.addEventListener('focusin', onFocusIn)
    const active = document.activeElement
    if (active instanceof HTMLElement && active.closest('.titlebar')) active.blur()
    void window.alcode.app.info().then((info) => setPlatform(info.platform))
    void window.alcode.app.takePendingFile().then((path) => {
      if (path) void openPaths([path])
    })

    const offTheme = window.alcode.theme.onChange((dark) => {
      if (useApp.getState().settings.theme === 'system') setDark(dark)
    })
    const offOpen = window.alcode.on.openPath((path) => void openPaths([path]))
    const offMenu = window.alcode.on.menuAction((action) => {
      if (action === 'open') void openDialog()
      else if (action === 'save') void saveActive().catch(() => undefined)
      else if (action === 'save-as') void saveActiveAs()
      else if (action === 'palette') setPaletteOpen(true)
      else if (action === 'close-doc') {
        void useApp.getState().confirmDiscard().then((ok) => {
          if (ok) useApp.getState().closePdf()
        })
      } else if (action === 'confirm-quit') {
        // The main process holds the window open until we answer: the question
        // resolves through a React modal, so it cannot be asked from there.
        void useApp
          .getState()
          .confirmDiscard()
          .then((ok) => {
            if (ok) void window.alcode.window.forceClose()
          })
      }
    })
    const offNavigate = window.alcode.on.menuNavigate((target) => navigate(target as Route))

    return () => {
      window.removeEventListener('keydown', onInput, true)
      window.removeEventListener('pointerdown', onInput, true)
      window.removeEventListener('focusin', onFocusIn)
      offTheme()
      offOpen()
      offMenu()
      offNavigate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Global keyboard shortcuts.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const meta = event.ctrlKey || event.metaKey
      if (!meta) return
      const key = event.key.toLowerCase()

      if (key === 'k') {
        event.preventDefault()
        setPaletteOpen(!useApp.getState().paletteOpen)
      } else if (key === 'o') {
        event.preventDefault()
        void openDialog()
      } else if (key === 's') {
        event.preventDefault()
        void saveActive()
      } else if (key === 'z' && !event.shiftKey) {
        const target = event.target as HTMLElement
        if (target.isContentEditable || /INPUT|TEXTAREA/.test(target.tagName)) return
        event.preventDefault()
        void useApp.getState().undo()
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        const target = event.target as HTMLElement
        if (target.isContentEditable || /INPUT|TEXTAREA/.test(target.tagName)) return
        event.preventDefault()
        void useApp.getState().redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openDialog, saveActive, setPaletteOpen])

  const commands = useMemo<Command[]>(() => {
    const navigation: Command[] = [
      { id: 'nav-home', label: t('nav.home'), icon: <Home size={15} />, run: () => navigate('home') },
      { id: 'nav-viewer', label: t('nav.viewer'), icon: <FileText size={15} />, run: () => navigate('viewer') },
      { id: 'nav-organize', label: t('nav.organize'), icon: <LayoutGrid size={15} />, run: () => navigate('organize') },
      { id: 'nav-annotate', label: t('nav.annotate'), icon: <PenLine size={15} />, run: () => navigate('annotate') },
      { id: 'nav-editor', label: t('nav.editor'), icon: <FileText size={15} />, run: () => navigate('editor') },
      { id: 'nav-convert', label: t('nav.convert'), icon: <Repeat2 size={15} />, run: () => navigate('convert') },
      { id: 'nav-tools', label: t('nav.tools'), icon: <Wrench size={15} />, run: () => navigate('tools') },
      { id: 'nav-settings', label: t('nav.settings'), icon: <SettingsIcon size={15} />, run: () => navigate('settings') }
    ]

    const actions: Command[] = [
      { id: 'open', label: t('action.open'), hint: 'Ctrl O', icon: <FolderOpen size={15} />, run: () => void openDialog() },
      { id: 'save', label: t('action.save'), hint: 'Ctrl S', icon: <Save size={15} />, run: () => void saveActive() }
    ]

    const tools: Command[] = TOOLS.map((tool) => ({
      id: `tool-${tool.id}`,
      label: t(tool.titleKey),
      hint: t('nav.tools'),
      icon: tool.icon,
      keywords: t(tool.descriptionKey),
      // Opens the panel itself; landing on the grid was the whole complaint.
      run: () => openTool(tool.id, Boolean(tool.needsDocument))
    }))

    return [...actions, ...navigation, ...tools]
  }, [navigate, openDialog, saveActive, t])

  const view = {
    home: <HomeView />,
    viewer: <ViewerView />,
    organize: <OrganizeView />,
    annotate: <AnnotateView />,
    editor: <EditorView />,
    convert: <ConvertView />,
    tools: <ToolsView />,
    settings: <SettingsView />
  }[route]

  return (
    // framer-motion animates inline styles through the Web Animations API, so
    // the CSS reduced-motion overrides never reach it — it has to be told.
    <MotionConfig reducedMotion={reduceMotion ? 'always' : 'user'}>
    <div className="app">
      <TitleBar platform={platform} onSave={() => void saveActive()} />

      <div className={`app-body${collapsed ? ' collapsed' : ''}`}>
        <Sidebar onOpenFile={() => void openDialog()} />
        <main className="main" style={{ position: 'relative' }}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={route}
              style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
              initial={reduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, y: -6 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            >
              <Suspense fallback={<div className="view" />}>{view}</Suspense>
            </motion.div>
          </AnimatePresence>
          <BusyVeil />
        </main>
      </div>

      <AnimatePresence>
        {dragging ? (
          <motion.div
            className="drop-veil"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}
          >
            <div className="dz-card">
              <span className="dz-icon">
                <UploadCloud size={30} />
              </span>
              {t('msg.dropHere')}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
      <CommandPalette commands={commands} />
      <PasswordDialog />
      <ConfirmDialog />
      <Toasts />
    </div>
    </MotionConfig>
  )
}

/** The single blocking question the store can ask before a destructive action. */
function ConfirmDialog(): React.JSX.Element {
  const t = useApp((state) => state.t)
  const prompt = useApp((state) => state.confirmPrompt)
  const answer = useApp((state) => state.answerConfirm)

  return (
    <Modal
      open={Boolean(prompt)}
      onClose={() => answer(false)}
      title={prompt?.title ?? ''}
      footer={
        <>
          <Button onClick={() => answer(false)}>{t('action.cancel')}</Button>
          <Button
            variant={prompt?.danger ? 'danger' : 'primary'}
            onClick={() => answer(true)}
          >
            {prompt?.confirmLabel ?? t('action.done')}
          </Button>
        </>
      }
    >
      <p style={{ margin: 0, lineHeight: 1.7 }}>{prompt?.body}</p>
    </Modal>
  )
}

function PasswordDialog(): React.JSX.Element {
  const t = useApp((state) => state.t)
  const prompt = useApp((state) => state.passwordPrompt)
  const resolvePassword = useApp((state) => state.resolvePassword)
  const cancelPassword = useApp((state) => state.cancelPassword)
  const [password, setPassword] = useState('')

  useEffect(() => {
    if (prompt) setPassword('')
  }, [prompt])

  return (
    <Modal
      open={Boolean(prompt)}
      onClose={cancelPassword}
      title={t('msg.needPassword')}
      footer={
        <>
          <Button onClick={cancelPassword}>{t('action.cancel')}</Button>
          <Button variant="primary" onClick={() => void resolvePassword(password)}>
            {t('msg.unlock')}
          </Button>
        </>
      }
    >
      <div className="stack">
        {prompt?.wrong ? <span className="badge red">{t('msg.wrongPassword')}</span> : null}
        <Field label={t('msg.password')} hint={prompt?.name}>
          <TextInput
            type="password"
            value={password}
            onChange={setPassword}
            autoFocus
            onEnter={() => void resolvePassword(password)}
          />
        </Field>
      </div>
    </Modal>
  )
}
