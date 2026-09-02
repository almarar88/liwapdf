import { useEffect, useState } from 'react'
import { FileDown, FileText, Image as ImageIcon, Paperclip } from 'lucide-react'
import { useApp } from '../../store/app'
import {
  Button,
  Bytes,
  Card,
  Checkbox,
  ColorInput,
  Empty,
  Field,
  Segmented,
  Select,
  Slider,
  TextInput
} from '../../components/ui'
import { FILTERS, pickFiles, pickOneFile, describeBatch,
  saveBatch, saveBytes, normalizeImage } from '../../lib/files'
import { formatBytes, MM_TO_PT, stripExtension } from '../../lib/format'
import * as ops from '../../lib/pdf/ops'
import { extractImages, readOutline, type OutlineNode } from '../../lib/pdf/render'
import { diffLines, documentTextLines } from '../../lib/convert'
import { AnchorPicker, RangeField, resolveRange, useApplied,
  useRunner, type ToolPanelProps } from './shared'

/* -------------------------------------------------------------- watermark */

export function WatermarkPanel({ onClose }: ToolPanelProps): React.JSX.Element {
  const t = useApp((state) => state.t)
  const applied = useApplied()
  const doc = useApp((state) => state.doc)
  const run = useRunner()

  const [source, setSource] = useState<'text' | 'image'>('text')
  const [text, setText] = useState(t('app.name'))
  const [image, setImage] = useState<{ name: string; bytes: Uint8Array } | null>(null)
  const [fontSize, setFontSize] = useState(48)
  const [color, setColor] = useState('#8892a6')
  const [opacity, setOpacity] = useState(22)
  const [rotation, setRotation] = useState(45)
  const [anchor, setAnchor] = useState<ops.Anchor>('center')
  const [scale, setScale] = useState(40)
  const [tile, setTile] = useState(false)
  const [bold, setBold] = useState(true)
  const [range, setRange] = useState('')

  if (!doc) return <p className="muted">{t('msg.noDocument')}</p>

  return (
    <div className="stack">
      <Segmented
        value={source}
        onChange={setSource}
        options={[
          { value: 'text', label: t('opt.text') },
          { value: 'image', label: t('opt.imageFile') }
        ]}
      />

      {source === 'text' ? (
        <>
          <Field label={t('opt.text')}>
            <TextInput value={text} onChange={setText} />
          </Field>
          <Field label={t('opt.fontSize')}>
            <Slider value={fontSize} onChange={setFontSize} min={8} max={140} />
          </Field>
          <Field label={t('opt.color')}>
            <ColorInput value={color} onChange={setColor} />
          </Field>
          <Checkbox checked={bold} onChange={setBold} label={t('word.bold')} />
        </>
      ) : (
        <>
          <Button
            onClick={async () => {
              const picked = await pickOneFile(FILTERS.images)
              if (picked) setImage({ name: picked.name, bytes: picked.data })
            }}
          >
            <ImageIcon size={15} />
            {image ? image.name : t('action.browse')}
          </Button>
          <Field label={t('opt.scale')}>
            <Slider value={scale} onChange={setScale} min={5} max={100} suffix="%" />
          </Field>
        </>
      )}

      <Field label={t('opt.opacity')}>
        <Slider value={opacity} onChange={setOpacity} min={3} max={100} suffix="%" />
      </Field>
      <Field label={t('opt.rotation')}>
        <Slider value={rotation} onChange={setRotation} min={-90} max={90} suffix="°" />
      </Field>
      <Checkbox checked={tile} onChange={setTile} label={t('opt.tile')} />
      {tile ? null : <AnchorPicker value={anchor} onChange={setAnchor} />}
      <RangeField value={range} onChange={setRange} />

      <Button
        variant="primary"
        disabled={source === 'image' && !image}
        onClick={() =>
          void run(t('msg.working'), async () => {
            const indices = resolveRange(range, doc.pageCount)
            const prepared = image ? await normalizeImage(image.name, image.bytes) : null
            const next = await ops.addWatermark(
              doc.bytes,
              {
                text: source === 'text' ? text : undefined,
                imageBytes: source === 'image' ? prepared?.bytes : undefined,
                imageType: prepared?.type,
                fontSize,
                color,
                opacity: opacity / 100,
                rotation,
                anchor,
                margin: 36,
                scale,
                tile,
                bold,
                indices
              },
              doc.password
            )
            await applied(next, 'tool.watermark')
            onClose()
          })
        }
      >
        {t('action.apply')}
      </Button>
    </div>
  )
}

/* ----------------------------------------------------------- page numbers */

export function PageNumbersPanel({ onClose }: ToolPanelProps): React.JSX.Element {
  const t = useApp((state) => state.t)
  const applied = useApplied()
  const doc = useApp((state) => state.doc)
  const language = useApp((state) => state.settings.language)
  const run = useRunner()

  const [format, setFormat] = useState<ops.NumberFormat>('n')
  const [startAt, setStartAt] = useState(1)
  const [anchor, setAnchor] = useState<ops.Anchor>('bottomCenter')
  const [fontSize, setFontSize] = useState(11)
  const [color, setColor] = useState('#3b4252')
  const [skipFirst, setSkipFirst] = useState(false)
  const [numerals, setNumerals] = useState<'western' | 'arabic-indic'>(
    language === 'ar' ? 'arabic-indic' : 'western'
  )
  const [templateLanguage, setTemplateLanguage] = useState<'ar' | 'en'>(language)
  const [range, setRange] = useState('')

  if (!doc) return <p className="muted">{t('msg.noDocument')}</p>

  return (
    <div className="stack">
      <Field label={t('opt.format')}>
        <Select
          value={format}
          onChange={setFormat}
          options={[
            { value: 'n', label: '1' },
            { value: 'n-of-total', label: '1 / 10' },
            { value: 'page-n', label: templateLanguage === 'ar' ? 'صفحة 1' : 'Page 1' },
            {
              value: 'page-n-of-total',
              label: templateLanguage === 'ar' ? 'صفحة 1 من 10' : 'Page 1 of 10'
            },
            { value: 'dash-n-dash', label: '- 1 -' }
          ]}
        />
      </Field>
      <Field label={t('opt.startAt')}>
        <TextInput type="number" value={startAt} onChange={(value) => setStartAt(Number(value) || 1)} />
      </Field>
      <AnchorPicker value={anchor} onChange={setAnchor} />
      <Field label={t('opt.fontSize')}>
        <Slider value={fontSize} onChange={setFontSize} min={6} max={28} />
      </Field>
      <Field label={t('opt.color')}>
        <ColorInput value={color} onChange={setColor} />
      </Field>
      <Checkbox checked={skipFirst} onChange={setSkipFirst} label={t('opt.skipFirst')} />
      <Field label={t('opt.numerals')}>
        <Segmented
          value={numerals}
          onChange={setNumerals}
          options={[
            { value: 'western', label: '0123456789' },
            { value: 'arabic-indic', label: '٠١٢٣٤٥٦٧٨٩' }
          ]}
        />
      </Field>
      <Field label={t('opt.templateLanguage')}>
        <Segmented
          value={templateLanguage}
          onChange={setTemplateLanguage}
          options={[
            { value: 'ar', label: 'العربية' },
            { value: 'en', label: 'English' }
          ]}
        />
      </Field>
      <RangeField value={range} onChange={setRange} />

      <Button
        variant="primary"
        onClick={() =>
          void run(t('msg.working'), async () => {
            const indices = resolveRange(range, doc.pageCount)
            const next = await ops.addPageNumbers(
              doc.bytes,
              {
                format,
                startAt,
                anchor,
                margin: 28,
                fontSize,
                color,
                bold: false,
                skipFirst,
                indices,
                numerals,
                templateLanguage
              },
              doc.password
            )
            await applied(next, 'tool.pageNumbers')
            onClose()
          })
        }
      >
        {t('action.apply')}
      </Button>
    </div>
  )
}

/* ---------------------------------------------------------- header/footer */

export function HeaderFooterPanel({ onClose }: ToolPanelProps): React.JSX.Element {
  const t = useApp((state) => state.t)
  const applied = useApplied()
  const doc = useApp((state) => state.doc)
  const run = useRunner()
  const [header, setHeader] = useState('')
  const [footer, setFooter] = useState('')
  const [align, setAlign] = useState<'start' | 'center' | 'end'>('center')
  const [fontSize, setFontSize] = useState(10)
  const [color, setColor] = useState('#5a6474')
  const [range, setRange] = useState('')

  if (!doc) return <p className="muted">{t('msg.noDocument')}</p>

  return (
    <div className="stack">
      <Field label={t('opt.headerText')}>
        <TextInput value={header} onChange={setHeader} />
      </Field>
      <Field label={t('opt.footerText')} hint={t('opt.hfTokens')}>
        <TextInput value={footer} onChange={setFooter} />
      </Field>
      <Field label={t('opt.position')}>
        <Segmented
          value={align}
          onChange={setAlign}
          options={[
            { value: 'start', label: t('word.alignStart') },
            { value: 'center', label: t('word.alignCenter') },
            { value: 'end', label: t('word.alignEnd') }
          ]}
        />
      </Field>
      <Field label={t('opt.fontSize')}>
        <Slider value={fontSize} onChange={setFontSize} min={6} max={24} />
      </Field>
      <Field label={t('opt.color')}>
        <ColorInput value={color} onChange={setColor} />
      </Field>
      <RangeField value={range} onChange={setRange} />

      <Button
        variant="primary"
        disabled={!header.trim() && !footer.trim()}
        onClick={() =>
          void run(t('msg.working'), async () => {
            const indices = resolveRange(range, doc.pageCount)
            const next = await ops.addHeaderFooter(
              doc.bytes,
              { header, footer, fontSize, color, margin: 24, align, indices },
              doc.password
            )
            await applied(next, 'tool.headerFooter')
            onClose()
          })
        }
      >
        {t('action.apply')}
      </Button>
    </div>
  )
}

/* ------------------------------------------------------- background/stamp */

export function BackgroundPanel({ onClose }: ToolPanelProps): React.JSX.Element {
  const t = useApp((state) => state.t)
  const applied = useApplied()
  const doc = useApp((state) => state.doc)
  const run = useRunner()
  const [mode, setMode] = useState<'color' | 'image'>('color')
  const [color, setColor] = useState('#fdf6e3')
  const [image, setImage] = useState<{ name: string; bytes: Uint8Array } | null>(null)
  const [opacity, setOpacity] = useState(18)
  const [range, setRange] = useState('')

  if (!doc) return <p className="muted">{t('msg.noDocument')}</p>

  return (
    <div className="stack">
      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { value: 'color', label: t('opt.color') },
          { value: 'image', label: t('opt.imageFile') }
        ]}
      />
      {mode === 'color' ? (
        <Field label={t('opt.color')}>
          <ColorInput value={color} onChange={setColor} />
        </Field>
      ) : (
        <Button
          onClick={async () => {
            const picked = await pickOneFile(FILTERS.images)
            if (picked) setImage({ name: picked.name, bytes: picked.data })
          }}
        >
          <ImageIcon size={15} />
          {image ? image.name : t('action.browse')}
        </Button>
      )}
      <Field label={t('opt.opacity')}>
        <Slider value={opacity} onChange={setOpacity} min={2} max={100} suffix="%" />
      </Field>
      <RangeField value={range} onChange={setRange} />

      <Button
        variant="primary"
        disabled={mode === 'image' && !image}
        onClick={() =>
          void run(t('msg.working'), async () => {
            const indices = resolveRange(range, doc.pageCount)
            const prepared = image ? await normalizeImage(image.name, image.bytes) : null
            const next = await ops.addBackground(
              doc.bytes,
              {
                color: mode === 'color' ? color : undefined,
                imageBytes: mode === 'image' ? prepared?.bytes : undefined,
                imageType: prepared?.type,
                opacity: opacity / 100,
                indices
              },
              doc.password
            )
            await applied(next, 'tool.background')
            onClose()
          })
        }
      >
        {t('action.apply')}
      </Button>
    </div>
  )
}

const STAMP_PRESETS = ['DRAFT', 'CONFIDENTIAL', 'APPROVED', 'مسودة', 'سري', 'معتمد']

export function StampPanel({ onClose }: ToolPanelProps): React.JSX.Element {
  const t = useApp((state) => state.t)
  const applied = useApplied()
  const doc = useApp((state) => state.doc)
  const run = useRunner()
  const [text, setText] = useState(STAMP_PRESETS[0])
  const [color, setColor] = useState('#e5484d')
  const [anchor, setAnchor] = useState<ops.Anchor>('center')
  const [range, setRange] = useState('')

  if (!doc) return <p className="muted">{t('msg.noDocument')}</p>

  return (
    <div className="stack">
      <Field label={t('opt.text')}>
        <TextInput value={text} onChange={setText} />
      </Field>
      <div className="row wrap" style={{ gap: 6 }}>
        {STAMP_PRESETS.map((preset) => (
          <Button key={preset} size="sm" onClick={() => setText(preset)}>
            {preset}
          </Button>
        ))}
      </div>
      <Field label={t('opt.color')}>
        <ColorInput value={color} onChange={setColor} />
      </Field>
      <AnchorPicker value={anchor} onChange={setAnchor} />
      <RangeField value={range} onChange={setRange} />

      <Button
        variant="primary"
        onClick={() =>
          void run(t('msg.working'), async () => {
            const indices = resolveRange(range, doc.pageCount)
            const next = await ops.addWatermark(
              doc.bytes,
              {
                text,
                fontSize: 54,
                color,
                opacity: 0.35,
                rotation: 22,
                anchor,
                margin: 48,
                scale: 100,
                tile: false,
                bold: true,
                indices
              },
              doc.password
            )
            await applied(next, 'tool.stamp')
            onClose()
          })
        }
      >
        {t('action.apply')}
      </Button>
    </div>
  )
}

/* --------------------------------------------------------- extract images */

export function ExtractImagesPanel({ onClose }: ToolPanelProps): React.JSX.Element {
  const t = useApp((state) => state.t)
  const doc = useApp((state) => state.doc)
  const notify = useApp((state) => state.notify)
  const run = useRunner()

  if (!doc) return <p className="muted">{t('msg.noDocument')}</p>

  return (
    <div className="stack">
      <p className="muted">{t('tool.extractImages.d')}</p>
      <Button
        variant="primary"
        onClick={() =>
          void run(t('msg.working'), async () => {
            const images = await extractImages(doc.proxy)
            if (images.length === 0) {
              notify({ kind: 'info', title: t('msg.noImages') })
              return
            }
            const outcome = await saveBatch(images.map(({ name, bytes }) => ({ name, bytes })))
            const summary = describeBatch(outcome, t)
            if (summary === undefined) return
            if (outcome.saved) onClose()
            return summary
          })
        }
      >
        <FileDown size={15} />
        {t('action.export')}
      </Button>
    </div>
  )
}

/* ---------------------------------------------------------------- forms */

export function FormsPanel({ onClose }: ToolPanelProps): React.JSX.Element {
  const t = useApp((state) => state.t)
  const applied = useApplied()
  const doc = useApp((state) => state.doc)
  const notify = useApp((state) => state.notify)
  const reportError = useApp((state) => state.reportError)
  const run = useRunner()
  const [fields, setFields] = useState<ops.FormField[] | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [flatten, setFlatten] = useState(false)

  useEffect(() => {
    if (!doc) return
    ops
      .readFormFields(doc.bytes, doc.password)
      .then((list) => {
        setFields(list)
        setValues(Object.fromEntries(list.map((field) => [field.name, field.value])))
      })
      .catch((error) => reportError(error))
  }, [doc, reportError])

  if (!doc) return <p className="muted">{t('msg.noDocument')}</p>
  if (!fields) return <p className="muted">{t('msg.loading')}</p>
  if (fields.length === 0) {
    return <Empty icon={<FileText size={22} />} title={t('tool.forms')} subtitle={t('tool.forms.d')} />
  }

  return (
    <div className="stack">
      {fields.map((field) => (
        <Field key={field.name} label={field.name} hint={field.type}>
          {field.type === 'checkbox' ? (
            <Checkbox
              checked={values[field.name] === 'true'}
              onChange={(checked) => setValues({ ...values, [field.name]: String(checked) })}
              label={field.name}
            />
          ) : field.options && field.options.length > 0 ? (
            <Select
              value={values[field.name] ?? ''}
              onChange={(value) => setValues({ ...values, [field.name]: value })}
              options={field.options.map((option) => ({ value: option, label: option }))}
            />
          ) : (
            <TextInput
              value={values[field.name] ?? ''}
              onChange={(value) => setValues({ ...values, [field.name]: value })}
            />
          )}
        </Field>
      ))}

      <Checkbox checked={flatten} onChange={setFlatten} label={t('annotate.flatten')} />
      <Button
        variant="primary"
        onClick={() =>
          void run(t('msg.working'), async () => {
            const result = await ops.fillFormFields(doc.bytes, values, flatten, doc.password)
            await applied(result.bytes, 'tool.forms')

            // Asking for the fields to be locked and getting them back live is
            // the kind of thing a person ships without noticing.
            if (flatten && !result.flattened) {
              throw new Error('flatten-failed')
            }
            if (result.skipped.length > 0) {
              notify({
                kind: 'info',
                title: t('msg.fieldsSkipped', { n: result.skipped.length }),
                message: result.skipped
                  .map((entry) => entry.name)
                  .filter(Boolean)
                  .join('، ')
              })
            }
            onClose()
          })
        }
      >
        {t('action.apply')}
      </Button>
    </div>
  )
}

/* --------------------------------------------------------------- compare */

export function ComparePanel(_: ToolPanelProps): React.JSX.Element {
  const t = useApp((state) => state.t)
  const doc = useApp((state) => state.doc)
  const notify = useApp((state) => state.notify)
  const run = useRunner()
  const [mode, setMode] = useState<'text' | 'visual'>('text')
  const [left, setLeft] = useState<{ name: string; bytes: Uint8Array } | null>(
    doc ? { name: doc.name, bytes: doc.bytes } : null
  )
  const [right, setRight] = useState<{ name: string; bytes: Uint8Array } | null>(null)
  const [result, setResult] = useState<ReturnType<typeof diffLines> | null>(null)
  const [visual, setVisual] = useState<import('../../lib/pdf/visualdiff').VisualDiffResult | null>(null)
  const [shown, setShown] = useState(0)

  const pick = async (setter: typeof setLeft): Promise<void> => {
    const picked = await pickOneFile(mode === 'visual' ? FILTERS.pdf : FILTERS.documents)
    if (picked) setter({ name: picked.name, bytes: picked.data })
  }

  const isPdf = (file: { name: string; bytes: Uint8Array } | null): boolean =>
    Boolean(file && (/\.pdf$/i.test(file.name) || (file.bytes[0] === 0x25 && file.bytes[1] === 0x50)))

  return (
    <div className="stack">
      <Field label={t('compare.mode')} hint={mode === 'visual' ? t('compare.visual.d') : undefined}>
        <Segmented
          value={mode}
          onChange={(value) => {
            setMode(value)
            setResult(null)
            setVisual(null)
          }}
          options={[
            { value: 'text', label: t('compare.text') },
            { value: 'visual', label: t('compare.visual') }
          ]}
        />
      </Field>

      <div className="row">
        <Button block onClick={() => void pick(setLeft)}>
          {left ? left.name : `${t('action.browse')} A`}
        </Button>
        <Button block onClick={() => void pick(setRight)}>
          {right ? right.name : `${t('action.browse')} B`}
        </Button>
      </div>

      <Button
        variant="primary"
        disabled={!left || !right || (mode === 'visual' && (!isPdf(left) || !isPdf(right)))}
        onClick={() =>
          void run(
            t('msg.working'),
            async (report, signal) => {
              if (mode === 'visual') {
                const { visualDiff } = await import('../../lib/pdf/visualdiff')
                const outcome = await visualDiff(left!.bytes, right!.bytes, {
                  withImages: true,
                  onProgress: report,
                  signal,
                  passwordA: doc && left!.bytes === doc.bytes ? doc.password : undefined
                })
                setVisual(outcome)
                setShown(Math.max(0, outcome.pages.findIndex((page) => page.changed > 0.0005)))
                if (outcome.changedPages === 0) notify({ kind: 'info', title: t('compare.noVisual') })
                return
              }
              const [a, b] = await Promise.all([
                documentTextLines(left!.name, left!.bytes),
                documentTextLines(right!.name, right!.bytes)
              ])
              const diff = diffLines(a, b)
              setResult(diff)
              if (!diff.some((line) => line.kind !== 'same')) {
                notify({ kind: 'info', title: t('msg.identical') })
              }
            },
            { cancellable: mode === 'visual' }
          )
        }
      >
        {t('action.run')}
      </Button>

      {result ? (
        <Card pad={false} style={{ maxHeight: 340, overflowY: 'auto', padding: 10 }}>
          {result.map((line, index) => (
            <div
              key={index}
              className={`diff-line${line.kind === 'added' ? ' add' : line.kind === 'removed' ? ' del' : ''}`}
            >
              {line.kind === 'added' ? '+ ' : line.kind === 'removed' ? '- ' : '  '}
              {line.text}
            </div>
          ))}
        </Card>
      ) : null}

      {visual ? (
        <div className="stack tight">
          <div className="row between">
            <span className="badge accent">
              {t('compare.changedPages', { n: visual.changedPages, total: visual.pages.length })}
            </span>
            <div className="row" style={{ gap: 6 }}>
              <Button size="sm" disabled={shown <= 0} onClick={() => setShown(shown - 1)}>‹</Button>
              <span className="muted">
                {t('compare.pageChanged', {
                  n: visual.pages[shown]?.page ?? 0,
                  percent: Math.round((visual.pages[shown]?.changed ?? 0) * 1000) / 10
                })}
              </span>
              <Button size="sm" disabled={shown >= visual.pages.length - 1} onClick={() => setShown(shown + 1)}>›</Button>
            </div>
          </div>
          {visual.pages[shown]?.image ? (
            <Card pad={false} style={{ maxHeight: 420, overflow: 'auto' }}>
              <img src={visual.pages[shown].image} alt="" style={{ display: 'block', width: '100%' }} />
            </Card>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/* -------------------------------------------------------------------- qr */

export function QrPanel({ onClose }: ToolPanelProps): React.JSX.Element {
  const t = useApp((state) => state.t)
  const applied = useApplied()
  const doc = useApp((state) => state.doc)
  const run = useRunner()
  const [text, setText] = useState('')
  const [sizeMm, setSizeMm] = useState(30)
  const [anchor, setAnchor] = useState<ops.Anchor>('bottomRight')
  const [margin, setMargin] = useState(10)
  const [range, setRange] = useState('')
  const [preview, setPreview] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!text.trim()) {
      setPreview(null)
      return undefined
    }
    void import('../../lib/qr').then(({ qrDataUrl }) => qrDataUrl(text.trim(), 160)).then((url) => {
      if (!cancelled) setPreview(url)
    })
    return () => {
      cancelled = true
    }
  }, [text])

  if (!doc) return <p className="muted">{t('msg.noDocument')}</p>

  return (
    <div className="stack">
      <Field label={t('qr.content')}>
        <TextInput value={text} onChange={setText} placeholder="https://" />
      </Field>
      {preview ? (
        <div className="row" style={{ justifyContent: 'center' }}>
          <img src={preview} alt="" width={120} height={120} style={{ borderRadius: 8, border: '1px solid var(--hairline)' }} />
        </div>
      ) : null}
      <Field label={t('qr.size')}>
        <Slider value={sizeMm} onChange={setSizeMm} min={10} max={80} suffix=" mm" />
      </Field>
      <Field label={t('opt.position')}>
        <AnchorPicker value={anchor} onChange={setAnchor} />
      </Field>
      <Field label={t('opt.margin')}>
        <Slider value={margin} onChange={setMargin} min={0} max={40} suffix=" mm" />
      </Field>
      <RangeField value={range} onChange={setRange} />
      <Button
        variant="primary"
        disabled={!text.trim()}
        onClick={() =>
          void run(t('msg.working'), async () => {
            const next = await ops.stampQr(
              doc.bytes,
              {
                text: text.trim(),
                sizePt: sizeMm * MM_TO_PT,
                anchor,
                margin: margin * MM_TO_PT,
                indices: resolveRange(range, doc.pageCount)
              },
              doc.password
            )
            await applied(next, 'tool.qr')
            onClose()
          })
        }
      >
        {t('action.apply')}
      </Button>
    </div>
  )
}

/* --------------------------------------------------------------- inspect */

export function InspectPanel(_: ToolPanelProps): React.JSX.Element {
  const t = useApp((state) => state.t)
  const doc = useApp((state) => state.doc)
  const notify = useApp((state) => state.notify)
  const [report, setReport] = useState<import('../../lib/pdf/inspect').DocumentReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!doc) return
    let cancelled = false
    void import('../../lib/pdf/inspect')
      .then(({ inspectDocument }) => inspectDocument(doc.bytes, doc.password))
      .then((next) => {
        if (!cancelled) setReport(next)
      })
      .catch((failure: Error) => {
        if (!cancelled) setError(String(failure.message ?? failure))
      })
    return () => {
      cancelled = true
    }
  }, [doc])

  if (!doc) return <p className="muted">{t('msg.noDocument')}</p>
  if (error) return <p className="muted">{error}</p>
  if (!report) return <p className="muted">{t('msg.loading')}</p>

  const rows: [string, string][] = [
    [t('inspect.version'), `PDF ${report.version}`],
    [t('inspect.size'), formatBytes(report.bytes)],
    [t('inspect.pages'), String(report.pages)],
    [
      t('inspect.pageSizes'),
      report.pageSizes
        .map((size) => `${size.label ?? ''} ${size.widthMm} × ${size.heightMm} مم${size.count > 1 ? ` ×${size.count}` : ''}`.trim())
        .join(' · ')
    ],
    [t('inspect.images'), String(report.images)],
    [t('inspect.forms'), String(report.formFields)],
    [t('inspect.bookmarks'), String(report.bookmarks)],
    [t('inspect.attachments'), String(report.attachments)],
    [t('inspect.encrypted'), report.encrypted ? t('inspect.yes') : t('inspect.no')]
  ]
  if (report.title) rows.push([t('inspect.title'), report.title])
  if (report.author) rows.push([t('inspect.author'), report.author])
  if (report.producer) rows.push([t('inspect.producer'), report.producer])

  const text = [
    ...rows.map(([label, value]) => `${label}: ${value}`),
    `${t('inspect.fonts')}: ${report.fonts.map((font) => `${font.name} (${font.type}, ${font.embedded ? t('inspect.embedded') : t('inspect.notEmbedded')})`).join('; ') || t('inspect.noFonts')}`
  ].join('\n')

  return (
    <div className="stack">
      {report.scanned ? <span className="badge accent">{t('inspect.scanned')}</span> : null}
      <Card pad={false}>
        {rows.map(([label, value]) => (
          <div className="list-row" key={label}>
            <span className="grow muted">{label}</span>
            <bdi>{value}</bdi>
          </div>
        ))}
      </Card>
      <h4 style={{ margin: 0 }}>{t('inspect.fonts')}</h4>
      <Card pad={false}>
        {report.fonts.length === 0 ? (
          <div className="list-row muted">{t('inspect.noFonts')}</div>
        ) : (
          report.fonts.map((font) => (
            <div className="list-row" key={`${font.name}:${font.type}`}>
              <span className="grow mono" dir="ltr">{font.name}</span>
              <span className="muted">{font.type}</span>
              <span className={`badge ${font.embedded ? 'green' : 'red'}`}>
                {font.embedded ? t('inspect.embedded') : t('inspect.notEmbedded')}
              </span>
            </div>
          ))
        )}
      </Card>
      <Button
        onClick={() => {
          void navigator.clipboard.writeText(text).then(() => notify({ kind: 'success', title: t('inspect.copied') }))
        }}
      >
        {t('inspect.copy')}
      </Button>
    </div>
  )
}

/* -------------------------------------------------------------- bookmarks */

export function BookmarksPanel({ onClose }: ToolPanelProps): React.JSX.Element {
  const t = useApp((state) => state.t)
  const doc = useApp((state) => state.doc)
  const setCurrentPage = useApp((state) => state.setCurrentPage)
  const navigate = useApp((state) => state.navigate)
  const [outline, setOutline] = useState<OutlineNode[] | null>(null)

  useEffect(() => {
    if (!doc) return
    readOutline(doc.proxy)
      .then(setOutline)
      .catch(() => setOutline([]))
  }, [doc])

  if (!doc) return <p className="muted">{t('msg.noDocument')}</p>
  if (!outline) return <p className="muted">{t('msg.loading')}</p>
  if (outline.length === 0) {
    return <Empty icon={<FileText size={22} />} title={t('viewer.noOutline')} />
  }

  const renderNodes = (nodes: OutlineNode[], depth = 0): React.JSX.Element[] =>
    nodes.flatMap((node) => [
      <button
        key={`${node.title}-${depth}-${node.pageNumber}`}
        className="list-row"
        style={{ width: '100%', paddingInlineStart: 14 + depth * 18, textAlign: 'start' }}
        onClick={() => {
          if (node.pageNumber) {
            setCurrentPage(node.pageNumber)
            navigate('viewer')
            onClose()
          }
        }}
      >
        <span className="grow truncate">{node.title}</span>
        {node.pageNumber ? <span className="badge">{node.pageNumber}</span> : null}
      </button>,
      ...renderNodes(node.children, depth + 1)
    ])

  return <Card pad={false}>{renderNodes(outline)}</Card>
}

/* ------------------------------------------------------------ attachments */

export function AttachmentsPanel({ onClose }: ToolPanelProps): React.JSX.Element {
  const t = useApp((state) => state.t)
  const doc = useApp((state) => state.doc)
  const run = useRunner()
  const [files, setFiles] = useState<{ name: string; bytes: Uint8Array; size: number }[]>([])

  if (!doc) return <p className="muted">{t('msg.noDocument')}</p>

  return (
    <div className="stack">
      <Button
        onClick={async () => {
          const picked = await pickFiles(FILTERS.any, true)
          setFiles((current) => [
            ...current,
            ...picked.map((file) => ({ name: file.name, bytes: file.data, size: file.size }))
          ])
        }}
      >
        <Paperclip size={15} />
        {t('action.add')}
      </Button>

      {files.length > 0 ? (
        <Card pad={false}>
          {files.map((file, index) => (
            <div className="list-row" key={`${file.name}-${index}`}>
              <div className="grow">
                <div className="title">{file.name}</div>
                <div className="sub"><Bytes value={file.size} /></div>
              </div>
            </div>
          ))}
        </Card>
      ) : null}

      <Button
        variant="primary"
        disabled={files.length === 0}
        onClick={() =>
          void run(t('msg.working'), async () => {
            const next = await ops.attachFiles(
              doc.bytes,
              files.map(({ name, bytes }) => ({ name, bytes })),
              doc.password
            )
            const outcome = await saveBytes(
              next,
              `${stripExtension(doc.name)}-with-attachments.pdf`,
              FILTERS.pdf
            )
            if (!outcome.saved) return
            onClose()
            return outcome.path
          })
        }
      >
        {t('action.apply')}
      </Button>
    </div>
  )
}
