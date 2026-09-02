import type { Suite } from '../harness'
import { eq as makeEq } from '../harness'
import { tafqeet, spellNumber, arabicWords } from '../../src/renderer/src/lib/text/tafqeet'
import { cleanArabicText, DEFAULT_CLEANUP } from '../../src/renderer/src/lib/text/cleanup'
import { splitForSpeech } from '../../src/renderer/src/lib/speech'

const suite: Suite = {
  name: 'arabic',
  async run(check) {
    const eq = makeEq(check)
    eq('one riyal', tafqeet(1, { currency: 'SAR' }), 'ريال واحد')
    eq('two riyals', tafqeet(2, { currency: 'SAR' }), 'ريالان')
    eq('three riyals', tafqeet(3, { currency: 'SAR' }), 'ثلاثة ريالات')
    eq('eleven riyals', tafqeet(11, { currency: 'SAR' }), 'أحد عشر ريالًا')
    eq('hundred riyals', tafqeet(100, { currency: 'SAR' }), 'مائة ريال')
    eq('thousand', arabicWords(1000), 'ألف')
    eq('two thousand', arabicWords(2000), 'ألفان')
    eq('three thousand', arabicWords(3000), 'ثلاثة آلاف')
    eq('eleven thousand', arabicWords(11000), 'أحد عشر ألفًا')
    eq('big number', arabicWords(1234567), 'مليون ومائتان وأربعة وثلاثون ألفًا وخمسمائة وسبعة وستون')
    eq('formal with halalas', tafqeet(1234.5, { currency: 'SAR', formal: true }), 'فقط ألف ومائتان وأربعة وثلاثون ريالًا وخمسون هللة لا غير')
    eq('kuwaiti fils', tafqeet(5.25, { currency: 'KWD' }), 'خمسة دنانير ومائتان وخمسون فلسًا')
    eq('english', spellNumber(1234.5, { currency: 'USD' }), 'One thousand two hundred and thirty-four dollars and fifty cents')
    eq('english formal', spellNumber(21, { currency: 'AED', formal: true }), 'Twenty-one dirhams only')

    eq('cleanup default', cleanArabicText('مَرْحَبًا ، كيف   حالك ؟ 123 ـــ  '), 'مرحبا، كيف حالك؟ 123')
    eq('cleanup arabic digits', cleanArabicText('عدد 123 و 45', { ...DEFAULT_CLEANUP, digits: 'arabic' }), 'عدد ١٢٣ و ٤٥')
    eq('cleanup western digits', cleanArabicText('عدد ١٢٣', { ...DEFAULT_CLEANUP, digits: 'western' }), 'عدد 123')
    eq('cleanup hamza leaves final ya', cleanArabicText('أحمد إلى آفاق مستشفى', { ...DEFAULT_CLEANUP, hamza: true }), 'احمد الى افاق مستشفى')
    eq('cleanup keeps latin', cleanArabicText('Version 2.0, ok.'), 'Version 2.0, ok.')

    const long = 'هذه جملة أولى. وهذه جملة ثانية طويلة بعض الشيء، تحتوي على فاصلة! ' + 'x'.repeat(700)
    const chunks = splitForSpeech(long)
    check('speech chunks bounded and complete', chunks.every((c) => c.length <= 320) && chunks.join('').replace(/\s/g, '').length === long.replace(/\s/g, '').length, chunks.map((c) => c.length).join(','))
  }
}
export default suite
