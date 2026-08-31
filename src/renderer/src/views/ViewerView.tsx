import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
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
  Printer
} from 'lucide-react'
import { useApp } from '../store/app'
import { useDocumentActions } from '../hooks/useDocumentActions'
import { Button, Empty, Segmented, TextInput } from '../components/ui'
import { PdfPageView } from '../components/PdfPageView'
import { Thumbnail } from '../components/Thumbnail'
import { readOutline, searchDocument, type OutlineNode, type SearchHit } from '../lib/pdf/render'
import { clamp } from '../lib/format'

type FitMode = 'width' | 'page' | 'custom'

export function ViewerView(): React.JSX.Element {
  const t = useApp((state) => state.t)
  const doc = useApp((state) => state.doc)
  const currentPage = useApp((state) => state.currentPage)
  const setCurrentPage = useApp((state) => state.setCurrentPage)
  const { openDialog } = useDocumentActions()

  const [zoom, setZoom] = useState(1.1)
  const [fit, setFit] = useState<FitMode>('width')
  const [rotation, setRotation] = useState(0)
  const [mode, setMode] = useState<'continuous' | 'single'>('continuous')
  const [railTab, setRailTab] = useState<'thumbs' | 'outline'>('thumbs')
  const [outline, setOutline] = useState<OutlineNode[]>([])
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [searching, setSearching] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef(new Map<number, HTMLDivElement>())

  useEffect(() => {
    if (!doc) return
    readOutline(doc.proxy)
      .then(setOutline)
      .catch(() => setOutline([]))
  }, [doc])

  // Fit-to-width/page recomputes the zoom against the visible viewport.
  useEffect(() => {
    if (!doc || fit === 'custom') return undefined
    let cancelled = false

    const compute = async (): Promise<void> => {
      const container = scrollRef.current
      if (!container) return
      const page = await doc.proxy.getPage(Math.min(currentPage, doc.pageCount))
      if (cancelled) return
      const viewport = page.getViewport({ scale: 1, rotation: (page.rotate + rotation) % 360 })
      const available = container.clientWidth - 64
      const availableHeight = container.clientHeight - 64
      const next =
        fit === 'width'
          ? available / viewport.width
          : Math.min(available / viewport.width, availableHeight / viewport.height)
      setZoom(clamp(next, 0.15, 6))
    }

    void compute()
    const observer = new ResizeObserver(() => void compute())
    if (scrollRef.current) observer.observe(scrollRef.current)
    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [doc, fit, rotation, currentPage])

  // Track which page is centred while scrolling in continuous mode.
  useEffect(() => {
    const container = scrollRef.current
    if (!container || mode !== 'continuous') return undefined
    let frame = 0

    const onScroll = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const middle = container.scrollTop + container.clientHeight / 2
        let closest = 1
        let best = Infinity
        for (const [pageNumber, element] of pageRefs.current) {
          const distance = Math.abs(element.offsetTop + element.offsetHeight / 2 - middle)
          if (distance < best) {
            best = distance
            closest = pageNumber
          }
        }
        setCurrentPage(closest)
      })
    }

    container.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      container.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
    }
  }, [mode, setCurrentPage, doc])

  const goToPage = (pageNumber: number): void => {
    const clamped = clamp(pageNumber, 1, doc?.pageCount ?? 1)
    setCurrentPage(clamped)
    if (mode === 'continuous') {
      pageRefs.current.get(clamped)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  const visiblePages = useMemo(() => {
    if (!doc) return []
    return mode === 'single'
      ? [currentPage]
      : Array.from({ length: doc.pageCount }, (_, index) => index + 1)
  }, [doc, mode, currentPage])

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
        <Button size="sm" icon variant="ghost" onClick={() => goToPage(currentPage - 1)}>
          <ChevronRight size={16} />
        </Button>
        <div className="row" style={{ gap: 6 }}>
          <input
            className="input"
            style={{ width: 56, height: 28, textAlign: 'center' }}
            value={currentPage}
            onChange={(event) => {
              const value = Number(event.target.value)
              if (Number.isFinite(value)) goToPage(value)
            }}
          />
          <span className="muted">
            {t('viewer.of')} {doc.pageCount}
          </span>
        </div>
        <Button size="sm" icon variant="ghost" onClick={() => goToPage(currentPage + 1)}>
          <ChevronLeft size={16} />
        </Button>

        <span className="sep" />

        <Button
          size="sm"
          icon
          variant="ghost"
          title={t('viewer.zoomOut')}
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
          onClick={() => void window.alcode.fs.saveTempAndOpen(doc.name, doc.bytes)}
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
                  setHits(await searchDocument(doc.proxy, query))
                } finally {
                  setSearching(false)
                }
              }}
            />
          </div>
          <span className="muted">
            {searching
              ? t('msg.loading')
              : hits
                ? hits.length === 0
                  ? t('viewer.noResults')
                  : `${hits.length} ${t('viewer.results')}`
                : ''}
          </span>
          <span className="spacer" />
          <Button
            size="sm"
            variant="ghost"
            icon
            onClick={() => {
              setSearchOpen(false)
              setHits(null)
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
              className="list-row"
              style={{ width: '100%', textAlign: 'start' }}
              onClick={() => goToPage(hit.pageNumber)}
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

        <div className="canvas-area" ref={scrollRef}>
          <div className="page-stack">
            {visiblePages.map((pageNumber) => (
              <div
                key={pageNumber}
                ref={(element) => {
                  if (element) pageRefs.current.set(pageNumber, element)
                  else pageRefs.current.delete(pageNumber)
                }}
              >
                <PdfPageView
                  proxy={doc.proxy}
                  pageNumber={pageNumber}
                  scale={zoom}
                  rotation={rotation}
                  version={doc.version}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
