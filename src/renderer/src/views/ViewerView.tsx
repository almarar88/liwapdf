import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  FileText,
  Maximize2,
  Minus,
  Plus,
  RotateCw,
  Search,
  ScrollText,
  Square,
  X,
  ListTree,
  Printer,
  Sun,
  Moon,
  BookOpen,
  Camera,
  Volume2,
  VolumeX
} from 'lucide-react'
import { useApp } from '../store/app'
import { useDocumentActions } from '../hooks/useDocumentActions'
import { Button, Empty, Segmented, TextInput } from '../components/ui'
import { PdfPageView } from '../components/PdfPageView'
import { Thumbnail } from '../components/Thumbnail'
import { PrintDialog } from './PrintDialog'
import { readOutline, searchDocument, type OutlineNode, type SearchHit } from '../lib/pdf/render'
import { clamp } from '../lib/format'
import { speak, type SpeechHandle } from '../lib/speech'

type FitMode = 'width' | 'page' | 'custom'

type ReadingMode = 'normal' | 'sepia' | 'night'
const READING_KEY = 'alcode.readingMode'

function readReadingMode(): ReadingMode {
  try {
    const value = localStorage.getItem(READING_KEY)
    return value === 'sepia' || value === 'night' ? value : 'normal'
  } catch {
    return 'normal'
  }
}

export function ViewerView(): React.JSX.Element {
  const t = useApp((state) => state.t)
  const doc = useApp((state) => state.doc)
  const currentPage = useApp((state) => state.currentPage)
  const setCurrentPage = useApp((state) => state.setCurrentPage)
  const rightToLeft = useApp((state) => state.settings.language === 'ar')
  const { openDialog } = useDocumentActions()

  const [zoom, setZoom] = useState(1.1)
  const [fit, setFit] = useState<FitMode>('width')
  const [rotation, setRotation] = useState(0)
  const [mode, setMode] = useState<'continuous' | 'single'>('continuous')
  // Night and paper tints are applied to the rendered page through a CSS
  // filter, so the document itself is never touched; remembered per machine.
  const [reading, setReading] = useState<ReadingMode>(() => readReadingMode())
  const notify = useApp((state) => state.notify)
  const [snapshot, setSnapshot] = useState(false)
  const [rubber, setRubber] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const dragStart = useRef<{ x: number; y: number } | null>(null)
  const [speech, setSpeech] = useState<SpeechHandle | null>(null)
  const resumedFor = useRef<string | null>(null)
  useEffect(() => {
    try {
      localStorage.setItem(READING_KEY, reading)
    } catch {
      // Not worth an error.
    }
  }, [reading])
  const [railTab, setRailTab] = useState<'thumbs' | 'outline'>('thumbs')
  const [outline, setOutline] = useState<OutlineNode[]>([])
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [hitIndex, setHitIndex] = useState(0)
  const [printOpen, setPrintOpen] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const [naturalSizes, setNaturalSizes] = useState<{ width: number; height: number }[]>([])
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)

  useEffect(() => {
    if (!doc) return
    readOutline(doc.proxy)
      .then(setOutline)
      .catch(() => setOutline([]))
  }, [doc])

  // Every page's unscaled size, measured once per document and rotation. The
  // virtualiser needs the full list up front so the scrollbar is honest before
  // anything has rendered; the sizes are independent of zoom, so a zoom change
  // never re-measures.
  useEffect(() => {
    if (!doc) {
      setNaturalSizes([])
      return undefined
    }
    let cancelled = false

    const measure = async (): Promise<void> => {
      const sizes: { width: number; height: number }[] = []
      const BATCH = 24
      for (let start = 0; start < doc.pageCount && !cancelled; start += BATCH) {
        const numbers = Array.from(
          { length: Math.min(BATCH, doc.pageCount - start) },
          (_, offset) => start + offset + 1
        )
        const batch = await Promise.all(
          numbers.map(async (pageNumber) => {
            const page = await doc.proxy.getPage(pageNumber)
            const viewport = page.getViewport({
              scale: 1,
              rotation: (page.rotate + rotation) % 360
            })
            return { width: viewport.width, height: viewport.height }
          })
        )
        sizes.push(...batch)
        if (!cancelled) setNaturalSizes([...sizes])
      }
    }

    void measure()
    return () => {
      cancelled = true
    }
  }, [doc, rotation])

  // Fit-to-width/page recomputes the zoom against the visible viewport.
  // Deliberately not keyed on currentPage: doing so re-derived the zoom on
  // every scroll frame and re-rasterised the document mid-scroll.
  const firstSize = naturalSizes[0]
  useEffect(() => {
    if (!doc || fit === 'custom' || !firstSize) return undefined

    const compute = (): void => {
      const container = scrollRef.current
      if (!container) return
      const available = container.clientWidth - 64
      const availableHeight = container.clientHeight - 64
      const next =
        fit === 'width'
          ? available / firstSize.width
          : Math.min(available / firstSize.width, availableHeight / firstSize.height)
      setZoom(clamp(next, 0.15, 6))
    }

    compute()
    const observer = new ResizeObserver(compute)
    if (scrollRef.current) observer.observe(scrollRef.current)
    return () => observer.disconnect()
  }, [doc, fit, firstSize])

  const layout = useMemo(() => {
    const gap = 22
    const offsets: number[] = []
    const heights: number[] = []
    let cursor = 0
    for (const size of naturalSizes) {
      const height = Math.floor(size.height * zoom)
      offsets.push(cursor)
      heights.push(height)
      cursor += height + gap
    }
    return { offsets, heights, total: Math.max(0, cursor - gap) }
  }, [naturalSizes, zoom])

  // Follow the scroll position instead of measuring mounted DOM nodes — with
  // virtualisation most pages have no node to measure.
  useEffect(() => {
    const container = scrollRef.current
    if (!container) return undefined
    let frame = 0

    const sync = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        setScrollTop(container.scrollTop)
        setViewportHeight(container.clientHeight)
      })
    }

    sync()
    container.addEventListener('scroll', sync, { passive: true })
    const observer = new ResizeObserver(sync)
    observer.observe(container)
    return () => {
      container.removeEventListener('scroll', sync)
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [doc])

  const visiblePages = useMemo(() => {
    if (!doc) return []
    if (mode === 'single') return [currentPage]
    if (layout.offsets.length === 0) return [1]
    // Two screens of overscan either side keeps scrolling smooth without ever
    // holding more than a handful of canvases.
    const top = scrollTop - viewportHeight
    const bottom = scrollTop + viewportHeight * 2
    const pages: number[] = []
    for (let index = 0; index < layout.offsets.length; index += 1) {
      const start = layout.offsets[index]
      const end = start + layout.heights[index]
      if (end >= top && start <= bottom) pages.push(index + 1)
    }
    return pages.length > 0 ? pages : [1]
  }, [doc, mode, currentPage, layout, scrollTop, viewportHeight])

  // Which page the reader is looking at, derived from the same layout.
  useEffect(() => {
    if (mode !== 'continuous' || layout.offsets.length === 0) return
    const middle = scrollTop + viewportHeight / 2
    let closest = 1
    let best = Infinity
    for (let index = 0; index < layout.offsets.length; index += 1) {
      const centre = layout.offsets[index] + layout.heights[index] / 2
      const distance = Math.abs(centre - middle)
      if (distance < best) {
        best = distance
        closest = index + 1
      }
    }
    setCurrentPage(closest)
  }, [mode, layout, scrollTop, viewportHeight, setCurrentPage])

  /** Moves to the next or previous hit, wrapping at both ends. */
  const step = (delta: number): void => {
    if (!hits || hits.length === 0) return
    const next = (hitIndex + delta + hits.length) % hits.length
    setHitIndex(next)
    goToPage(hits[next].pageNumber)
  }

  /**
   * Which occurrence on a given page is the active one — the text layer counts
   * matches per page, so a document-wide index has to be rebased.
   */
  const activeOnPage = (pageNumber: number): number | undefined => {
    if (!hits || hits.length === 0) return undefined
    const current = hits[hitIndex]
    if (!current || current.pageNumber !== pageNumber) return undefined
    return hits.filter((hit, index) => hit.pageNumber === pageNumber && index < hitIndex).length
  }

  const goToPage = (pageNumber: number): void => {
    const clamped = clamp(pageNumber, 1, doc?.pageCount ?? 1)
    setCurrentPage(clamped)
    const offset = layout.offsets[clamped - 1]
    if (mode === 'continuous' && offset !== undefined) {
      scrollRef.current?.scrollTo({ top: offset, behavior: 'smooth' })
    }
  }

  // Reading position, remembered per file on this machine and offered back
  // once the layout knows where the page is. Only after the first page:
  // resuming at page 1 is not resuming.
  useEffect(() => {
    if (!doc?.path || resumedFor.current === doc.id) return
    let saved = 0
    try {
      saved = Number(localStorage.getItem(`alcode.lastPage:${doc.path}`) ?? 0)
    } catch {
      return
    }
    if (!(saved > 1 && saved <= doc.pageCount)) {
      resumedFor.current = doc.id
      return
    }
    if (mode === 'continuous' && layout.offsets[saved - 1] === undefined) return
    resumedFor.current = doc.id
    goToPage(saved)
    notify({ kind: 'info', title: t('viewer.resumed', { n: saved }) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, layout, mode])

  useEffect(() => {
    if (!doc?.path || resumedFor.current !== doc.id) return
    try {
      if (currentPage > 1) localStorage.setItem(`alcode.lastPage:${doc.path}`, String(currentPage))
      else localStorage.removeItem(`alcode.lastPage:${doc.path}`)
    } catch {
      // Storage full or disabled: the position is a convenience.
    }
  }, [doc, currentPage])

  // Stop reading aloud when the document goes away or the view unmounts.
  useEffect(() => () => speech?.stop(), [speech])
  useEffect(() => {
    speech?.stop()
    setSpeech(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id])

  const toggleReadAloud = async (): Promise<void> => {
    if (speech) {
      speech.stop()
      setSpeech(null)
      return
    }
    if (!doc) return
    const page = await doc.proxy.getPage(currentPage)
    const content = await page.getTextContent()
    const text = content.items
      .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : ''))
      .join(' ')
    const handle = speak(text, { onEnd: () => setSpeech(null) })
    if (!handle) {
      notify({ kind: 'info', title: t('viewer.noVoice') })
      return
    }
    setSpeech(handle)
  }

  /**
   * Snapshot: drag a rectangle over the page and the pixels under it go to
   * the clipboard as a PNG. Coordinates are kept relative to the scrolling
   * area so the rubber band survives a scroll mid-drag.
   */
  const areaPoint = (event: React.MouseEvent): { x: number; y: number } => {
    const area = scrollRef.current!
    const rect = area.getBoundingClientRect()
    return { x: event.clientX - rect.left + area.scrollLeft, y: event.clientY - rect.top + area.scrollTop }
  }

  const onSnapDown = (event: React.MouseEvent): void => {
    if (!snapshot || event.button !== 0) return
    event.preventDefault()
    dragStart.current = areaPoint(event)
    setRubber({ ...dragStart.current, left: dragStart.current.x, top: dragStart.current.y, width: 0, height: 0 })
  }

  const onSnapMove = (event: React.MouseEvent): void => {
    if (!snapshot || !dragStart.current) return
    const point = areaPoint(event)
    setRubber({
      left: Math.min(point.x, dragStart.current.x),
      top: Math.min(point.y, dragStart.current.y),
      width: Math.abs(point.x - dragStart.current.x),
      height: Math.abs(point.y - dragStart.current.y)
    })
  }

  const onSnapUp = async (): Promise<void> => {
    if (!snapshot || !dragStart.current) return
    dragStart.current = null
    const box = rubber
    setRubber(null)
    setSnapshot(false)
    const area = scrollRef.current
    if (!box || !area || box.width < 4 || box.height < 4) return

    const areaRect = area.getBoundingClientRect()
    const output = document.createElement('canvas')
    // Device pixels: the page canvas is rendered at the display ratio, so
    // the copy keeps that sharpness rather than the CSS size.
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    output.width = Math.round(box.width * ratio)
    output.height = Math.round(box.height * ratio)
    const context = output.getContext('2d')
    if (!context) return
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, output.width, output.height)

    let painted = false
    for (const canvas of Array.from(area.querySelectorAll<HTMLCanvasElement>('.pdf-page canvas'))) {
      const rect = canvas.getBoundingClientRect()
      // Page position in the same area-relative space as the box.
      const left = rect.left - areaRect.left + area.scrollLeft
      const top = rect.top - areaRect.top + area.scrollTop
      const x1 = Math.max(box.left, left)
      const y1 = Math.max(box.top, top)
      const x2 = Math.min(box.left + box.width, left + rect.width)
      const y2 = Math.min(box.top + box.height, top + rect.height)
      if (x2 <= x1 || y2 <= y1) continue
      const scaleX = canvas.width / rect.width
      const scaleY = canvas.height / rect.height
      context.drawImage(
        canvas,
        (x1 - left) * scaleX,
        (y1 - top) * scaleY,
        (x2 - x1) * scaleX,
        (y2 - y1) * scaleY,
        (x1 - box.left) * ratio,
        (y1 - box.top) * ratio,
        (x2 - x1) * ratio,
        (y2 - y1) * ratio
      )
      painted = true
    }
    if (!painted) return

    const blob = await new Promise<Blob | null>((resolve) => output.toBlob(resolve, 'image/png'))
    if (!blob) return
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      notify({ kind: 'success', title: t('viewer.snapshotCopied') })
    } catch (error) {
      notify({ kind: 'error', title: String((error as Error).message ?? error) })
    }
  }

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

  return (
    <div className="view flush" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="toolbar">
        {/* "Previous" points toward the start of the reading direction, which
            is the right edge in Arabic and the left edge in English. */}
        <Button
          size="sm"
          icon
          variant="ghost"
          title={t('viewer.previousPage')}
          aria-label={t('viewer.previousPage')}
          onClick={() => goToPage(currentPage - 1)}
        >
          {rightToLeft ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </Button>
        <div className="row" style={{ gap: 6 }}>
          <input
            className="input"
            style={{ width: 56, height: 28, textAlign: 'center' }}
            value={currentPage}
            aria-label={t('viewer.pageNumber')}
            dir="ltr"
            onChange={(event) => {
              const value = Number(event.target.value)
              if (Number.isFinite(value)) goToPage(value)
            }}
          />
          <span className="muted">
            {t('viewer.of')} <span dir="ltr">{doc.pageCount}</span>
          </span>
        </div>
        <Button
          size="sm"
          icon
          variant="ghost"
          title={t('viewer.nextPage')}
          aria-label={t('viewer.nextPage')}
          onClick={() => goToPage(currentPage + 1)}
        >
          {rightToLeft ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
        </Button>

        <span className="sep" />

        <Button
          size="sm"
          icon
          variant="ghost"
          title={t('viewer.zoomOut')}
          aria-label={t('viewer.zoomOut')}
          onClick={() => {
            setFit('custom')
            setZoom((value) => clamp(value - 0.15, 0.15, 6))
          }}
        >
          <Minus size={15} />
        </Button>
        <span className="mono muted" style={{ minWidth: 46, textAlign: 'center' }}>
          {Math.round(zoom * 100)}%
        </span>
        <Button
          size="sm"
          icon
          variant="ghost"
          title={t('viewer.zoomIn')}
          aria-label={t('viewer.zoomIn')}
          onClick={() => {
            setFit('custom')
            setZoom((value) => clamp(value + 0.15, 0.15, 6))
          }}
        >
          <Plus size={15} />
        </Button>

        <Segmented
          value={fit}
          onChange={setFit}
          options={[
            { value: 'width', label: '', icon: <Maximize2 size={14} /> },
            { value: 'page', label: '', icon: <Square size={13} /> },
            { value: 'custom', label: '100%' }
          ]}
        />

        <span className="sep" />

        <Button
          size="sm"
          icon
          variant="ghost"
          title={t('viewer.rotateView')}
          aria-label={t('viewer.rotateView')}
          onClick={() => setRotation((value) => (value + 90) % 360)}
        >
          <RotateCw size={15} />
        </Button>

        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'continuous', label: '', icon: <ScrollText size={14} /> },
            { value: 'single', label: '', icon: <FileText size={14} /> }
          ]}
        />

        <span className="sep" />

        <div title={t('viewer.reading')}>
          <Segmented
            value={reading}
            onChange={setReading}
            options={[
              { value: 'normal', label: '', icon: <Sun size={14} /> },
              { value: 'sepia', label: '', icon: <BookOpen size={14} /> },
              { value: 'night', label: '', icon: <Moon size={14} /> }
            ]}
          />
        </div>

        <span className="sep" />

        <Button
          size="sm"
          icon
          variant={snapshot ? 'primary' : 'ghost'}
          title={`${t('viewer.snapshot')} — ${t('viewer.snapshotHint')}`}
          aria-label={t('viewer.snapshot')}
          aria-pressed={snapshot}
          onClick={() => {
            setSnapshot((value) => !value)
            setRubber(null)
            dragStart.current = null
          }}
        >
          <Camera size={15} />
        </Button>
        <Button
          size="sm"
          icon
          variant={speech ? 'primary' : 'ghost'}
          title={speech ? t('viewer.stopReading') : t('viewer.readAloud')}
          aria-label={speech ? t('viewer.stopReading') : t('viewer.readAloud')}
          onClick={() => void toggleReadAloud()}
        >
          {speech ? <VolumeX size={15} /> : <Volume2 size={15} />}
        </Button>

        <span className="spacer" />

        <Button
          size="sm"
          variant={searchOpen ? 'primary' : 'ghost'}
          onClick={() => setSearchOpen((open) => !open)}
        >
          <Search size={15} />
          {t('viewer.search')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon
          title={t('action.print')}
          aria-label={t('action.print')}
          onClick={() => setPrintOpen(true)}
        >
          <Printer size={15} />
        </Button>
      </div>

      {searchOpen ? (
        <div className="toolbar" style={{ borderTop: 'none' }}>
          <div style={{ flex: 1, maxWidth: 420 }}>
            <TextInput
              autoFocus
              value={query}
              onChange={setQuery}
              placeholder={t('viewer.searchPlaceholder')}
              onEnter={async () => {
                setSearching(true)
                try {
                  const found = await searchDocument(doc.proxy, query)
                  setHits(found)
                  setHitIndex(0)
                  if (found.length > 0) goToPage(found[0].pageNumber)
                } finally {
                  setSearching(false)
                }
              }}
            />
          </div>
          <span className="muted" dir="ltr">
            {searching
              ? t('msg.loading')
              : hits
                ? hits.length === 0
                  ? t('viewer.noResults')
                  : `${hitIndex + 1} / ${hits.length}`
                : ''}
          </span>
          {hits && hits.length > 0 ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                icon
                title={t('viewer.previousMatch')}
                aria-label={t('viewer.previousMatch')}
                onClick={() => step(-1)}
              >
                <ChevronUp size={15} />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon
                title={t('viewer.nextMatch')}
                aria-label={t('viewer.nextMatch')}
                onClick={() => step(1)}
              >
                <ChevronDown size={15} />
              </Button>
            </>
          ) : null}
          <span className="spacer" />
          <Button
            size="sm"
            variant="ghost"
            icon
            title={t('action.close')}
            aria-label={t('action.close')}
            onClick={() => {
              setSearchOpen(false)
              setHits(null)
              setHitIndex(0)
            }}
          >
            <X size={15} />
          </Button>
        </div>
      ) : null}

      {hits && hits.length > 0 ? (
        <div style={{ maxHeight: 148, overflowY: 'auto', borderBottom: '1px solid var(--hairline-soft)' }}>
          {hits.slice(0, 60).map((hit, index) => (
            <button
              key={index}
              className={`list-row${index === hitIndex ? ' active' : ''}`}
              style={{ width: '100%', textAlign: 'start' }}
              onClick={() => {
                setHitIndex(index)
                goToPage(hit.pageNumber)
              }}
            >
              <span className="badge accent">{hit.pageNumber}</span>
              <span className="grow truncate">{hit.snippet}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="workspace">
        <aside className="rail">
          <Segmented
            value={railTab}
            onChange={setRailTab}
            options={[
              { value: 'thumbs', label: '', icon: <FileText size={14} /> },
              { value: 'outline', label: '', icon: <ListTree size={14} /> }
            ]}
          />
          {railTab === 'thumbs'
            ? Array.from({ length: doc.pageCount }, (_, index) => (
                <Thumbnail
                  key={index}
                  proxy={doc.proxy}
                  pageNumber={index + 1}
                  version={doc.version}
                  active={currentPage === index + 1}
                  onClick={() => goToPage(index + 1)}
                />
              ))
            : outline.length === 0
              ? <p className="muted center" style={{ fontSize: 'var(--text-sm)' }}>{t('viewer.noOutline')}</p>
              : outline.map((node, index) => (
                  <button
                    key={index}
                    className="nav-item"
                    onClick={() => node.pageNumber && goToPage(node.pageNumber)}
                  >
                    <span className="truncate">{node.title}</span>
                  </button>
                ))}
        </aside>

        <div
          className={`canvas-area reading-${reading}${snapshot ? ' snapping' : ''}`}
          ref={scrollRef}
          onMouseDown={onSnapDown}
          onMouseMove={onSnapMove}
          onMouseUp={() => void onSnapUp()}
        >
          {rubber ? <div className="snap-rubber" style={rubber} /> : null}
          {mode === 'continuous' ? (
            <div className="page-stack virtual" style={{ height: layout.total }}>
              {visiblePages.map((pageNumber) => (
                <div
                  key={pageNumber}
                  className="page-slot"
                  style={{ top: layout.offsets[pageNumber - 1] ?? 0 }}
                >
                  <PdfPageView
                    proxy={doc.proxy}
                    pageNumber={pageNumber}
                    scale={zoom}
                    rotation={rotation}
                    version={doc.version}
                    selectable
                    highlight={hits && hits.length > 0 ? query : undefined}
                    activeMatch={activeOnPage(pageNumber)}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="page-stack">
              <PdfPageView
                proxy={doc.proxy}
                pageNumber={currentPage}
                scale={zoom}
                rotation={rotation}
                version={doc.version}
                selectable
                highlight={hits && hits.length > 0 ? query : undefined}
                activeMatch={activeOnPage(currentPage)}
              />
            </div>
          )}
        </div>
      </div>

      <PrintDialog open={printOpen} onClose={() => setPrintOpen(false)} />
    </div>
  )
}
