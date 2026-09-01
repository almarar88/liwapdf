import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  FileText,
  FileType2,
  Images,
  Combine,
  Scissors,
  Shrink,
  Droplets,
  ShieldCheck,
  UploadCloud,
  Clock3,
  FolderOpen,
  Trash2,
  Sparkles,
  WifiOff,
  Lock,
  FileSpreadsheet,
  Signature,
  Minimize2
} from 'lucide-react'
import { useApp } from '../store/app'
import { useDocumentActions } from '../hooks/useDocumentActions'
import { Button, Bytes, Card, Dropzone, Empty, useSpotlight } from '../components/ui'
import { formatRelativeTime } from '../lib/format'
import { clearDraft, documentFromDraft, readDraft, type Draft } from '../lib/documents/draft'
import { listSignatures } from '../components/SignaturePad'

export function HomeView(): React.JSX.Element {
  const t = useApp((state) => state.t)
  const recents = useApp((state) => state.recents)
  const clearRecents = useApp((state) => state.clearRecents)
  const language = useApp((state) => state.settings.language)
  const navigate = useApp((state) => state.navigate)
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

  const quick = [
    { icon: <FileText size={19} />, label: t('action.openPdf'), run: () => void openDialog() },
    { icon: <FileType2 size={19} />, label: t('editor.new.rich'), run: () => navigate('editor') },
    { icon: <Combine size={19} />, label: t('tool.merge'), run: () => navigate('tools') },
    { icon: <Scissors size={19} />, label: t('tool.split'), run: () => navigate('tools') },
    { icon: <Shrink size={19} />, label: t('tool.compress'), run: () => navigate('tools') },
    { icon: <Images size={19} />, label: t('convert.pdfToImages'), run: () => navigate('convert') },
    { icon: <Droplets size={19} />, label: t('tool.watermark'), run: () => navigate('tools') },
    { icon: <ShieldCheck size={19} />, label: t('tool.protect'), run: () => navigate('tools') },
    { icon: <FileSpreadsheet size={19} />, label: t('editor.new.sheet'), run: () => navigate('editor') },
    { icon: <Minimize2 size={19} />, label: t('tool.compressAny'), run: () => navigate('tools') }
  ]

  return (
    <div className="view">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="page-head">
          <div>
            <h1>{t('home.greeting')}</h1>
            <p>{t('home.sub')}</p>
          </div>
          <div className="spacer" />
          <Button variant="primary" size="lg" onClick={() => void openDialog()}>
            <FolderOpen size={17} />
            {t('action.open')}
          </Button>
        </div>

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
              <button className="open-doc" onClick={() => navigate('viewer')} {...spotlight}>
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
              <button className="open-doc" onClick={() => navigate('editor')} {...spotlight}>
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
          <Card style={{ padding: 0 }} pad={false}>
            <div className="stat">
              <span className="value">{doc ? doc.pageCount : '—'}</span>
              <span className="label">
                <FileText size={12} style={{ verticalAlign: -2, marginInlineEnd: 4 }} />
                {t('home.stat.pages')}
              </span>
            </div>
          </Card>
          <Card style={{ padding: 0 }} pad={false}>
            <div className="stat">
              <span className="value">{editorDoc ? editorWords : '—'}</span>
              <span className="label">
                <FileType2 size={12} style={{ verticalAlign: -2, marginInlineEnd: 4 }} />
                {t('home.stat.words')}
              </span>
            </div>
          </Card>
          <Card style={{ padding: 0 }} pad={false}>
            <div className="stat">
              <span className="value">{recents.length}</span>
              <span className="label">
                <Clock3 size={12} style={{ verticalAlign: -2, marginInlineEnd: 4 }} />
                {t('home.stat.recent')}
              </span>
            </div>
          </Card>
          <Card style={{ padding: 0 }} pad={false}>
            <div className="stat">
              <span className="value">{signatureCount}</span>
              <span className="label">
                <Signature size={12} style={{ verticalAlign: -2, marginInlineEnd: 4 }} />
                {t('home.stat.signatures')}
              </span>
            </div>
          </Card>
        </div>

        <h2 className="section-title">{t('home.quick')}</h2>
        <div className="grid cols-4">
          {quick.map((item, index) => (
            <motion.button
              key={item.label}
              className="tool"
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
                  className="icon"
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 'var(--r-sm)',
                    display: 'grid',
                    placeItems: 'center',
                    background: 'var(--accent-soft)',
                    color: 'var(--accent)'
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
