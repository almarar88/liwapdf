import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  Images,
  FileImage,
  FileText,
  FileType2,
  FileCode2,
  FileDown,
  ArrowRight
} from 'lucide-react'
import { useApp } from '../store/app'
import {
  Button,
  Card,
  Field,
  Modal,
  Segmented,
  Select,
  Slider,
  useSpotlight
} from '../components/ui'
import {
  FILTERS,
  pickFiles,
  pickOneFile,
  describeBatch,
  saveBatch,
  saveBytes,
  saveText,
  bytesToText,
  type FileFilter
} from '../lib/files'
import { PAGE_PRESETS, stripExtension, MM_TO_PT } from '../lib/format'
import {
  imagesToPdf,
  pdfToDocx,
  pdfToImages,
  pdfToPlainText,
  textFileToPdf,
  wordToHtmlDocument,
  wordToPdf
} from '../lib/convert'
import { useRunner } from './tools/shared'
import type { TranslationKey } from '../i18n'

type ConverterId =
  | 'pdfToImages'
  | 'imagesToPdf'
  | 'pdfToText'
  | 'pdfToWord'
  | 'wordToPdf'
  | 'wordToHtml'
  | 'textToPdf'
  | 'htmlToPdf'

interface Converter {
  id: ConverterId
  titleKey: TranslationKey
  descriptionKey: TranslationKey
  icon: React.JSX.Element
}

const CONVERTERS: Converter[] = [
  { id: 'pdfToImages', titleKey: 'convert.pdfToImages', descriptionKey: 'convert.pdfToImages.d', icon: <Images size={19} /> },
  { id: 'imagesToPdf', titleKey: 'convert.imagesToPdf', descriptionKey: 'convert.imagesToPdf.d', icon: <FileImage size={19} /> },
  { id: 'pdfToText', titleKey: 'convert.pdfToText', descriptionKey: 'convert.pdfToText.d', icon: <FileText size={19} /> },
  { id: 'pdfToWord', titleKey: 'convert.pdfToWord', descriptionKey: 'convert.pdfToWord.d', icon: <FileType2 size={19} /> },
  { id: 'wordToPdf', titleKey: 'convert.wordToPdf', descriptionKey: 'convert.wordToPdf.d', icon: <FileDown size={19} /> },
  { id: 'wordToHtml', titleKey: 'convert.wordToHtml', descriptionKey: 'convert.wordToHtml.d', icon: <FileCode2 size={19} /> },
  { id: 'textToPdf', titleKey: 'convert.textToPdf', descriptionKey: 'convert.textToPdf.d', icon: <FileText size={19} /> },
  { id: 'htmlToPdf', titleKey: 'convert.htmlToPdf', descriptionKey: 'convert.htmlToPdf.d', icon: <FileCode2 size={19} /> }
]

export function ConvertView(): React.JSX.Element {
  const t = useApp((state) => state.t)
  const [active, setActive] = useState<ConverterId | null>(null)
  const spotlight = useSpotlight()
  const descriptor = CONVERTERS.find((converter) => converter.id === active)

  return (
    <div className="view">
      <div className="page-head">
        <div>
          <h1>{t('convert.title')}</h1>
          <p>{t('convert.sub')}</p>
        </div>
      </div>

      <div className="grid cols-3">
        {CONVERTERS.map((converter, index) => (
          <motion.button
            key={converter.id}
            className="tool"
            {...spotlight}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.025, duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            onClick={() => setActive(converter.id)}
          >
            <span className="icon">{converter.icon}</span>
            <h3>{t(converter.titleKey)}</h3>
            <p>{t(converter.descriptionKey)}</p>
          </motion.button>
        ))}
      </div>

      <Modal
        open={Boolean(active)}
        onClose={() => setActive(null)}
        title={descriptor ? t(descriptor.titleKey) : ''}
      >
        {active ? <ConverterPanel id={active} onClose={() => setActive(null)} /> : null}
      </Modal>
    </div>
  )
}

function ConverterPanel({
  id,
  onClose
}: {
  id: ConverterId
  onClose: () => void
}): React.JSX.Element {
  const t = useApp((state) => state.t)
  const doc = useApp((state) => state.doc)
  const run = useRunner()

  const [format, setFormat] = useState<'png' | 'jpg'>('png')
  const [dpi, setDpi] = useState(150)
  const [quality, setQuality] = useState(92)
  const [pageSize, setPageSize] = useState<'A4' | 'A3' | 'Letter' | 'Legal' | 'auto'>('A4')
  const [landscape, setLandscape] = useState(false)
  const [margins, setMargins] = useState(18)
  const [fit, setFit] = useState<'contain' | 'cover' | 'actual'>('contain')
  const [files, setFiles] = useState<{ name: string; bytes: Uint8Array }[]>([])

  const sizeTuple = (): [number, number] | null => {
    if (pageSize === 'auto') return null
    const preset = PAGE_PRESETS[pageSize]
    return landscape ? [preset[1], preset[0]] : [preset[0], preset[1]]
  }

  const pickerButton = (filters: FileFilter[], multiple: boolean): React.JSX.Element => (
    <Button
      block
      onClick={async () => {
        const picked = await pickFiles(filters, multiple)
        if (picked.length > 0) {
          setFiles(picked.map((file) => ({ name: file.name, bytes: file.data })))
        }
      }}
    >
      {files.length > 0
        ? files.length === 1
          ? files[0].name
          : `${files.length} ${t('file.all')}`
        : t('action.browse')}
    </Button>
  )

  const pageOptions = (
    <>
      <Field label={t('convert.pageSize')}>
        <Select
          value={pageSize}
          onChange={setPageSize}
          options={[
            { value: 'A4', label: 'A4' },
            { value: 'A3', label: 'A3' },
            { value: 'Letter', label: 'Letter' },
            { value: 'Legal', label: 'Legal' },
            { value: 'auto', label: t('convert.fit.actual') }
          ]}
        />
      </Field>
      <Field label={t('convert.orientation')}>
        <Segmented
          value={landscape ? 'landscape' : 'portrait'}
          onChange={(value) => setLandscape(value === 'landscape')}
          options={[
            { value: 'portrait', label: t('convert.portrait') },
            { value: 'landscape', label: t('convert.landscape') }
          ]}
        />
      </Field>
      <Field label={t('convert.margins')}>
        <Slider value={margins} onChange={setMargins} min={0} max={40} suffix=" mm" />
      </Field>
    </>
  )

  switch (id) {
    case 'pdfToImages':
      return (
        <div className="stack">
          {doc ? (
            <Card style={{ background: 'var(--surface-2)' }}>{doc.name}</Card>
          ) : (
            pickerButton(FILTERS.pdf, false)
          )}
          <Field label={t('convert.imageFormat')}>
            <Segmented
              value={format}
              onChange={setFormat}
              options={[
                { value: 'png', label: 'PNG' },
                { value: 'jpg', label: 'JPG' }
              ]}
            />
          </Field>
          <Field label={t('convert.dpi')}>
            <Slider value={dpi} onChange={setDpi} min={72} max={400} step={6} />
          </Field>
          {format === 'jpg' ? (
            <Field label={t('convert.quality')}>
              <Slider value={quality} onChange={setQuality} min={40} max={100} suffix="%" />
            </Field>
          ) : null}
          <Button
            variant="primary"
            disabled={!doc && files.length === 0}
            onClick={() =>
              void run(t('msg.rendering'), async (report) => {
                const source = doc ? { name: doc.name, bytes: doc.bytes } : files[0]
                const images = await pdfToImages(
                  source.bytes,
                  source.name,
                  { dpi, format, quality: quality / 100 },
                  doc?.password,
                  report
                )
                const outcome = await saveBatch(images)
                const summary = describeBatch(outcome, t)
                if (summary === undefined) return
                if (outcome.saved) onClose()
                return summary
              })
            }
          >
            <ArrowRight size={15} />
            {t('action.export')}
          </Button>
        </div>
      )

    case 'imagesToPdf':
      return (
        <div className="stack">
          {pickerButton(FILTERS.images, true)}
          {pageOptions}
          <Field label={t('convert.fitMode')}>
            <Segmented
              value={fit}
              onChange={setFit}
              options={[
                { value: 'contain', label: t('convert.fit.contain') },
                { value: 'cover', label: t('convert.fit.cover') },
                { value: 'actual', label: t('convert.fit.actual') }
              ]}
            />
          </Field>
          <Button
            variant="primary"
            disabled={files.length === 0}
            onClick={() =>
              void run(t('msg.working'), async (report) => {
                const bytes = await imagesToPdf(
                  files,
                  sizeTuple(),
                  fit,
                  margins * MM_TO_PT,
                  report
                )
                const outcome = await saveBytes(
                  bytes,
                  `${stripExtension(files[0].name)}.pdf`,
                  FILTERS.pdf
                )
                if (!outcome.saved) return
                onClose()
                return outcome.path
              })
            }
          >
            {t('action.export')}
          </Button>
        </div>
      )

    case 'pdfToText':
      return (
        <div className="stack">
          {doc ? <Card style={{ background: 'var(--surface-2)' }}>{doc.name}</Card> : pickerButton(FILTERS.pdf, false)}
          <Button
            variant="primary"
            disabled={!doc && files.length === 0}
            onClick={() =>
              void run(t('msg.working'), async () => {
                const source = doc ? { name: doc.name, bytes: doc.bytes } : files[0]
                const text = await pdfToPlainText(source.bytes, doc?.password)
                const outcome = await saveText(
                  text,
                  `${stripExtension(source.name)}.txt`,
                  FILTERS.text
                )
                if (!outcome.saved) return
                onClose()
                return outcome.path
              })
            }
          >
            {t('action.export')}
          </Button>
        </div>
      )

    case 'pdfToWord':
      return (
        <div className="stack">
          {doc ? <Card style={{ background: 'var(--surface-2)' }}>{doc.name}</Card> : pickerButton(FILTERS.pdf, false)}
          <p className="muted">{t('convert.pdfToWord.d')}</p>
          <Button
            variant="primary"
            disabled={!doc && files.length === 0}
            onClick={() =>
              void run(t('msg.working'), async (report) => {
                const source = doc ? { name: doc.name, bytes: doc.bytes } : files[0]
                const bytes = await pdfToDocx(source.bytes, source.name, doc?.password, report)
                const outcome = await saveBytes(
                  bytes,
                  `${stripExtension(source.name)}.docx`,
                  FILTERS.word
                )
                if (!outcome.saved) return
                onClose()
                return outcome.path
              })
            }
          >
            {t('action.export')}
          </Button>
        </div>
      )

    case 'wordToPdf':
      return (
        <div className="stack">
          {pickerButton(FILTERS.word, false)}
          {pageOptions}
          <Button
            variant="primary"
            disabled={files.length === 0}
            onClick={() =>
              void run(t('msg.working'), async () => {
                const bytes = await wordToPdf(files[0].bytes, files[0].name, {
                  landscape,
                  pageSize: pageSize === 'auto' ? 'A4' : pageSize,
                  marginsMm: margins
                })
                const outcome = await saveBytes(
                  bytes,
                  `${stripExtension(files[0].name)}.pdf`,
                  FILTERS.pdf
                )
                if (!outcome.saved) return
                onClose()
                return outcome.path
              })
            }
          >
            {t('action.export')}
          </Button>
        </div>
      )

    case 'wordToHtml':
      return (
        <div className="stack">
          {pickerButton(FILTERS.word, false)}
          <Button
            variant="primary"
            disabled={files.length === 0}
            onClick={() =>
              void run(t('msg.working'), async () => {
                const html = await wordToHtmlDocument(files[0].bytes, files[0].name)
                const outcome = await saveText(
                  html,
                  `${stripExtension(files[0].name)}.html`,
                  FILTERS.html
                )
                if (!outcome.saved) return
                onClose()
                return outcome.path
              })
            }
          >
            {t('action.export')}
          </Button>
        </div>
      )

    case 'textToPdf':
    case 'htmlToPdf':
      return (
        <div className="stack">
          <Button
            block
            onClick={async () => {
              const picked = await pickOneFile(id === 'textToPdf' ? FILTERS.text : FILTERS.html)
              if (picked) setFiles([{ name: picked.name, bytes: picked.data }])
            }}
          >
            {files.length > 0 ? files[0].name : t('action.browse')}
          </Button>
          {pageOptions}
          <Button
            variant="primary"
            disabled={files.length === 0}
            onClick={() =>
              void run(t('msg.working'), async () => {
                const text = bytesToText(files[0].bytes)
                const isMarkdown = /\.(md|markdown)$/i.test(files[0].name)
                const bytes =
                  id === 'htmlToPdf'
                    ? await window.alcode.print.html(text, {
                        landscape,
                        pageSize: pageSize === 'auto' ? 'A4' : pageSize,
                        marginsMm: margins,
                        printBackground: true
                      })
                    : await textFileToPdf(
                        text,
                        files[0].name,
                        {
                          landscape,
                          pageSize: pageSize === 'auto' ? 'A4' : pageSize,
                          marginsMm: margins
                        },
                        isMarkdown
                      )
                const outcome = await saveBytes(
                  bytes,
                  `${stripExtension(files[0].name)}.pdf`,
                  FILTERS.pdf
                )
                if (!outcome.saved) return
                onClose()
                return outcome.path
              })
            }
          >
            {t('action.export')}
          </Button>
        </div>
      )
  }
}
