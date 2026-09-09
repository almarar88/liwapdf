import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, X, FolderOpen, Trash2 } from 'lucide-react'
import { useApp } from '../renderer/src/store/app'
import { useDocumentActions } from '../renderer/src/hooks/useDocumentActions'
import { Button } from '../renderer/src/components/ui'
import type { RecentFile } from '@shared/types'
import { FileChip } from './PhoneHome'
import { tapFeedback } from './shell'

/**
 * Everything you have opened, when you opened it.
 *
 * A phone has no folder tree worth browsing — the file lives in the system
 * picker, in Drive, in a chat — so the list that matters is the one the app
 * itself can honestly keep: what has been through it, newest first, grouped
 * by when. "Today" and "This week" are how anyone actually looks for a file
 * they had open an hour ago.
 */
export function PhoneFiles({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element | null {
  const t = useApp((state) => state.t)
  const recents = useApp((state) => state.recents)
  const clearRecents = useApp((state) => state.clearRecents)
  const { openDialog, openPaths } = useDocumentActions()
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const groups = useMemo(() => bucket(recents, query), [recents, query])

  if (!open) return null

  return (
    <div className="phone-files">
      <header className="pf-head">
        <button className="ph-round dark" aria-label={t('action.close')} data-mobile-dismiss onClick={onClose}>
          <X size={19} />
        </button>
        <div className="pf-search">
          <Search size={16} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('phone.searchFiles')}
            aria-label={t('phone.searchFiles')}
          />
        </div>
      </header>

      <div className="pf-body">
        {groups.length === 0 ? (
          <div className="pf-empty">
            <FolderOpen size={30} />
            <p>{query ? t('phone.noMatch') : t('home.noRecent')}</p>
            <Button
              variant="primary"
              onClick={() => {
                tapFeedback()
                onClose()
                void openDialog()
              }}
            >
              {t('action.open')}
            </Button>
          </div>
        ) : (
          groups.map((group) => (
            <section key={group.key}>
              <h2>{t(group.key)}</h2>
              <div className="pf-grid">
                {group.files.map((file) => (
                  <FileChip
                    key={file.path}
                    file={file}
                    showSize
                    onOpen={() => {
                      onClose()
                      void openPaths([file.path])
                    }}
                  />
                ))}
              </div>
            </section>
          ))
        )}

        {recents.length > 0 ? (
          <Button block variant="ghost" onClick={() => void clearRecents()}>
            <Trash2 size={15} />
            {t('home.clearRecent')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

const DAY = 86_400_000

/** Newest first, cut at today, this week, this month and everything older. */
function bucket(
  recents: RecentFile[],
  query: string
): { key: 'phone.today' | 'phone.thisWeek' | 'phone.thisMonth' | 'phone.older'; files: RecentFile[] }[] {
  const needle = query.trim().toLowerCase()
  const matching = needle
    ? recents.filter((file) => file.name.toLowerCase().includes(needle))
    : recents
  const now = Date.now()

  const groups: Record<string, RecentFile[]> = {
    'phone.today': [],
    'phone.thisWeek': [],
    'phone.thisMonth': [],
    'phone.older': []
  }
  for (const file of matching) {
    const age = now - file.openedAt
    const key =
      age < DAY ? 'phone.today' : age < 7 * DAY ? 'phone.thisWeek' : age < 31 * DAY ? 'phone.thisMonth' : 'phone.older'
    groups[key].push(file)
  }
  return (['phone.today', 'phone.thisWeek', 'phone.thisMonth', 'phone.older'] as const)
    .map((key) => ({ key, files: groups[key] }))
    .filter((group) => group.files.length > 0)
}
