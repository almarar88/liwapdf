import { useEffect, useRef, useState } from 'react'
import { pdfjs, type PDFDocumentProxy } from '../lib/pdf/pdfjs'
import { normalizeForSearch } from '../lib/text/encoding'
import { foldWithOffsets } from '../lib/pdf/render'

interface PdfPageViewProps {
  proxy: PDFDocumentProxy
  pageNumber: number
  scale: number
  rotation?: number
  /** Bumped by the store whenever the document bytes change. */
  version: number
  className?: string
  overlay?: React.ReactNode
  onSize?: (size: { width: number; height: number }) => void
  /** Renders an invisible, selectable copy of the page's text over the canvas. */
  selectable?: boolean
  /** Folded query whose matches are highlighted in the text layer. */
  highlight?: string
  /** Highlights this occurrence more strongly than the others. */
  activeMatch?: number
}

/**
 * Renders a single PDF page into a canvas, cancelling any in-flight render when
 * the inputs change so fast scrolling or zooming never queues work up.
 *
 * On top of the canvas sits pdf.js's own text layer: transparent, positioned
 * glyph by glyph, and therefore selectable and copyable. Without it the page is
 * a picture — which is the one thing every reader the user already has does
 * better.
 */
export function PdfPageView({
  proxy,
  pageNumber,
  scale,
  rotation = 0,
  version,
  className,
  overlay,
  onSize,
  selectable = false,
  highlight,
  activeMatch
}: PdfPageViewProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    let task: { cancel(): void } | null = null
    let layer: { cancel(): void } | null = null

    const run = async (): Promise<void> => {
      const canvas = canvasRef.current
      if (!canvas) return
      const page = await proxy.getPage(pageNumber)
      if (cancelled) return

      const viewport = page.getViewport({ scale, rotation: (page.rotate + rotation) % 360 })
      const context = canvas.getContext('2d', { alpha: false })
      if (!context) return

      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.floor(viewport.width * ratio)
      canvas.height = Math.floor(viewport.height * ratio)
      canvas.style.width = `${Math.floor(viewport.width)}px`
      canvas.style.height = `${Math.floor(viewport.height)}px`
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, viewport.width, viewport.height)

      const next = { width: Math.floor(viewport.width), height: Math.floor(viewport.height) }
      setSize(next)
      onSize?.(next)

      const renderTask = page.render({ canvasContext: context, viewport })
      task = renderTask
      try {
        await renderTask.promise
      } catch (error) {
        if ((error as { name?: string }).name !== 'RenderingCancelledException') throw error
      }
      if (cancelled || !selectable) return

      const container = textRef.current
      if (!container) return
      container.replaceChildren()
      // Sized from the CSS-pixel viewport, never from canvas.width: the backing
      // store is scaled by devicePixelRatio, and using it would offset every
      // glyph box by that ratio.
      container.style.width = `${next.width}px`
      container.style.height = `${next.height}px`

      const textLayer = new pdfjs.TextLayer({
        textContentSource: page.streamTextContent(),
        container,
        viewport
      })
      layer = textLayer
      await textLayer.render()
    }

    void run().catch(() => undefined)
    return () => {
      cancelled = true
      task?.cancel()
      layer?.cancel()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proxy, pageNumber, scale, rotation, version, selectable])

  /**
   * Marks the search hits inside the already-rendered text layer.
   *
   * Each occurrence is wrapped in its own <mark> rather than the whole run
   * being tinted, so a one-word query highlights that word and not the line it
   * happens to sit on. The folded offsets map the match back through Arabic
   * normalisation, which changes the string's length.
   */
  useEffect(() => {
    const container = textRef.current
    if (!container || !selectable) return
    const spans = Array.from(container.querySelectorAll<HTMLElement>('span'))
    const needle = normalizeForSearch(highlight ?? '')

    let seen = 0
    for (const span of spans) {
      const text = span.dataset.plain ?? span.textContent ?? ''
      if (!needle) {
        if (span.dataset.plain !== undefined) {
          span.textContent = text
          delete span.dataset.plain
        }
        continue
      }

      const { folded, offsets } = foldWithOffsets(text)
      const ranges: [number, number][] = []
      let cursor = folded.indexOf(needle)
      while (cursor !== -1) {
        ranges.push([offsets[cursor] ?? 0, offsets[cursor + needle.length] ?? text.length])
        cursor = folded.indexOf(needle, cursor + Math.max(1, needle.length))
      }
      if (ranges.length === 0) {
        if (span.dataset.plain !== undefined) {
          span.textContent = text
          delete span.dataset.plain
        }
        continue
      }

      span.dataset.plain = text
      const pieces: Node[] = []
      let at = 0
      for (const [start, end] of ranges) {
        if (start > at) pieces.push(document.createTextNode(text.slice(at, start)))
        const mark = document.createElement('mark')
        mark.textContent = text.slice(start, end)
        mark.className = activeMatch !== undefined && seen === activeMatch ? 'match-active' : 'match'
        pieces.push(mark)
        seen += 1
        at = end
      }
      if (at < text.length) pieces.push(document.createTextNode(text.slice(at)))
      span.replaceChildren(...pieces)
    }
  }, [highlight, activeMatch, selectable, size, version])

  return (
    <div
      className={`pdf-page ${className ?? ''}`}
      style={size ? { width: size.width, height: size.height } : undefined}
    >
      <canvas ref={canvasRef} />
      {selectable ? <div className="text-layer" ref={textRef} /> : null}
      {overlay}
    </div>
  )
}
