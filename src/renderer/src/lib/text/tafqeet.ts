/**
 * Numbers in words — تفقيط — for invoices, contracts and cheques.
 *
 * Arabic counting has rules no template gets right by accident: two of a
 * thing takes the dual (ريالان), three to ten take the plural (ريالات),
 * eleven to ninety-nine take the singular in the accusative (ريالًا), and a
 * round hundred or thousand takes the plain singular (مائة ريال). The
 * thousands and millions follow the same pattern (ألف، ألفان، آلاف). This
 * module knows those rules for the currencies used here, and produces the
 * conventional "فقط … لا غير" form a cheque carries.
 */

export type Currency = 'none' | 'SAR' | 'AED' | 'KWD' | 'QAR' | 'BHD' | 'OMR' | 'EGP' | 'JOD' | 'USD' | 'EUR'

interface UnitForms {
  /** singular, dual, plural (3–10), accusative singular (11–99). */
  one: string
  two: string
  few: string
  many: string
}

interface CurrencyForms {
  major: UnitForms
  minor: UnitForms
  /** Digits of the minor unit: 2 for halalas and fils, 3 for Kuwaiti fils. */
  minorDigits: number
  english: { major: [string, string]; minor: [string, string] }
}

export const CURRENCIES: Record<Exclude<Currency, 'none'>, CurrencyForms> = {
  SAR: {
    major: { one: 'ريال', two: 'ريالان', few: 'ريالات', many: 'ريالًا' },
    minor: { one: 'هللة', two: 'هللتان', few: 'هللات', many: 'هللة' },
    minorDigits: 2,
    english: { major: ['riyal', 'riyals'], minor: ['halala', 'halalas'] }
  },
  AED: {
    major: { one: 'درهم', two: 'درهمان', few: 'دراهم', many: 'درهمًا' },
    minor: { one: 'فلس', two: 'فلسان', few: 'فلوس', many: 'فلسًا' },
    minorDigits: 2,
    english: { major: ['dirham', 'dirhams'], minor: ['fils', 'fils'] }
  },
  QAR: {
    major: { one: 'ريال', two: 'ريالان', few: 'ريالات', many: 'ريالًا' },
    minor: { one: 'درهم', two: 'درهمان', few: 'دراهم', many: 'درهمًا' },
    minorDigits: 2,
    english: { major: ['riyal', 'riyals'], minor: ['dirham', 'dirhams'] }
  },
  KWD: {
    major: { one: 'دينار', two: 'ديناران', few: 'دنانير', many: 'دينارًا' },
    minor: { one: 'فلس', two: 'فلسان', few: 'فلوس', many: 'فلسًا' },
    minorDigits: 3,
    english: { major: ['dinar', 'dinars'], minor: ['fils', 'fils'] }
  },
  BHD: {
    major: { one: 'دينار', two: 'ديناران', few: 'دنانير', many: 'دينارًا' },
    minor: { one: 'فلس', two: 'فلسان', few: 'فلوس', many: 'فلسًا' },
    minorDigits: 3,
    english: { major: ['dinar', 'dinars'], minor: ['fils', 'fils'] }
  },
  OMR: {
    major: { one: 'ريال', two: 'ريالان', few: 'ريالات', many: 'ريالًا' },
    minor: { one: 'بيسة', two: 'بيستان', few: 'بيسات', many: 'بيسة' },
    minorDigits: 3,
    english: { major: ['rial', 'rials'], minor: ['baisa', 'baisa'] }
  },
  EGP: {
    major: { one: 'جنيه', two: 'جنيهان', few: 'جنيهات', many: 'جنيهًا' },
    minor: { one: 'قرش', two: 'قرشان', few: 'قروش', many: 'قرشًا' },
    minorDigits: 2,
    english: { major: ['pound', 'pounds'], minor: ['piastre', 'piastres'] }
  },
  JOD: {
    major: { one: 'دينار', two: 'ديناران', few: 'دنانير', many: 'دينارًا' },
    minor: { one: 'قرش', two: 'قرشان', few: 'قروش', many: 'قرشًا' },
    minorDigits: 2,
    english: { major: ['dinar', 'dinars'], minor: ['piastre', 'piastres'] }
  },
  USD: {
    major: { one: 'دولار', two: 'دولاران', few: 'دولارات', many: 'دولارًا' },
    minor: { one: 'سنت', two: 'سنتان', few: 'سنتات', many: 'سنتًا' },
    minorDigits: 2,
    english: { major: ['dollar', 'dollars'], minor: ['cent', 'cents'] }
  },
  EUR: {
    major: { one: 'يورو', two: 'يوروان', few: 'يوروات', many: 'يورو' },
    minor: { one: 'سنت', two: 'سنتان', few: 'سنتات', many: 'سنتًا' },
    minorDigits: 2,
    english: { major: ['euro', 'euros'], minor: ['cent', 'cents'] }
  }
}

/* ---------------------------------------------------------------- Arabic */

const ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة']
const TEENS = ['عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر']
const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون']
const HUNDREDS = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة']

/** Scale words: singular, dual, plural (3–10), singular for 11+. */
const SCALES: UnitForms[] = [
  { one: '', two: '', few: '', many: '' },
  { one: 'ألف', two: 'ألفان', few: 'آلاف', many: 'ألفًا' },
  { one: 'مليون', two: 'مليونان', few: 'ملايين', many: 'مليونًا' },
  { one: 'مليار', two: 'ملياران', few: 'مليارات', many: 'مليارًا' },
  { one: 'تريليون', two: 'تريليونان', few: 'تريليونات', many: 'تريليونًا' }
]

/** The form of a counted noun for a given count, per Arabic agreement. */
export function countedForm(count: number, forms: UnitForms): string {
  const tail = count % 100
  if (count === 1) return forms.one
  if (count === 2) return forms.two
  if (tail >= 3 && tail <= 10) return forms.few
  if (tail >= 11 && tail <= 99) return forms.many
  return forms.one
}

function belowThousand(n: number): string {
  const parts: string[] = []
  const hundreds = Math.floor(n / 100)
  const rest = n % 100
  if (hundreds) parts.push(HUNDREDS[hundreds])
  if (rest >= 10 && rest < 20) parts.push(TEENS[rest - 10])
  else {
    const ones = rest % 10
    const tens = Math.floor(rest / 10)
    if (ones) parts.push(ONES[ones])
    if (tens) parts.push(TENS[tens])
  }
  return parts.join(' و')
}

/** Cardinal number in Arabic words (integer part only). */
export function arabicWords(value: number): string {
  const n = Math.floor(Math.abs(value))
  if (n === 0) return 'صفر'
  const groups: string[] = []
  let remaining = n
  let scale = 0
  while (remaining > 0 && scale < SCALES.length) {
    const group = remaining % 1000
    if (group > 0) {
      const scaleForms = SCALES[scale]
      let words: string
      if (scale === 0) words = belowThousand(group)
      else if (group === 1) words = scaleForms.one
      else if (group === 2) words = scaleForms.two
      else words = `${belowThousand(group)} ${countedForm(group, scaleForms)}`
      groups.unshift(words)
    }
    remaining = Math.floor(remaining / 1000)
    scale += 1
  }
  return (value < 0 ? 'سالب ' : '') + groups.join(' و')
}

export interface TafqeetOptions {
  currency?: Currency
  /** Wrap in the cheque form: "فقط … لا غير". */
  formal?: boolean
}

/**
 * A count with its noun: "ريال واحد", "ريالان", "ثلاثة ريالات", "أحد عشر
 * ريالًا", "مائة ريال". One and two are carried by the noun itself.
 */
function counted(count: number, forms: UnitForms): string {
  if (count === 1) return `${forms.one} واحد`
  if (count === 2) return forms.two
  return `${arabicWords(count)} ${countedForm(count, forms)}`
}

/** Amount in Arabic words, with the currency's major and minor units. */
export function tafqeet(value: number, options: TafqeetOptions = {}): string {
  if (!Number.isFinite(value)) return ''
  const currency = options.currency ?? 'none'
  const negative = value < 0
  const amount = Math.abs(value)
  const forms = currency === 'none' ? null : CURRENCIES[currency]
  const minorDigits = forms?.minorDigits ?? 2
  const factor = 10 ** minorDigits
  const major = Math.floor(amount + 1e-9)
  const minor = Math.round((amount - major) * factor)
  const majorFixed = minor >= factor ? major + 1 : major
  const minorFixed = minor >= factor ? 0 : minor

  let text: string
  if (!forms) {
    text = arabicWords(majorFixed)
    if (minorFixed > 0) text += ` فاصلة ${arabicWords(minorFixed)}`
  } else {
    const parts: string[] = []
    if (majorFixed > 0 || minorFixed === 0) parts.push(counted(majorFixed, forms.major))
    if (minorFixed > 0) parts.push(counted(minorFixed, forms.minor))
    text = parts.join(' و')
  }
  if (negative) text = `سالب ${text}`
  return options.formal ? `فقط ${text} لا غير` : text
}

/* --------------------------------------------------------------- English */

const EN_ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
const EN_SCALES = ['', 'thousand', 'million', 'billion', 'trillion']

function englishBelowThousand(n: number): string {
  const parts: string[] = []
  const hundreds = Math.floor(n / 100)
  const rest = n % 100
  if (hundreds) parts.push(`${EN_ONES[hundreds]} hundred`)
  if (rest < 20) {
    if (rest) parts.push(EN_ONES[rest])
  } else {
    const ones = rest % 10
    parts.push(ones ? `${EN_TENS[Math.floor(rest / 10)]}-${EN_ONES[ones]}` : EN_TENS[Math.floor(rest / 10)])
  }
  return parts.join(' and ')
}

export function englishWords(value: number): string {
  const n = Math.floor(Math.abs(value))
  if (n === 0) return 'zero'
  const groups: string[] = []
  let remaining = n
  let scale = 0
  while (remaining > 0 && scale < EN_SCALES.length) {
    const group = remaining % 1000
    if (group > 0) groups.unshift(`${englishBelowThousand(group)}${EN_SCALES[scale] ? ` ${EN_SCALES[scale]}` : ''}`)
    remaining = Math.floor(remaining / 1000)
    scale += 1
  }
  return (value < 0 ? 'minus ' : '') + groups.join(' ')
}

export function spellNumber(value: number, options: TafqeetOptions = {}): string {
  if (!Number.isFinite(value)) return ''
  const currency = options.currency ?? 'none'
  const forms = currency === 'none' ? null : CURRENCIES[currency]
  const minorDigits = forms?.minorDigits ?? 2
  const factor = 10 ** minorDigits
  const amount = Math.abs(value)
  const major = Math.floor(amount + 1e-9)
  const minor = Math.round((amount - major) * factor)
  let text: string
  if (!forms) {
    text = englishWords(major)
    if (minor > 0) text += ` point ${englishWords(minor)}`
  } else {
    const parts = [`${englishWords(major)} ${major === 1 ? forms.english.major[0] : forms.english.major[1]}`]
    if (minor > 0) parts.push(`${englishWords(minor)} ${minor === 1 ? forms.english.minor[0] : forms.english.minor[1]}`)
    text = parts.join(' and ')
  }
  if (value < 0) text = `minus ${text}`
  const capitalised = text.charAt(0).toUpperCase() + text.slice(1)
  return options.formal ? `${capitalised} only` : capitalised
}

/** Resolves a currency argument as typed in a formula or a dialog. */
export function currencyFromText(text: string | undefined): Currency {
  if (!text) return 'none'
  const key = text.trim().toUpperCase()
  if (key in CURRENCIES) return key as Currency
  const byName: Record<string, Currency> = {
    'ريال': 'SAR', 'ريال سعودي': 'SAR', 'درهم': 'AED', 'دينار': 'KWD', 'دينار كويتي': 'KWD',
    'ريال قطري': 'QAR', 'دينار بحريني': 'BHD', 'ريال عماني': 'OMR', 'جنيه': 'EGP', 'دينار أردني': 'JOD',
    'دولار': 'USD', 'يورو': 'EUR'
  }
  return byName[text.trim()] ?? 'none'
}
