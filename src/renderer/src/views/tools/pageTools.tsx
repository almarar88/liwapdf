import { useState } from 'react'
import { ArrowDown, ArrowUp, FileText, Plus, Trash2 } from 'lucide-react'
import { useApp } from '../../store/app'
import {
  Button,
  Bytes,
  Card,
  Checkbox,
  Field,
  Segmented,
  Select,
  Slider,
  TextInput
} from '../../components/ui'
import { FILTERS, pickFiles, saveBatch, saveBytes } from '../../lib/files'
import { formatBytes, PAGE_PRESETS, stripExtension, MM_TO_PT } from '../../lib/format'
import * as ops from '../../lib/pdf/ops'
import { RangeField, resolveRange, useRunner, type ToolPanelProps } from './shared'

/* ------------------------------------------------------------------ merge */

export function MergePanel({ onClose }: ToolPanelProps): React.JSX.Element {
  const t = useApp((state) => state.t)
  const doc = useApp((state) => state.doc)
  const openPdfBytes = useApp((state) => state.openPdfBytes)
  const navigate = useApp((state) => state.navigate)
  const run = useRunner()

  const [files, setFiles] = useState<{ name: string; bytes: Uint8Array; size: number }[]>(
    doc ? [{ name: doc.name, bytes: doc.bytes, size: doc.bytes.byteLength }] : []
  )

  const move = (index: number, delta: number): void => {
    const next = [...files]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    setFiles(next)
  }

  return (
    <div className="stack">
      <Button
        onClick={async () => {
          const picked = await pickFiles(FILTERS.pdf, true)
          setFiles((current) => [
            ...current,
            ...picked.map((file) => ({ name: file.name, bytes: file.data, size: file.size }))
          ])
        }}
      >
        <Plus size={15} />
        {t('action.add')}
      </Button>

      <Card pad={false}>
        {files.length === 0 ? (
          <div className="list-row muted">{t('msg.selectFiles')}</div>
        ) : (
          files.map((file, index) => (
            <div className="list-row" key={`${file.name}-${index}`}>
              <FileText size={16} className="muted" />
              <div className="grow">
                <div className="title">{file.name}</div>
                <div className="sub"><Bytes value={file.size} /></div>
              </div>
              <Button size="sm" variant="ghost" icon onClick={() => move(index, -1)}>
                <ArrowUp size={14} />
              </Button>
              <Button size="sm" variant="ghost" icon onClick={() => move(index, 1)}>
                <ArrowDown size={14} />
              </Button>
              <Button
                size="sm"
                variant="danger"
                ghostDanger
                icon
                onClick={() => setFiles(files.filter((_, position) => position !== index))}
              >
                <Trash2 size={14} />
              </Button>
            </div>
          ))
        )}
      </Card>

      <Button
        variant="primary"
        disabled={files.length < 2}
        onClick={() =>
          void run(t('msg.working'), async () => {
            const merged = await ops.mergeDocuments(files)
            const name = `${stripExtension(files[0].name)}-merged.pdf`
            const outcome = await saveBytes(merged, name, FILTERS.pdf)
            if (!outcome.saved) return
            await openPdfBytes(name, merged, outcome.path ?? null)
            navigate('viewer')
            onClose()
            return outcome.path
          })
        }
      >
        {t('tool.merge')}
      </Button>
    </div>
  )
}

/* ------------------------------------------------------------------ split */

export function SplitPanel({ onClose }: ToolPanelProps): React.JSX.Element {
  const t = useApp((state) => state.t)
  const doc = useApp((state) => state.doc)
  const run = useRunner()
  const [mode, setMode] = useState<ops.SplitMode>('count')
  const [every, setEvery] = useState(1)
  const [ranges, setRanges] = useState('1-3, 4-6')

  if (!doc) return <p className="muted">{t('msg.noDocument')}</p>

  return (
    <div className="stack">
      <Field label={t('opt.mode')}>
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'count', label: t('opt.byCount') },
            { value: 'ranges', label: t('opt.byRanges') },
            { value: 'each', label: t('opt.byEach') }
          ]}
        />
      </Field>

      {mode === 'count' ? (
        <Field label={t('opt.everyN', { n: every })}>
          <Slider value={every} onChange={setEvery} min={1} max={Math.max(1, doc.pageCount - 1)} />
        </Field>
      ) : null}

      {mode === 'ranges' ? (
        <Field label={t('opt.range')} hint={t('opt.rangeHint')}>
          <TextInput value={ranges} onChange={setRanges} placeholder="1-3, 4-6" />
        </Field>
      ) : null}

      <Button
        variant="primary"
        onClick={() =>
          void run(t('msg.working'), async () => {
            const groups =
              mode === 'ranges'
                ? ranges
                    .split(/[,;]/)
                    .map((chunk) => chunk.trim())
                    .filter(Boolean)
                    .map((chunk) => resolveRange(chunk, doc.pageCount))
                : []
            const parts = await ops.splitDocument(
              doc.bytes,
              doc.name,
              mode,
              { ranges: groups, every },
              doc.password
            )
            const outcome = await saveBatch(parts)
            if (!outcome.saved) return
            onClose()
            return t('msg.filesCreated', { n: outcome.count })
          })
        }
      >
        {t('tool.split')}
      </Button>
    </div>
  )
}

export function SplitBySizePanel({ onClose }: ToolPanelProps): React.JSX.Element {
  const t = useApp((state) => state.t)
  const doc = useApp((state) => state.doc)
  const run = useRunner()
  const [maxMb, setMaxMb] = useState(5)

  if (!doc) return <p className="muted">{t('msg.noDocument')}</p>

  return (
    <div className="stack">
      <Field label={t('opt.maxSize')}>
        <Slider value={maxMb} onChange={setMaxMb} min={1} max={50} suffix=" MB" />
      </Field>
      <Button
        variant="primary"
        onClick={() =>
          void run(t('msg.working'), async () => {
            const parts = await ops.splitBySize(
              doc.bytes,
              doc.name,
              maxMb * 1024 * 1024,
              doc.password
            )
            const outcome = await saveBatch(parts)
            if (!outcome.saved) return
            onClose()
            return t('msg.filesCreated', { n: outcome.count })
          })
        }
      >
        {t('action.run')}
      </Button>
    </div>
  )
}

/* --------------------------------------------------------- extract/delete */

export function ExtractPanel({ onClose }: ToolPanelProps): React.JSX.Element {
  const t = useApp((state) => state.t)
  const doc = useApp((state) => state.doc)
  const selected = useApp((state) => state.selectedPages)
  const run = useRunner()
  const [range, setRange] = useState(
    selected.length > 0 ? selected.map((index) => index + 1).join(', ') : ''
  )

  if (!doc) return <p className="muted">{t('msg.noDocument')}</p>

  return (
    <div className="stack">
      <RangeField value={range} onChange={setRange} />
      <Button
        variant="primary"
        onClick={() =>
          void run(t('msg.working'), async () => {
            const indices = resolveRange(range, doc.pageCount)
            const extracted = await ops.extractPages(doc.bytes, indices, doc.password)
            const outcome = await saveBytes(
              extracted,
              `${stripExtension(doc.name)}-extract.pdf`,
              FILTERS.pdf
            )
            if (!outcome.saved) return
            onClose()
            return outcome.path
          })
        }
      >
        {t('organize.extract')}
      </Button>
    </div>
  )
}

export function DeletePagesPanel({ onClose }: ToolPanelProps): React.JSX.Element {
  const t = useApp((state) => state.t)
  const doc = useApp((state) => state.doc)
  const selected = useApp((state) => state.selectedPages)
  const applyPdfBytes = useApp((state) => state.applyPdfBytes)
  const notify = useApp((state) => state.notify)
  const run = useRunner()
  const [range, setRange] = useState(
    selected.length > 0 ? selected.map((index) => index + 1).join(', ') : ''
  )

  if (!doc) return <p className="muted">{t('msg.noDocument')}</p>

  return (
    <div className="stack">
      <RangeField value={range} onChange={setRange} />
      <Button
        variant="danger"
        onClick={() =>
          void run(t('msg.working'), async () => {
            const indices = resolveRange(range, doc.pageCount)
            const next = await ops.deletePages(doc.bytes, indices, doc.password)
            await applyPdfBytes(next)
            notify({ kind: 'success', title: t('msg.pagesRemoved', { n: indices.length }) })
            onClose()
          })
        }
      >
        {t('organize.delete')}
      </Button>
    </div>
  )
}

/* ----------------------------------------------------------------- rotate */

export function RotatePanel({ onClose }: ToolPanelProps): React.JSX.Element {
  const t = useApp((state) => state.t)
  const doc = useApp((state) => state.doc)
  const applyPdfBytes = useApp((state) => state.applyPdfBytes)
  const run = useRunner()
  const [range, setRange] = useState('')
  const [angle, setAngle] = useState<'90' | '180' | '270'>('90')

  if (!doc) return <p className="muted">{t('msg.noDocument')}</p>

  return (
    <div className="stack">
      <RangeField value={range} onChange={setRange} />
      <Field label={t('opt.rotation')}>
        <Segmented
          value={angle}
          onChange={setAngle}
          options={[
            { value: '90', label: `90°` },
            { value: '180', label: `180°` },
            { value: '270', label: `270°` }
          ]}
        />
      </Field>
      <Button
        variant="primary"
        onClick={() =>
          void run(t('msg.working'), async () => {
            const indices = resolveRange(range, doc.pageCount)
            const next = await ops.rotatePages(doc.bytes, indices, Number(angle), doc.password)
            await applyPdfBytes(next)
            onClose()
          })
        }
      >
        {t('action.apply')}
      </Button>
    </div>
  )
}

/* -------------------------------------------------------------- n-up/size */

export function NUpPanel({ onClose }: ToolPanelProps): React.JSX.Element {
  const t = useApp((state) => state.t)
  const doc = useApp((state) => state.doc)
  const applyPdfBytes = useApp((state) => state.applyPdfBytes)
  const run = useRunner()
  const [perSheet, setPerSheet] = useState<'2' | '4' | '6' | '9'>('2')
  const [size, setSize] = useState<'A4' | 'A3' | 'Letter'>('A4')
  const [landscape, setLandscape] = useState(true)

  if (!doc) return <p className="muted">{t('msg.noDocument')}</p>

  return (
    <div className="stack">
      <Field label={t('opt.perSheet')}>
        <Segmented
          value={perSheet}
          onChange={setPerSheet}
          options={[
            { value: '2', label: '2' },
            { value: '4', label: '4' },
            { value: '6', label: '6' },
            { value: '9', label: '9' }
          ]}
        />
      </Field>
      <Field label={t('convert.pageSize')}>
        <Select
          value={size}
          onChange={setSize}
          options={[
            { value: 'A4', label: 'A4' },
            { value: 'A3', label: 'A3' },
            { value: 'Letter', label: 'Letter' }
          ]}
        />
      </Field>
      <Checkbox checked={landscape} onChange={setLandscape} label={t('convert.landscape')} />
      <Button
        variant="primary"
        onClick={() =>
          void run(t('msg.working'), async () => {
            const preset = PAGE_PRESETS[size]
            const sheet: [number, number] = landscape ? [preset[1], preset[0]] : [preset[0], preset[1]]
            const next = await ops.nUpPages(
              doc.bytes,
              Number(perSheet) as 2 | 4 | 6 | 9,
              sheet,
              doc.password
            )
            await applyPdfBytes(next)
            onClose()
          })
        }
      >
        {t('action.apply')}
      </Button>
    </div>
  )
}

export function ResizePanel({ onClose }: ToolPanelProps): React.JSX.Element {
  const t = useApp((state) => state.t)
  const doc = useApp((state) => state.doc)
  const applyPdfBytes = useApp((state) => state.applyPdfBytes)
  const run = useRunner()
  const [preset, setPreset] = useState<'A4' | 'A3' | 'A5' | 'Letter' | 'Legal' | 'custom'>('A4')
  const [width, setWidth] = useState(210)
  const [height, setHeight] = useState(297)
  const [landscape, setLandscape] = useState(false)

  if (!doc) return <p className="muted">{t('msg.noDocument')}</p>

  return (
    <div className="stack">
      <Field label={t('convert.pageSize')}>
        <Select
          value={preset}
          onChange={setPreset}
          options={[
            { value: 'A4', label: 'A4' },
            { value: 'A3', label: 'A3' },
            { value: 'A5', label: 'A5' },
            { value: 'Letter', label: 'Letter' },
            { value: 'Legal', label: 'Legal' },
            { value: 'custom', label: `${t('opt.customWidth')} / ${t('opt.customHeight')}` }
          ]}
        />
      </Field>

      {preset === 'custom' ? (
        <div className="row">
          <Field label={t('opt.customWidth')}>
            <TextInput type="number" value={width} onChange={(value) => setWidth(Number(value))} />
          </Field>
          <Field label={t('opt.customHeight')}>
            <TextInput type="number" value={height} onChange={(value) => setHeight(Number(value))} />
          </Field>
        </div>
      ) : (
        <Checkbox checked={landscape} onChange={setLandscape} label={t('convert.landscape')} />
      )}

      <Button
        variant="primary"
        onClick={() =>
          void run(t('msg.working'), async () => {
            let target: [number, number]
            if (preset === 'custom') {
              target = [width * MM_TO_PT, height * MM_TO_PT]
            } else {
              const dimensions = PAGE_PRESETS[preset]
              target = landscape ? [dimensions[1], dimensions[0]] : [dimensions[0], dimensions[1]]
            }
            const next = await ops.resizePages(doc.bytes, target, doc.password)
            await applyPdfBytes(next)
            onClose()
          })
        }
      >
        {t('action.apply')}
      </Button>
    </div>
  )
}

export function CropPanel({ onClose }: ToolPanelProps): React.JSX.Element {
  const t = useApp((state) => state.t)
  const doc = useApp((state) => state.doc)
  const applyPdfBytes = useApp((state) => state.applyPdfBytes)
  const run = useRunner()
  const [range, setRange] = useState('')
  const [top, setTop] = useState(5)
  const [bottom, setBottom] = useState(5)
  const [start, setStart] = useState(5)
  const [end, setEnd] = useState(5)

  if (!doc) return <p className="muted">{t('msg.noDocument')}</p>

  return (
    <div className="stack">
      <RangeField value={range} onChange={setRange} />
      <Field label={t('opt.cropTop')}>
        <Slider value={top} onChange={setTop} min={0} max={45} suffix="%" />
      </Field>
      <Field label={t('opt.cropBottom')}>
        <Slider value={bottom} onChange={setBottom} min={0} max={45} suffix="%" />
      </Field>
      <Field label={t('opt.cropStart')}>
        <Slider value={start} onChange={setStart} min={0} max={45} suffix="%" />
      </Field>
      <Field label={t('opt.cropEnd')}>
        <Slider value={end} onChange={setEnd} min={0} max={45} suffix="%" />
      </Field>
      <Button
        variant="primary"
        onClick={() =>
          void run(t('msg.working'), async () => {
            const indices = resolveRange(range, doc.pageCount)
            const next = await ops.cropPages(
              doc.bytes,
              { top, bottom, start, end },
              indices,
              doc.password
            )
            await applyPdfBytes(next)
            onClose()
          })
        }
      >
        {t('action.apply')}
      </Button>
    </div>
  )
}
