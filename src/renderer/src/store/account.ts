import { create } from 'zustand'
import type { Session, User } from '@supabase/supabase-js'
import { cloudReachable, supabase } from '../lib/cloud/client'
import { resetSyncCursor, syncAll, type SyncReport } from '../lib/cloud/sync'

/**
 * The person, and whether their copy in the cloud is current.
 *
 * Signing in is optional: everything works on the device alone. An account
 * adds the copy — the same journal and diwan on the phone and the laptop,
 * and still there after the phone is lost. Sync runs after sign-in, on
 * launch, when the network comes back, and a little after any change.
 */

export interface Profile {
  displayName: string
  poetName: string
}

export type AuthFailure = 'invalid' | 'exists' | 'weak' | 'network' | 'confirm' | 'unknown'

interface AccountState {
  user: User | null
  profile: Profile
  ready: boolean
  syncing: boolean
  lastSyncAt: number | null
  lastReport: SyncReport | null
  /** Set after a sign-up that needs the confirmation email to be clicked. */
  awaitingConfirmation: boolean
}

interface AccountActions {
  init: () => Promise<void>
  signUp: (email: string, password: string, displayName: string) => Promise<AuthFailure | null>
  signIn: (email: string, password: string) => Promise<AuthFailure | null>
  signOut: () => Promise<void>
  resetPassword: (email: string) => Promise<AuthFailure | null>
  saveProfile: (patch: Partial<Profile>) => Promise<void>
  sync: () => Promise<SyncReport | null>
  /** Called by the local stores after a change; syncs once things settle. */
  scheduleSync: () => void
}

const SYNC_DELAY = 20_000
let syncTimer: ReturnType<typeof setTimeout> | null = null
let listening = false

export const useAccount = create<AccountState & AccountActions>((set, get) => {
  const adopt = async (session: Session | null): Promise<void> => {
    const user = session?.user ?? null
    set({ user })
    if (!user) {
      set({ profile: { displayName: '', poetName: '' } })
      return
    }
    const { data } = await supabase().from('profiles').select('display_name, poet_name').eq('id', user.id).maybeSingle()
    if (data) {
      set({ profile: { displayName: data.display_name ?? '', poetName: data.poet_name ?? '' } })
      // The poet name lives in the profile once there is one; the diwan's
      // local copy follows it, or seeds it the first time.
      const { useDiwan } = await import('./diwan')
      const local = useDiwan.getState().poet
      if (data.poet_name) useDiwan.getState().setPoet(data.poet_name)
      else if (local) void get().saveProfile({ poetName: local })
    }
  }

  return {
    user: null,
    profile: { displayName: '', poetName: '' },
    ready: false,
    syncing: false,
    lastSyncAt: null,
    lastReport: null,
    awaitingConfirmation: false,

    async init() {
      try {
        const { data } = await supabase().auth.getSession()
        await adopt(data.session)
        if (!listening) {
          listening = true
          supabase().auth.onAuthStateChange((_event, session) => {
            // Deferred on purpose: the client holds its auth lock while this
            // callback runs, and adopt() makes a request that needs it —
            // calling it here directly deadlocks the sign-in.
            setTimeout(() => {
              void adopt(session).then(() => {
                if (session) get().scheduleSync()
              })
            }, 0)
          })
          window.addEventListener('online', () => get().scheduleSync())
        }
      } catch {
        // No network and no stored session: the app carries on locally.
      } finally {
        set({ ready: true })
      }
      if (get().user) void get().sync()
    },

    async signUp(email, password, displayName) {
      const { data, error } = await supabase().auth.signUp({
        email: email.trim(),
        password,
        options: { data: { display_name: displayName.trim() } }
      })
      if (error) return classify(error.message)
      if (!data.session) {
        set({ awaitingConfirmation: true })
        return 'confirm'
      }
      await resetSyncCursor()
      return null
    },

    async signIn(email, password) {
      const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password })
      if (error) return classify(error.message)
      set({ awaitingConfirmation: false })
      // A different account than last time must not inherit its cursor.
      await resetSyncCursor()
      return null
    },

    async signOut() {
      await supabase().auth.signOut().catch(() => undefined)
      set({ user: null, lastSyncAt: null, lastReport: null })
    },

    async resetPassword(email) {
      const { error } = await supabase().auth.resetPasswordForEmail(email.trim())
      return error ? classify(error.message) : null
    },

    async saveProfile(patch) {
      const profile = { ...get().profile, ...patch }
      set({ profile })
      const user = get().user
      if (!user) return
      await supabase()
        .from('profiles')
        .upsert({ id: user.id, display_name: profile.displayName, poet_name: profile.poetName, updated_at: new Date().toISOString() })
    },

    async sync() {
      const user = get().user
      if (!user || get().syncing || !cloudReachable()) return null
      set({ syncing: true })
      try {
        // The stores hold the lists in memory; what the device has not yet
        // written is written first, and what the cloud brought is read back
        // after, so the screens show it without a restart.
        const [{ useJournal }, { useDiwan }] = await Promise.all([import('./journal'), import('./diwan')])
        await Promise.all([useJournal.getState().flush(), useDiwan.getState().flush()])
        const report = await syncAll(user.id)
        if (report.pulled > 0 || report.recordings > 0) {
          await Promise.all([useJournal.getState().load(), useDiwan.getState().load()])
        }
        set({ lastSyncAt: Date.now(), lastReport: report })
        return report
      } catch (error) {
        set({ lastReport: { pushed: 0, pulled: 0, recordings: 0, errors: [String(error)] } })
        return null
      } finally {
        set({ syncing: false })
      }
    },

    scheduleSync() {
      if (!get().user) return
      if (syncTimer) clearTimeout(syncTimer)
      syncTimer = setTimeout(() => {
        syncTimer = null
        void get().sync()
      }, SYNC_DELAY)
    }
  }
})

function classify(message: string): AuthFailure {
  const text = message.toLowerCase()
  if (text.includes('invalid login') || text.includes('invalid credentials')) return 'invalid'
  if (text.includes('already registered') || text.includes('already exists')) return 'exists'
  if (text.includes('password') && (text.includes('least') || text.includes('weak'))) return 'weak'
  if (text.includes('fetch') || text.includes('network')) return 'network'
  if (text.includes('confirm')) return 'confirm'
  return 'unknown'
}
