import { motion } from 'framer-motion'
import {
  Home,
  FileText,
  LayoutGrid,
  PenLine,
  FileType2,
  Repeat2,
  Wrench,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  FolderOpen,
  ShieldCheck
} from 'lucide-react'
import { useApp, type Route } from '../store/app'
import type { TranslationKey } from '../i18n'
import { Button, SPRING } from './ui'

interface NavEntry {
  route: Route
  labelKey: TranslationKey
  icon: React.JSX.Element
  needsDoc?: boolean
}

const PRIMARY: NavEntry[] = [
  { route: 'home', labelKey: 'nav.home', icon: <Home size={17} /> },
  { route: 'viewer', labelKey: 'nav.viewer', icon: <FileText size={17} />, needsDoc: true },
  { route: 'organize', labelKey: 'nav.organize', icon: <LayoutGrid size={17} />, needsDoc: true },
  { route: 'annotate', labelKey: 'nav.annotate', icon: <PenLine size={17} />, needsDoc: true }
]

const SECONDARY: NavEntry[] = [
  { route: 'editor', labelKey: 'nav.editor', icon: <FileType2 size={17} /> },
  { route: 'convert', labelKey: 'nav.convert', icon: <Repeat2 size={17} /> },
  { route: 'tools', labelKey: 'nav.tools', icon: <Wrench size={17} /> }
]

export function Sidebar({ onOpenFile }: { onOpenFile: () => void }): React.JSX.Element {
  const route = useApp((state) => state.route)
  const navigate = useApp((state) => state.navigate)
  const collapsed = useApp((state) => state.sidebarCollapsed)
  const toggle = useApp((state) => state.toggleSidebar)
  const doc = useApp((state) => state.doc)
  const t = useApp((state) => state.t)

  const renderItem = (entry: NavEntry): React.JSX.Element => {
    const active = route === entry.route
    return (
      <button
        key={entry.route}
        className={`nav-item${active ? ' active' : ''}`}
        onClick={() => navigate(entry.route)}
        title={collapsed ? t(entry.labelKey) : undefined}
      >
        {active ? <motion.span layoutId="nav-glow" className="nav-glow" transition={SPRING} /> : null}
        {entry.icon}
        {collapsed ? null : <span>{t(entry.labelKey)}</span>}
        {!collapsed && entry.needsDoc && doc ? <span className="count">{doc.pageCount}</span> : null}
      </button>
    )
  }

  return (
    <nav className="sidebar">
      {collapsed ? null : <div className="group-label">{t('nav.workspace')}</div>}
      {PRIMARY.map(renderItem)}
      {collapsed ? null : <div className="group-label">{t('nav.tools.group')}</div>}
      {SECONDARY.map(renderItem)}

      <div className="sidebar-footer">
        {collapsed ? null : (
          <div className="side-pill">
            <ShieldCheck size={14} />
            <span>
              {t('home.stat.offline')} · {t('home.stat.privacy')}
            </span>
          </div>
        )}
        {collapsed ? null : (
          <div style={{ padding: '0 2px 10px' }}>
            <Button variant="primary" block onClick={onOpenFile}>
              <FolderOpen size={16} />
              {t('action.open')}
            </Button>
          </div>
        )}
        <button
          className={`nav-item${route === 'settings' ? ' active' : ''}`}
          onClick={() => navigate('settings')}
          title={collapsed ? t('nav.settings') : undefined}
        >
          {route === 'settings' ? (
            <motion.span layoutId="nav-glow" className="nav-glow" transition={SPRING} />
          ) : null}
          <Settings size={17} />
          {collapsed ? null : <span>{t('nav.settings')}</span>}
        </button>
        <button className="nav-item" onClick={toggle} title={t('action.collapse')}>
          {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          {collapsed ? null : <span>{t('action.collapse')}</span>}
        </button>
      </div>
    </nav>
  )
}
