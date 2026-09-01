import { useState } from 'react'
import { FileDown, Minimize2 } from 'lucide-react'
import { useApp } from '../../store/app'
import { Button, Bytes, Card, Checkbox, Field, Select, Slider, Switch } from '../../components/ui'
import { pickOneFile, saveBytes, type FileFilter } from '../../lib/files'
import { formatBytes, ltr, stripExtension, extensionOf } from '../../lib/format'
import {
  compressFile,
  compressionTargetFor,
  type CompressTarget,
  type UniversalCompressResult
} from '../../lib/compress/universal'
import type { CompressionLevel } from '../../lib/pdf/compress'
import { useRunner, type ToolPanelProps } from './shared'

const COMPRESSIBLE: FileFilter[] = [
  {
    name: 'Compressible files',
    extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'epub']
  },
  { name: 'PDF', extensions: ['pdf'] },
  { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff'] },
  { name: 'Office', extensions: ['docx', 'xlsx', 'pptx', 'odt', 'ods', 'epub'] }
]

const TARGET_LABELS: Record<CompressTarget, string> = {
  pdf: 'PDF',
  image: 'Image',
  'zip-office': 'Office',
  zip: 'ZIP',
  none: '—'
}

/**
 * Shrinks any supported file. The current PDF in the workspace is offered as
 * the default source so the common case takes one click.
 */
export function CompressAnyPanel({ onClose }: ToolPanelProps): React.JSX.Element {
  const t = useApp((state) => state.t)
  const doc = useApp((state) => state.doc)
  const applyPdfBytes = useApp((state) => state.applyPdfBytes)
  const notify = useApp((state) => state.notify)
  const run = useRunner()

  const [file, setFile] = useState<{ name: string; bytes: Uint8Array } | null>(
    doc ? { name: doc.name, bytes: doc.bytes } : null
  )
  const [level, setLevel] = useState<CompressionLevel>('balanced')
  const [maxDimension, setMaxDimension] = useState(2000)
  const [grayscale, setGrayscale] = useState(false)
  const [rasterizePdf, setRasterizePdf] = useState(true)
  const [convertPngToJpeg, setConvertPngToJpeg] = useState(true)
  const [result, setResult] = useState<UniversalCompressResult | null>(null)

  const target = file ? compressionTargetFor(file.name, file.bytes) : 'none'
  const isCurrentPdf = Boolean(doc && file?.name === doc.name && file.bytes === doc.bytes)

  return (
    <div className="stack">
      <Field label={t('opt.sourceFile')}>
        <Button
          block
          onClick={async () => {
            const picked = await pickOneFile(COMPRESSIBLE)
            if (picked) {
              setFile({ name: picked.name, bytes: picked.data })
              setResult(null)
            }
          }}
        >
          <FileDown size={15} />
          {file ? file.name : t('action.browse')}
        </Button>
      </Field>

      {file ? (
        <Card style={{ background: 'var(--surface-2)' }}>
          <div className="row between">
            <span className="muted">{t('msg.sizeBefore')}</span>
            <strong className="mono"><Bytes value={file.bytes.byteLength} /></strong>
          </div>
          <div className="row between" style={{ marginTop: 6 }}>
            <span className="muted">{t('editor.format')}</span>
            <span className="badge accent">{TARGET_LABELS[target]}</span>
          </div>
        </Card>
      ) : null}

      <Field label={t('opt.level')}>
        <Select
          value={level}
          onChange={setLevel}
          options={[
            { value: 'light', label: t('opt.level.light') },
            { value: 'balanced', label: t('opt.level.balanced') },
            { value: 'strong', label: t('opt.level.strong') },
            { value: 'extreme', label: t('opt.level.extreme') }
          ]}
        />
      </Field>

      {target !== 'pdf' ? (
        <Field label={t('opt.maxImageDimension')}>
          <Slider value={maxDimension} onChange={setMaxDimension} min={480} max={6000} step={40} />
        </Field>
      ) : (
        <Switch checked={rasterizePdf} onChange={setRasterizePdf} label={t('opt.rasterize')} />
      )}

      <Checkbox checked={grayscale} onChange={setGrayscale} label={t('opt.grayscale')} />
      {target === 'zip-office' || target === 'image' ? (
        <Checkbox
          checked={convertPngToJpeg}
          onChange={setConvertPngToJpeg}
          label={t('opt.convertPng')}
        />
      ) : null}

      {result ? (
        <Card style={{ background: 'var(--surface-2)' }}>
          <div className="row between">
            <span className="muted">{t('msg.sizeAfter')}</span>
            <strong className="mono"><Bytes value={result.after} /></strong>
          </div>
          <div className="row between" style={{ marginTop: 6 }}>
            <span className="muted">{t('msg.reduction')}</span>
            <span className={`badge ${result.keptOriginal ? '' : 'green'}`}>
              {result.keptOriginal
                ? t('msg.noGain')
                : `${Math.round(((result.before - result.after) / result.before) * 100)}%`}
            </span>
          </div>
          {result.detail ? (
            <div className="muted" style={{ marginTop: 6, fontSize: 'var(--text-sm)' }}>
              {result.detail}
            </div>
          ) : null}
        </Card>
      ) : null}

      <Button
        variant="primary"
        disabled={!file || target === 'none'}
        onClick={() =>
          void run(
            t('msg.working'),
            async (report, signal) => {
            const outcome = await compressFile(
              file!.name,
              file!.bytes,
              {
                level,
                maxImageDimension: maxDimension,
                grayscale,
                rasterizePdf,
                convertPngToJpeg,
                onProgress: report,
                signal
              },
              isCurrentPdf ? doc?.password : undefined
            )
            if (signal.aborted) return
            setResult(outcome)

            if (outcome.keptOriginal) {
              notify({ kind: 'info', title: t('msg.noGain') })
              return
            }

            // Compressing the open PDF updates the workspace in place.
            if (isCurrentPdf && outcome.target === 'pdf') {
              await applyPdfBytes(outcome.bytes)
              notify({
                kind: 'success',
                title: `${t('msg.sizeAfter')}: ${ltr(formatBytes(outcome.after))}`,
                message: `${t('msg.reduction')}: ${ltr(formatBytes(outcome.before - outcome.after))}`
              })
              onClose()
              return
            }

            // The compressor now says what it produced, which beats sniffing:
            // it is the only source that knows a PNG was kept as PNG because
            // the picture had transparency.
            const extension =
              outcome.target === 'image'
                ? (outcome.mimeType?.split('/')[1]?.replace('jpeg', 'jpg') ??
                  guessImageExtension(outcome.bytes))
                : extensionOf(file!.name)
            const saved = await saveBytes(
              outcome.bytes,
              `${stripExtension(file!.name)}-compressed.${extension}`,
              [{ name: extension.toUpperCase(), extensions: [extension] }]
            )
            if (!saved.saved) return
            onClose()
            return saved.path
            },
            { cancellable: rasterizePdf }
          )
        }
      >
        <Minimize2 size={15} />
        {t('tool.compressAny')}
      </Button>
    </div>
  )
}

/** The compressor picks JPEG or WebP per image, so read it back from the bytes. */
function guessImageExtension(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpg'
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'webp'
  }
  return 'png'
}
