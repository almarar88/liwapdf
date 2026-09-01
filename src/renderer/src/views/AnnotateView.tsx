import { useRef, useState } from 'react'
import {
  MousePointer2,
  Type,
  Highlighter,
  PenTool,
  Minus as LineIcon,
  Square,
  Circle,
  Image as ImageIcon,
  Signature,
  EyeOff,
  Trash2,
  Check,
  FileText
} from 'lucide-react'
import { useApp } from '../store/app'
import { SignaturePad } from '../components/SignaturePad'
import { useDocumentActions } from '../hooks/useDocumentActions'
import {
  Button,
  Card,
  ColorInput,
  Empty,
  Field,
  Modal,
  Slider,
  TextArea,
  Checkbox
} from '../components/ui'
import { PdfPageView } from '../components/PdfPageView'
import { Thumbnail } from '../components/Thumbnail'
import {
  createAnnotation,
  flattenAnnotations,
  type Annotation,
  type AnnotationKind
} from '../lib/pdf/annotations'
import { FILTERS, pickOneFile } from '../lib/files'
import { clamp } from '../lib/format'

type Tool = 'select' | AnnotationKind | 'signature'

const TOOLS: { id: Tool; icon: React.JSX.Element; labelKey: Parameters<ReturnType<typeof useApp.getState>['t']>[0] }[] = [
  { id: 'select', icon: <MousePointer2 size={15} />, labelKey: 'annotate.tool.select' },
  { id: 'text', icon: <Type size={15} />, labelKey: 'annotate.tool.text' },
  { id: 'highlight', icon: <Highlighter size={15} />, labelKey: 'annotate.tool.highlight' },
  { id: 'draw', icon: <PenTool size={15} />, labelKey: 'annotate.tool.draw' },
  { id: 'line', icon: <LineIcon size={15} />, labelKey: 'annotate.tool.line' },
  { id: 'rect', icon: <Square size={15} />, labelKey: 'annotate.tool.rect' },
  { id: 'ellipse', icon: <Circle size={15} />, labelKey: 'annotate.tool.ellipse' },
  { id: 'image', icon: <ImageIcon size={15} />, labelKey: 'annotate.tool.image' },
  { id: 'signature', icon: <Signature size={15} />, labelKey: 'annotate.tool.signature' },
  { id: 'redact', icon: <EyeOff size={15} />, labelKey: 'annotate.tool.redact' }
]

export function AnnotateView(): React.JSX.Element {
  const t = useApp((state) => state.t)
  const doc = useApp((state) => state.doc)
  const currentPage = useApp((state) => state.currentPage)
  const setCurrentPage = useApp((state) => state.setCurrentPage)
  const applyPdfBytes = useApp((state) => state.applyPdfBytes)
  const setBusy = useApp((state) => state.setBusy)
  const reportError = useApp((state) => state.reportError)
  const notify = useApp((state) => state.notify)
  const { openDialog } = useDocumentActions()

  const [tool, setTool] = useState<Tool>('select')
  const [color, setColor] = useState('#e5484d')
  const [strokeWidth, setStrokeWidth] = useState(2)
  const [fontSize, setFontSize] = useState(16)
  const [opacity, setOpacity] = useState(100)
  const [filled, setFilled] = useState(false)
  // Annotations live in the store, so leaving this route no longer destroys
  // work the user has not flattened yet.
  const annotations = useApp((state) => state.annotations)
  const setAnnotationsRaw = useApp((state) => state.setAnnotations)
  const selectedId = useApp((state) => state.selectedAnnotation)
  const setSelectedId = useApp((state) => state.setSelectedAnnotation)

  const setAnnotations = (
    update: Annotation[] | ((current: Annotation[]) => Annotation[])
  ): void => {
    setAnnotationsRaw(
      typeof update === 'function' ? (update as (c: Annotation[]) => Annotation[])(useApp.getState().annotations) : update
    )
  }
  const [signatureOpen, setSignatureOpen] = useState(false)
  const [pendingImage, setPendingImage] = useState<string | null>(null)

  const overlayRef = useRef<HTMLDivElement>(null)
  const dragState = useRef<{
    startX: number
    startY: number
    id: string
    mode: 'create' | 'move'
    originX: number
    originY: number
  } | null>(null)

  if (!doc) {
    return (
      <div className="view">
        <Empty
          icon={<FileText size={26} />}
          title={t('viewer.empty')}
          subtitle={t('viewer.emptySub')}
          action={
            <Button variant="primary" onClick={() => void openDialog()}>
              {t('action.open')}
            </Button>
          }
        />
      </div>
    )
  }

  const pageAnnotations = annotations.filter((item) => item.page === currentPage)
  const selected = annotations.find((item) => item.id === selectedId) ?? null

  const relativePoint = (event: React.PointerEvent): { x: number; y: number } => {
    const rect = overlayRef.current!.getBoundingClientRect()
    return {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1)
    }
  }

  const onPointerDown = (event: React.PointerEvent): void => {
    if (!overlayRef.current) return
    const point = relativePoint(event)

    if (tool === 'select') {
      setSelectedId(null)
      return
    }

    if (tool === 'image' || tool === 'signature') {
      if (!pendingImage) return
      const annotation = createAnnotation({
        page: currentPage,
        kind: 'image',
        x: point.x,
        y: point.y,
        width: 0.28,
        height: 0.1,
        imageDataUrl: pendingImage,
        opacity: opacity / 100
      })
      setAnnotations((current) => [...current, annotation])
      setSelectedId(annotation.id)
      setPendingImage(null)
      setTool('select')
      return
    }

    const kind = tool as AnnotationKind
    const annotation = createAnnotation({
      page: currentPage,
      kind,
      x: point.x,
      y: point.y,
      width: kind === 'text' ? 0.36 : 0.001,
      height: kind === 'text' ? 0.06 : 0.001,
      color,
      opacity: opacity / 100,
      strokeWidth,
      filled,
      fontSize,
      text: kind === 'text' ? t('annotate.textPlaceholder') : undefined,
      points: kind === 'draw' ? [[point.x, point.y]] : undefined
    })

    setAnnotations((current) => [...current, annotation])
    setSelectedId(annotation.id)

    if (kind !== 'text') {
      dragState.current = {
        startX: point.x,
        startY: point.y,
        id: annotation.id,
        mode: 'create',
        originX: point.x,
        originY: point.y
      }
      overlayRef.current.setPointerCapture(event.pointerId)
    } else {
      setTool('select')
    }
  }

  const onPointerMove = (event: React.PointerEvent): void => {
    const drag = dragState.current
    if (!drag) return
    const point = relativePoint(event)

    setAnnotations((current) =>
      current.map((item) => {
        if (item.id !== drag.id) return item
        if (drag.mode === 'move') {
          return {
            ...item,
            x: clamp(drag.originX + (point.x - drag.startX), 0, 1),
            y: clamp(drag.originY + (point.y - drag.startY), 0, 1)
          }
        }
        if (item.kind === 'draw') {
          return { ...item, points: [...(item.points ?? []), [point.x, point.y]] }
        }
        if (item.kind === 'line') {
          return {
            ...item,
            width: point.x - drag.startX,
            height: point.y - drag.startY
          }
        }
        return {
          ...item,
          x: Math.min(drag.startX, point.x),
          y: Math.min(drag.startY, point.y),
          width: Math.abs(point.x - drag.startX),
          height: Math.abs(point.y - drag.startY)
        }
      })
    )
  }

  const onPointerUp = (event: React.PointerEvent): void => {
    const drag = dragState.current
    dragState.current = null
    overlayRef.current?.releasePointerCapture(event.pointerId)
    if (!drag) return

    // Discard accidental zero-size shapes from a stray click.
    setAnnotations((current) =>
      current.filter(
        (item) =>
          item.id !== drag.id ||
          item.kind === 'draw' ||
          Math.abs(item.width) > 0.006 ||
          Math.abs(item.height) > 0.006
      )
    )
    if (drag.mode === 'create' && tool !== 'draw') setTool('select')
  }

  /**
   * Keyboard equivalents for every pointer gesture on the canvas.
   *
   * Drawing an annotation was mouse-only, which left the whole view — and the
   * properties panel that depends on a selection — unreachable from the
   * keyboard. Enter drops a default-sized shape of the armed tool at the page
   * centre and selects it; the arrows then move and resize it.
   */
  const onCanvasKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    if (event.target !== event.currentTarget) return
    if (tool === 'select' || tool === 'signature' || tool === 'image') return
    event.preventDefault()
    const kind = tool as AnnotationKind
    const annotation = createAnnotation({
      page: currentPage,
      kind,
      x: 0.32,
      y: 0.44,
      width: kind === 'text' ? 0.36 : 0.24,
      height: kind === 'text' ? 0.06 : 0.12,
      color,
      opacity: opacity / 100,
      strokeWidth,
      filled,
      fontSize,
      text: kind === 'text' ? t('annotate.textPlaceholder') : undefined,
      points:
        kind === 'draw'
          ? ([
              [0.32, 0.44],
              [0.56, 0.56]
            ] as [number, number][])
          : undefined
    })
    setAnnotations((current) => [...current, annotation])
    setSelectedId(annotation.id)
    setTool('select')
  }

  const onShapeKeyDown = (event: React.KeyboardEvent, annotation: Annotation): void => {
    const step = event.shiftKey ? 0.05 : 0.01

    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      setAnnotations((current) => current.filter((item) => item.id !== annotation.id))
      setSelectedId(null)
      overlayRef.current?.focus()
      return
    }
    if (event.key === 'Escape') {
      setSelectedId(null)
      overlayRef.current?.focus()
      return
    }

    const deltas: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step]
    }
    const delta = deltas[event.key]
    if (!delta) return
    event.preventDefault()
    setSelectedId(annotation.id)

    // Alt resizes, everything else moves.
    if (event.altKey) {
      setAnnotations((current) =>
        current.map((item) =>
          item.id === annotation.id
            ? {
                ...item,
                width: clamp(item.width + delta[0], 0.01, 1),
                height: clamp(item.height + delta[1], 0.01, 1)
              }
            : item
        )
      )
      return
    }
    setAnnotations((current) =>
      current.map((item) =>
        item.id === annotation.id
          ? {
              ...item,
              x: clamp(item.x + delta[0], 0, 1),
              y: clamp(item.y + delta[1], 0, 1)
            }
          : item
      )
    )
  }

  const updateSelected = (patch: Partial<Annotation>): void => {
    if (!selectedId) return
    setAnnotations((current) =>
      current.map((item) => (item.id === selectedId ? { ...item, ...patch } : item))
    )
  }

  const apply = async (): Promise<void> => {
    if (annotations.length === 0) return
    const redacting = annotations.some((item) => item.kind === 'redact')
    setBusy({ label: t(redacting ? 'msg.redacting' : 'msg.working'), progress: null })
    try {
      const result = await flattenAnnotations(
        doc.bytes,
        annotations,
        doc.password,
        redacting ? (fraction) => setBusy({ label: t('msg.redacting'), progress: fraction }) : undefined
      )
      await applyPdfBytes(result.bytes)
      setAnnotations([])
      setSelectedId(null)

      // Redaction makes a promise the user is entitled to see kept, so say
      // exactly what was destroyed — and admit it when a page had to be
      // flattened to an image to make the guarantee hold.
      const report = result.redaction
      if (report) {
        notify({
          kind: report.verified ? 'success' : 'info',
          title: t(report.verified ? 'msg.redacted' : 'redact.unverified'),
          message:
            t('msg.redactedDetail')
              .replace('{runs}', String(report.removedRuns))
              .replace('{annots}', String(report.removedAnnotations)) +
            (report.verified ? ` ${t('redact.reportVerified')}` : '') +
            (report.rasterizedPages.length > 0
              ? ' ' +
                t('msg.redactedFlattened').replace(
                  '{pages}',
                  report.rasterizedPages.map((index) => index + 1).join(', ')
                )
              : '')
        })
      }
    } catch (error) {
      reportError(error)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="view flush" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="toolbar">
        {TOOLS.map((entry) => (
          <Button
            key={entry.id}
            size="sm"
            variant={tool === entry.id ? 'primary' : 'ghost'}
            title={t(entry.labelKey)}
            onClick={async () => {
              if (entry.id === 'signature') {
                setSignatureOpen(true)
                return
              }
              if (entry.id === 'image') {
                const picked = await pickOneFile(FILTERS.images)
                if (!picked) return
                const blob = new Blob([picked.data.slice().buffer as ArrayBuffer])
                const reader = new FileReader()
                reader.onload = () => {
                  setPendingImage(String(reader.result))
                  setTool('image')
                }
                reader.readAsDataURL(blob)
                return
              }
              setTool(entry.id)
            }}
          >
            {entry.icon}
          </Button>
        ))}

        <span className="spacer" />
        <span className="muted" style={{ fontSize: 'var(--text-sm)' }}>
          {annotations.length} {t('annotate.layers')}
        </span>
        <Button
          size="sm"
          variant="ghost"
          disabled={annotations.length === 0}
          onClick={() => {
            setAnnotations([])
            setSelectedId(null)
          }}
        >
          {t('action.clear')}
        </Button>
        <Button size="sm" variant="primary" disabled={annotations.length === 0} onClick={() => void apply()}>
          <Check size={15} />
          {t('annotate.flatten')}
        </Button>
      </div>

      <div className="workspace with-panel">
        <aside className="rail">
          {Array.from({ length: doc.pageCount }, (_, index) => (
            <Thumbnail
              key={index}
              proxy={doc.proxy}
              pageNumber={index + 1}
              version={doc.version}
              active={currentPage === index + 1}
              onClick={() => setCurrentPage(index + 1)}
            />
          ))}
        </aside>

        <div className="canvas-area">
          <div className="page-stack">
            <PdfPageView
              proxy={doc.proxy}
              pageNumber={currentPage}
              scale={1.2}
              version={doc.version}
              overlay={
                <div
                  ref={overlayRef}
                  className="anno-layer"
                  style={{ cursor: tool === 'select' ? 'default' : 'crosshair', touchAction: 'none' }}
                  role="application"
                  aria-label={t('annotate.canvasLabel')}
                  tabIndex={0}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onKeyDown={onCanvasKeyDown}
                >
                  {pageAnnotations.map((annotation) => (
                    <AnnotationShape
                      key={annotation.id}
                      annotation={annotation}
                      selected={annotation.id === selectedId}
                      interactive={tool === 'select'}
                      label={t('annotate.shapeLabel', {
                        kind: t(`annotate.tool.${annotation.kind}` as never),
                        page: annotation.page
                      })}
                      onFocus={() => setSelectedId(annotation.id)}
                      onKeyDown={onShapeKeyDown}
                      onSelect={(event) => {
                        setSelectedId(annotation.id)
                        if (tool !== 'select' || !overlayRef.current) return
                        const point = relativePoint(event)
                        dragState.current = {
                          startX: point.x,
                          startY: point.y,
                          id: annotation.id,
                          mode: 'move',
                          originX: annotation.x,
                          originY: annotation.y
                        }
                        overlayRef.current.setPointerCapture(event.pointerId)
                      }}
                    />
                  ))}
                </div>
              }
            />
          </div>
        </div>

        <aside className="panel">
          <h4>{t('annotate.layers')}</h4>
          {selected ? (
            <div className="stack tight">
              {selected.kind === 'text' ? (
                <>
                  <Field label={t('opt.text')}>
                    <TextArea
                      value={selected.text ?? ''}
                      onChange={(value) => updateSelected({ text: value })}
                      rows={3}
                    />
                  </Field>
                  <Field label={t('annotate.fontSize')}>
                    <Slider
                      value={selected.fontSize ?? 16}
                      onChange={(value) => updateSelected({ fontSize: value })}
                      min={6}
                      max={72}
                    />
                  </Field>
                  <Checkbox
                    checked={Boolean(selected.bold)}
                    onChange={(checked) => updateSelected({ bold: checked })}
                    label={t('word.bold')}
                  />
                </>
              ) : null}

              {selected.kind === 'redact' ? (
                <p className="hint" style={{ margin: '0 0 10px' }}>
                  {t('annotate.redactHint')}
                </p>
              ) : null}

              {selected.kind !== 'image' && selected.kind !== 'redact' ? (
                <Field label={t('annotate.color')}>
                  <ColorInput
                    value={selected.color}
                    onChange={(value) => updateSelected({ color: value })}
                  />
                </Field>
              ) : null}

              {['rect', 'ellipse', 'line', 'draw'].includes(selected.kind) ? (
                <>
                  <Field label={t('annotate.size')}>
                    <Slider
                      value={selected.strokeWidth}
                      onChange={(value) => updateSelected({ strokeWidth: value })}
                      min={1}
                      max={20}
                    />
                  </Field>
                  {selected.kind === 'rect' || selected.kind === 'ellipse' ? (
                    <Checkbox
                      checked={selected.filled}
                      onChange={(checked) => updateSelected({ filled: checked })}
                      label={t('annotate.fill')}
                    />
                  ) : null}
                </>
              ) : null}

              <Field label={t('annotate.opacity')}>
                <Slider
                  value={Math.round(selected.opacity * 100)}
                  onChange={(value) => updateSelected({ opacity: value / 100 })}
                  min={5}
                  max={100}
                  suffix="%"
                />
              </Field>

              <Button
                variant="danger"
                ghostDanger
                block
                onClick={() => {
                  setAnnotations((current) => current.filter((item) => item.id !== selectedId))
                  setSelectedId(null)
                }}
              >
                <Trash2 size={15} />
                {t('annotate.deleteItem')}
              </Button>
            </div>
          ) : (
            <div className="stack tight">
              <Field label={t('annotate.color')}>
                <ColorInput value={color} onChange={setColor} />
              </Field>
              <Field label={t('annotate.size')}>
                <Slider value={strokeWidth} onChange={setStrokeWidth} min={1} max={20} />
              </Field>
              <Field label={t('annotate.fontSize')}>
                <Slider value={fontSize} onChange={setFontSize} min={6} max={72} />
              </Field>
              <Field label={t('annotate.opacity')}>
                <Slider value={opacity} onChange={setOpacity} min={5} max={100} suffix="%" />
              </Field>
              <Checkbox checked={filled} onChange={setFilled} label={t('annotate.fill')} />
              <Card style={{ background: 'var(--surface-2)', fontSize: 'var(--text-sm)' }}>
                {t('annotate.noLayers')}
              </Card>
            </div>
          )}
        </aside>
      </div>

      <SignaturePad
        open={signatureOpen}
        onClose={() => setSignatureOpen(false)}
        onUse={(dataUrl) => {
          setPendingImage(dataUrl)
          setTool('signature')
          setSignatureOpen(false)
        }}
      />
    </div>
  )
}

function AnnotationShape({
  annotation,
  selected,
  interactive,
  label,
  onSelect,
  onFocus,
  onKeyDown
}: {
  annotation: Annotation
  selected: boolean
  interactive: boolean
  label: string
  onSelect: (event: React.PointerEvent) => void
  onFocus: () => void
  onKeyDown: (event: React.KeyboardEvent, annotation: Annotation) => void
}): React.JSX.Element {
  // Every shape is a focus stop with an accessible name, so the annotation
  // layer can be walked, selected and edited without a pointer.
  const keyboard = {
    tabIndex: interactive ? 0 : -1,
    role: 'button' as const,
    'aria-label': label,
    'aria-pressed': selected,
    onFocus,
    onKeyDown: (event: React.KeyboardEvent) => onKeyDown(event, annotation)
  }
  const base: React.CSSProperties = {
    position: 'absolute',
    left: `${annotation.x * 100}%`,
    top: `${annotation.y * 100}%`,
    width: `${Math.abs(annotation.width) * 100}%`,
    height: `${Math.abs(annotation.height) * 100}%`,
    opacity: annotation.opacity,
    pointerEvents: interactive ? 'auto' : 'none',
    outline: selected ? '2px solid var(--accent)' : undefined,
    outlineOffset: 2,
    cursor: interactive ? 'move' : undefined
  }

  if (annotation.kind === 'draw' || annotation.kind === 'line') {
    const points =
      annotation.kind === 'draw'
        ? (annotation.points ?? [])
        : ([
            [annotation.x, annotation.y],
            [annotation.x + annotation.width, annotation.y + annotation.height]
          ] as [number, number][])

    return (
      <svg
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          overflow: 'visible',
          outline: selected ? '2px solid var(--accent)' : undefined
        }}
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        {...keyboard}
      >
        <polyline
          points={points.map(([x, y]) => `${x},${y}`).join(' ')}
          fill="none"
          stroke={annotation.color}
          strokeWidth={annotation.strokeWidth / 600}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={annotation.opacity}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    )
  }

  if (annotation.kind === 'text') {
    return (
      <div
        style={{
          ...base,
          color: annotation.color,
          fontSize: annotation.fontSize,
          fontWeight: annotation.bold ? 700 : 400,
          lineHeight: 1.3,
          whiteSpace: 'pre-wrap',
          height: 'auto'
        }}
        onPointerDown={interactive ? onSelect : undefined}
        {...keyboard}
      >
        {annotation.text}
      </div>
    )
  }

  if (annotation.kind === 'image') {
    return (
      <img
        src={annotation.imageDataUrl}
        alt=""
        style={{ ...base, objectFit: 'contain' }}
        onPointerDown={interactive ? onSelect : undefined}
        draggable={false}
        {...keyboard}
      />
    )
  }

  const style: React.CSSProperties = { ...base }
  if (annotation.kind === 'redact') {
    style.background = '#000'
  } else if (annotation.kind === 'highlight') {
    style.background = annotation.color
    style.opacity = annotation.opacity * 0.42
  } else {
    style.border = `${annotation.strokeWidth}px solid ${annotation.color}`
    if (annotation.filled) style.background = annotation.color
    if (annotation.kind === 'ellipse') style.borderRadius = '50%'
  }

  return <div style={style} onPointerDown={interactive ? onSelect : undefined} {...keyboard} />
}

