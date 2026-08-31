import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Combine,
  FileText,
  FolderOpen,
  Home,
  LayoutGrid,
  Lock,
  PenLine,
  Repeat2,
  Save,
  Settings as SettingsIcon,
  Shrink,
  Wrench
} from 'lucide-react'
import { useApp, type Route } from './store/app'
import { useDocumentActions } from './hooks/useDocumentActions'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { CommandPalette, type Command } from './components/CommandPalette'
import { BusyVeil, Button, Field, Modal, TextInput, Toasts } from './components/ui'
import { HomeView } from './views/HomeView'
import { ViewerView } from './views/ViewerView'
import { OrganizeView } from './views/OrganizeView'
import { AnnotateView } from './views/AnnotateView'
import { WordView } from './views/WordView'
import { ConvertView } from './views/ConvertView'
import { ToolsView } from './views/ToolsView'
import { SettingsView } from './views/SettingsView'
import { TOOLS } from './views/toolRegistry'

export default function App(): React.JSX.Element {
  const init = useApp((state) => state.init)
  const setDark = useApp((state) => state.setDark)
  const route = useApp((state) => state.route)
  const navigate = useApp((state) => state.navigate)
  const collapsed = useApp((state) => state.sidebarCollapsed)
  const setPaletteOpen = useApp((state) => state.setPaletteOpen)
  const reduceMotion = useApp((state) => state.settings.reduceMotion)
  const t = useApp((state) => state.t)
  const { openDialog, openPaths, saveActive } = useDocumentActions()

  const [platform, setPlatform] = useState('win32')

  useEffect(() => {
    void init()
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
      else if (action === 'save' || action === 'save-as') void saveActive()
      else if (action === 'palette') setPaletteOpen(true)
      else if (action === 'close-doc') useApp.getState().closePdf()
    })
    const offNavigate = window.alcode.on.menuNavigate((target) => navigate(target as Route))

    return () => {
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
      { id: 'nav-word', label: t('nav.word'), icon: <FileText size={15} />, run: () => navigate('word') },
      { id: 'nav-convert', label: t('nav.convert'), icon: <Repeat2 size={15} />, run: () => navigate('convert') },
      { id: 'nav-tools', label: t('nav.tools'), icon: <Wrench size={15} />, run: () => navigate('tools') },
      { id: 'nav-settings', label: t('nav.settings'), icon: <SettingsIcon size={15} />, run: () => navigate('settings') }
    ]

    const actions: Command[] = [
      { id: 'open', label: t('action.open'), hint: 'Ctrl O', icon: <FolderOpen size={15} />, run: () => void openDialog() },
      { id: 'save', label: t('action.save'), hint: 'Ctrl S', icon: <Save size={15} />, run: () => void saveActive() },
      { id: 'quick-merge', label: t('tool.merge'), icon: <Combine size={15} />, run: () => navigate('tools') },
      { id: 'quick-compress', label: t('tool.compress'), icon: <Shrink size={15} />, run: () => navigate('tools') },
      { id: 'quick-protect', label: t('tool.protect'), icon: <Lock size={15} />, run: () => navigate('tools') }
    ]

    const tools: Command[] = TOOLS.map((tool) => ({
      id: `tool-${tool.id}`,
      label: t(tool.titleKey),
      hint: t('nav.tools'),
      icon: tool.icon,
      keywords: t(tool.descriptionKey),
      run: () => navigate('tools')
    }))

    return [...actions, ...navigation, ...tools]
  }, [navigate, openDialog, saveActive, t])

  const view = {
    home: <HomeView />,
    viewer: <ViewerView />,
    organize: <OrganizeView />,
    annotate: <AnnotateView />,
    word: <WordView />,
    convert: <ConvertView />,
    tools: <ToolsView />,
    settings: <SettingsView />
  }[route]

  return (
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
              {view}
            </motion.div>
          </AnimatePresence>
          <BusyVeil />
        </main>
      </div>

      <CommandPalette commands={commands} />
      <PasswordDialog />
      <Toasts />
    </div>
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
