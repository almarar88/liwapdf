import { useEffect, useRef, useState } from 'react'
import { Pen, Trash2, Upload } from 'lucide-react'
import { useApp } from '../store/app'
import { Button, Modal, TextInput, Field } from './ui'
import { pickOneFile } from '../lib/files'
import { uid } from '../lib/format'

export interface SavedSignature {
  id: string
  name: string
  dataUrl: string
  createdAt: number
}

export async function listSignatures(): Promise<SavedSignature[]> {
  try {
    return ((await window.alcode.signatures.list()) as SavedSignature[]) ?? []
  } catch {
    return []
  }
}

/**
 * Crops a drawn signature to its ink and drops the empty margins.
 *
 * The pad is a wide box and a signature occupies a corner of it. Saved
 * untrimmed, the stroke keeps all that emptiness, so placing it on a page puts
 * a large invisible rectangle over the text and the visible mark ends up
 * nowhere near where it was dropped. Trimming makes the image *be* the
 * signature, which is what every later placement assumes.
 */
function trim(canvas: HTMLCanvasElement): string | null {
  const context = canvas.getContext('2d')
  if (!context) return null
  const { width, height } = canvas
  const { data } = context.getImageData(0, 0, width, height)

  let top = height
  let left = width
  let right = -1
  let bottom = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] < 8) continue
      if (x < left) left = x
      if (x > right) right = x
      if (y < top) top = y
      if (y > bottom) bottom = y
    }
  }
  if (right < 0) return null

  const pad = 6
  const cropped = document.createElement('canvas')
  cropped.width = Math.min(width, right - left + 1 + pad * 2)
  cropped.height = Math.min(height, bottom - top + 1 + pad * 2)
  const target = cropped.getContext('2d')
  if (!target) return null
  target.drawImage(
    canvas,
    Math.max(0, left - pad),
    Math.max(0, top - pad),
    cropped.width,
    cropped.height,
    0,
    0,
    cropped.width,
    cropped.height
  )
  return cropped.toDataURL('image/png')
}

/**
 * Lifts a signature off a photograph of paper.
 *
 * People sign a sheet and photograph it far more often than they draw with a
 * mouse. Pasted as-is that photo brings its white page with it and covers
 * whatever it is placed over, so the light pixels become transparent and the
 * dark ink is kept — a fixed threshold rather than anything cleverer, because
 * the failure mode of clever here is erasing the signature.
 */
async function inkFromPhoto(bytes: Uint8Array): Promise<string | null> {
  const blob = new Blob([bytes as unknown as BlobPart])
  const bitmap = await createImageBitmap(blob).catch(() => null)
  if (!bitmap) return null

  const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const context = canvas.getContext('2d')
  if (!context) return null
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  const image = context.getImageData(0, 0, canvas.width, canvas.height)
  const { data } = image
  for (let index = 0; index < data.length; index += 4) {
    const luma = (data[index] * 299 + data[index + 1] * 587 + data[index + 2] * 114) / 1000
    if (luma > 170) {
      data[index + 3] = 0
    } else {
      // Keep the stroke's own darkness so the edges stay soft rather than
      // turning into a jagged one-bit outline.
      data[index] = 20
      data[index + 1] = 22
      data[index + 2] = 28
      data[index + 3] = Math.min(255, Math.round((170 - luma) * 3))
    }
  }
  context.putImageData(image, 0, 0)
  return trim(canvas)
}

/**
 * Draw a signature, name it, and keep it.
 *
 * Both halves matter: a pad with no library means redrawing the signature for
 * every document, and a mouse-drawn scrawl is never the same twice.
 */
export function SignaturePad({
  open,
  onClose,
  onUse
}: {
  open: boolean
  onClose: () => void
  onUse: (dataUrl: string) => void
}): React.JSX.Element {
  const t = useApp((state) => state.t)
  const notify = useApp((state) => state.notify)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const [saved, setSaved] = useState<SavedSignature[]>([])
  const [name, setName] = useState('')
  const [empty, setEmpty] = useState(true)

  useEffect(() => {
    if (open) void listSignatures().then(setSaved)
  }, [open])

  const contextOf = (): CanvasRenderingContext2D | null => canvasRef.current?.getContext('2d') ?? null

  const clear = (): void => {
    const canvas = canvasRef.current
    const context = contextOf()
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height)
    setEmpty(true)
  }

  const point = (event: React.PointerEvent): { x: number; y: number } => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    // The backing store is larger than the element, so pointer coordinates
    // have to be scaled or the stroke lands away from the cursor.
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    return { x: (event.clientX - rect.left) * scaleX, y: (event.clientY - rect.top) * scaleY }
  }

  const store = async (dataUrl: string): Promise<void> => {
    const entry = {
      id: uid(),
      name: name.trim() || t('sign.untitled'),
      dataUrl,
      createdAt: Date.now()
    }
    const items = ((await window.alcode.signatures.save(entry)) as SavedSignature[]) ?? []
    setSaved(items)
    setName('')
    notify({ kind: 'success', title: t('sign.saved') })
  }

  const importPhoto = async (): Promise<void> => {
    const file = await pickOneFile([{ name: 'file.images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }])
    if (!file) return
    const ink = await inkFromPhoto(file.data)
    if (!ink) {
      notify({ kind: 'info', title: t('sign.photoEmpty') })
      return
    }
    await store(ink)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('annotate.signaturePad')}
      footer={
        <>
          <Button onClick={clear}>{t('annotate.clearPad')}</Button>
          <Button
            disabled={empty}
            onClick={() => {
              const canvas = canvasRef.current
              const ink = canvas ? trim(canvas) : null
              if (ink) void store(ink)
            }}
          >
            <Pen size={15} />
            {t('sign.save')}
          </Button>
          <Button
            variant="primary"
            disabled={empty}
            onClick={() => {
              const canvas = canvasRef.current
              const ink = canvas ? trim(canvas) : null
              if (ink) onUse(ink)
            }}
          >
            {t('annotate.useSignature')}
          </Button>
        </>
      }
    >
      <div className="stack">
        {saved.length > 0 ? (
          <Field label={t('sign.library')}>
            <div className="sign-library">
              {saved.map((item) => (
                <div key={item.id} className="sign-card">
                  <button className="sign-pick" title={item.name} onClick={() => onUse(item.dataUrl)}>
                    <img src={item.dataUrl} alt={item.name} />
                  </button>
                  <span className="sign-name" title={item.name}>
                    {item.name}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon
                    ghostDanger
                    title={t('action.remove')}
                    onClick={() => {
                      void window.alcode.signatures
                        .remove(item.id)
                        .then((items) => setSaved((items as SavedSignature[]) ?? []))
                    }}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              ))}
            </div>
          </Field>
        ) : null}

        <canvas
          ref={canvasRef}
          width={1000}
          height={320}
          className="sign-pad"
          onPointerDown={(event) => {
            const context = contextOf()
            if (!context) return
            drawing.current = true
            setEmpty(false)
            canvasRef.current?.setPointerCapture(event.pointerId)
            const spot = point(event)
            context.strokeStyle = '#14161c'
            context.lineWidth = 4
            context.lineCap = 'round'
            context.lineJoin = 'round'
            context.beginPath()
            context.moveTo(spot.x, spot.y)
          }}
          onPointerMove={(event) => {
            if (!drawing.current) return
            const context = contextOf()
            if (!context) return
            const spot = point(event)
            context.lineTo(spot.x, spot.y)
            context.stroke()
          }}
          onPointerUp={() => {
            drawing.current = false
          }}
          onPointerLeave={() => {
            drawing.current = false
          }}
        />

        <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
          <Field label={t('sign.name')} hint={t('sign.nameHint')}>
            <TextInput value={name} onChange={setName} placeholder={t('sign.untitled')} />
          </Field>
          <Button size="sm" onClick={() => void importPhoto()}>
            <Upload size={15} />
            {t('sign.fromPhoto')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
