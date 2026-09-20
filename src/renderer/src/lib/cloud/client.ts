import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * The account and the cloud copy: Supabase.
 *
 * A publishable key is what it says — it identifies the project, not a
 * person, and every table and bucket is guarded by row-level security so
 * an account can only ever read and write its own rows. The client is made
 * once, on first use, so a person who never signs in never loads it.
 */

export const SUPABASE_URL = 'https://pisokgtgzvnlayjehasz.supabase.co'
export const SUPABASE_HOST = 'pisokgtgzvnlayjehasz.supabase.co'
const SUPABASE_KEY = 'sb_publishable_uR_4VOjU5rR-uXhjDlEVDg_Yi0hMEUz'

let client: SupabaseClient | null = null

export function supabase(): SupabaseClient {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    })
  }
  return client
}

export function cloudReachable(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false
}
