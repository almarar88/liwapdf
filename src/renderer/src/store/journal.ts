import { create } from 'zustand'
import { uid } from '../lib/format'
import { emptyEntry, entryHasContent, todayIso, type JournalEntry } from '../lib/journal/types'
import { listEntries, saveEntry } from '../lib/journal/store'
import { useAccount } from './account'

/**
 * The journal's live state. One entry is open at a time; edits are written
 * to the device shortly after the typing pauses, and the cloud copy follows
 * a little later when there is an account.
 */

const AUTOSAVE_DELAY = 700
const timers = new Map<string, ReturnType<typeof setTimeout>>()

interface JournalState {
  entries: JournalEntry[]
  loaded: boolean
  activeId: string | null
  pendingSave: boolean
}

interface JournalActions {
  load: () => Promise<void>
  /** Opens today's entry, creating it if the day has none yet. */
  openToday: () => JournalEntry
  create: (day?: string) => JournalEntry
  open: (id: string | null) => void
  update: (id: string, patch: Partial<JournalEntry>) => void
  remove: (id: string) => Promise<void>
  flush: () => Promise<void>
  /** Drops an entry that was opened and never written in. */
  discardIfEmpty: (id: string) => Promise<void>
}

export const useJournal = create<JournalState & JournalActions>((set, get) => {
  const byId = (id: string): JournalEntry | undefined => get().entries.find((entry) => entry.id === id)

  const commit = (id: string, next: JournalEntry): void => {
    set({ entries: sortEntries(get().entries.map((entry) => (entry.id === id ? next : entry))), pendingSave: true })
    const pending = timers.get(id)
    if (pending) clearTimeout(pending)
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id)
        const latest = byId(id)
        if (!latest) return
        void saveEntry(latest)
          .catch(() => undefined)
          .then(() => {
            if (timers.size === 0) set({ pendingSave: false })
            useAccount.getState().scheduleSync()
          })
      }, AUTOSAVE_DELAY)
    )
  }

  return {
    entries: [],
    loaded: false,
    activeId: null,
    pendingSave: false,

    async load() {
      try {
        const entries = (await listEntries()).filter((entry) => !entry.deletedAt)
        set({ entries: sortEntries(entries), loaded: true })
      } catch {
        set({ loaded: true })
      }
    },

    openToday() {
      const today = todayIso()
      const existing = get().entries.find((entry) => entry.day === today)
      if (existing) {
        set({ activeId: existing.id })
        return existing
      }
      return get().create(today)
    },

    create(day = todayIso()) {
      const entry = emptyEntry(uid(), day)
      set({ entries: sortEntries([entry, ...get().entries]), activeId: entry.id })
      commit(entry.id, entry)
      return entry
    },

    open(id) {
      set({ activeId: id })
    },

    update(id, patch) {
      const current = byId(id)
      if (!current) return
      commit(id, { ...current, ...patch, updatedAt: Date.now() })
    },

    async remove(id) {
      const current = byId(id)
      const pending = timers.get(id)
      if (pending) {
        clearTimeout(pending)
        timers.delete(id)
      }
      set({ entries: get().entries.filter((entry) => entry.id !== id), activeId: get().activeId === id ? null : get().activeId })
      if (current) {
        await saveEntry({ ...current, deletedAt: Date.now(), updatedAt: Date.now() }).catch(() => undefined)
        useAccount.getState().scheduleSync()
      }
    },

    async flush() {
      for (const id of [...timers.keys()]) {
        const pending = timers.get(id)
        if (pending) clearTimeout(pending)
        timers.delete(id)
        const entry = byId(id)
        if (entry) await saveEntry(entry).catch(() => undefined)
      }
      set({ pendingSave: false })
    },

    async discardIfEmpty(id) {
      const entry = byId(id)
      if (entry && !entryHasContent(entry)) await get().remove(id)
    }
  }
})

function sortEntries(entries: JournalEntry[]): JournalEntry[] {
  return [...entries].sort((a, b) => (a.day === b.day ? b.updatedAt - a.updatedAt : b.day.localeCompare(a.day)))
}
