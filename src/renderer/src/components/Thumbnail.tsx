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
  onClick?: () => void
  onDoubleClick?: () => void
  draggable?: boolean
  onDragStart?: () => void
  onDragOver?: (event: React.DragEvent) => void
  onDrop?: () => void
}

/**
 * A lazily rendered page preview. Rendering only starts once the tile scrolls
 * into view, which keeps documents with hundreds of pages responsive.
 */
export function Thumbnail({
  proxy,
  pageNumber,
  version,
  active,
  selected,
  selectable,
  width = 168,
  onClick,
  onDoubleClick,
  draggable,
  onDragStart,
  onDragOver,
  onDrop
}: ThumbnailProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [source, setSource] = useState<string | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return undefined
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '400px' }
    )
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return undefined
    let cancelled = false

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
      if (!cancelled) setSource(canvas.toDataURL('image/jpeg', 0.7))
    }

    void run().catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [visible, proxy, pageNumber, version, width])

  return (
    <div
      ref={hostRef}
      className={`thumb${active ? ' active' : ''}${selected ? ' selected' : ''}`}
      style={{ minHeight: source ? undefined : width * 1.35 }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {source ? (
        <img src={source} alt={`Page ${pageNumber}`} draggable={false} />
      ) : (
        <div style={{ height: width * 1.35, background: 'var(--surface-sunken)' }} />
      )}
      <span className="num">{pageNumber}</span>
      {selectable ? (
        <span className="pick">{selected ? <Check size={12} strokeWidth={3} /> : null}</span>
      ) : null}
    </div>
  )
}
