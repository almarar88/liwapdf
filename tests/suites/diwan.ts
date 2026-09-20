import type { Suite } from '../harness'
import { eq as makeEq, saveArtifact } from '../harness'
import { guessRhyme, poemToText, splitIntoVerses } from '../../src/renderer/src/lib/diwan/parse'
import { emptyPoem, filledVerses, poemLabel } from '../../src/renderer/src/lib/diwan/types'
import { renderDiwanPdf } from '../../src/renderer/src/lib/diwan/pdf'
import { parseDiwan, serializeDiwan } from '../../src/renderer/src/lib/diwan/store'
import { wordsToVerses } from '../../src/renderer/src/lib/diwan/transcribe'
import { diwanHtml, poemHtml, poemPlainText } from '../../src/renderer/src/lib/diwan/export'
import { fontFamilyFor, styleOf } from '../../src/renderer/src/lib/diwan/types'

let counter = 0
const id = (): string => `v${(counter += 1)}`

const suite: Suite = {
  name: 'diwan',
  async run(check) {
    const eq = makeEq(check)

    // Splitting pasted text into sadr and ajuz.
    const starred = splitIntoVerses('يا طير يا اللي في سماك تحلّق ✦ سلّم على من في الديار حبيبي\nقل له عيوني بالسهر تتعلّق * والقلب من فرقاه صار غريبي', id)
    eq('star split count', starred.length, 2)
    eq('star split sadr', starred[0].sadr, 'يا طير يا اللي في سماك تحلّق')
    eq('star split ajuz', starred[0].ajuz, 'سلّم على من في الديار حبيبي')
    eq('asterisk split ajuz', starred[1].ajuz, 'والقلب من فرقاه صار غريبي')

    const gapped = splitIntoVerses('صدر البيت الأول      عجز البيت الأول\nصدر البيت الثاني — عجز البيت الثاني', id)
    eq('wide gap split', gapped[0].ajuz, 'عجز البيت الأول')
    eq('dash is not a separator alone', gapped[1].sadr, 'صدر البيت الثاني — عجز البيت الثاني')

    const dashed = splitIntoVerses('صدر البيت الثاني -- عجز البيت الثاني', id)
    eq('double dash split', dashed[0].ajuz, 'عجز البيت الثاني')

    const paired = splitIntoVerses('سطر أول\nسطر ثانٍ\nسطر ثالث\nسطر رابع', id)
    eq('line pairs become verses', paired.length, 2)
    eq('line pairs ajuz', paired[1].ajuz, 'سطر رابع')

    const lone = splitIntoVerses('كلمة واحدة اثنتان ثلاث أربع خمس ست سبع ثمان', id)
    eq('lone long line cut at the middle: sadr', lone[0].sadr, 'كلمة واحدة اثنتان ثلاث أربع')
    eq('lone long line cut at the middle: ajuz', lone[0].ajuz, 'خمس ست سبع ثمان')

    const odd = splitIntoVerses('نصف بيت\nصدر ✦ عجز', id)
    eq('odd line before a starred one keeps its own verse', odd.length, 2)
    eq('odd line ajuz empty', odd[0].ajuz, '')

    eq('empty text', splitIntoVerses('  \n\n', id).length, 0)

    // Round trip through the text form.
    const poem = emptyPoem('p1', 'v0')
    poem.title = 'مسحوب الليل'
    poem.verses = starred
    poem.occasion = 'قيلت في ليلة سفر'
    const text = poemToText(poem)
    eq('text form line count', text.split('\n').length, 2)
    eq('text form round trip', splitIntoVerses(text, id)[1].sadr, starred[1].sadr)
    eq('poem label is title', poemLabel(poem, 'x'), 'مسحوب الليل')
    eq('poem label falls back to first words', poemLabel({ ...poem, title: '' }, 'x'), 'يا طير يا اللي في')
    eq('filled verses ignore blanks', filledVerses({ ...poem, verses: [...poem.verses, { id: 'e', sadr: ' ', ajuz: '' }] }).length, 2)
    eq('rhyme letter skips the final vowel', guessRhyme(poem), 'ب')

    // A recitation's word timings (from a real transcription of a two-verse
    // recording) split at the pauses between the halves.
    const timed = [
      ['يا', 0.1, 0.2], ['طير', 0.2, 1.0], ['يا', 1.1, 1.2], ['اللي', 1.2, 1.5], ['في', 1.5, 1.7], ['سماك', 1.7, 2.0], ['تحلق', 2.0, 2.5],
      ['سلم', 3.6, 4.0], ['على', 4.0, 4.1], ['من', 4.1, 4.3], ['في', 4.3, 4.4], ['الديار', 4.4, 4.8], ['حبيبي', 4.8, 5.3],
      ['قل', 6.3, 6.4], ['له', 6.4, 6.5], ['عيوني', 6.5, 7.0], ['بالسهر', 7.0, 7.6], ['تتعلق', 7.9, 8.4],
      ['والقلب', 9.5, 10.2], ['من', 10.2, 10.4], ['فراقه', 10.4, 10.9], ['صار', 10.9, 11.2], ['غريبي.', 11.2, 11.8]
    ].map(([text, start, end]) => ({ text: String(text), start: Number(start), end: Number(end) }))
    const heard = wordsToVerses(timed, id)
    eq('timed words become two verses', heard.length, 2)
    eq('timed sadr 1', heard[0].sadr, 'يا طير يا اللي في سماك تحلق')
    eq('timed ajuz 1', heard[0].ajuz, 'سلم على من في الديار حبيبي')
    eq('timed ajuz 2 without punctuation', heard[1].ajuz, 'والقلب من فراقه صار غريبي')
    eq('no timings falls back to text', wordsToVerses([], id, 'صدر ✦ عجز')[0].ajuz, 'عجز')

    // Exports: the two-column table and the plain text form.
    const html = poemHtml(poem, 'شاعر')
    check('poem html has one row per verse', (html.match(/<tr>/g) ?? []).length === 2 && html.includes('مسحوب الليل') && html.includes('— شاعر'))
    const plain = poemPlainText(poem, 'شاعر')
    eq('plain text starts with the title', plain.split('\n')[0], 'مسحوب الليل')
    check('plain text carries the star and the signature', plain.includes(' ✦ ') && plain.trim().endsWith('— شاعر'))
    check('diwan html separates poems with page breaks', (diwanHtml([poem, poem], 'ديوان', 'شاعر').match(/page-break-before/g) ?? []).length === 2)
    eq('default style', styleOf(poem).font, 'amiri')
    eq('style falls back per field', styleOf({ style: { theme: 'night' } }).font, 'amiri')
    check('every face resolves to a family', fontFamilyFor('ruqaa').includes('Aref Ruqaa') && fontFamilyFor(undefined).includes('Amiri'))

    // Backup round trip.
    const restored = parseDiwan(serializeDiwan([poem]))
    eq('backup keeps the poem', restored[0]?.verses[1]?.ajuz, starred[1].ajuz)
    let rejected = false
    try {
      parseDiwan('{"poems": 1}')
    } catch {
      rejected = true
    }
    check('backup rejects a foreign file', rejected)

    // The printed book: a cover, an index and one page per poem.
    const second = { ...emptyPoem('p2', 'v9'), title: 'قصيدة ثانية', verses: gapped, form: 'fusha' as const, meter: 'الطويل' }
    const bytes = await renderDiwanPdf([poem, second], {
      title: 'ديوان التجربة',
      poet: 'شاعر الاختبار',
      language: 'ar',
      cover: true,
      index: true,
      occasions: true,
      pagePerPoem: true,
      pageSize: 'A5'
    })
    saveArtifact('diwan.pdf', bytes)
    check('diwan pdf is a pdf', bytes.length > 2000 && String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-')
    const { PDFDocument } = await import('@cantoo/pdf-lib')
    const loaded = await PDFDocument.load(bytes)
    eq('diwan pdf page count (cover, index, two poems)', loaded.getPageCount(), 4)
    eq('diwan pdf title', loaded.getTitle(), 'ديوان التجربة')

    const single = await renderDiwanPdf([poem], {
      title: 'x',
      poet: '',
      language: 'en',
      cover: false,
      index: false,
      occasions: false,
      pagePerPoem: true,
      pageSize: 'A4'
    })
    eq('single poem pdf is one page', (await PDFDocument.load(single)).getPageCount(), 1)
  }
}
export default suite
