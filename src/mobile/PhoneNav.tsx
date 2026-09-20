import { useState } from 'react'
import { BookOpen, CalendarDays, Feather, Home, Mic, PenLine, Plus, UserRound } from 'lucide-react'
import { useApp } from '../renderer/src/store/app'
import { useJournal } from '../renderer/src/store/journal'
import { useDiwan } from '../renderer/src/store/diwan'
import { Modal } from '../renderer/src/components/ui'
import { SheetCards, type SheetEntry } from './SheetCard'
import { tapFeedback } from './shell'

/**
 * The phone's navigation: four places and one verb.
 *
 * Home, the days, the diwan, and you — and the add button, which offers
 * the three things a person opens this app to do: write tonight's page,
 * write a poem, or record one.
 */
export function PhoneNav(): React.JSX.Element {
  const t = useApp((state) => state.t)
  const route = useApp((state) => state.route)
  const navigate = useApp((state) => state.navigate)
  const openToday = useJournal((state) => state.openToday)
  const openEntry = useJournal((state) => state.open)
  const createPoem = useDiwan((state) => state.create)
  const openPoem = useDiwan((state) => state.open)
  const [adding, setAdding] = useState(false)

  const go = (run: () => void) => (): void => {
    tapFeedback()
    setAdding(false)
    run()
  }

  const entries: SheetEntry[] = [
    {
      key: 'entry',
      tone: 'yellow',
      icon: <PenLine size={19} />,
      title: t('phone.add.entry'),
      detail: t('phone.add.entry.d'),
      run: go(() => {
        openToday()
        navigate('journal')
      })
    },
    {
      key: 'poem',
      tone: 'orange',
      icon: <Feather size={19} />,
      title: t('phone.add.poem'),
      detail: t('phone.add.poem.d'),
      run: go(() => {
        createPoem()
        navigate('diwan')
      })
    },
    {
      key: 'record',
      tone: 'green',
      icon: <Mic size={19} />,
      title: t('phone.add.record'),
      detail: t('phone.add.record.d'),
      run: go(() => {
        createPoem()
        navigate('diwan')
      })
    }
  ]

  const tab = (target: 'home' | 'journal' | 'diwan' | 'account', label: string, icon: React.JSX.Element, before?: () => void): React.JSX.Element => (
    <button
      className={`pill-btn${route === target ? ' active' : ''}`}
      aria-label={label}
      title={label}
      aria-current={route === target ? 'page' : undefined}
      onClick={() => {
        tapFeedback()
        before?.()
        navigate(target)
      }}
    >
      {icon}
    </button>
  )

  return (
    <>
      <div className="phone-bar">
        <nav className="phone-pill">
          {tab('home', t('nav.home'), <Home size={20} />)}
          {tab('journal', t('nav.journal'), <CalendarDays size={20} />, () => openEntry(null))}
          {tab('diwan', t('nav.diwan'), <BookOpen size={20} />, () => openPoem(null))}
          {tab('account', t('nav.account'), <UserRound size={20} />)}
        </nav>

        <button
          className="phone-add"
          aria-label={t('phone.add')}
          onClick={() => {
            tapFeedback('medium')
            setAdding(true)
          }}
        >
          <Plus size={22} />
        </button>
      </div>

      <Modal open={adding} onClose={() => setAdding(false)} title={t('phone.add')}>
        <SheetCards entries={entries} />
      </Modal>
    </>
  )
}
