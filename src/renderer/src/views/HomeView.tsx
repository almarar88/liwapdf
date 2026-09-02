import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  FileText,
  FileType2,
  Images,
  UploadCloud,
  Clock3,
  FolderOpen,
  Trash2,
  FileSpreadsheet,
  Signature,
  FilePlus2,
  Repeat2,
  CalendarDays,
  Check
} from 'lucide-react'
import { useApp } from '../store/app'
import { useDocumentActions } from '../hooks/useDocumentActions'
import { Button, Bytes, Card, Dropzone, Empty, useSpotlight } from '../components/ui'
import { formatRelativeTime, formatHijri, formatGregorian } from '../lib/format'
import { clearDraft, documentFromDraft, readDraft, type Draft } from '../lib/documents/draft'
import { listSignatures } from '../components/SignaturePad'
import { toolById, type ToolId, type Tone } from './toolRegistry'

/** The tools people reach for first; the rest are one click away. */
const QUICK_TOOLS: ToolId[] = ['merge', 'split', 'compress', 'watermark', 'protect', 'ocr', 'redact', 'batch']

export function HomeView(): React.JSX.Element {
  const t = useApp((state) => state.t)
  const recents = useApp((state) => state.recents)
  const clearRecents = useApp((state) => state.clearRecents)
  const language = useApp((state) => state.settings.language)
  const navigate = useApp((state) => state.navigate)
  const openTool = useApp((state) => state.openTool)
  const pinnedTools = useApp((state) => state.pinnedTools)
  const doc = useApp((state) => state.doc)
  const editorDoc = useApp((state) => state.editorDoc)
  const openEditorDocument = useApp((state) => state.openEditorDocument)
  const { openDialog, openPaths } = useDocumentActions()
  const spotlight = useSpotlight()

  const [draft, setDraft] = useState<Draft | null>(null)
  const [signatureCount, setSignatureCount] = useState(0)

  useEffect(() => {
    void readDraft().then(setDraft)
    void listSignatures().then((items) => setSignatureCount(items.length))
  }, [])

  // Words in whatever is open, so the figure describes the user's work rather
  // than the product. A marketing number on a dashboard is wasted space.
  const editorWords = useMemo(() => {
    if (!editorDoc) return 0
    const text =
      editorDoc.source.kind === 'sheet'
        ? editorDoc.sheets.flatMap((sheet) => sheet.rows.flatMap((row) => row.map((c) => c.text))).join(' ')
        : editorDoc.source.kind === 'code'
          ? editorDoc.text
          : editorDoc.html.replace(/<[^>]*>/g, ' ')
    return text.split(/\s+/).filter(Boolean).length
  }, [editorDoc])

  // The greeting follows the clock and the date is given on both calendars:
  // the people this is built for live on both, and a letter dated today needs
  // the Hijri date as often as the Gregorian one.
  const now = new Date()
  const hour = now.getHours()
  const greeting = t(hour < 12 ? 'home.morning' : hour < 18 ? 'home.afternoon' : 'home.evening')
  const weekday = new Intl.DateTimeFormat(language === 'ar' ? 'ar' : 'en-GB', { weekday: 'long' }).format(now)
  const dateLine = `${weekday}، ${formatGregorian(now, language)} · ${formatHijri(now, language)}`

  const quick: { key: string; tone: Tone; icon: React.ReactNode; label: string; run: () => void }[] = [
    ...(pinnedTools.length > 0 ? pinnedTools : QUICK_TOOLS).flatMap((id) => {
      const tool = toolById(id)
      if (!tool) return []
      return [
        {
          key: id,
          tone: tool.tone,
          icon: tool.icon,
          label: t(tool.titleKey),
          // Opens the panel itself rather than landing on the grid.
          run: () => openTool(id, tool.needsDocument)
        }
      ]
    }),
    { key: 'new-rich', tone: 'blue', icon: <FilePlus2 size={19} />, label: t('editor.new.rich'), run: () => navigate('editor') },
    { key: 'new-sheet', tone: 'green', icon: <FileSpreadsheet size={19} />, label: t('editor.new.sheet'), run: () => navigate('editor') },
    { key: 'convert', tone: 'purple', icon: <Repeat2 size={19} />, label: t('nav.convert'), run: () => navigate('convert') },
    { key: 'images', tone: 'teal', icon: <Images size={19} />, label: t('convert.pdfToImages'), run: () => navigate('convert') }
  ]

  const stats: { key: string; tone: Tone; icon: React.ReactNode; value: string | number; label: string }[] = [
    { key: 'pages', tone: 'blue', icon: <FileText size={15} />, value: doc ? doc.pageCount : '—', label: t('home.stat.pages') },
    { key: 'words', tone: 'purple', icon: <FileType2 size={15} />, value: editorDoc ? editorWords : '—', label: t('home.stat.words') },
    { key: 'recent', tone: 'amber', icon: <Clock3 size={15} />, value: recents.length, label: t('home.stat.recent') },
    { key: 'signatures', tone: 'green', icon: <Signature size={15} />, value: signatureCount, label: t('home.stat.signatures') }
  ]

  return (
    <div className="view">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      >
        <section className="hero">
          <div>
            <span className="eyebrow">
              <CalendarDays size={13} />
              {dateLine}
            </span>
            <h1>{greeting}</h1>
            <p>{t('home.heroSub')}</p>
            <div className="hero-actions">
              <Button variant="primary" size="lg" onClick={() => void openDialog()}>
                <FolderOpen size={17} />
                {t('action.open')}
              </Button>
              <Button size="lg" onClick={() => navigate('editor')}>
                <FilePlus2 size={17} />
                {t('editor.new.rich')}
              </Button>
            </div>
          </div>
          <div className="hero-art" aria-hidden>
            <div className="sheet"><i className="t" /><i /><i className="s" /><i /></div>
            <div className="sheet"><i className="t" /><i /><i className="s" /><i /></div>
            <div className="sheet">
              <i className="t" /><i /><i className="s" /><i />
              <span className="stamp"><Check size={15} strokeWidth={3} /></span>
            </div>
          </div>
        </section>

        {draft ? (
          <div className="recovery">
            <div>
              <b>{t('editor.recoverTitle')}</b>
              <p className="muted" style={{ margin: '2px 0 0' }}>
                {t('editor.recoverBody', { name: draft.name })}
              </p>
            </div>
            <span className="spacer" />
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                openEditorDocument(documentFromDraft(draft))
                navigate('editor')
                setDraft(null)
              }}
            >
              {t('editor.recoverOpen')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { void clearDraft(); setDraft(null) }}>
              {t('editor.recoverDiscard')}
            </Button>
          </div>
        ) : null}

        {doc || editorDoc ? (
          <div className="grid cols-2" style={{ marginBottom: 16 }}>
            {doc ? (
              <button className="open-doc tone-rose" onClick={() => navigate('viewer')} {...spotlight}>
                <span className="icon"><FileText size={19} /></span>
                <span className="grow">
                  <b><bdi>{doc.name}</bdi></b>
                  <span className="muted">
                    {t('home.openPdf', { pages: doc.pageCount })}
                    {doc.dirty ? ` · ${t('home.unsaved')}` : ''}
                  </span>
                </span>
              </button>
            ) : null}
            {editorDoc ? (
              <button className="open-doc tone-blue" onClick={() => navigate('editor')} {...spotlight}>
                <span className="icon"><FileType2 size={19} /></span>
                <span className="grow">
                  <b><bdi>{editorDoc.source.name}</bdi></b>
                  <span className="muted">
                    {t('home.openWords', { words: editorWords })}
                    {editorDoc.dirty ? ` · ${t('home.unsaved')}` : ''}
                  </span>
                </span>
              </button>
            ) : null}
          </div>
        ) : (
          <Dropzone
            onBrowse={() => void openDialog()}
            onFiles={(paths) => void openPaths(paths)}
            icon={<UploadCloud size={26} />}
            title={t('home.dropTitle')}
            subtitle={t('home.dropSub')}
          />
        )}

        <div className="grid cols-4" style={{ marginTop: 16 }}>
          {stats.map((stat) => (
            <Card key={stat.key} style={{ padding: 0 }} pad={false}>
              <div className={`stat tone-${stat.tone}`}>
                <span className="s-icon">{stat.icon}</span>
                <span className="value">{stat.value}</span>
                <span className="label">{stat.label}</span>
              </div>
            </Card>
          ))}
        </div>

        <h2 className="section-title">{t('home.quick')}</h2>
        {pinnedTools.length === 0 ? <p className="muted" style={{ margin: '-6px 0 12px', fontSize: 'var(--text-sm)' }}>{t('home.pinnedHint')}</p> : null}
        <div className="grid cols-4">
          {quick.map((item, index) => (
            <motion.button
              key={item.key}
              className={`tool tone-${item.tone}`}
              onClick={item.run}
              {...spotlight}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.03 * index, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            >
              <span className="icon">{item.icon}</span>
              <h3>{item.label}</h3>
            </motion.button>
          ))}
        </div>

        <h2 className="section-title">
          {t('home.recent')}
          {recents.length > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void clearRecents()}
              title={t('home.clearRecent')}
            >
              <Trash2 size={14} />
            </Button>
          ) : null}
        </h2>

        <Card pad={false}>
          {recents.length === 0 ? (
            <Empty
              icon={<Clock3 size={24} />}
              title={t('home.noRecent')}
              subtitle={t('home.noRecentSub')}
            />
          ) : (
            recents.slice(0, 10).map((file) => (
              <div className="list-row" key={file.path}>
                <span
                  className={`icon tone-${file.kind === 'pdf' ? 'rose' : file.kind === 'image' ? 'teal' : 'blue'}`}
                  style={{
                    width: 34,
                    height: 34,
                    flex: 'none',
                    borderRadius: 'var(--r-sm)',
                    display: 'grid',
                    placeItems: 'center',
                    background: 'color-mix(in srgb, var(--tone) 14%, transparent)',
                    color: 'var(--tone)'
                  }}
                >
                  {file.kind === 'pdf' ? (
                    <FileText size={16} />
                  ) : file.kind === 'image' ? (
                    <Images size={16} />
                  ) : (
                    <FileType2 size={16} />
                  )}
                </span>
                <div className="grow">
                  <div className="title"><bdi>{file.name}</bdi></div>
                  <div className="sub truncate" title={file.path}>
                    <Bytes value={file.size} /> · {formatRelativeTime(file.openedAt, language)}
                  </div>
                </div>
                <Button size="sm" onClick={() => void openPaths([file.path])}>
                  {t('action.open')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon
                  title={t('action.reveal')}
                  onClick={() => void window.alcode.shell.reveal(file.path)}
                >
                  <FolderOpen size={15} />
                </Button>
              </div>
            ))
          )}
        </Card>
      </motion.div>
    </div>
  )
}
