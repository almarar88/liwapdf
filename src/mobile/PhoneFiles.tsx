import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, X, FolderOpen, Trash2, CheckSquare, Combine, Share2, Check } from 'lucide-react'
import { useApp } from '../renderer/src/store/app'
import { useDocumentActions } from '../renderer/src/hooks/useDocumentActions'
import { Button } from '../renderer/src/components/ui'
import type { RecentFile } from '@shared/types'
import { FileChip } from './PhoneHome'
import { tapFeedback } from './shell'
import { canMerge } from './mergeAny'

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
  const notify = useApp((state) => state.notify)
  const setBusy = useApp((state) => state.setBusy)
  const reportError = useApp((state) => state.reportError)
  const openPdfBytes = useApp((state) => state.openPdfBytes)
  const [query, setQuery] = useState('')
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) return
    setQuery('')
    setPicking(false)
    setPicked([])
  }, [open])

  const toggle = (path: string): void => {
    tapFeedback()
    setPicked((current) =>
      current.includes(path) ? current.filter((entry) => entry !== path) : [...current, path]
    )
  }

  /**
   * Several files into one PDF, in the order they were picked.
   *
   * The commonest thing anyone does with a phone full of scans, and until now
   * it meant opening the merge tool and choosing the same files a second time
   * from a system picker that does not know what the app has already seen.
   */
  const mergePicked = async (): Promise<void> => {
    if (picked.length < 2) return
    setBusy({ label: t('tool.merge'), progress: null })
    try {
      const [{ mergeDocuments }, { convertToPdf }] = await Promise.all([
        import('../renderer/src/lib/pdf/ops'),
        import('./mergeAny')
      ])
      const parts = []
      for (const path of picked) {
        const file = recents.find((entry) => entry.path === path)
        if (!file) continue
        const read = await window.alcode.fs.read(path)
        parts.push({ name: file.name, bytes: await convertToPdf(file.name, read.data) })
      }
      if (parts.length < 2) throw new Error('merge-needs-two')
      const bytes = await mergeDocuments(parts)
      await openPdfBytes(`merged-${new Date().toISOString().slice(0, 10)}.pdf`, bytes, null)
      notify({ kind: 'success', title: t('files.merged', { n: parts.length }) })
      setPicking(false)
      setPicked([])
      onClose()
    } catch (error) {
      reportError(error)
    } finally {
      setBusy(null)
    }
  }

  const groups = useMemo(() => bucket(recents, query), [recents, query])
  // Merge is offered only when every pick can become a page here; a Word file
  // needs the print pipeline, and half a merge is worse than no button.
  const mergeable =
    picked.length >= 2 &&
    picked.every((path) => canMerge(recents.find((entry) => entry.path === path)?.name ?? ''))

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
        {recents.length > 1 ? (
          <button
            className={`ph-round dark${picking ? ' on' : ''}`}
            aria-label={t('files.select')}
            title={t('files.select')}
            aria-pressed={picking}
            onClick={() => {
              tapFeedback()
              setPicking((on) => !on)
              setPicked([])
            }}
          >
            <CheckSquare size={19} />
          </button>
        ) : null}
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
                    picked={picking ? picked.includes(file.path) : undefined}
                    onOpen={() => {
                      if (picking) {
                        toggle(file.path)
                        return
                      }
                      onClose()
                      void openPaths([file.path])
                    }}
                  />
                ))}
              </div>
            </section>
          ))
        )}

        {recents.length > 0 && !picking ? (
          <Button block variant="ghost" onClick={() => void clearRecents()}>
            <Trash2 size={15} />
            {t('home.clearRecent')}
          </Button>
        ) : null}
      </div>

      {/* The action bar only exists while something is picked, so the screen
          is a list of files the rest of the time. */}
      {picking && picked.length > 0 ? (
        <div className="pf-actions">
          <span>
            <Check size={15} />
            {t('files.picked', { n: picked.length })}
          </span>
          <Button
            size="sm"
            onClick={() => {
              const file = recents.find((entry) => entry.path === picked[0])
              if (file) void window.alcode.shell.reveal(file.path)
            }}
          >
            <Share2 size={15} />
            {t('action.share')}
          </Button>
          <Button size="sm" variant="primary" disabled={!mergeable} onClick={() => void mergePicked()}>
            <Combine size={15} />
            {t('tool.merge')}
          </Button>
        </div>
      ) : null}
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
