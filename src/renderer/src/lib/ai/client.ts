import { supabase } from '../cloud/client'
import type { PoemForm, Verse } from '../diwan/types'

/**
 * The assistant, from the app's side.
 *
 * Every request goes to the project's own edge function, signed with the
 * person's session; the model key never reaches the device. Each action
 * returns a typed shape the function guarantees with a JSON schema.
 */

export interface ArrangedPoem {
  title: string
  form: PoemForm
  meter: string
  purpose: string
  rhyme: string
  verses: { sadr: string; ajuz: string }[]
  note: string
}

export interface VerseSuggestion {
  sadr: string
  ajuz: string
  why: string
}

export interface Critique {
  overall: string
  strengths: string[]
  improvements: string[]
  meter_note: string
}

export interface Reflection {
  summary: string
  themes: string[]
  mood: string
  highlight: string
  question: string
}

export type AiFailure = 'signed-out' | 'not-configured' | 'daily-cap' | 'busy' | 'refused' | 'network' | 'upstream'

export class AiError extends Error {
  constructor(
    public readonly reason: AiFailure,
    detail = ''
  ) {
    super(detail || reason)
  }
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data: session } = await supabase().auth.getSession()
  if (!session.session) throw new AiError('signed-out')
  const { data, error } = await supabase().functions.invoke<{ result?: T; error?: string }>('awraq-ai', { body })
  if (error) {
    // The function answers with a JSON body on every failure; the SDK
    // wraps non-2xx responses in an error that carries it.
    const context = (error as { context?: Response }).context
    if (context && typeof context.json === 'function') {
      const detail = (await context.json().catch(() => ({}))) as { error?: string }
      throw new AiError(classify(detail.error, context.status), detail.error)
    }
    throw new AiError('network', error.message)
  }
  if (!data?.result) throw new AiError(classify(data?.error, 502))
  return data.result
}

function classify(code: string | undefined, status: number): AiFailure {
  if (code === 'not-configured') return 'not-configured'
  if (code === 'daily-cap') return 'daily-cap'
  if (code === 'busy' || status === 429) return 'busy'
  if (code === 'refused') return 'refused'
  if (code === 'unauthorized' || status === 401) return 'signed-out'
  return 'upstream'
}

const strip = (verses: Verse[]): { sadr: string; ajuz: string }[] =>
  verses.filter((verse) => verse.sadr.trim() || verse.ajuz.trim()).map((verse) => ({ sadr: verse.sadr.trim(), ajuz: verse.ajuz.trim() }))

export const ai = {
  arrange: (text: string) => call<ArrangedPoem>({ action: 'arrange', text }),
  suggest: (verses: Verse[], index: number, instruction = '') =>
    call<{ suggestions: VerseSuggestion[] }>({
      action: 'suggest',
      verses: strip(verses),
      index,
      sadr: verses[index]?.sadr ?? '',
      ajuz: verses[index]?.ajuz ?? '',
      instruction
    }).then((result) => result.suggestions),
  titles: (verses: Verse[]) => call<{ titles: string[] }>({ action: 'titles', verses: strip(verses) }).then((result) => result.titles),
  critique: (title: string, form: PoemForm, meter: string, verses: Verse[]) =>
    call<Critique>({ action: 'critique', title, form, meter, verses: strip(verses) }),
  reflect: (text: string) => call<Reflection>({ action: 'reflect', text })
}
