import { useState } from 'react'
import { FileDown, ScanText, Sparkles } from 'lucide-react'
import { useApp } from '../../store/app'
import { Button, Checkbox, Field, Select } from '../../components/ui'
import { saveText } from '../../lib/files'
import { makeSearchable, recognizeDocument, type OcrLanguage } from '../../lib/ocr'
import { documentBaseName } from '../../hooks/useDocumentActions'
import { parsePageRange } from '../../lib/format'
import { RangeField, useRunner, type ToolPanelProps } from './shared'

const LANGUAGES: OcrLanguage[] = ['ara+eng', 'ara', 'eng']
const DPI_OPTIONS = ['200', '300', '400'] as const

/**
 * Optical character recognition, entirely offline.
 *
 * One panel covers both things people want from OCR: the text out of a scan,
 * and a scan that behaves like a real document. The second is the valuable
 * one — it leaves the page looking untouched and adds an invisible layer of
 * the recognised words, so search, selection and copy start working.
 */
export function OcrPanel({ onClose }: ToolPanelProps): React.JSX.Element {
  const t = useApp((state) => state.t)
  const doc = useApp((state) => state.doc)
  const applyPdfBytes = useApp((state) => state.applyPdfBytes)
  const notify = useApp((state) => state.notify)
  const run = useRunner()

  const [language, setLanguage] = useState<OcrLanguage>('ara+eng')
  const [dpi, setDpi] = useState<(typeof DPI_OPTIONS)[number]>('300')
  const [range, setRange] = useState('')
  const [searchable, setSearchable] = useState(true)

  if (!doc) return <p className="muted">{t('msg.noDocument')}</p>

  const pagesFor = (): number[] => {
    const indices = parsePageRange(range, doc.pageCount)
    return indices.map((index) => index + 1)
  }

  return (
    <div className="stack">
      <p className="muted">{t('tool.ocr.d')}</p>

      <Field label={t('ocr.language')}>
        <Select
          value={language}
          onChange={(value) => setLanguage(value as OcrLanguage)}
          options={LANGUAGES.map((code) => ({ value: code, label: t(`ocr.lang.${code}` as never) }))}
        />
      </Field>

      <Field label={t('ocr.quality')} hint={t('ocr.qualityHint')}>
        <Select
          value={dpi}
          onChange={(value) => setDpi(value as (typeof DPI_OPTIONS)[number])}
          options={DPI_OPTIONS.map((value) => ({ value, label: `${value} DPI` }))}
        />
      </Field>

      <RangeField value={range} onChange={setRange} />

      <Checkbox checked={searchable} onChange={setSearchable} label={t('ocr.makeSearchable')} />

      <p className="hint">{t('ocr.arabicNote')}</p>

      <div className="row" style={{ gap: 8 }}>
        <Button
          variant="primary"
          onClick={() =>
            void run(t('ocr.working'), async (report) => {
              if (searchable) {
                const result = await makeSearchable(doc.bytes, {
                  language,
                  dpi: Number(dpi),
                  pages: pagesFor(),
                  password: doc.password,
                  onProgress: (done, total) => report(done, total)
                })
                if (result.placedWords === 0) {
                  notify({ kind: 'info', title: t('ocr.nothingFound') })
                  return
                }
                await applyPdfBytes(result.bytes)
                onClose()
                return t('ocr.placed', { n: result.placedWords })
              }

              const pages = await recognizeDocument(doc.bytes, {
                language,
                dpi: Number(dpi),
                pages: pagesFor(),
                password: doc.password,
                onProgress: (done, total) => report(done, total)
              })
              const text = pages
                .map((page) => `--- ${t('msg.pages')} ${page.pageNumber} ---\n${page.text.trim()}`)
                .join('\n\n')
              if (!text.replace(/[-\s]|---/g, '')) {
                notify({ kind: 'info', title: t('ocr.nothingFound') })
                return
              }
              const outcome = await saveText(text, `${documentBaseName(doc.name)}-ocr.txt`, [
                { name: 'file.text', extensions: ['txt'] }
              ])
              if (!outcome.saved) return
              onClose()
              return outcome.path
            })
          }
        >
          {searchable ? <Sparkles size={15} /> : <FileDown size={15} />}
          {searchable ? t('ocr.run') : t('action.export')}
        </Button>
        <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
          <ScanText size={13} style={{ verticalAlign: '-2px' }} /> {t('ocr.offline')}
        </span>
      </div>
    </div>
  )
}
