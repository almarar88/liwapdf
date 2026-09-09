import { useEffect, useRef, useState } from 'react'
import { Camera, Check, Ruler, Sigma, Hash, RefreshCw, Share2 } from 'lucide-react'
import { useApp } from '../renderer/src/store/app'
import { Button, Field, Modal, Segmented, Slider } from '../renderer/src/components/ui'
import { countObjects, type CountResult } from '../renderer/src/lib/images/count'
import { solve, findProblems, MathError, type Solution } from '../renderer/src/lib/text/mathsolve'
import { imagesToPdf } from '../renderer/src/lib/convert'
import { openForRender } from '../renderer/src/lib/pdf/pdfjs'
import { renderPage } from '../renderer/src/lib/pdf/render'
import { capturePage } from './scan'
import { tapFeedback } from './shell'

/**
 * The three things a camera can do to a subject that is not a page of text,
 * and the one thing a page can be asked that is not about its words.
 *
 * Each is a small pipeline over machinery the app already has — the camera,
 * the bundled recogniser, the image tools, the PDF renderer — rather than a
 * service somewhere. That is the whole point: a photograph of a prescription,
 * a pallet or a child's homework is not something to upload.
 */

/* ------------------------------------------------------------- shared bits */

/** Decodes captured bytes into a canvas the pixel tools can read. */
export async function toCanvas(bytes: Uint8Array, maxEdge = 1600): Promise<HTMLCanvasElement> {
  const blob = new Blob([bytes as BlobPart])
  const url = URL.createObjectURL(blob)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error('decode-failed'))
      element.src = url
    })
    // Counting a 12-megapixel photograph is a second of work for no gain: the
    // objects are hundreds of pixels across either way.
    const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas
  } finally {
    URL.revokeObjectURL(url)
  }
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('encode-failed'))
        return
      }
      void blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)))
    }, 'image/png')
  })
}

/* ------------------------------------------------------------------ ID card */

const CARD_KINDS = { id: 2, passport: 1 } as const

/**
 * Both sides of a card on one page.
 *
 * Every office that asks for a copy of an ID wants the two sides together on
 * one sheet, and every phone scanner returns two pages. Composing them here
 * saves the user the merge, and keeps the card at its real proportions rather
 * than blown up to fill A4.
 */
export function CardSheet({
  open,
  kind,
  onClose
}: {
  open: boolean
  kind: 'id' | 'passport'
  onClose: () => void
}): React.JSX.Element {
  const t = useApp((state) => state.t)
  const notify = useApp((state) => state.notify)
  const openPdfBytes = useApp((state) => state.openPdfBytes)
  const [shots, setShots] = useState<{ bytes: Uint8Array; url: string }[]>([])
  const [busy, setBusy] = useState(false)
  const wanted = CARD_KINDS[kind]

  useEffect(() => {
    if (open) return
    for (const shot of shots) URL.revokeObjectURL(shot.url)
    setShots([])
    // Cleared when the sheet closes so a second visit starts empty.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const shoot = async (): Promise<void> => {
    const bytes = await capturePage()
    if (!bytes) return
    tapFeedback()
    setShots((current) => [...current, { bytes, url: URL.createObjectURL(new Blob([bytes as BlobPart])) }])
  }

  const finish = async (): Promise<void> => {
    if (shots.length === 0) return
    setBusy(true)
    try {
      const page = await composeCard(shots.map((shot) => shot.bytes))
      const bytes = await imagesToPdf(
        [{ name: 'card.png', bytes: page }],
        [595.28, 841.89],
        'contain',
        0,
        undefined,
        false
      )
      await openPdfBytes(`${kind}-${new Date().toISOString().slice(0, 10)}.pdf`, bytes, null)
      onClose()
    } catch (error) {
      notify({ kind: 'error', title: t('msg.error'), message: String((error as Error)?.message ?? error) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t(kind === 'id' ? 'phone.scan.id' : 'phone.scan.passport')}>
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>
          {t(kind === 'id' ? 'phone.scan.id.hint' : 'phone.scan.passport.hint')}
        </p>
        {shots.length > 0 ? (
          <div className="scan-strip">
            {shots.map((shot, index) => (
              <div className="scan-page" key={shot.url}>
                <img src={shot.url} alt={t('scan.page', { n: index + 1 })} />
                <span className="scan-number">{index + 1}</span>
              </div>
            ))}
          </div>
        ) : null}
        <Button block variant={shots.length === 0 ? 'primary' : undefined} onClick={() => void shoot()}>
          <Camera size={16} />
          {t(shots.length === 0 ? 'phone.scan.front' : shots.length < wanted ? 'phone.scan.back' : 'scan.another')}
        </Button>
        {shots.length > 0 ? (
          <Button block variant="primary" disabled={busy} onClick={() => void finish()}>
            <Check size={16} />
            {t('scan.open')}
          </Button>
        ) : null}
      </div>
    </Modal>
  )
}

/** Lays the captured sides down the page at their own aspect ratio. */
async function composeCard(shots: Uint8Array[]): Promise<Uint8Array> {
  const images = await Promise.all(shots.map((bytes) => toCanvas(bytes, 1800)))
  // A4 at 150 DPI, with a margin the print shop will not clip.
  const page = document.createElement('canvas')
  page.width = 1240
  page.height = 1754
  const context = page.getContext('2d')!
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, page.width, page.height)

  const margin = 90
  const gap = 60
  const usableWidth = page.width - margin * 2
  const slot = (page.height - margin * 2 - gap * (images.length - 1)) / images.length

  images.forEach((image, index) => {
    const scale = Math.min(usableWidth / image.width, slot / image.height)
    const width = image.width * scale
    const height = image.height * scale
    const x = (page.width - width) / 2
    const y = margin + index * (slot + gap) + (slot - height) / 2
    context.drawImage(image, x, y, width, height)
  })
  return canvasToPng(page)
}

/* --------------------------------------------------------------------- math */

export function MathSheet({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element {
  const t = useApp((state) => state.t)
  const language = useApp((state) => state.settings.language)
  const [stage, setStage] = useState<'idle' | 'reading'>('idle')
  const [progress, setProgress] = useState('')
  const [answers, setAnswers] = useState<{ line: string; solution: Solution | null }[]>([])
  const [typed, setTyped] = useState('')

  const read = async (): Promise<void> => {
    const bytes = await capturePage()
    if (!bytes) return
    setStage('reading')
    setAnswers([])
    try {
      const canvas = await toCanvas(bytes, 2000)
      const { recognizeImage } = await import('../renderer/src/lib/ocr')
      const { enhanceScan } = await import('../renderer/src/lib/images/scan')
      enhanceScan(canvas)
      const outcome = await recognizeImage(canvas, {
        // Mathematics is written in Latin digits and symbols whatever the
        // language around it; adding Arabic here only adds misreadings.
        language: 'eng',
        onProgress: (fraction, status) => setProgress(`${status} ${Math.round(fraction * 100)}%`)
      })
      setAnswers(findProblems(outcome.text).map((line) => ({ line, solution: attempt(line) })))
    } finally {
      setStage('idle')
      setProgress('')
    }
  }

  const manual = typed.trim() ? [{ line: typed, solution: attempt(typed) }] : []
  const shown = manual.length > 0 ? manual : answers

  return (
    <Modal open={open} onClose={onClose} title={t('phone.scan.math')}>
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>{t('phone.scan.math.hint')}</p>

        <Button block variant="primary" disabled={stage === 'reading'} onClick={() => void read()}>
          <Camera size={16} />
          {stage === 'reading' ? progress || t('msg.loading') : t('phone.scan.math.shoot')}
        </Button>

        <Field label={t('phone.scan.math.type')}>
          <input
            className="input"
            value={typed}
            dir="ltr"
            inputMode="text"
            placeholder="2x + 5 = 13"
            onChange={(event) => setTyped(event.target.value)}
          />
        </Field>

        {shown.length === 0 && stage === 'idle' ? null : (
          <div className="math-list">
            {shown.map((entry, index) => (
              <div className="math-row" key={`${entry.line}-${index}`}>
                <span className="math-problem" dir="ltr">
                  {entry.solution?.problem ?? entry.line}
                </span>
                {entry.solution ? (
                  <>
                    <b dir="ltr">{entry.solution.answer}</b>
                    <span className="math-steps" dir="ltr">
                      {entry.solution.steps.join('  →  ')}
                    </span>
                  </>
                ) : (
                  <span className="muted">{t('phone.scan.math.unsolved')}</span>
                )}
              </div>
            ))}
          </div>
        )}

        {shown.length > 0 ? (
          <Button
            block
            onClick={() => {
              const text = shown
                .map((entry) => `${entry.solution?.problem ?? entry.line} = ${entry.solution?.answer ?? '?'}`)
                .join('\n')
              void navigator.clipboard.writeText(text)
            }}
          >
            <Share2 size={16} />
            {t('action.copy')}
          </Button>
        ) : null}

        <p className="muted" style={{ margin: 0, fontSize: 'var(--text-xs)' }}>
          {t(language === 'ar' ? 'phone.scan.math.note' : 'phone.scan.math.note')}
        </p>
      </div>
    </Modal>
  )
}

function attempt(line: string): Solution | null {
  try {
    return solve(line)
  } catch (error) {
    // A worksheet has headings and page numbers on it; a line that is not
    // mathematics is skipped rather than answered with a guess.
    if (error instanceof MathError) return null
    throw error
  }
}

/* -------------------------------------------------------------------- count */

export function CountSheet({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element {
  const t = useApp((state) => state.t)
  const [photo, setPhoto] = useState<HTMLCanvasElement | null>(null)
  const [result, setResult] = useState<CountResult | null>(null)
  const [sensitivity, setSensitivity] = useState(50)
  const viewRef = useRef<HTMLCanvasElement>(null)

  const shoot = async (): Promise<void> => {
    const bytes = await capturePage()
    if (!bytes) return
    tapFeedback()
    const canvas = await toCanvas(bytes, 1400)
    setPhoto(canvas)
  }

  // Re-counted whenever the photograph or the sensitivity changes, and drawn
  // over a copy of the original so the markers can be redrawn without
  // destroying the picture underneath them.
  useEffect(() => {
    const view = viewRef.current
    if (!photo || !view) return
    const counted = countObjects(photo, { sensitivity: sensitivity / 100 })
    setResult(counted)

    view.width = photo.width
    view.height = photo.height
    const context = view.getContext('2d')!
    context.drawImage(photo, 0, 0)
    context.lineWidth = Math.max(2, photo.width / 320)
    for (const object of counted.objects) {
      const radius = Math.max(6, Math.min(object.width, object.height) / 2.6)
      context.beginPath()
      context.arc(object.cx, object.cy, radius, 0, Math.PI * 2)
      context.strokeStyle = object.units > 1 ? '#f5a524' : '#0a84ff'
      context.stroke()
    }
  }, [photo, sensitivity])

  return (
    <Modal open={open} onClose={onClose} title={t('phone.scan.count')}>
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>{t('phone.scan.count.hint')}</p>

        {photo ? (
          <>
            <div className="count-total">
              <Hash size={18} />
              <b>{result?.total ?? 0}</b>
              <span>{t('phone.scan.count.objects')}</span>
            </div>
            <canvas ref={viewRef} className="count-view" />
            <Field label={t('phone.scan.count.sensitivity')}>
              <Slider min={10} max={90} value={sensitivity} onChange={setSensitivity} />
            </Field>
            <Button block onClick={() => void shoot()}>
              <RefreshCw size={16} />
              {t('phone.scan.count.again')}
            </Button>
          </>
        ) : (
          <Button block variant="primary" onClick={() => void shoot()}>
            <Camera size={16} />
            {t('phone.scan.count.shoot')}
          </Button>
        )}
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ measure */

const UNITS = { mm: 1, cm: 0.1, in: 1 / 25.4 } as const
const POINT_TO_MM = 25.4 / 72

/**
 * Distances on the open page, in real units.
 *
 * A PDF page carries its true size, so two taps on a rendered page are a
 * measurement rather than an estimate — which is what makes this worth having
 * over a photograph and a guess. It is the drawing, the plan and the printed
 * form this is for.
 */
export function MeasureSheet({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element {
  const t = useApp((state) => state.t)
  const doc = useApp((state) => state.doc)
  const currentPage = useApp((state) => state.currentPage)
  const [unit, setUnit] = useState<'mm' | 'cm' | 'in'>('cm')
  const [points, setPoints] = useState<{ x: number; y: number }[]>([])
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const baseRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    if (!open || !doc) return
    let cancelled = false
    const draw = async (): Promise<void> => {
      const source = await openForRender(doc.bytes, doc.password)
      try {
        const page = await source.getPage(Math.min(currentPage, source.numPages))
        const viewport = page.getViewport({ scale: 1 })
        if (cancelled) return
        setPageSize({ width: viewport.width, height: viewport.height })
        const offscreen = document.createElement('canvas')
        // 900px wide is enough to aim at on a phone and cheap to render.
        await renderPage(source, Math.min(currentPage, source.numPages), 900 / viewport.width, offscreen)
        if (cancelled) return
        baseRef.current = offscreen
        setPoints([])
        paint(canvasRef.current, offscreen, [])
      } finally {
        await source.destroy().catch(() => undefined)
      }
    }
    void draw()
    return () => {
      cancelled = true
    }
  }, [open, doc, currentPage])

  const tap = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const canvas = canvasRef.current
    const base = baseRef.current
    if (!canvas || !base) return
    const rect = canvas.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * base.width
    const y = ((event.clientY - rect.top) / rect.height) * base.height
    const next = points.length >= 2 ? [{ x, y }] : [...points, { x, y }]
    setPoints(next)
    paint(canvas, base, next)
    tapFeedback()
  }

  const distance =
    points.length === 2 && pageSize && baseRef.current
      ? (Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y) *
          (pageSize.width / baseRef.current.width) *
          POINT_TO_MM) *
        UNITS[unit]
      : null

  return (
    <Modal open={open} onClose={onClose} title={t('phone.scan.measure')}>
      <div className="stack">
        {!doc ? (
          <p className="muted" style={{ margin: 0 }}>{t('phone.scan.measure.needsDoc')}</p>
        ) : (
          <>
            <p className="muted" style={{ margin: 0 }}>{t('phone.scan.measure.hint')}</p>
            <canvas ref={canvasRef} className="measure-view" onPointerDown={tap} />
            <div className="count-total">
              <Ruler size={18} />
              <b dir="ltr">{distance === null ? '—' : distance.toFixed(unit === 'in' ? 2 : 1)}</b>
              <span>{unit}</span>
            </div>
            <Segmented
              value={unit}
              onChange={setUnit}
              options={[
                { value: 'mm', label: 'mm' },
                { value: 'cm', label: 'cm' },
                { value: 'in', label: 'in' }
              ]}
            />
            <p className="muted" style={{ margin: 0, fontSize: 'var(--text-xs)' }}>
              <Sigma size={12} style={{ verticalAlign: '-2px', marginInlineEnd: 4 }} />
              {pageSize
                ? t('phone.scan.measure.page', {
                    w: (pageSize.width * POINT_TO_MM).toFixed(0),
                    h: (pageSize.height * POINT_TO_MM).toFixed(0)
                  })
                : ''}
            </p>
          </>
        )}
      </div>
    </Modal>
  )
}

function paint(
  canvas: HTMLCanvasElement | null,
  base: HTMLCanvasElement,
  points: { x: number; y: number }[]
): void {
  if (!canvas) return
  canvas.width = base.width
  canvas.height = base.height
  const context = canvas.getContext('2d')!
  context.drawImage(base, 0, 0)
  context.strokeStyle = '#0a84ff'
  context.fillStyle = '#0a84ff'
  context.lineWidth = 3
  for (const point of points) {
    context.beginPath()
    context.arc(point.x, point.y, 7, 0, Math.PI * 2)
    context.fill()
  }
  if (points.length === 2) {
    context.beginPath()
    context.moveTo(points[0].x, points[0].y)
    context.lineTo(points[1].x, points[1].y)
    context.stroke()
  }
}
