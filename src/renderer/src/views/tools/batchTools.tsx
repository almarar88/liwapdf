import { useState } from 'react'
import { Layers, Trash2 } from 'lucide-react'
import { useApp } from '../../store/app'
import { Button, Checkbox, Field, Select, TextInput } from '../../components/ui'
import { pickFiles } from '../../lib/files'
import { openFilters } from '../../hooks/useDocumentActions'
import { runBatch, type BatchItem } from '../../lib/batch'
import { stripExtension } from '../../lib/format'
import { useRunner, type ToolPanelProps } from './shared'

type Operation = 'compress' | 'toPdf' | 'watermark' | 'protect' | 'ocr'

const OPERATIONS: Operation[] = ['compress', 'toPdf', 'watermark', 'protect', 'ocr']

/**
 * One job, many files.
 *
 * Nearly every tool in the app acts on the single open document, so applying
 * the same watermark to a folder of contracts meant opening, setting and
 * saving each one by hand — the exact work a computer should be doing. The
 * operations offered here are the ones people actually repeat; anything
 * needing a decision per file (a password to remove, pages to pick) is
 * deliberately absent, because a batch that stops to ask is not a batch.
 */
export function BatchPanel({ onClose }: ToolPanelProps): React.JSX.Element {
  const t = useApp((state) => state.t)
  const notify = useApp((state) => state.notify)
  const run = useRunner()

  const [items, setItems] = useState<BatchItem[]>([])
  const [operation, setOperation] = useState<Operation>('compress')
  const [watermarkText, setWatermarkText] = useState('')
  const [password, setPassword] = useState('')
  const [grayscale, setGrayscale] = useState(false)

  const pick = async (): Promise<void> => {
    const files = await pickFiles(openFilters(), true)
    if (files.length === 0) return
    // Only the paths are kept: the picker hands back every file's bytes, and
    // holding a folder of scans in memory is the thing the runner exists to
    // avoid. Each one is re-read when its turn comes.
    setItems((current) => {
      const seen = new Set(current.map((item) => item.path))
      return [...current, ...files.filter((file) => !seen.has(file.path)).map((file) => ({ path: file.path, name: file.name }))]
    })
  }

  const ready =
    items.length > 0 &&
    (operation !== 'watermark' || watermarkText.trim().length > 0) &&
    (operation !== 'protect' || password.length >= 4)

  const start = (): Promise<void> =>
    run(
      t('batch.working'),
      async (report, signal) => {
        const outcome = await runBatch(
          items,
          { run: (input) => apply(operation, input, { watermarkText, password, grayscale }) },
          (done, total, name) => {
            report(done, total)
            if (name) {
              useApp.getState().setBusy({
                label: t('batch.file', { name, done: done + 1, total }),
                progress: total > 0 ? done / total : null,
                cancel: () => undefined
              })
            }
          },
          signal
        )
        // The OCR models are ~40 MB; worth keeping between files, not afterwards.
        if (operation === 'ocr') void import('../../lib/ocr').then((ocr) => ocr.releaseOcr())
        if (outcome.cancelled && outcome.succeeded === 0) return

        notify({
          kind: outcome.failed.length > 0 ? 'info' : 'success',
          title: t('batch.done', { done: outcome.succeeded, total: items.length }),
          message:
            outcome.failed.length > 0
              ? t('batch.failures', { names: outcome.failed.map((f) => f.name).join('، ') })
              : undefined,
          action: outcome.directory
            ? {
                label: t('action.reveal'),
                run: () => void window.alcode.shell.reveal(outcome.directory!)
              }
            : undefined
        })
        onClose()
      },
      { cancellable: true }
    )

  return (
    <div className="stack">
      <p className="muted">{t('tool.batch.d')}</p>

      <Field label={t('batch.operation')}>
        <Select
          value={operation}
          onChange={(value) => setOperation(value as Operation)}
          options={OPERATIONS.map((id) => ({ value: id, label: t(`batch.op.${id}` as never) }))}
        />
      </Field>

      {operation === 'watermark' ? (
        <Field label={t('opt.text')}>
          <TextInput value={watermarkText} onChange={setWatermarkText} placeholder={t('batch.watermarkHint')} />
        </Field>
      ) : null}

      {operation === 'protect' ? (
        <Field label={t('msg.password')} hint={t('batch.passwordHint')}>
          <TextInput value={password} onChange={setPassword} type="password" />
        </Field>
      ) : null}

      {operation === 'compress' ? (
        <Checkbox checked={grayscale} onChange={setGrayscale} label={t('opt.grayscale')} />
      ) : null}

      <Field label={t('batch.files', { n: items.length })}>
        <div className="row" style={{ gap: 8 }}>
          <Button size="sm" onClick={() => void pick()}>
            {t('batch.add')}
          </Button>
          {items.length > 0 ? (
            <Button size="sm" variant="ghost" ghostDanger onClick={() => setItems([])}>
              <Trash2 size={14} />
              {t('action.clear')}
            </Button>
          ) : null}
        </div>
      </Field>

      {items.length > 0 ? (
        <div className="batch-list">
          {items.slice(0, 60).map((item) => (
            <div className="batch-row" key={item.path}>
              <bdi className="truncate">{item.name}</bdi>
              <button
                className="btn ghost sm icon"
                title={t('action.remove')}
                onClick={() => setItems((current) => current.filter((entry) => entry.path !== item.path))}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          {items.length > 60 ? (
            <p className="hint">{t('batch.more', { n: items.length - 60 })}</p>
          ) : null}
        </div>
      ) : null}

      <Button variant="primary" disabled={!ready} onClick={() => void start()}>
        <Layers size={15} />
        {t('batch.run', { n: items.length })}
      </Button>
    </div>
  )
}

/**
 * Applies one operation to one file's bytes.
 *
 * The heavy modules load on first use, the same way the rest of the app
 * defers them — a batch of Word files should never pay for pdf-lib.
 */
async function apply(
  operation: Operation,
  input: { bytes: Uint8Array; name: string },
  settings: { watermarkText: string; password: string; grayscale: boolean }
): Promise<{ bytes: Uint8Array; name: string } | null> {
  const base = stripExtension(input.name)

  if (operation === 'compress') {
    const { compressFile } = await import('../../lib/compress/universal')
    const result = await compressFile(input.name, input.bytes, {
      level: 'balanced',
      maxImageDimension: 1600,
      grayscale: settings.grayscale,
      convertPngToJpeg: false,
      rasterizePdf: false
    })
    // A file nothing could shrink is copied through rather than skipped: the
    // output folder should hold every file that went in, or the count lies.
    const extension = input.name.includes('.') ? input.name.slice(input.name.lastIndexOf('.') + 1) : 'bin'
    return { bytes: result.bytes, name: `${base}-compressed.${extension}` }
  }

  if (operation === 'toPdf') {
    if (/\.pdf$/i.test(input.name)) return null
    const [{ readDocument }, { exportDocument }] = await Promise.all([
      import('../../lib/documents/read'),
      import('../../lib/documents/write')
    ])
    const loaded = await readDocument(input.name, input.bytes, null)
    if (loaded.kind === 'pdf' || loaded.kind === 'image') return null
    const result = await exportDocument({
      target: 'pdf',
      name: input.name,
      rightToLeft: loaded.direction === 'rtl',
      html: loaded.kind === 'rich' || loaded.kind === 'slides' ? loaded.html : undefined,
      sheets: loaded.kind === 'sheet' ? loaded.sheets : undefined,
      text: loaded.kind === 'code' ? loaded.text : undefined
    })
    return { bytes: result.bytes, name: result.fileName }
  }

  // The two PDF operations only make sense on a PDF; anything else is skipped
  // rather than reported as a failure the user did not cause.
  if (!/\.pdf$/i.test(input.name)) return null

  if (operation === 'ocr') {
    const { makeSearchable } = await import('../../lib/ocr')
    const result = await makeSearchable(input.bytes, { language: 'ara+eng' })
    return { bytes: result.bytes, name: `${base}-searchable.pdf` }
  }
  const ops = await import('../../lib/pdf/ops')

  if (operation === 'watermark') {
    const bytes = await ops.addWatermark(input.bytes, {
      text: settings.watermarkText,
      fontSize: 54,
      color: '#9aa3b2',
      opacity: 0.28,
      rotation: 45,
      anchor: 'center',
      margin: 24,
      scale: 1,
      tile: false,
      bold: false,
      indices: []
    })
    return { bytes, name: `${base}-watermarked.pdf` }
  }

  // Everything stays permitted: the password is the point here, and quietly
  // stripping printing from someone's batch would be a surprise.
  const bytes = await ops.encryptDocument(input.bytes, settings.password, settings.password, {
    printing: true,
    modifying: true,
    copying: true,
    annotating: true,
    fillingForms: true,
    contentAccessibility: true,
    documentAssembly: true
  })
  return { bytes, name: `${base}-protected.pdf` }
}
