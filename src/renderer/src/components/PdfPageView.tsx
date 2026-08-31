import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from '../lib/pdf/pdfjs'

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
}

/**
 * Renders a single PDF page into a canvas, cancelling any in-flight render when
 * the inputs change so fast scrolling or zooming never queues work up.
 */
export function PdfPageView({
  proxy,
  pageNumber,
  scale,
  rotation = 0,
  version,
  className,
  overlay,
  onSize
}: PdfPageViewProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    let task: { cancel(): void } | null = null

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
    }

    void run().catch(() => undefined)
    return () => {
      cancelled = true
      task?.cancel()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proxy, pageNumber, scale, rotation, version])

  return (
    <div
      className={`pdf-page ${className ?? ''}`}
      style={size ? { width: size.width, height: size.height } : undefined}
    >
      <canvas ref={canvasRef} />
      {overlay}
    </div>
  )
}
