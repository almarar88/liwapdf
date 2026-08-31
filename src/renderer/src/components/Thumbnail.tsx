import { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import type { PDFDocumentProxy } from '../lib/pdf/pdfjs'

interface ThumbnailProps {
  proxy: PDFDocumentProxy
  pageNumber: number
  version: number
  active?: boolean
  selected?: boolean
  selectable?: boolean
  width?: number
  label?: string
  onClick?: () => void
  onDoubleClick?: () => void
  /** Keyboard equivalent of dragging the tile: move it one place. */
  onMove?: (direction: -1 | 1) => void
  draggable?: boolean
  onDragStart?: () => void
  onDragOver?: (event: React.DragEvent) => void
  onDrop?: () => void
}

/**
 * A lazily rendered page preview.
 *
 * Rendering starts when the tile scrolls into view and the bitmap is released
 * when it scrolls a long way back out, so a 500-page document costs a sliding
 * window of previews rather than one that only ever grows. The tile is a real
 * button so pages can be picked, opened and reordered without a mouse.
 */
export function Thumbnail({
  proxy,
  pageNumber,
  version,
  active,
  selected,
  selectable,
  width = 168,
  label,
  onClick,
  onDoubleClick,
  onMove,
  draggable,
  onDragStart,
  onDragOver,
  onDrop
}: ThumbnailProps): React.JSX.Element {
  const hostRef = useRef<HTMLButtonElement>(null)
  const [near, setNear] = useState(false)
  const [source, setSource] = useState<string | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return undefined
    // Kept connected rather than disconnected on first hit, so leaving the
    // viewport is observable and the preview can be dropped again.
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1]
        if (entry) setNear(entry.isIntersecting)
      },
      { rootMargin: '600px' }
    )
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!near) {
      setSource((current) => {
        if (current?.startsWith('blob:')) URL.revokeObjectURL(current)
        return null
      })
      return undefined
    }
    let cancelled = false
    let url: string | null = null

    const run = async (): Promise<void> => {
      const page = await proxy.getPage(pageNumber)
      if (cancelled) return
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: width / base.width })
      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      const context = canvas.getContext('2d', { alpha: false })
      if (!context) return
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: context, viewport }).promise
      page.cleanup()
      if (cancelled) return

      // A blob URL keeps the encode off the main thread and, unlike a data
      // URL, its bytes can be released deterministically.
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', 0.7)
      )
      if (cancelled || !blob) return
      url = URL.createObjectURL(blob)
      setSource(url)
    }

    void run().catch(() => undefined)
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [near, proxy, pageNumber, version, width])

  const name = label ?? `Page ${pageNumber}`

  return (
    <button
      type="button"
      ref={hostRef}
      className={`thumb${active ? ' active' : ''}${selected ? ' selected' : ''}`}
      style={{ minHeight: source ? undefined : width * 1.35 }}
      aria-label={name}
      aria-current={active ? 'true' : undefined}
      aria-pressed={selectable ? Boolean(selected) : undefined}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onKeyDown={(event) => {
        if (!onMove) return
        // Alt+arrow reorders, matching what dragging the tile does.
        if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
          event.preventDefault()
          const forward = event.key === 'ArrowRight'
          const rtl = document.documentElement.getAttribute('dir') === 'rtl'
          onMove(forward !== rtl ? 1 : -1)
        } else if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
          event.preventDefault()
          onMove(event.key === 'ArrowDown' ? 1 : -1)
        }
      }}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {source ? (
        <img src={source} alt="" draggable={false} />
      ) : (
        <div style={{ height: width * 1.35, background: 'var(--surface-sunken)' }} />
      )}
      <span className="num">{pageNumber}</span>
      {selectable ? (
        <span className="pick">{selected ? <Check size={12} strokeWidth={3} /> : null}</span>
      ) : null}
    </button>
  )
}
