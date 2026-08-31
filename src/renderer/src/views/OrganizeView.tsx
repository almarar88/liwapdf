import { useEffect, useRef, useState } from 'react'
import {
  Copy,
  FileOutput,
  FilePlus2,
  FileText,
  FlipVertical2,
  RotateCcw,
  RotateCw,
  Trash2,
  CheckSquare,
  Square
} from 'lucide-react'
import { useApp } from '../store/app'
import { useDocumentActions } from '../hooks/useDocumentActions'
import { Button, Empty } from '../components/ui'
import { Thumbnail } from '../components/Thumbnail'
import { FILTERS, pickOneFile, saveBytes } from '../lib/files'
import { stripExtension } from '../lib/format'
import * as ops from '../lib/pdf/ops'

export function OrganizeView(): React.JSX.Element {
  const t = useApp((state) => state.t)
  const doc = useApp((state) => state.doc)
  const selected = useApp((state) => state.selectedPages)
  const setSelectedPages = useApp((state) => state.setSelectedPages)
  const togglePageSelection = useApp((state) => state.togglePageSelection)
  const applyPdfBytes = useApp((state) => state.applyPdfBytes)
  const setBusy = useApp((state) => state.setBusy)
  const notify = useApp((state) => state.notify)
  const reportError = useApp((state) => state.reportError)
  const { openDialog } = useDocumentActions()

  const [order, setOrder] = useState<number[]>([])
  const dragIndex = useRef<number | null>(null)

  // Keyed on the document's identity, not on two of its numbers: a different
  // file with the same page count and version would otherwise inherit the
  // previous document's page order.
  const documentKey = doc ? `${doc.id}:${doc.version}` : null
  useEffect(() => {
    if (doc) setOrder(Array.from({ length: doc.pageCount }, (_, index) => index))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentKey])

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

  const run = async (label: string, action: () => Promise<void>): Promise<void> => {
    setBusy({ label, progress: null })
    try {
      await action()
    } catch (error) {
      reportError(error)
    } finally {
      setBusy(null)
    }
  }

  const orderChanged = order.some((pageIndex, position) => pageIndex !== position)

  const applyOrder = (next: number[]): void => {
    setOrder(next)
  }

  const commitOrder = (): Promise<void> =>
    run(t('msg.working'), async () => {
      const next = await ops.reorderPages(doc.bytes, order, doc.password)
      await applyPdfBytes(next)
    })

  const selectedOriginals = selected

  return (
    <div className="view">
      <div className="page-head">
        <div>
          <h1>{t('organize.title')}</h1>
          <p>{t('organize.sub')}</p>
        </div>
        <div className="spacer" />
        <span className="badge accent">
          {selected.length} {t('organize.selected')}
        </span>
      </div>

      <div className="toolbar" style={{ borderRadius: 'var(--r-md)', border: '1px solid var(--hairline-soft)', marginBottom: 18 }}>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            setSelectedPages(
              selected.length === doc.pageCount
                ? []
                : Array.from({ length: doc.pageCount }, (_, index) => index)
            )
          }
        >
          {selected.length === doc.pageCount ? <Square size={15} /> : <CheckSquare size={15} />}
          {t('action.selectAll')}
        </Button>

        <span className="sep" />

        <Button
          size="sm"
          variant="ghost"
          disabled={selected.length === 0}
          title={t('organize.rotateLeft')}
          onClick={() =>
            void run(t('msg.working'), async () => {
              const next = await ops.rotatePages(doc.bytes, selectedOriginals, -90, doc.password)
              await applyPdfBytes(next)
            })
          }
        >
          <RotateCcw size={15} />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={selected.length === 0}
          title={t('organize.rotateRight')}
          onClick={() =>
            void run(t('msg.working'), async () => {
              const next = await ops.rotatePages(doc.bytes, selectedOriginals, 90, doc.password)
              await applyPdfBytes(next)
            })
          }
        >
          <RotateCw size={15} />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={selected.length === 0}
          title={t('organize.duplicate')}
          onClick={() =>
            void run(t('msg.working'), async () => {
              const next = await ops.duplicatePages(doc.bytes, selectedOriginals, doc.password)
              await applyPdfBytes(next)
            })
          }
        >
          <Copy size={15} />
        </Button>
        <Button
          size="sm"
          variant="danger"
          ghostDanger
          disabled={selected.length === 0 || selected.length >= doc.pageCount}
          title={t('organize.delete')}
          onClick={() =>
            void run(t('msg.working'), async () => {
              const count = selectedOriginals.length
              const next = await ops.deletePages(doc.bytes, selectedOriginals, doc.password)
              await applyPdfBytes(next)
              notify({ kind: 'success', title: t('msg.pagesRemoved', { n: count }) })
            })
          }
        >
          <Trash2 size={15} />
        </Button>

        <span className="sep" />

        <Button
          size="sm"
          variant="ghost"
          disabled={selected.length === 0}
          onClick={() =>
            void run(t('msg.working'), async () => {
              const extracted = await ops.extractPages(doc.bytes, selectedOriginals, doc.password)
              const outcome = await saveBytes(
                extracted,
                `${stripExtension(doc.name)}-extract.pdf`,
                FILTERS.pdf
              )
              if (outcome.saved) {
                notify({ kind: 'success', title: t('msg.saved'), message: outcome.path })
              }
            })
          }
        >
          <FileOutput size={15} />
          {t('organize.extract')}
        </Button>

        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            void run(t('msg.working'), async () => {
              const at = selected.length > 0 ? selected[selected.length - 1] + 1 : doc.pageCount
              const next = await ops.insertBlankPage(doc.bytes, at, null, doc.password)
              await applyPdfBytes(next)
              notify({ kind: 'success', title: t('msg.pagesAdded', { n: 1 }) })
            })
          }
        >
          <FilePlus2 size={15} />
          {t('organize.insertBlank')}
        </Button>

        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            const picked = await pickOneFile(FILTERS.pdf)
            if (!picked) return
            await run(t('msg.working'), async () => {
              const at = selected.length > 0 ? selected[selected.length - 1] + 1 : doc.pageCount
              const next = await ops.insertDocument(doc.bytes, picked.data, at, doc.password)
              await applyPdfBytes(next)
            })
          }}
        >
          <FileText size={15} />
          {t('organize.insertFile')}
        </Button>

        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            void run(t('msg.working'), async () => {
              const next = await ops.reversePages(doc.bytes, doc.password)
              await applyPdfBytes(next)
            })
          }
        >
          <FlipVertical2 size={15} />
          {t('organize.reverse')}
        </Button>

        <span className="spacer" />

        {orderChanged ? (
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setOrder(Array.from({ length: doc.pageCount }, (_, index) => index))}
            >
              {t('action.reset')}
            </Button>
            <Button size="sm" variant="primary" onClick={() => void commitOrder()}>
              {t('action.apply')}
            </Button>
          </>
        ) : (
          <span className="muted" style={{ fontSize: 'var(--text-sm)' }}>
            {t('organize.dragHint')}
          </span>
        )}
      </div>

      <div
        className="grid"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 16 }}
      >
        {order.map((pageIndex, position) => (
          <Thumbnail
            key={`${pageIndex}-${position}`}
            proxy={doc.proxy}
            pageNumber={pageIndex + 1}
            version={doc.version}
            selectable
            selected={selected.includes(pageIndex)}
            label={t('organize.pageTile', { page: String(pageIndex + 1) })}
            onClick={() => togglePageSelection(pageIndex)}
            onMove={(direction) => {
              const target = position + direction
              if (target < 0 || target >= order.length) return
              const next = [...order]
              const [moved] = next.splice(position, 1)
              next.splice(target, 0, moved)
              applyOrder(next)
            }}
            draggable
            onDragStart={() => {
              dragIndex.current = position
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              const from = dragIndex.current
              dragIndex.current = null
              if (from === null || from === position) return
              const next = [...order]
              const [moved] = next.splice(from, 1)
              next.splice(position, 0, moved)
              applyOrder(next)
            }}
          />
        ))}
      </div>
    </div>
  )
}
