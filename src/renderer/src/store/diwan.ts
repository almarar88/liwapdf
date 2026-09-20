import { create } from 'zustand'
import { uid } from '../lib/format'
import { emptyPoem, newVerse, type Poem, type Verse } from '../lib/diwan/types'
import { deleteRecording, listPoems, readRecording, savePoem, saveRecording } from '../lib/diwan/store'
import { useAccount } from './account'

/**
 * The diwan's live state: the poems, the one being edited, and the poet.
 *
 * Kept apart from the document store on purpose. A poem is never "the open
 * document" — the viewer, the tools and the converters know nothing about
 * it — so mixing it into that state would only give thirty tools a field
 * they must ignore. What the two share is the platform bridge, for saving
 * a PDF or a card where the user can find it.
 */

const POET_KEY = 'alcode.diwan.poet'
const AUTOSAVE_DELAY = 700
const VERSIONS_PER_VERSE = 8

interface DiwanState {
  poems: Poem[]
  loaded: boolean
  /** Null while the shelf is showing; a poem id while one is open. */
  activeId: string | null
  poet: string
  /** True between an edit and the write that follows it. */
  pendingSave: boolean
}

interface DiwanActions {
  load: () => Promise<void>
  setPoet: (name: string) => void
  create: (seed?: Partial<Poem>) => Poem
  open: (id: string | null) => void
  update: (id: string, patch: Partial<Poem>) => void
  updateVerse: (id: string, verseId: string, patch: Partial<Verse>) => void
  insertVerse: (id: string, afterVerseId: string | null) => string
  removeVerse: (id: string, verseId: string) => void
  moveVerse: (id: string, verseId: string, direction: -1 | 1) => void
  /** Keeps the verse's current wording so a later edit can be undone by hand. */
  keepVersion: (id: string, verseId: string) => void
  restoreVersion: (id: string, verseId: string, savedAt: number) => void
  remove: (id: string) => Promise<void>
  attachRecording: (id: string, blob: Blob, seconds: number) => Promise<void>
  loadRecording: (id: string) => Promise<Blob | null>
  dropRecording: (id: string) => Promise<void>
  importPoems: (poems: Poem[]) => Promise<number>
  flush: () => Promise<void>
}

const timers = new Map<string, ReturnType<typeof setTimeout>>()

function readPoet(): string {
  try {
    return localStorage.getItem(POET_KEY) ?? ''
  } catch {
    return ''
  }
}

export const useDiwan = create<DiwanState & DiwanActions>((set, get) => {
  const poemById = (id: string): Poem | undefined => get().poems.find((poem) => poem.id === id)

  const commit = (id: string, next: Poem): void => {
    set({
      poems: get().poems.map((poem) => (poem.id === id ? next : poem)),
      pendingSave: true
    })
    const pending = timers.get(id)
    if (pending) clearTimeout(pending)
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id)
        const latest = poemById(id)
        if (!latest) return
        void savePoem(latest)
          .catch(() => undefined)
          .then(() => {
            if (timers.size === 0) set({ pendingSave: false })
            useAccount.getState().scheduleSync()
          })
      }, AUTOSAVE_DELAY)
    )
  }

  const patch = (id: string, change: (poem: Poem) => Poem): void => {
    const current = poemById(id)
    if (!current) return
    commit(id, { ...change(current), updatedAt: Date.now() })
  }

  return {
    poems: [],
    loaded: false,
    activeId: null,
    poet: readPoet(),
    pendingSave: false,

    async load() {
      try {
        const poems = await listPoems()
        set({ poems, loaded: true })
      } catch {
        // No IndexedDB (a locked-down WebView): the shelf works for the
        // session and says nothing was kept, rather than not opening at all.
        set({ loaded: true })
      }
    },

    setPoet(name) {
      set({ poet: name })
      try {
        localStorage.setItem(POET_KEY, name)
      } catch {
        /* a private window; the name lives for the session */
      }
    },

    create(seed = {}) {
      const poem = { ...emptyPoem(uid(), uid()), ...seed }
      set({ poems: [poem, ...get().poems], activeId: poem.id })
      commit(poem.id, poem)
      return poem
    },

    open(id) {
      set({ activeId: id })
    },

    update(id, changes) {
      patch(id, (poem) => ({ ...poem, ...changes }))
    },

    updateVerse(id, verseId, changes) {
      patch(id, (poem) => ({
        ...poem,
        verses: poem.verses.map((verse) => (verse.id === verseId ? { ...verse, ...changes } : verse))
      }))
    },

    insertVerse(id, afterVerseId) {
      const verse = newVerse(uid())
      patch(id, (poem) => {
        const index = afterVerseId ? poem.verses.findIndex((entry) => entry.id === afterVerseId) : -1
        const verses = [...poem.verses]
        verses.splice(index < 0 ? verses.length : index + 1, 0, verse)
        return { ...poem, verses }
      })
      return verse.id
    },

    removeVerse(id, verseId) {
      patch(id, (poem) => {
        const verses = poem.verses.filter((verse) => verse.id !== verseId)
        // A poem always shows one row to type into.
        return { ...poem, verses: verses.length > 0 ? verses : [newVerse(uid())] }
      })
    },

    moveVerse(id, verseId, direction) {
      patch(id, (poem) => {
        const index = poem.verses.findIndex((verse) => verse.id === verseId)
        const target = index + direction
        if (index < 0 || target < 0 || target >= poem.verses.length) return poem
        const verses = [...poem.verses]
        const [moved] = verses.splice(index, 1)
        verses.splice(target, 0, moved)
        return { ...poem, verses }
      })
    },

    keepVersion(id, verseId) {
      patch(id, (poem) => {
        const verse = poem.verses.find((entry) => entry.id === verseId)
        if (!verse || (!verse.sadr.trim() && !verse.ajuz.trim())) return poem
        const same = poem.versions.find(
          (version) => version.verseId === verseId && version.sadr === verse.sadr && version.ajuz === verse.ajuz
        )
        if (same) return poem
        const mine = poem.versions.filter((version) => version.verseId === verseId)
        const others = poem.versions.filter((version) => version.verseId !== verseId)
        const kept = [...mine, { verseId, sadr: verse.sadr, ajuz: verse.ajuz, savedAt: Date.now() }].slice(
          -VERSIONS_PER_VERSE
        )
        return { ...poem, versions: [...others, ...kept] }
      })
    },

    restoreVersion(id, verseId, savedAt) {
      const poem = poemById(id)
      const version = poem?.versions.find((entry) => entry.verseId === verseId && entry.savedAt === savedAt)
      if (!poem || !version) return
      // The wording being replaced is kept too, so restoring is never a loss.
      get().keepVersion(id, verseId)
      get().updateVerse(id, verseId, { sadr: version.sadr, ajuz: version.ajuz })
    },

    async remove(id) {
      const current = poemById(id)
      const pending = timers.get(id)
      if (pending) {
        clearTimeout(pending)
        timers.delete(id)
      }
      set({
        poems: get().poems.filter((poem) => poem.id !== id),
        activeId: get().activeId === id ? null : get().activeId
      })
      // A tombstone, not a removal: the sync layer purges it once the cloud
      // knows, so the poem disappears from the other devices too.
      if (current) {
        await deleteRecording(id).catch(() => undefined)
        await savePoem({ ...current, deletedAt: Date.now(), updatedAt: Date.now() }).catch(() => undefined)
        useAccount.getState().scheduleSync()
      }
    },

    async attachRecording(id, blob, seconds) {
      await saveRecording(id, blob)
      patch(id, (poem) => ({ ...poem, hasRecording: true, recordingSeconds: Math.round(seconds), recordingAt: Date.now() }))
      await get().flush()
    },

    loadRecording(id) {
      return readRecording(id).catch(() => null)
    },

    async dropRecording(id) {
      await deleteRecording(id).catch(() => undefined)
      patch(id, (poem) => ({ ...poem, hasRecording: false, recordingSeconds: 0, recordingAt: Date.now() }))
      await get().flush()
    },

    async importPoems(incoming) {
      const existing = new Set(get().poems.map((poem) => poem.id))
      let added = 0
      for (const poem of incoming) {
        const fresh: Poem = {
          ...poem,
          id: existing.has(poem.id) ? uid() : poem.id,
          // A recording is not part of a backup file.
          hasRecording: false,
          recordingSeconds: 0,
          deletedAt: null,
          syncedAt: undefined
        }
        await savePoem(fresh)
        added += 1
      }
      const poems = await listPoems().catch(() => get().poems)
      set({ poems })
      return added
    },

    async flush() {
      const ids = [...timers.keys()]
      for (const id of ids) {
        const pending = timers.get(id)
        if (pending) clearTimeout(pending)
        timers.delete(id)
        const poem = poemById(id)
        if (poem) await savePoem(poem).catch(() => undefined)
      }
      set({ pendingSave: false })
      useAccount.getState().scheduleSync()
    }
  }
})
