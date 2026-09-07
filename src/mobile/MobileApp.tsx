import { useEffect, useState } from 'react'
import { Camera } from 'lucide-react'
import App from '../renderer/src/App'
import { useApp } from '../renderer/src/store/app'
import { usePhone } from '../renderer/src/hooks/usePhone'
import { ScanSheet } from './ScanSheet'
import { PhoneNav } from './PhoneNav'
import { takePendingMobileFile } from './bridge'
import { tapFeedback } from './shell'

/**
 * The desktop app, plus the two things only a phone can do: point a camera at
 * a piece of paper, and receive a document another app just shared.
 *
 * Both are additions around the existing App rather than changes inside it,
 * so the desktop build stays exactly as it was and there is one codebase to
 * keep honest.
 */
export function MobileApp(): React.JSX.Element {
  const t = useApp((state) => state.t)
  const openPdfBytes = useApp((state) => state.openPdfBytes)
  const notify = useApp((state) => state.notify)
  const [scanning, setScanning] = useState(false)
  const phone = usePhone()

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

  return (
    <>
      <App />
      {/* A phone navigates from its own bottom bar, which carries the camera.
          A tablet keeps the side rail, so scanning gets a floating button. */}
      {phone ? (
        <PhoneNav onScan={() => setScanning(true)} />
      ) : (
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
      )}
      <ScanSheet open={scanning} onClose={() => setScanning(false)} />
    </>
  )
}
