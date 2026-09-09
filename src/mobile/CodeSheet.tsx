import { useState } from 'react'
import { Camera, Copy, ExternalLink, QrCode, Wifi, UserRound, Mail, Phone } from 'lucide-react'
import { useApp } from '../renderer/src/store/app'
import { Button, Modal } from '../renderer/src/components/ui'
import { readCode, wifiName, type CodeResult } from '../renderer/src/lib/images/scancode'
import { capturePage } from './scan'
import { tapFeedback } from './shell'

/**
 * Reading a QR code with the camera.
 *
 * The decoder was already in the bundle — the app draws codes into documents
 * and its tests read them back — so the only thing missing was pointing the
 * camera at one. Everything happens on the device, which for a code is not a
 * privacy nicety but the difference between a Wi-Fi password staying in the
 * room and being posted to a scanner service.
 *
 * The result is offered as an action rather than a string: a link opens, a
 * number dials, a network name is copied. A code nobody can act on is a code
 * that was not worth scanning.
 */
export function CodeSheet({
  open,
  onClose,
  toCanvas
}: {
  open: boolean
  onClose: () => void
  toCanvas: (bytes: Uint8Array, maxEdge?: number) => Promise<HTMLCanvasElement>
}): React.JSX.Element {
  const t = useApp((state) => state.t)
  const notify = useApp((state) => state.notify)
  const [result, setResult] = useState<CodeResult | null>(null)
  const [missed, setMissed] = useState(false)
  const [busy, setBusy] = useState(false)

  const shoot = async (): Promise<void> => {
    const bytes = await capturePage()
    if (!bytes) return
    setBusy(true)
    setMissed(false)
    try {
      // Full resolution: a code at arm's length is small, and downscaling it
      // before the decoder sees it is what loses the modules.
      const canvas = await toCanvas(bytes, 2400)
      const found = readCode(canvas)
      if (found) tapFeedback('medium')
      setResult(found)
      setMissed(!found)
    } finally {
      setBusy(false)
    }
  }

  const copy = (text: string): void => {
    void navigator.clipboard.writeText(text)
    notify({ kind: 'success', title: t('code.copied') })
  }

  return (
    <Modal open={open} onClose={onClose} title={t('phone.scan.code')}>
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>{t('phone.scan.code.hint')}</p>

        <Button block variant="primary" disabled={busy} onClick={() => void shoot()}>
          <Camera size={16} />
          {busy ? t('msg.loading') : t('phone.scan.code.shoot')}
        </Button>

        {missed ? <p className="muted" style={{ margin: 0 }}>{t('code.none')}</p> : null}

        {result ? (
          <>
            <div className="code-result">
              <span className="code-kind">{glyph(result.kind)}</span>
              <div className="grow">
                <b>{t(LABEL[result.kind])}</b>
                <p dir="auto">
                  {result.kind === 'wifi' ? (wifiName(result.text) ?? result.text) : result.text}
                </p>
              </div>
            </div>

            <div className="row" style={{ gap: 8 }}>
              <Button onClick={() => copy(result.text)}>
                <Copy size={15} />
                {t('action.copy')}
              </Button>
              {result.kind === 'url' ? (
                <Button
                  variant="primary"
                  onClick={() => void window.alcode.shell.external(result.text)}
                >
                  <ExternalLink size={15} />
                  {t('code.open')}
                </Button>
              ) : null}
            </div>

            {result.kind === 'url' ? (
              // A scanned link is under the control of whoever printed the
              // sticker, so it is shown in full before it is followed.
              <p className="ai-privacy">
                <ExternalLink size={14} />
                {t('code.checkLink')}
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </Modal>
  )
}

const LABEL = {
  url: 'code.kind.url',
  phone: 'code.kind.phone',
  email: 'code.kind.email',
  wifi: 'code.kind.wifi',
  contact: 'code.kind.contact',
  text: 'code.kind.text'
} as const

function glyph(kind: CodeResult['kind']): React.JSX.Element {
  if (kind === 'url') return <ExternalLink size={18} />
  if (kind === 'wifi') return <Wifi size={18} />
  if (kind === 'contact') return <UserRound size={18} />
  if (kind === 'email') return <Mail size={18} />
  if (kind === 'phone') return <Phone size={18} />
  return <QrCode size={18} />
}
