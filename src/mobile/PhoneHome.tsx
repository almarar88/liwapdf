import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Bell,
  HelpCircle,
  Search,
  AudioLines,
  ScanLine,
  PenSquare,
  Repeat2,
  Sparkles,
  FileText,
  FileSpreadsheet,
  Image as ImageIcon,
  FileType2,
  Share2,
  Repeat,
  FolderOpen,
  Languages
} from 'lucide-react'
import { useApp } from '../renderer/src/store/app'
import { useDocumentActions } from '../renderer/src/hooks/useDocumentActions'
import type { RecentFile } from '@shared/types'
import { tapFeedback } from './shell'

/**
 * The phone's home screen.
 *
 * Everything this app can do fits in four verbs — scan a thing, edit a thing,
 * turn it into another format, read it for me — and on a phone that is the
 * whole navigation. Four cards big enough to hit without looking, a search
 * field, and the files you had open last: nothing else earns a place above
 * the fold on a screen this size.
 *
 * The cards are staggered rather than gridded because a 2×2 of identical
 * rectangles reads as a wall; offsetting the second column by a card's
 * shoulder gives the eye a path down the screen and makes the four distinct
 * at a glance rather than after reading four labels.
 */

export type Sheet = 'scan' | 'edit' | 'convert' | 'ai' | 'notices' | 'files' | null

export function PhoneHome({ onSheet }: { onSheet: (sheet: Sheet) => void }): React.JSX.Element {
  const t = useApp((state) => state.t)
  const recents = useApp((state) => state.recents)
  const unread = useApp((state) => state.unreadNotices)
  const language = useApp((state) => state.settings.language)
  const setSettings = useApp((state) => state.setSettings)
  const [query, setQuery] = useState('')
  const { openDialog, openPaths } = useDocumentActions()

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const list = needle
      ? recents.filter((file) => file.name.toLowerCase().includes(needle))
      : recents
    return list.slice(0, 12)
  }, [recents, query])

  const cards: {
    key: Exclude<Sheet, null>
    icon: React.JSX.Element
    title: string
    lines: string
    tall: boolean
  }[] = [
    {
      key: 'scan',
      icon: <ScanLine size={20} />,
      title: t('phone.card.scan'),
      lines: t('phone.card.scan.d'),
      tall: false
    },
    {
      key: 'edit',
      icon: <PenSquare size={20} />,
      title: t('phone.card.edit'),
      lines: t('phone.card.edit.d'),
      tall: true
    },
    {
      key: 'convert',
      icon: <Repeat2 size={20} />,
      title: t('phone.card.convert'),
      lines: t('phone.card.convert.d'),
      tall: true
    },
    {
      key: 'ai',
      icon: <Sparkles size={20} />,
      title: t('phone.card.ai'),
      lines: t('phone.card.ai.d'),
      tall: false
    }
  ]

  const open = (key: Exclude<Sheet, null>): void => {
    tapFeedback('medium')
    onSheet(key)
  }

  return (
    <div className="phone-home">
      <header className="ph-top">
        <div className="ph-top-group">
          <button className="ph-round" aria-label={t('phone.help')} onClick={() => onSheet('ai')}>
            <HelpCircle size={19} />
          </button>
          {/* The label is the language you would get, not the one you are in:
              a toggle that shows its current state leaves the user guessing
              whether tapping it confirms or changes. */}
          <button
            className="ph-lang"
            lang={language === 'ar' ? 'en' : 'ar'}
            dir={language === 'ar' ? 'ltr' : 'rtl'}
            aria-label={t('settings.language')}
            title={t('settings.language')}
            onClick={() => {
              tapFeedback()
              void setSettings({ language: language === 'ar' ? 'en' : 'ar' })
            }}
          >
            <Languages size={15} />
            {language === 'ar' ? 'English' : 'العربية'}
          </button>
        </div>
        <button
          className="ph-round"
          aria-label={t('phone.notices')}
          onClick={() => onSheet('notices')}
        >
          <Bell size={19} />
          {unread > 0 ? <i className="ph-badge">{unread > 9 ? '9+' : unread}</i> : null}
        </button>
      </header>

      <div className="ph-cards">
        {cards.map((card, index) => (
          <motion.button
            key={card.key}
            className={`ph-card ph-${card.key}${card.tall ? ' tall' : ''}`}
            onClick={() => open(card.key)}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.04 * index, duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className="ph-card-icon">{card.icon}</span>
            <b>{card.title}</b>
            <span>{card.lines}</span>
          </motion.button>
        ))}
      </div>

      <div className="ph-search">
        <Search size={17} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('phone.searchFiles')}
          aria-label={t('phone.searchFiles')}
          enterKeyHint="search"
        />
        <button
          className="ph-voice"
          aria-label={t('phone.dictate')}
          onClick={() => onSheet('ai')}
        >
          <AudioLines size={17} />
        </button>
      </div>

      {matches.length > 0 ? (
        <div className="ph-strip">
          {matches.map((file) => (
            <FileChip key={file.path} file={file} onOpen={() => void openPaths([file.path])} />
          ))}
        </div>
      ) : query ? (
        <p className="ph-empty">{t('phone.noMatch')}</p>
      ) : (
        <button className="ph-empty" onClick={() => void openDialog()}>
          <span>
            <FolderOpen size={20} />
          </span>
          {t('home.dropSub')}
        </button>
      )}
    </div>
  )
}

/**
 * One recently opened file.
 *
 * The two small buttons are the two things anyone does with a file they can
 * see the name of but have not opened: convert it, or send it on. Putting
 * them on the card removes a screen from both journeys.
 */
export function FileChip({
  file,
  onOpen,
  showSize = false
}: {
  file: RecentFile
  onOpen: () => void
  showSize?: boolean
}): React.JSX.Element {
  const t = useApp((state) => state.t)
  const openEntry = useApp((state) => state.openEntry)
  const notify = useApp((state) => state.notify)

  return (
    <div className={`ph-file kind-${file.kind}`}>
      <div className="ph-file-top">
        <button
          className="ph-file-act"
          aria-label={t('nav.convert')}
          title={t('nav.convert')}
          onClick={() => openEntry('convert', converterFor(file))}
        >
          <Repeat size={13} />
        </button>
        <button
          className="ph-file-act"
          aria-label={t('action.share')}
          title={t('action.share')}
          onClick={() => {
            void window.alcode.shell.reveal(file.path).catch(() => {
              notify({ kind: 'error', title: t('msg.error') })
            })
          }}
        >
          <Share2 size={13} />
        </button>
        <span className="ph-file-glyph">{glyph(file.kind)}</span>
      </div>
      <button className="ph-file-name" onClick={onOpen}>
        <bdi>{file.name}</bdi>
      </button>
      {showSize ? <span className="ph-file-size">{Math.max(1, Math.round(file.size / 1024))} KB</span> : null}
    </div>
  )
}

function glyph(kind: RecentFile['kind']): React.JSX.Element {
  if (kind === 'image') return <ImageIcon size={13} />
  if (kind === 'pdf') return <FileText size={13} />
  if (kind === 'docx') return <FileType2 size={13} />
  return <FileSpreadsheet size={13} />
}

/** The conversion a file of this kind is most often asked for. */
function converterFor(file: RecentFile): string {
  if (file.kind === 'image') return 'imagesToPdf'
  if (file.kind === 'docx') return 'wordToPdf'
  if (file.kind === 'text') return 'textToPdf'
  return 'pdfToImages'
}
