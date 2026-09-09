import type { Suite } from '../harness'
import { eq as makeEq } from '../harness'
import {
  splitSentences,
  summarize,
  shorten,
  simplify,
  keyPoints,
  extractFacts,
  readingStats,
  stem
} from '../../src/renderer/src/lib/text/intelligence'
import { solve, evaluate, normalizeProblem, findProblems, MathError } from '../../src/renderer/src/lib/text/mathsolve'
import { countObjects } from '../../src/renderer/src/lib/images/count'
import { readCode, classify, wifiName } from '../../src/renderer/src/lib/images/scancode'
import { qrMatrix } from '../../src/renderer/src/lib/qr'

/** A contract-shaped Arabic text whose subject is unmistakable. */
const CONTRACT = [
  'عقد إيجار سكني بين المالك والمستأجر.',
  'يلتزم المستأجر بدفع الأجرة الشهرية البالغة 3,500 ريال في اليوم الأول من كل شهر.',
  'مدة العقد سنة واحدة تبدأ من 01/03/2025 وتنتهي في 28/02/2026.',
  'الطقس اليوم جميل.',
  'يحق للمالك فسخ العقد إذا تأخر المستأجر عن دفع الأجرة أكثر من ثلاثين يومًا.',
  'للتواصل: owner@example.com أو +966501234567.'
].join(' ')

/** Objects on a plain background: nine discs, two of them touching. */
function discs(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 600
  canvas.height = 600
  const context = canvas.getContext('2d')!
  context.fillStyle = '#f2f2f2'
  context.fillRect(0, 0, 600, 600)
  context.fillStyle = '#1b1b1b'
  const centres: [number, number][] = [
    [90, 90], [250, 90], [410, 90],
    [90, 250], [250, 250], [410, 250],
    [90, 410], [250, 410], [410, 410]
  ]
  for (const [x, y] of centres) {
    context.beginPath()
    context.arc(x, y, 42, 0, Math.PI * 2)
    context.fill()
  }
  return canvas
}

const suite: Suite = {
  name: 'intelligence',
  async run(check) {
    const eq = makeEq(check)

    /* ------------------------------------------------------- sentences */

    eq('sentence count', splitSentences(CONTRACT).length, 6)
    eq(
      'decimal point is not a sentence end',
      splitSentences('القياس 3.5 مم. والوزن 2.25 كجم.').length,
      2
    )
    eq(
      'decimal survives the split',
      splitSentences('القياس 3.5 مم. تم.')[0].text.includes('3.5'),
      true
    )
    eq('arabic question mark ends a sentence', splitSentences('ما هذا؟ هذا عقد.').length, 2)

    /* ------------------------------------------------------- summarise */

    const summary = summarize(CONTRACT, { ratio: 0.34 })
    check('summary is shorter than the source', summary.length < CONTRACT.length * 0.75, `${summary.length}/${CONTRACT.length}`)
    check(
      'summary quotes the document, inventing nothing',
      splitSentences(summary).every((sentence) => CONTRACT.includes(sentence.text)),
      summary
    )
    check('summary keeps the subject', /عقد|الأجرة|المستأجر/.test(summary), summary)
    check('summary drops the sentence about the weather', !summary.includes('الطقس'), summary)
    eq('a two-sentence text is returned whole', summarize('جملة أولى. جملة ثانية.'), 'جملة أولى. جملة ثانية.')
    eq('empty text summarises to nothing', summarize(''), '')

    const brief = shorten(CONTRACT)
    check('shorten is at most as long as summarise', brief.length <= summary.length, `${brief.length}/${summary.length}`)

    const points = keyPoints(CONTRACT, 3)
    eq('key points count', points.length, 3)
    check('key points are in document order', points.every((point) => CONTRACT.includes(point)), points.join(' | '))

    /* -------------------------------------------------------- simplify */

    const wordy = 'In order to complete the transfer, and due to the fact that the account was dormant, the bank will contact the customer prior to the settlement date.'
    const plain = simplify(wordy)
    check('simplify replaces padded connectives', /\bto complete\b/.test(plain) && /because/.test(plain), plain)
    check('simplify keeps every fact', /bank/.test(plain) && /customer/.test(plain) && /settlement/.test(plain), plain)
    check('simplify does not shorten the text away', plain.length > wordy.length * 0.5, plain)

    const arabicWordy = 'نظرًا لكون المستأجر قد تأخر في السداد، وفي حالة ما إذا استمر التأخير، يتعين على المالك إشعاره خطيًا قبل الشروع في اتخاذ أي إجراء.'
    const arabicPlain = simplify(arabicWordy)
    check('arabic simplify plainer', /لأن/.test(arabicPlain) && /إذا/.test(arabicPlain), arabicPlain)

    /* ----------------------------------------------------------- facts */

    const facts = extractFacts(CONTRACT)
    check('finds the amount', facts.amounts.some((a) => a.includes('3500') || a.includes('3,500')), facts.amounts.join(','))
    eq('finds both dates', facts.dates.length, 2)
    eq('finds the email', facts.emails[0], 'owner@example.com')
    check('finds the phone', facts.phones.some((p) => p.replace(/\D/g, '') === '966501234567'), facts.phones.join(','))
    eq('no false IBAN', facts.ibans.length, 0)

    const stats = readingStats(CONTRACT)
    check('word count is plausible', stats.words > 40 && stats.words < 90, String(stats.words))
    eq('sentence count matches', stats.sentences, 6)

    eq('stem folds article and sound plural', stem('المستأجر'), stem('للمستأجرين'))
    eq('stem leaves short words alone', stem('من'), 'من')

    /* ------------------------------------------------------------ math */

    eq('normalise arabic digits', normalizeProblem('٣ + ٤'), '3 + 4')
    eq('normalise multiplication sign', normalizeProblem('12 × 3'), '12*3')
    eq('normalise arabic words', normalizeProblem('٣ في ٤'), '3 * 4')
    eq('unknown survives normalising', normalizeProblem('٢س + ٥ = ١٣'), '2x + 5 = 13')

    eq('precedence', evaluate('2 + 3 * 4'), 14)
    eq('brackets', evaluate('(2 + 3) * 4'), 20)
    eq('power is right associative', evaluate('2^3^2'), 512)
    eq('unary minus', evaluate('-5 + 8'), 3)
    eq('implicit multiplication', evaluate('3(4+1)'), 15)
    eq('decimals', evaluate('1.5 * 4'), 6)
    eq('thousands separator', evaluate(normalizeProblem('1,000 + 5')), 1005)
    eq('percent of', evaluate('15% of 240'), 36)

    eq('solve an expression', solve('12 × (3 + 4) ÷ 2').answer, '42')
    eq('solve an equation', solve('2x + 5 = 13').answer, 'x = 4')
    eq('solve an arabic equation', solve('٢س + ٥ = ١٣').answer, 'x = 4')
    eq('equation with x on both sides', solve('3x + 2 = x + 10').answer, 'x = 4')
    eq('fractional root', solve('2x = 5').answer, 'x = 2.5')

    check('divide by zero is refused', refuses(() => solve('4 ÷ 0')), 'expected MathError')
    check('a quadratic is refused, not guessed', refuses(() => solve('x^2 + 1 = 0')), 'expected MathError')
    check('an impossible equation is refused', refuses(() => solve('x + 1 = x + 2')), 'expected MathError')
    check('prose is refused', refuses(() => solve('اسم الطالب')), 'expected MathError')
    check(
      'no code execution from a photograph',
      refuses(() => solve('constructor.constructor("return 1")()')),
      'expected MathError'
    )

    const sheet = 'ورقة عمل الرياضيات\nالاسم: أحمد\n12 + 8 =\n٧ × ٦ =\nصفحة 2'
    const problems = findProblems(sheet)
    eq('finds only the problems', problems.length, 2)
    check('keeps the arabic problem', problems.some((line) => line.includes('٧')), problems.join(' | '))

    /* ---------------------------------------------------------- counting */

    const nine = countObjects(discs())
    eq('counts nine separated discs', nine.total, 9)
    check('every disc has a marker', nine.objects.length === 9, String(nine.objects.length))
    check('median area is about a disc', Math.abs(nine.medianArea - Math.PI * 42 * 42) / (Math.PI * 42 * 42) < 0.1, String(nine.medianArea))

    // Dust that a naive labelling would count as objects.
    const noisy = discs()
    const dust = noisy.getContext('2d')!
    dust.fillStyle = '#111'
    for (let i = 0; i < 60; i += 1) dust.fillRect(20 + ((i * 37) % 560), 520 + ((i * 13) % 60), 2, 2)
    eq('specks are not counted', countObjects(noisy).total, 9)

    // Pale objects on a dark tray: the polarity must be found, not assumed.
    const inverted = document.createElement('canvas')
    inverted.width = 600
    inverted.height = 600
    const ic = inverted.getContext('2d')!
    ic.fillStyle = '#101010'
    ic.fillRect(0, 0, 600, 600)
    ic.fillStyle = '#e8e8e8'
    for (const [x, y] of [[120, 120], [300, 120], [480, 120], [120, 300], [300, 300]] as [number, number][]) {
      ic.beginPath()
      ic.arc(x, y, 44, 0, Math.PI * 2)
      ic.fill()
    }
    eq('counts pale objects on a dark ground', countObjects(inverted).total, 5)

    /* ------------------------------------------------------------- codes */

    // Round trip: the app's own encoder draws it, the reader reads it back.
    const url = 'https://alcode.app/invoice/12345'
    eq('reads a clean code', readCode(drawCode(url, 8, 0))?.text, url)
    // A code photographed from a distance is a small patch of a big frame.
    eq('reads a small code in a large frame', readCode(drawCode(url, 3, 260))?.text, url)
    // White on black is what packaging prints.
    eq('reads an inverted code', readCode(drawCode(url, 8, 0, true))?.text, url)
    eq('a picture with no code reads as none', readCode(blank()), null)

    const box = readCode(drawCode(url, 8, 40))
    check('reports four corners inside the picture', box?.corners.length === 4 &&
      box.corners.every((c) => c.x >= 0 && c.y >= 0 && c.x <= 600 && c.y <= 600), JSON.stringify(box?.corners))

    eq('classifies a link', classify('https://example.com'), 'url')
    eq('classifies a phone', classify('tel:+966501234567'), 'phone')
    eq('classifies an email', classify('name@example.com'), 'email')
    eq('classifies wifi', classify('WIFI:T:WPA;S:Alcode;P:secret;;'), 'wifi')
    eq('classifies a contact', classify('BEGIN:VCARD\nFN:Ahmed'), 'contact')
    eq('classifies plain text', classify('عقد الإيجار'), 'text')
    eq('reads the wifi name', wifiName('WIFI:T:WPA;S:Alcode Guest;P:secret;;'), 'Alcode Guest')
    eq('unescapes a wifi name', wifiName('WIFI:S:Cafe\\;Bar;;'), 'Cafe;Bar')
  }
}

/** Draws a code the app's own encoder produced, at a given module size. */
function drawCode(text: string, module: number, margin: number, invert = false): HTMLCanvasElement {
  const { size: modules, modules: bits } = qrMatrix(text)
  const canvas = document.createElement('canvas')
  canvas.width = 600
  canvas.height = 600
  const context = canvas.getContext('2d')!
  context.fillStyle = invert ? '#111' : '#fff'
  context.fillRect(0, 0, 600, 600)
  const size = modules * module
  const left = margin > 0 ? margin : Math.round((600 - size) / 2)
  const top = margin > 0 ? margin : Math.round((600 - size) / 2)
  context.fillStyle = invert ? '#fff' : '#111'
  for (let y = 0; y < modules; y += 1) {
    for (let x = 0; x < modules; x += 1) {
      if (bits[y * modules + x]) context.fillRect(left + x * module, top + y * module, module, module)
    }
  }
  return canvas
}

function blank(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 400
  canvas.height = 400
  const context = canvas.getContext('2d')!
  context.fillStyle = '#dcdcdc'
  context.fillRect(0, 0, 400, 400)
  context.fillStyle = '#333'
  context.font = '28px sans-serif'
  context.fillText('no code here', 40, 200)
  return canvas
}

function refuses(run: () => unknown): boolean {
  try {
    run()
    return false
  } catch (error) {
    return error instanceof MathError
  }
}

export default suite
