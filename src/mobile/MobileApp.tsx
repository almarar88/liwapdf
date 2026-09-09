import { useEffect, useState } from 'react'
import { Camera } from 'lucide-react'
import App from '../renderer/src/App'
import { useApp } from '../renderer/src/store/app'
import { usePhone } from '../renderer/src/hooks/usePhone'
import { ScanSheet } from './ScanSheet'
import { ScanModes } from './ScanModes'
import { EditSheet, ConvertSheet, NoticesSheet } from './ActionSheets'
import { AskAiSheet } from './AskAiSheet'
import { PhoneHome, type Sheet } from './PhoneHome'
import { PhoneFiles } from './PhoneFiles'
import { PhoneNav } from './PhoneNav'
import { takePendingMobileFile } from './bridge'
import { tapFeedback } from './shell'

/**
 * The desktop app, plus the two things only a phone can do — point a camera at
 * the world, and receive a document another app just shared — and the one
 * screen a phone genuinely needs of its own.
 *
 * Everything past the home screen is the same application the desktop runs:
 * the same viewer, the same editor, the same thirty-three tools. What differs
 * is the way in, which is the part a 6-inch screen actually changes.
 */
export function MobileApp(): React.JSX.Element {
  const t = useApp((state) => state.t)
  const openPdfBytes = useApp((state) => state.openPdfBytes)
  const notify = useApp((state) => state.notify)
  const readNotices = useApp((state) => state.readNotices)
  const phone = usePhone()
  const [sheet, setSheet] = useState<Sheet>(null)
  const [scanning, setScanning] = useState(false)

  // A document opened from a file manager, mail or a share sheet.
  useEffect(() => {
    let cancelled = false
    const absorb = async (): Promise<void> => {
      const file = takePendingMobileFile()
      if (!file || cancelled) return
      const { openAnyBytes } = await import('./openIncoming')
      await openAnyBytes(file.name, file.bytes).catch((error: unknown) => {
        notify({ kind: 'error', title: t('msg.error'), message: String(error) })
      })
    }
    void absorb()
    const timer = window.setInterval(() => void absorb(), 1200)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [openPdfBytes, notify, t])

  const show = (next: Sheet): void => {
    if (next === 'notices') readNotices()
    setSheet(next)
  }
  const close = (): void => setSheet(null)

  return (
    <>
      <App home={phone ? <PhoneHome onSheet={show} /> : undefined} />

      {phone ? (
        <>
          <PhoneNav onFiles={() => show('files')} onScan={() => show('scan')} />
          <PhoneFiles open={sheet === 'files'} onClose={close} />
          <ScanModes open={sheet === 'scan'} onClose={close} />
          <EditSheet open={sheet === 'edit'} onClose={close} />
          <ConvertSheet open={sheet === 'convert'} onClose={close} />
          <AskAiSheet open={sheet === 'ai'} onClose={close} />
          <NoticesSheet open={sheet === 'notices'} onClose={close} />
        </>
      ) : (
        <>
          {/* A tablet keeps the desktop sidebar, so scanning gets a button. */}
          <button
            className="scan-fab"
            title={t('scan.title')}
            aria-label={t('scan.title')}
            onClick={() => {
              tapFeedback('medium')
              setScanning(true)
            }}
          >
            <Camera size={22} />
          </button>
          <ScanSheet open={scanning} onClose={() => setScanning(false)} />
        </>
      )}
    </>
  )
}
