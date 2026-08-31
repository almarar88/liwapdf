import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CornerDownLeft } from 'lucide-react'
import { useApp } from '../store/app'
import { SPRING } from './ui'

export interface Command {
  id: string
  label: string
  hint?: string
  icon?: React.ReactNode
  keywords?: string
  run: () => void
}

export function CommandPalette({ commands }: { commands: Command[] }): React.JSX.Element {
  const open = useApp((state) => state.paletteOpen)
  const setOpen = useApp((state) => state.setPaletteOpen)
  const t = useApp((state) => state.t)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return commands.slice(0, 40)
    return commands
      .filter((command) =>
        `${command.label} ${command.hint ?? ''} ${command.keywords ?? ''}`
          .toLowerCase()
          .includes(needle)
      )
      .slice(0, 40)
  }, [commands, query])

  useEffect(() => {
    if (open) {
      setQuery('')
      setCursor(0)
    }
  }, [open])

  useEffect(() => {
    setCursor(0)
  }, [query])

  useEffect(() => {
    const element = listRef.current?.children[cursor] as HTMLElement | undefined
    element?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="palette-scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false)
          }}
        >
          <motion.div
            className="palette"
            initial={{ opacity: 0, y: -14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={SPRING}
          >
            <input
              autoFocus
              value={query}
              placeholder={t('palette.placeholder')}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  setCursor((index) => Math.min(index + 1, results.length - 1))
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  setCursor((index) => Math.max(index - 1, 0))
                } else if (event.key === 'Enter') {
                  event.preventDefault()
                  const command = results[cursor]
                  if (command) {
                    setOpen(false)
                    command.run()
                  }
                } else if (event.key === 'Escape') {
                  setOpen(false)
                }
              }}
            />
            <div className="results" ref={listRef}>
              {results.length === 0 ? (
                <div className="result muted">{t('palette.empty')}</div>
              ) : (
                results.map((command, index) => (
                  <button
                    key={command.id}
                    className={`result${index === cursor ? ' active' : ''}`}
                    onMouseEnter={() => setCursor(index)}
                    onClick={() => {
                      setOpen(false)
                      command.run()
                    }}
                  >
                    {command.icon}
                    <span className="truncate">{command.label}</span>
                    {command.hint ? <span className="k">{command.hint}</span> : null}
                    {index === cursor ? (
                      <CornerDownLeft size={13} style={{ marginInlineStart: 6, opacity: 0.6 }} />
                    ) : null}
                  </button>
                ))
              )}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
