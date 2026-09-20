import type { Suite } from '../harness'
import { eq as makeEq, saveArtifact } from '../harness'
import { guessRhyme, poemToText, splitIntoVerses } from '../../src/renderer/src/lib/diwan/parse'
import { emptyPoem, filledVerses, poemLabel } from '../../src/renderer/src/lib/diwan/types'
import { renderDiwanPdf } from '../../src/renderer/src/lib/diwan/pdf'
import { parseDiwan, serializeDiwan } from '../../src/renderer/src/lib/diwan/store'

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
