import { useState } from 'react'
import { Files, CreditCard, BookUser, Sigma, Hash, Ruler } from 'lucide-react'
import { useApp } from '../renderer/src/store/app'
import { Modal } from '../renderer/src/components/ui'
import { SheetCards, type SheetEntry } from './SheetCard'
import { ScanSheet } from './ScanSheet'
import { CardSheet, MathSheet, CountSheet, MeasureSheet } from './ScanFlows'

type Mode = 'documents' | 'id' | 'passport' | 'math' | 'count' | 'measure' | null

/**
 * What the camera is being pointed at.
 *
 * A scanner app that only scans documents wastes the other nine tenths of
 * what a camera and a processor can do with a picture of the physical world.
 * These six are the ones a person with a phone in an office, a warehouse or a
 * kitchen table full of homework actually needs, and all six run on the
 * device.
 */
export function ScanModes({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element {
  const t = useApp((state) => state.t)
  const [mode, setMode] = useState<Mode>(null)

  const pick = (next: Mode) => (): void => {
    onClose()
    setMode(next)
  }

  const entries: SheetEntry[] = [
    {
      key: 'documents',
      tone: 'blue',
      icon: <Files size={19} />,
      title: t('phone.scan.documents'),
      detail: t('phone.scan.documents.d'),
      run: pick('documents')
    },
    {
      key: 'id',
      tone: 'green',
      icon: <CreditCard size={19} />,
      title: t('phone.scan.id'),
      detail: t('phone.scan.id.d'),
      run: pick('id')
    },
    {
      key: 'passport',
      tone: 'green',
      icon: <BookUser size={19} />,
      title: t('phone.scan.passport'),
      detail: t('phone.scan.passport.d'),
      run: pick('passport')
    },
    {
      key: 'math',
      tone: 'violet',
      icon: <Sigma size={19} />,
      title: t('phone.scan.math'),
      detail: t('phone.scan.math.d'),
      run: pick('math')
    },
    {
      key: 'count',
      tone: 'orange',
      icon: <Hash size={19} />,
      title: t('phone.scan.count'),
      detail: t('phone.scan.count.d'),
      run: pick('count')
    },
    {
      key: 'measure',
      tone: 'yellow',
      icon: <Ruler size={19} />,
      title: t('phone.scan.measure'),
      detail: t('phone.scan.measure.d'),
      run: pick('measure')
    }
  ]

  const close = (): void => setMode(null)

  return (
    <>
      <Modal open={open} onClose={onClose} title={t('phone.card.scan')}>
        <SheetCards entries={entries} />
      </Modal>

      <ScanSheet open={mode === 'documents'} onClose={close} />
      <CardSheet open={mode === 'id' || mode === 'passport'} kind={mode === 'passport' ? 'passport' : 'id'} onClose={close} />
      <MathSheet open={mode === 'math'} onClose={close} />
      <CountSheet open={mode === 'count'} onClose={close} />
      <MeasureSheet open={mode === 'measure'} onClose={close} />
    </>
  )
}
