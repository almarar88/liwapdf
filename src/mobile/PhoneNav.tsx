import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  Camera,
  FileText,
  FolderOpen,
  Home,
  LayoutGrid,
  MoreHorizontal,
  PenLine,
  Repeat2,
  Settings,
  FileType2,
  Wrench
} from 'lucide-react'
import { useApp, type Route } from '../renderer/src/store/app'
import { useDocumentActions } from '../renderer/src/hooks/useDocumentActions'
import { Modal, SPRING } from '../renderer/src/components/ui'
import type { TranslationKey } from '../renderer/src/i18n'
import { tapFeedback } from './shell'

/**
 * The phone's navigation.
 *
 * The desktop sidebar lists seven destinations, two group headings, a promise
 * pill and a collapse control — a column that reads well at 248px. Folded onto
 * a 412px screen it became a sideways-scrolling strip of seven long Arabic
 * labels where three were off-screen and none were legible, which is not a
 * menu: it is a list nobody can reach the end of.
 *
 * So the phone gets its own: five fixed slots. Three destinations a phone
 * reaches for constantly — where you start, the document you are holding, the
 * tools you act on it with — the camera raised in the middle because scanning
 * is the one thing only a phone can do, and everything else behind "more" as
 * labelled rows. No scrolling, one word per label, nothing past an edge.
 */

interface Destination {
  route: Route
  labelKey: TranslationKey
  icon: React.JSX.Element
  /** Shown with the open document's page count. */
  counts?: boolean
}

const TABS: Destination[] = [
  { route: 'home', labelKey: 'nav.home', icon: <Home size={21} /> },
  { route: 'viewer', labelKey: 'phone.document', icon: <FileText size={21} />, counts: true }
]

const AFTER: Destination[] = [
  { route: 'tools', labelKey: 'phone.tools', icon: <Wrench size={21} /> }
]

const MORE: Destination[] = [
  { route: 'editor', labelKey: 'nav.editor', icon: <FileType2 size={18} /> },
  { route: 'organize', labelKey: 'nav.organize', icon: <LayoutGrid size={18} /> },
  { route: 'annotate', labelKey: 'nav.annotate', icon: <PenLine size={18} /> },
  { route: 'convert', labelKey: 'nav.convert', icon: <Repeat2 size={18} /> },
  { route: 'settings', labelKey: 'nav.settings', icon: <Settings size={18} /> }
]

export function PhoneNav({ onScan }: { onScan: () => void }): React.JSX.Element {
  const route = useApp((state) => state.route)
  const navigate = useApp((state) => state.navigate)
  const doc = useApp((state) => state.doc)
  const t = useApp((state) => state.t)
  const { openDialog } = useDocumentActions()
  const [moreOpen, setMoreOpen] = useState(false)

  const go = (target: Route): void => {
    tapFeedback()
    navigate(target)
    setMoreOpen(false)
  }

  const tab = (entry: Destination): React.JSX.Element => {
    const active = route === entry.route
    return (
      <button
        key={entry.route}
        className={`phone-tab${active ? ' active' : ''}`}
        aria-current={active ? 'page' : undefined}
        onClick={() => go(entry.route)}
      >
        {active ? (
          <motion.span layoutId="phone-tab-glow" className="phone-tab-glow" transition={SPRING} />
        ) : null}
        <span className="phone-tab-icon">
          {entry.icon}
          {entry.counts && doc ? <span className="phone-tab-dot" /> : null}
        </span>
        <span>{t(entry.labelKey)}</span>
      </button>
    )
  }

  // The "more" sheet holds a destination anyone reaches for occasionally, so
  // each one is a labelled row rather than an icon to decode.
  const moreIsActive = MORE.some((entry) => entry.route === route)

  return (
    <>
      <nav className="phone-nav">
        {TABS.map(tab)}

        <button
          className="phone-scan"
          title={t('scan.title')}
          onClick={() => {
            tapFeedback('medium')
            onScan()
          }}
        >
          <span className="phone-scan-badge">
            <Camera size={21} />
          </span>
          <span>{t('phone.scan')}</span>
        </button>

        {AFTER.map(tab)}

        <button
          className={`phone-tab${moreIsActive || moreOpen ? ' active' : ''}`}
          aria-expanded={moreOpen}
          onClick={() => {
            tapFeedback()
            setMoreOpen(true)
          }}
        >
          {moreIsActive && !moreOpen ? (
            <motion.span layoutId="phone-tab-glow" className="phone-tab-glow" transition={SPRING} />
          ) : null}
          <span className="phone-tab-icon">
            <MoreHorizontal size={21} />
          </span>
          <span>{t('phone.more')}</span>
        </button>
      </nav>

      <Modal open={moreOpen} onClose={() => setMoreOpen(false)} title={t('phone.more')}>
        <div className="stack">
          <p className="muted" style={{ margin: 0, fontSize: 'var(--text-sm)' }}>
            {t('phone.moreHint')}
          </p>
          <div className="more-list">
            <button
              className="more-row"
              onClick={() => {
                setMoreOpen(false)
                void openDialog()
              }}
            >
              <span className="more-icon accent">
                <FolderOpen size={18} />
              </span>
              <span className="grow">{t('action.open')}</span>
            </button>
            {MORE.map((entry) => (
              <button
                key={entry.route}
                className={`more-row${route === entry.route ? ' active' : ''}`}
                onClick={() => go(entry.route)}
              >
                <span className="more-icon">{entry.icon}</span>
                <span className="grow">{t(entry.labelKey)}</span>
                {entry.route === 'organize' && doc ? (
                  <span className="badge">{doc.pageCount}</span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      </Modal>
    </>
  )
}
