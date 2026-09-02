/**
 * Read-aloud through the system's own voices.
 *
 * Chromium's speech synthesis uses the voices the OS ships — SAPI on
 * Windows, the macOS voices on a Mac — so nothing is downloaded and nothing
 * leaves the machine. Arabic voices exist on both when the language pack is
 * installed; when none is, the caller is told rather than left with silence.
 */

export interface SpeechHandle {
  stop: () => void
}

const ARABIC = /[؀-ۿ]/

export function speechAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

/** Picks the best installed voice for the text's script, or null if there is none. */
export function voiceFor(text: string): SpeechSynthesisVoice | null {
  if (!speechAvailable()) return null
  const voices = window.speechSynthesis.getVoices()
  const wantArabic = ARABIC.test(text)
  const prefix = wantArabic ? 'ar' : 'en'
  const candidates = voices.filter((voice) => voice.lang.toLowerCase().startsWith(prefix))
  if (candidates.length === 0) return null
  // A local voice over a remote one, the default over the rest.
  return (
    candidates.find((voice) => voice.localService && voice.default) ??
    candidates.find((voice) => voice.localService) ??
    candidates[0]
  )
}

/**
 * Speaks the text in chunks: a single utterance longer than a few hundred
 * characters is cut off silently by some engines. Resolves the handle at
 * once so the caller can offer a stop button.
 */
export function speak(
  text: string,
  options: { onEnd?: () => void; rate?: number } = {}
): SpeechHandle | null {
  if (!speechAvailable()) return null
  const voice = voiceFor(text)
  if (!voice) return null

  const synth = window.speechSynthesis
  synth.cancel()

  const chunks = splitForSpeech(text)
  let index = 0
  let stopped = false

  const next = (): void => {
    if (stopped || index >= chunks.length) {
      if (!stopped) options.onEnd?.()
      return
    }
    const utterance = new SpeechSynthesisUtterance(chunks[index])
    index += 1
    utterance.voice = voice
    utterance.lang = voice.lang
    utterance.rate = options.rate ?? 1
    utterance.onend = next
    utterance.onerror = () => {
      if (!stopped) options.onEnd?.()
    }
    synth.speak(utterance)
  }
  next()

  return {
    stop: () => {
      stopped = true
      synth.cancel()
    }
  }
}

export function stopSpeaking(): void {
  if (speechAvailable()) window.speechSynthesis.cancel()
}

/** Sentence-sized pieces, never longer than ~240 characters. */
export function splitForSpeech(text: string): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return []
  const sentences = clean.split(/(?<=[.!?؟。\n])\s+|(?<=[،,;؛])\s+(?=\S{20,})/)
  const out: string[] = []
  let current = ''
  for (const sentence of sentences) {
    if ((current + ' ' + sentence).length > 240 && current) {
      out.push(current.trim())
      current = sentence
    } else {
      current = current ? `${current} ${sentence}` : sentence
    }
  }
  if (current.trim()) out.push(current.trim())
  // A single run of text with no punctuation still has to be cut, and
  // nothing may be dropped in the cutting.
  return out.flatMap((piece) => {
    if (piece.length <= 320) return [piece]
    const parts: string[] = []
    let rest = piece
    while (rest.length > 240) {
      const space = rest.lastIndexOf(' ', 240)
      const cut = space > 80 ? space : 240
      parts.push(rest.slice(0, cut).trim())
      rest = rest.slice(cut).trim()
    }
    if (rest) parts.push(rest)
    return parts
  })
}
