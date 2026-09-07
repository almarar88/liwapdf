import { useState } from 'react'
import { Camera, Check, FileDown, Share2, Trash2 } from 'lucide-react'
import { useApp } from '../renderer/src/store/app'
import { Button, Checkbox, Field, Modal, Segmented } from '../renderer/src/components/ui'
import { capturePage, pagesToPdf } from './scan'
import { tapFeedback } from './shell'

/**
 * Scanning, as a phone does it: shoot, see the page appear, shoot again,
 * then save one PDF. The list of captured pages is the whole interface —
 * there is nothing to configure before starting, because the moment the
 * paper is in front of the camera is the moment the user wants to shoot.
 */
export function ScanSheet({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element {
  const t = useApp((state) => state.t)
  const notify = useApp((state) => state.notify)
  const openBytes = useApp((state) => state.openPdfBytes)
  const [pages, setPages] = useState<{ bytes: Uint8Array; url: string }[]>([])
  const [enhance, setEnhance] = useState(true)
  const [size, setSize] = useState<'A4' | 'Letter' | 'auto'>('A4')
  const [busy, setBusy] = useState(false)

  const shoot = async (): Promise<void> => {
    const bytes = await capturePage()
    if (!bytes) return
    tapFeedback()
    setPages((current) => [...current, { bytes, url: URL.createObjectURL(new Blob([bytes as BlobPart])) }])
  }

  const discard = (index: number): void => {
    setPages((current) => {
      URL.revokeObjectURL(current[index].url)
      return current.filter((_, at) => at !== index)
    })
  }

  const finish = async (andShare: boolean): Promise<void> => {
    if (pages.length === 0) return
    setBusy(true)
    try {
      const result = await pagesToPdf(
        pages.map((page) => page.bytes),
        { enhance, pageSize: size }
      )
      const name = `scan-${new Date().toISOString().slice(0, 10)}.pdf`
      if (andShare) {
        await window.alcode.fs.write(`alcode://save/${encodeURIComponent(name)}`, result.bytes)
        await window.alcode.shell.reveal('')
        notify({ kind: 'success', title: t('scan.saved', { n: result.pages }) })
      } else {
        await openBytes(name, result.bytes, null)
      }
      for (const page of pages) URL.revokeObjectURL(page.url)
      setPages([])
      onClose()
    } catch (error) {
      notify({ kind: 'error', title: t('msg.error'), message: String((error as Error)?.message ?? error) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t('scan.title')}>
      <div className="stack">
        <p className="muted">{t('scan.hint')}</p>

        {pages.length > 0 ? (
          <div className="scan-strip">
            {pages.map((page, index) => (
              <div className="scan-page" key={page.url}>
                <img src={page.url} alt={t('scan.page', { n: index + 1 })} />
                <span className="scan-number">{index + 1}</span>
                <button
                  className="scan-drop"
                  title={t('action.remove')}
                  aria-label={t('action.remove')}
                  onClick={() => discard(index)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <Button block variant={pages.length === 0 ? 'primary' : undefined} onClick={() => void shoot()}>
          <Camera size={16} />
          {pages.length === 0 ? t('scan.first') : t('scan.another')}
        </Button>

        {pages.length > 0 ? (
          <>
            <Field label={t('convert.pageSize')}>
              <Segmented
                value={size}
                onChange={setSize}
                options={[
                  { value: 'A4', label: 'A4' },
                  { value: 'Letter', label: 'Letter' },
                  { value: 'auto', label: t('convert.fit.actual') }
                ]}
              />
            </Field>
            <Checkbox checked={enhance} onChange={setEnhance} label={t('scan.enhance')} />
            <div className="row" style={{ gap: 8 }}>
              <Button variant="primary" disabled={busy} onClick={() => void finish(false)}>
                <Check size={16} />
                {t('scan.open')}
              </Button>
              <Button disabled={busy} onClick={() => void finish(true)}>
                <Share2 size={16} />
                {t('scan.share')}
              </Button>
            </div>
          </>
        ) : (
          <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>
            <FileDown size={13} style={{ verticalAlign: '-2px', marginInlineEnd: 4 }} />
            {t('scan.note')}
          </p>
        )}
      </div>
    </Modal>
  )
}
