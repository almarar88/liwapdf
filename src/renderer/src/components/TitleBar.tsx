import { useEffect, useState } from 'react'
import { Minus, Square, X, Copy, Search, Undo2, Redo2, Save } from 'lucide-react'
import { useApp } from '../store/app'
import { Button } from './ui'

export function TitleBar({
  platform,
  onSave
}: {
  platform: string
  onSave: () => void
}): React.JSX.Element {
  const [maximized, setMaximized] = useState(false)
  const doc = useApp((state) => state.doc)
  const wordDoc = useApp((state) => state.wordDoc)
  const undo = useApp((state) => state.undo)
  const redo = useApp((state) => state.redo)
  const undoDepth = useApp((state) => state.undoStack.length)
  const redoDepth = useApp((state) => state.redoStack.length)
  const setPaletteOpen = useApp((state) => state.setPaletteOpen)
  const t = useApp((state) => state.t)

  const isMac = platform === 'darwin'

  useEffect(() => {
    void window.alcode.window.isMaximized().then(setMaximized)
    return window.alcode.window.onState((state) => setMaximized(state.maximized))
  }, [])

  const active = doc ?? wordDoc
  const activeName = doc?.name ?? wordDoc?.name
  const dirty = Boolean(active && 'dirty' in active && active.dirty)

  return (
    <div className={`titlebar${isMac ? ' mac' : ''}`}>
      <div className="brand">
        <span className="brand-mark">A</span>
        <span className="brand-name">
          Alcode <span>Editor</span>
        </span>
      </div>

      <div className="titlebar-actions">
        <Button
          size="sm"
          variant="ghost"
          icon
          title={t('action.undo')}
          disabled={!doc || undoDepth === 0}
          onClick={() => void undo()}
        >
          <Undo2 size={15} />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon
          title={t('action.redo')}
          disabled={!doc || redoDepth === 0}
          onClick={() => void redo()}
        >
          <Redo2 size={15} />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon
          title={t('action.save')}
          disabled={!active}
          onClick={onSave}
        >
          <Save size={15} />
        </Button>
      </div>

      {activeName ? (
        <div className="doc-chip" title={activeName}>
          {dirty ? <span className="dot" /> : null}
          <strong>{activeName}</strong>
          {doc ? (
            <span>
              · {doc.pageCount} {t('msg.pages')}
            </span>
          ) : null}
        </div>
      ) : (
        <div className="doc-chip" style={{ opacity: 0.7 }}>
          <span>{t('app.tagline')}</span>
        </div>
      )}

      <div className="titlebar-actions" style={{ marginLeft: isMac ? 'auto' : undefined }}>
        <Button size="sm" variant="ghost" onClick={() => setPaletteOpen(true)} title={t('sc.palette')}>
          <Search size={14} />
          <span className="kbd">{isMac ? 'Cmd K' : 'Ctrl K'}</span>
        </Button>
      </div>

      {isMac ? null : (
        <div className="win-controls">
          <button onClick={() => void window.alcode.window.minimize()} aria-label="Minimize">
            <Minus size={14} />
          </button>
          <button
            onClick={() => void window.alcode.window.toggleMaximize().then(setMaximized)}
            aria-label="Maximize"
          >
            {maximized ? <Copy size={12} /> : <Square size={12} />}
          </button>
          <button className="close" onClick={() => void window.alcode.window.close()} aria-label="Close">
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  )
}
