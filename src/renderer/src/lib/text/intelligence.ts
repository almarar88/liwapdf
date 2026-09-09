/**
 * Reading a document for you, on the device, with no model and no network.
 *
 * "Ask AI" in a document app usually means the document is uploaded to
 * somebody's server. That is exactly what this app promises not to do, and a
 * contract or a medical report is the last text anyone should be posting to a
 * third party. So the work is done here, extractively: the summary is built
 * out of the document's own sentences rather than generated, which also means
 * it cannot invent a clause that was never in the file — the failure mode that
 * matters most when the text is legal or medical.
 *
 * The scoring is classic and language-agnostic where it can be: term
 * frequency over content words, a position bonus because documents put their
 * subject first, a length penalty so a heading never outranks a clause. Arabic
 * gets what it needs on top — its own stop list, its own sentence punctuation,
 * and a light stemmer that folds the definite article and the sound suffixes
 * so "المستأجر" and "للمستأجرين" count as the same word. Broken plurals
 * ("عقد" / "عقود") are left apart: folding them needs a lexicon, and a rule
 * aggressive enough to catch them merges words that are genuinely different.
 */

/* ------------------------------------------------------------- sentences */

/** Terminators: Latin, the Arabic question mark and semicolon, and newlines. */
const SENTENCE_END = /([.!?؟؛…]+|\n{2,})/

/** Stand-in for a dot that is not a sentence end, restored afterwards. */
const INNER_DOT = '\u0001'

export interface Sentence {
  text: string
  /** Index in the original order, so a summary can be re-sorted into it. */
  index: number
}

/**
 * Splits text into sentences without breaking on the dots inside numbers,
 * addresses or file names.
 *
 * A sentence's full stop is followed by a space; a dot with a letter or digit
 * on both sides of it belongs to what it is written inside — 3.5, example.com,
 * invoice-01.pdf, U.S. — and is hidden from the splitter rather than being
 * enumerated case by case.
 */
export function splitSentences(text: string): Sentence[] {
  const guarded = text.replace(/([\p{L}\p{N}])\.(?=[\p{L}\p{N}])/gu, `$1${INNER_DOT}`)
  const parts = guarded.split(SENTENCE_END)
  const out: Sentence[] = []
  let buffer = ''
  for (const part of parts) {
    if (part === undefined) continue
    buffer += part
    if (SENTENCE_END.test(part)) {
      const clean = restore(buffer)
      if (clean) out.push({ text: clean, index: out.length })
      buffer = ''
    }
  }
  const tail = restore(buffer)
  if (tail) out.push({ text: tail, index: out.length })
  return out
}

function restore(value: string): string {
  return value.split(INNER_DOT).join('.').replace(/\s+/g, ' ').trim()
}

/* ----------------------------------------------------------------- words */

const ARABIC_STOP = new Set(
  ('من إلى عن على في مع هذا هذه ذلك تلك التي الذي الذين اللذان اللتان ما لا لم لن قد كان كانت يكون تكون هو هي هم هن نحن أنا أنت أنتم و ثم أو أم بل حتى إذا إن أن أنه إنه كما لكن غير بين بعد قبل عند لدى حيث كل بعض أي أية له لها لهم به بها فيه فيها منه منها عليه عليها إليه إليها ذات ذو هناك هنالك ليس ليست سوف سـ نعم أيضا أيضًا حين خلال ضمن دون بدون سبق مثل نحو تحت فوق أمام خلف يمكن يجب ينبغي التالي السابق' +
    ' الى او فى')
    .split(/\s+/)
    .filter(Boolean)
)

const LATIN_STOP = new Set(
  'the a an and or but of to in on at for with from by as is are was were be been being this that these those it its he she they we you i not no if then than so such which who whom whose will would shall should can could may might must do does did have has had there here about into over under between after before during within without any all each other more most some own same only own very'
    .split(/\s+/)
    .filter(Boolean)
)

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu

/**
 * Folds a word to the form used for counting.
 *
 * Arabic is highly inflected and a document says "العقد", "بالعقد", "للعقود"
 * about the same thing; without this the term that carries the document loses
 * to whatever happened to be spelled consistently. The rules are deliberately
 * shallow — prefixes that are certainly clitics, suffixes that are certainly
 * inflection — because an aggressive stemmer merges words that differ.
 */
export function stem(word: string): string {
  let out = word.toLowerCase()
  if (/[؀-ۿ]/.test(out)) {
    out = out.replace(/[ً-ْٰـ]/g, '')
    out = out.replace(/^(وال|بال|كال|فال|لل|ال)/, '')
    out = out.replace(/^[وفبك](?=[؀-ۿ]{3,})/, '')
    out = out.replace(/(ات|ون|ين|ان|ها|هم|هن|كم|كن|نا|ية|ه|ة)$/, '')
    out = out.replace(/[أإآ]/g, 'ا').replace(/ى$/, 'ي')
    return out
  }
  return out.replace(/(ing|edly|ies|es|ed|ly|s)$/, (match) => (out.length > match.length + 2 ? '' : match))
}

function isStop(word: string): boolean {
  const lower = word.toLowerCase()
  return ARABIC_STOP.has(lower) || LATIN_STOP.has(lower) || lower.length < 2
}

/** Content words of a sentence, folded and de-noised. */
function terms(sentence: string): string[] {
  return (sentence.match(WORD) ?? []).filter((word) => !isStop(word)).map(stem).filter((word) => word.length > 1)
}

/* ------------------------------------------------------------- summarise */

export interface SummaryOptions {
  /** Share of the sentences to keep, 0–1. Clamped to at least one sentence. */
  ratio?: number
  /** Hard cap on sentences, whatever the ratio works out to. */
  maxSentences?: number
}

interface Scored extends Sentence {
  score: number
}

function score(sentences: Sentence[]): Scored[] {
  const frequency = new Map<string, number>()
  for (const sentence of sentences) {
    for (const term of new Set(terms(sentence.text))) {
      frequency.set(term, (frequency.get(term) ?? 0) + 1)
    }
  }
  const peak = Math.max(1, ...frequency.values())

  return sentences.map((sentence) => {
    const words = terms(sentence.text)
    if (words.length === 0) return { ...sentence, score: 0 }
    // Mean weight rather than sum: otherwise the longest sentence always wins
    // and the summary is the three longest clauses in the file.
    const weight = words.reduce((total, word) => total + (frequency.get(word) ?? 0) / peak, 0) / words.length
    // Documents state their subject early and their conclusion late.
    const place = sentence.index / Math.max(1, sentences.length - 1)
    const position = place < 0.2 ? 1.18 : place > 0.85 ? 1.06 : 1
    // A three-word fragment is a heading; a sixty-word one is a whole section.
    const length = words.length < 4 ? 0.55 : words.length > 45 ? 0.85 : 1
    return { ...sentence, score: weight * position * length }
  })
}

/**
 * The document's own sentences, the important ones, in the order they appear.
 */
export function summarize(text: string, options: SummaryOptions = {}): string {
  const sentences = splitSentences(text)
  if (sentences.length <= 2) return sentences.map((s) => s.text).join(' ')

  const ratio = Math.min(0.9, Math.max(0.05, options.ratio ?? 0.28))
  const wanted = Math.max(
    1,
    Math.min(options.maxSentences ?? Number.MAX_SAFE_INTEGER, Math.round(sentences.length * ratio))
  )

  const ranked = score(sentences).sort((a, b) => b.score - a.score).slice(0, wanted)
  return ranked.sort((a, b) => a.index - b.index).map((sentence) => sentence.text).join(' ')
}

/** Half the length of a summary: the gist, for a message rather than a file. */
export function shorten(text: string): string {
  const stripped = text.replace(FILLER, '').replace(/\s{2,}/g, ' ')
  return summarize(stripped, { ratio: 0.15, maxSentences: 5 })
}

/** Phrases that carry no information in either language. */
const FILLER =
  /\b(?:it (?:is|should be) (?:worth )?not(?:ed|ing) that|please note that|as (?:a matter of fact|previously mentioned)|in order to|due to the fact that)\b|(?:و)?(?:من )?الجدير بالذكر أن|تجدر الإشارة إلى أن|كما هو معلوم|وذلك من أجل|بناءً على ما تقدم/gi

/**
 * The important sentences as separate points, for reading rather than quoting.
 */
export function keyPoints(text: string, count = 5): string[] {
  const sentences = splitSentences(text)
  if (sentences.length === 0) return []
  return score(sentences)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, count))
    .sort((a, b) => a.index - b.index)
    .map((sentence) => sentence.text.replace(/^[-–—•\s]+/, ''))
}

/* -------------------------------------------------------------- simplify */

/** Long-winded connectives, and the plain word that says the same thing. */
const PLAINER: [RegExp, string][] = [
  [/\bin order to\b/gi, 'to'],
  [/\bdue to the fact that\b/gi, 'because'],
  [/\bin the event that\b/gi, 'if'],
  [/\bwith regard to\b/gi, 'about'],
  [/\bat this point in time\b/gi, 'now'],
  [/\bprior to\b/gi, 'before'],
  [/\bsubsequent to\b/gi, 'after'],
  [/\butilis?e(d|s)?\b/gi, 'use$1'],
  [/\bin the near future\b/gi, 'soon'],
  [/نظرًا لكون|نظرا لكون|بالنظر إلى أن/g, 'لأن'],
  [/في حالة ما إذا|في حال ما إذا/g, 'إذا'],
  [/فيما يتعلق بـ?|بخصوص ما يتعلق بـ?/g, 'عن'],
  [/في الوقت الراهن|في الوقت الحالي/g, 'الآن'],
  [/قبل قيام|قبل الشروع في/g, 'قبل'],
  [/يتعين على|يتوجب على/g, 'على'],
  [/القيام بـ/g, '']
]

/** Where a long sentence can be cut without losing the join. */
const JOINS = /(?:،\s*(?:و|ثم|كما|حيث|بينما|إذ)\b|\s+(?:,\s*)?(?:and|but|which|while|whereas|however)\s+)/

/**
 * Shorter sentences and plainer words, with every fact kept.
 *
 * Simplifying is not summarising: nothing is dropped. Long sentences are cut
 * at their joins and the padded connectives are replaced, which is most of
 * what makes official Arabic and legal English hard to read.
 */
export function simplify(text: string, maxWords = 22): string {
  let out = text
  for (const [pattern, plain] of PLAINER) out = out.replace(pattern, plain)
  out = out.replace(/\s{2,}/g, ' ')

  return splitSentences(out)
    .map((sentence) => cut(sentence.text, maxWords).join(' '))
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function cut(sentence: string, maxWords: number): string[] {
  if ((sentence.match(WORD) ?? []).length <= maxWords) return [sentence]
  const pieces = sentence.split(JOINS).map((piece) => piece.trim()).filter(Boolean)
  if (pieces.length < 2) return [sentence]
  return pieces.map((piece, index) => {
    const first = piece.charAt(0)
    const head = index > 0 && /[a-z]/.test(first) ? first.toUpperCase() + piece.slice(1) : piece
    return /[.!?؟]$/.test(head) ? head : `${head}.`
  })
}

/* ---------------------------------------------------------------- facts */

export interface Facts {
  dates: string[]
  amounts: string[]
  percentages: string[]
  emails: string[]
  phones: string[]
  ibans: string[]
  urls: string[]
}

const PATTERNS: [keyof Facts, RegExp][] = [
  ['emails', /[\w.+-]+@[\w-]+\.[\w.]{2,}/g],
  ['urls', /https?:\/\/[^\s<>"')]+/g],
  ['ibans', /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g],
  ['phones', /(?:\+|00)\d[\d\s()-]{7,17}\d/g],
  ['percentages', /\d+(?:[.,]\d+)?\s?%|%\s?\d+(?:[.,]\d+)?/g],
  [
    'amounts',
    /(?:[$€£¥]|ر\.?س|ريال|درهم|دينار|جنيه|SAR|AED|KWD|USD|EUR|GBP|QAR|BHD|OMR|EGP)\s?\d[\d,.٫٬]*|\d[\d,.٫٬]*\s?(?:ر\.?س|ريال|ريالا|درهم|دينار|جنيه|SAR|AED|KWD|USD|EUR|GBP|QAR|BHD|OMR|EGP)/gi
  ],
  [
    'dates',
    /\b\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\s(?:يناير|فبراير|مارس|أبريل|ابريل|مايو|يونيو|يوليو|أغسطس|اغسطس|سبتمبر|أكتوبر|اكتوبر|نوفمبر|ديسمبر|محرم|صفر|ربيع|جمادى|رجب|شعبان|رمضان|شوال|ذو)\S*\s\d{4}\b|\b\d{1,2}\s(?:January|February|March|April|May|June|July|August|September|October|November|December)\s\d{4}\b/gi
  ]
]

/**
 * The things a person actually looks for in a document — what it costs, when
 * it starts, who to call — pulled out so they can be read at a glance.
 */
export function extractFacts(text: string): Facts {
  const facts: Facts = { dates: [], amounts: [], percentages: [], emails: [], phones: [], ibans: [], urls: [] }
  for (const [key, pattern] of PATTERNS) {
    const found = text.match(pattern) ?? []
    facts[key] = unique(found.map((value) => value.replace(/\s{2,}/g, ' ').trim()))
  }
  // A URL contains no email and an email is not a phone number: the looser
  // patterns would otherwise report pieces of the stricter ones.
  const inside = new Set([...facts.emails, ...facts.urls].join(' ').match(/\d[\d\s()-]{7,}\d/g) ?? [])
  facts.phones = facts.phones.filter((phone) => !inside.has(phone))
  return facts
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

/** Words, sentences and an estimate of how long the text takes to read. */
export function readingStats(text: string): { words: number; sentences: number; minutes: number } {
  const words = (text.match(WORD) ?? []).length
  return {
    words,
    sentences: splitSentences(text).length,
    // 200 wpm is the usual adult figure for prose read on a screen.
    minutes: Math.max(1, Math.round(words / 200))
  }
}
