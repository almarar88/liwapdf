import { useEffect, useState } from 'react'
import { Printer } from 'lucide-react'
import type { PrinterOption } from '@shared/types'
import { useApp } from '../store/app'
import { Button, Checkbox, Field, Modal, Select, TextInput } from '../components/ui'
import { openForRender } from '../lib/pdf/pdfjs'
import { renderPage } from '../lib/pdf/render'
import { parsePageRange } from '../lib/format'

/**
 * Sends the open document to a printer.
 *
 * The old Print button wrote a temp copy and asked the OS to open it — and
 * since this app registers itself for .pdf, that frequently just re-opened the
 * file in Alcode. This rasterises the requested pages at print resolution and
 * hands them to the platform print dialog through the main process.
 */
export function PrintDialog({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): React.JSX.Element {
  const t = useApp((state) => state.t)
  const doc = useApp((state) => state.doc)
  const setBusy = useApp((state) => state.setBusy)
  const notify = useApp((state) => state.notify)
  const reportError = useApp((state) => state.reportError)

  const [printers, setPrinters] = useState<PrinterOption[]>([])
  const [device, setDevice] = useState('')
  const [range, setRange] = useState('')
  const [copies, setCopies] = useState('1')
  const [color, setColor] = useState(true)

  useEffect(() => {
    if (!open) return
    void window.alcode.print
      .printers()
      .then((found) => {
        setPrinters(found)
        setDevice(found.find((printer) => printer.isDefault)?.name ?? found[0]?.name ?? '')
      })
      .catch(() => setPrinters([]))
  }, [open])

  const run = async (): Promise<void> => {
    if (!doc) return
    const indices = parsePageRange(range, doc.pageCount)
    if (indices.length === 0) return

    setBusy({ label: t('print.preparing'), progress: 0 })
    const proxy = await openForRender(doc.bytes, doc.password)
    try {
      const pages: { dataUrl: string; widthPt: number; heightPt: number }[] = []
      // One canvas for the run: a page at 200 DPI is four megapixels, and a
      // fresh one per page leaves that behind for every page printed.
      const canvas = document.createElement('canvas')
      for (const [position, index] of indices.entries()) {
        setBusy({ label: t('print.preparing'), progress: position / indices.length })
        const page = await proxy.getPage(index + 1)
        const box = page.getViewport({ scale: 1 })
        const rendered = await renderPage(proxy, index + 1, 200 / 72, canvas)
        pages.push({
          dataUrl: rendered.canvas.toDataURL('image/jpeg', 0.92),
          widthPt: Math.round(box.width),
          heightPt: Math.round(box.height)
        })
        page.cleanup()
      }

      setBusy({ label: t('print.sending'), progress: null })
      const sent = await window.alcode.print.job({
        pages,
        copies: Math.max(1, Number(copies) || 1),
        color,
        deviceName: device || undefined,
        silent: false
      })
      if (sent) {
        notify({ kind: 'success', title: t('print.sent', { n: pages.length }) })
        onClose()
      }
    } catch (error) {
      reportError(error)
    } finally {
      await proxy.destroy().catch(() => undefined)
      setBusy(null)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t('action.print')}>
      <div className="stack">
        <Field label={t('print.printer')}>
          <Select
            value={device}
            onChange={setDevice}
            options={
              printers.length > 0
                ? printers.map((printer) => ({ value: printer.name, label: printer.displayName }))
                : [{ value: '', label: t('print.systemDefault') }]
            }
          />
        </Field>

        <Field label={t('opt.range')} hint={t('opt.rangeHint')}>
          <TextInput value={range} onChange={setRange} placeholder="1-3, 5, 8-10" />
        </Field>

        <Field label={t('print.copies')}>
          <TextInput value={copies} onChange={setCopies} type="number" min={1} max={99} />
        </Field>

        <Checkbox checked={color} onChange={setColor} label={t('print.color')} />

        <Button variant="primary" onClick={() => void run()}>
          <Printer size={15} />
          {t('action.print')}
        </Button>
      </div>
    </Modal>
  )
}
