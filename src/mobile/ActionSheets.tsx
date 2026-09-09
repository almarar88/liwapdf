import {
  Signature,
  Type,
  Image as ImageIcon,
  Highlighter,
  EyeOff,
  ScanText,
  FileText,
  FileSpreadsheet,
  FileType2,
  Images,
  FileCode2,
  FileDown,
  Presentation,
  Bell,
  CheckCircle2,
  AlertTriangle,
  Info,
  Trash2
} from 'lucide-react'
import { useApp } from '../renderer/src/store/app'
import { Button, Modal } from '../renderer/src/components/ui'
import { formatRelativeTime } from '../renderer/src/lib/format'
import { SheetCards, type SheetEntry } from './SheetCard'

/**
 * The three sheets that are pure navigation, and the notice list.
 *
 * Each entry here already exists somewhere in the app; what the sheet adds is
 * arriving at it directly. Tapping "Sign" used to mean the annotate screen and
 * then finding the pen on its toolbar — two steps where the user had already
 * said what they wanted in the first one.
 */

/* ------------------------------------------------------------------- edit */

export function EditSheet({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element {
  const t = useApp((state) => state.t)
  const openEntry = useApp((state) => state.openEntry)
  const openTool = useApp((state) => state.openTool)

  const go = (run: () => void) => (): void => {
    onClose()
    run()
  }

  const entries: SheetEntry[] = [
    {
      key: 'signature',
      tone: 'yellow',
      icon: <Signature size={19} />,
      title: t('annotate.tool.signature'),
      detail: t('phone.edit.sign.d'),
      run: go(() => openEntry('annotate', 'signature'))
    },
    {
      key: 'text',
      icon: <Type size={19} />,
      title: t('annotate.tool.text'),
      detail: t('phone.edit.text.d'),
      run: go(() => openEntry('annotate', 'text'))
    },
    {
      key: 'image',
      icon: <ImageIcon size={19} />,
      title: t('annotate.tool.image'),
      detail: t('phone.edit.image.d'),
      run: go(() => openEntry('annotate', 'image'))
    },
    {
      key: 'highlight',
      icon: <Highlighter size={19} />,
      title: t('annotate.tool.highlight'),
      detail: t('phone.edit.markup.d'),
      run: go(() => openEntry('annotate', 'highlight'))
    },
    {
      key: 'redact',
      tone: 'orange',
      icon: <EyeOff size={19} />,
      title: t('tool.redact'),
      detail: t('phone.edit.hide.d'),
      run: go(() => openTool('redact', true))
    },
    {
      key: 'ocr',
      tone: 'green',
      icon: <ScanText size={19} />,
      title: t('tool.ocr'),
      detail: t('phone.edit.recognize.d'),
      run: go(() => openTool('ocr', true))
    }
  ]

  return (
    <Modal open={open} onClose={onClose} title={t('phone.card.edit')}>
      <SheetCards entries={entries} />
    </Modal>
  )
}

/* ---------------------------------------------------------------- convert */

export function ConvertSheet({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element {
  const t = useApp((state) => state.t)
  const openEntry = useApp((state) => state.openEntry)

  const go = (id: string) => (): void => {
    onClose()
    openEntry('convert', id)
  }

  const entries: SheetEntry[] = [
    { key: 'pdfToImages', tone: 'green', icon: <Images size={19} />, title: t('convert.pdfToImages'), run: go('pdfToImages') },
    { key: 'imagesToPdf', tone: 'green', icon: <FileDown size={19} />, title: t('convert.imagesToPdf'), run: go('imagesToPdf') },
    { key: 'wordToPdf', icon: <FileType2 size={19} />, title: t('convert.wordToPdf'), run: go('wordToPdf') },
    { key: 'pdfToWord', icon: <FileType2 size={19} />, title: t('convert.pdfToWord'), run: go('pdfToWord') },
    { key: 'pdfToSheet', tone: 'yellow', icon: <FileSpreadsheet size={19} />, title: t('convert.pdfToSheet'), run: go('pdfToSheet') },
    { key: 'pdfToText', icon: <FileText size={19} />, title: t('convert.pdfToText'), run: go('pdfToText') },
    { key: 'textToPdf', icon: <FileText size={19} />, title: t('convert.textToPdf'), run: go('textToPdf') },
    { key: 'htmlToPdf', tone: 'violet', icon: <FileCode2 size={19} />, title: t('convert.htmlToPdf'), run: go('htmlToPdf') },
    { key: 'wordToHtml', tone: 'violet', icon: <Presentation size={19} />, title: t('convert.wordToHtml'), run: go('wordToHtml') }
  ]

  return (
    <Modal open={open} onClose={onClose} title={t('phone.card.convert')}>
      <SheetCards entries={entries} />
    </Modal>
  )
}

/* ---------------------------------------------------------------- notices */

export function NoticesSheet({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element {
  const t = useApp((state) => state.t)
  const notices = useApp((state) => state.notices)
  const clear = useApp((state) => state.clearNotices)
  const language = useApp((state) => state.settings.language)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('phone.notices')}
      footer={
        notices.length > 0 ? (
          <Button variant="ghost" onClick={clear}>
            <Trash2 size={15} />
            {t('phone.clearNotices')}
          </Button>
        ) : undefined
      }
    >
      {notices.length === 0 ? (
        <p className="muted" style={{ display: 'grid', gap: 10, justifyItems: 'center', padding: '18px 0', margin: 0 }}>
          <Bell size={26} />
          {t('phone.noNotices')}
        </p>
      ) : (
        <div className="notice-list">
          {notices.map((notice) => (
            <div className={`notice kind-${notice.kind}`} key={notice.id}>
              <span className="notice-icon">
                {notice.kind === 'success' ? (
                  <CheckCircle2 size={17} />
                ) : notice.kind === 'error' ? (
                  <AlertTriangle size={17} />
                ) : (
                  <Info size={17} />
                )}
              </span>
              <div className="grow">
                <b>{notice.title}</b>
                {notice.message ? <p>{notice.message}</p> : null}
                <span className="muted">{formatRelativeTime(notice.at, language)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
