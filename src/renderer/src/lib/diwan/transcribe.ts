import type { Verse } from './types'
import { splitIntoVerses } from './parse'

/**
 * A recitation, written down.
 *
 * There is no speech recogniser inside the app: none that runs offline in
 * a WebView is any good at Arabic verse, and the app will not pretend. So
 * this is the one feature that leaves the device, and it does so only when
 * the poet has pasted their own ElevenLabs key into the settings — until
 * then the button explains itself and does nothing. The recording is sent
 * once, the text comes back with a time for every word, and the pauses a
 * reciter takes between the halves and between the verses are what split
 * the transcript into sadr and ajuz.
 */

export const TRANSCRIBE_HOST = 'api.elevenlabs.io'
const ENDPOINT = `https://${TRANSCRIBE_HOST}/v1/speech-to-text`

export interface TimedWord {
  text: string
  /** Seconds from the start of the recording. */
  start: number
  end: number
}

export interface Transcript {
  text: string
  words: TimedWord[]
  language: string
}

export type TranscribeFailure = 'no-key' | 'unauthorized' | 'network' | 'rejected' | 'empty'

export class TranscribeError extends Error {
  constructor(
    public readonly reason: TranscribeFailure,
    detail = ''
  ) {
    super(detail || reason)
  }
}

export async function transcribeRecording(
  audio: Blob,
  apiKey: string,
  language: 'ar' | 'en' = 'ar'
): Promise<Transcript> {
  const key = apiKey.trim()
  if (!key) throw new TranscribeError('no-key')

  const form = new FormData()
  form.append('file', audio, `recitation.${audio.type.includes('ogg') ? 'ogg' : audio.type.includes('mp4') ? 'm4a' : 'webm'}`)
  form.append('model_id', 'scribe_v2')
  form.append('language_code', language === 'ar' ? 'ara' : 'eng')
  form.append('timestamps_granularity', 'word')
  form.append('tag_audio_events', 'false')
  form.append('diarize', 'false')

  let response: Response
  try {
    response = await fetch(ENDPOINT, { method: 'POST', headers: { 'xi-api-key': key }, body: form })
  } catch {
    throw new TranscribeError('network')
  }
  if (response.status === 401 || response.status === 403) throw new TranscribeError('unauthorized')
  if (!response.ok) throw new TranscribeError('rejected', `${response.status}`)

  const payload = (await response.json()) as {
    text?: string
    language_code?: string
    words?: { text: string; start?: number; end?: number; type?: string }[]
  }
  const text = (payload.text ?? '').trim()
  if (!text) throw new TranscribeError('empty')
  const words: TimedWord[] = (payload.words ?? [])
    .filter((word) => (word.type ?? 'word') === 'word' && word.text.trim())
    .map((word) => ({ text: word.text.trim(), start: word.start ?? 0, end: word.end ?? word.start ?? 0 }))
  return { text, words, language: payload.language_code ?? language }
}

/**
 * Where the reciter breathed, the verse breaks.
 *
 * A pause between two words that is clearly longer than the reciter's
 * ordinary spacing marks a boundary. The threshold adapts to the reader:
 * a slow declaimer leaves wider gaps everywhere, so the cut is measured
 * against the median gap of the recording rather than a fixed number, with
 * a floor so ordinary word spacing never splits a line. Lines then pair
 * up into verses, first as sadr, then as ajuz.
 */
export function wordsToVerses(words: TimedWord[], makeId: () => string, fallbackText = ''): Verse[] {
  if (words.length < 2) return fallbackText ? splitIntoVerses(fallbackText, makeId) : []

  const gaps: number[] = []
  for (let index = 1; index < words.length; index += 1) {
    gaps.push(Math.max(0, words[index].start - words[index - 1].end))
  }
  const sorted = [...gaps].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0
  const threshold = Math.max(0.45, median * 3.5)

  const lines: string[] = []
  let current: string[] = [stripPunctuation(words[0].text)]
  for (let index = 1; index < words.length; index += 1) {
    const gap = gaps[index - 1]
    const previous = words[index - 1].text
    // A full stop the recogniser heard as a sentence end is a break too,
    // even where the pause was short.
    if (gap >= threshold || /[.؟!]$/.test(previous)) {
      lines.push(current.join(' '))
      current = []
    }
    current.push(stripPunctuation(words[index].text))
  }
  if (current.length > 0) lines.push(current.join(' '))

  // One line only means the pauses were not heard; let the text splitter
  // do what it can with the words instead.
  if (lines.length < 2) return splitIntoVerses(fallbackText || lines.join(' '), makeId)

  const verses: Verse[] = []
  for (let index = 0; index < lines.length; index += 2) {
    verses.push({ id: makeId(), sadr: lines[index], ajuz: lines[index + 1] ?? '' })
  }
  return verses
}

function stripPunctuation(word: string): string {
  return word.replace(/^[\s.،,؛;:!؟?…"'«»()\-–—]+|[\s.،,؛;:!؟?…"'«»()\-–—]+$/g, '')
}
