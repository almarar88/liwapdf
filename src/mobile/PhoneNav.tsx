import { useState } from 'react'
import {
  Layers,
  UserRound,
  Plus,
  FolderOpen,
  FilePlus2,
  FileSpreadsheet,
  Wrench,
  LayoutGrid,
  Camera
} from 'lucide-react'
import { useApp } from '../renderer/src/store/app'
import { useDocumentActions } from '../renderer/src/hooks/useDocumentActions'
import { Modal } from '../renderer/src/components/ui'
import { SheetCards, type SheetEntry } from './SheetCard'
import { tapFeedback } from './shell'

/**
 * The phone's navigation, such as it is.
 *
 * There is deliberately almost none. The home screen's four cards are the
 * navigation, so the bar underneath carries only the two places that are not
 * a verb — the files you have, and you — and the one control that is: add
 * something. A floating pill rather than a full-width bar, because at this
 * count a bar is mostly empty and the document behind it is worth more than
 * the background of a tab strip.
 */
export function PhoneNav({
  onFiles,
  onScan
}: {
  onFiles: () => void
  onScan: () => void
}): React.JSX.Element {
  const t = useApp((state) => state.t)
  const route = useApp((state) => state.route)
  const navigate = useApp((state) => state.navigate)
  const openTool = useApp((state) => state.openTool)
  const { openDialog, newDocument } = useDocumentActions()
  const [adding, setAdding] = useState(false)

  const go = (run: () => void) => (): void => {
    tapFeedback()
    setAdding(false)
    run()
  }

  const entries: SheetEntry[] = [
    {
      key: 'open',
      tone: 'blue',
      icon: <FolderOpen size={19} />,
      title: t('action.open'),
      detail: t('phone.add.open.d'),
      run: go(() => void openDialog())
    },
    {
      key: 'scan',
      tone: 'green',
      icon: <Camera size={19} />,
      title: t('scan.title'),
      detail: t('phone.add.scan.d'),
      run: go(onScan)
    },
    {
      key: 'rich',
      icon: <FilePlus2 size={19} />,
      title: t('editor.new.rich'),
      detail: t('editor.new.rich.d'),
      run: go(() => void newDocument('rich'))
    },
    {
      key: 'sheet',
      tone: 'yellow',
      icon: <FileSpreadsheet size={19} />,
      title: t('editor.new.sheet'),
      detail: t('editor.new.sheet.d'),
      run: go(() => void newDocument('sheet'))
    },
    {
      key: 'tools',
      tone: 'violet',
      icon: <Wrench size={19} />,
      title: t('nav.tools'),
      detail: t('phone.add.tools.d'),
      run: go(() => navigate('tools'))
    },
    {
      key: 'organize',
      tone: 'orange',
      icon: <LayoutGrid size={19} />,
      title: t('nav.organize'),
      detail: t('phone.add.organize.d'),
      run: go(() => openTool('deletePages', true))
    }
  ]

  return (
    <>
      <div className="phone-bar">
        <nav className="phone-pill">
          <button
            className="pill-btn"
            aria-label={t('phone.files')}
            title={t('phone.files')}
            onClick={() => {
              tapFeedback()
              onFiles()
            }}
          >
            <Layers size={20} />
          </button>
          <button
            className={`pill-btn${route === 'settings' ? ' active' : ''}`}
            aria-label={t('nav.settings')}
            title={t('nav.settings')}
            onClick={() => {
              tapFeedback()
              navigate(route === 'settings' ? 'home' : 'settings')
            }}
          >
            <UserRound size={20} />
          </button>
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
