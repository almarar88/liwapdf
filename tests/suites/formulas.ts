import type { Suite } from '../harness'
import { eq as makeEq } from '../harness'
import { recalculate } from '../../src/renderer/src/lib/documents/formulas'
import { inferCell, readWorkbook, writeWorkbook, type SheetData } from '../../src/renderer/src/lib/documents/sheets'

function grid(name: string, cells: string[][]): SheetData {
  return { name, rows: cells.map((row) => row.map((text) => inferCell(text))) }
}
const at = (sheet: SheetData, r: number, c: number): string => sheet.rows[r][c].text

const suite: Suite = {
  name: 'formulas',
  async run(check) {
    const eq = makeEq(check)
    const s1 = recalculate(grid('S', [
      ['10', '20', '=A1+B1'],
      ['5', '', '=SUM(A1:B2)*2'],
      ['=AVERAGE(A1:A2)', '=IF(A1>B1;"big";"small")', '=C1/0'],
      ['=ROUND(10/3;2)', '="a"&"b"&LEN("xyz")', '=COUNT(A1:C2)'],
      ['=SUMIF(A1:A2;">6")', '=COUNTIF(A1:B2;"<15")', '=MAX(A1:B2)-MIN(A1:B2)'],
      ['=D9', '=(2+3)*4^2', '=-A1%'],
      ['=NOPE(1)', '=1+', '=TRUE']
    ]))
    eq('addition', at(s1, 0, 2), '30')
    eq('range sum', at(s1, 1, 2), '70')
    eq('average', at(s1, 2, 0), '7.5')
    eq('IF with text and semicolons', at(s1, 2, 1), 'small')
    eq('divide by zero', at(s1, 2, 2), '#DIV/0!')
    eq('round', at(s1, 3, 0), '3.33')
    eq('concat and LEN', at(s1, 3, 1), 'ab3')
    eq('count', at(s1, 3, 2), '5')
    eq('sumif', at(s1, 4, 0), '10')
    eq('countif ignores blanks for numeric criteria', at(s1, 4, 1), '2')
    eq('max minus min', at(s1, 4, 2), '15')
    eq('empty ref', at(s1, 5, 0), '')
    eq('precedence and power', at(s1, 5, 1), '80')
    eq('percent and unary', at(s1, 5, 2), '-0.1')
    eq('unknown function', at(s1, 6, 0), '#NAME?')
    eq('syntax error', at(s1, 6, 1), '#VALUE!')
    eq('boolean literal', at(s1, 6, 2), 'TRUE')
    eq('cycle detected', at(recalculate(grid('S', [['=B1+1', '=A1+1']])), 0, 0), '#CYCLE!')
    eq('arabic-indic digits', at(recalculate(grid('S', [['٥', '=A1*٢']])), 0, 1), '10')
    eq('chain', at(recalculate(grid('S', [['1'], ['=A1*2'], ['=A2*2'], ['=A3*2']])), 3, 0), '8')

    // Cross-sheet references, quoted and bare.
    const data = grid('Data', [['100', '200'], ['300', '400']])
    const summary = grid('My Summary', [['=SUM(Data!A1:B2)', "=Data!B2*2", "='Data'!A1+1", '=Nowhere!A1']])
    const book = [data, summary]
    const evaluated = recalculate(summary, book)
    eq('sum across sheets', at(evaluated, 0, 0), '1000')
    eq('single cell on another sheet', at(evaluated, 0, 1), '800')
    eq('quoted sheet name', at(evaluated, 0, 2), '101')
    eq('missing sheet is #REF!', at(evaluated, 0, 3), '#REF!')

    // TAFQEET in a cell and an XLSX round trip.
    const money = recalculate(grid('S', [['1500', '=TAFQEET(A1;"SAR";TRUE)', '=SPELLNUMBER(A1)']]))
    eq('TAFQEET formula', at(money, 0, 1), 'فقط ألف وخمسمائة ريال لا غير')
    eq('SPELLNUMBER formula', at(money, 0, 2), 'One thousand five hundred')
    const back = readWorkbook(writeWorkbook([s1], 'xlsx'))
    const cell = back.sheets[0].rows[0][2]
    eq('xlsx keeps formula', cell.formula, 'A1+B1')
    check('xlsx keeps value', cell.value === 30 || cell.text === '30', `${cell.value} ${cell.text}`)
    const plain = grid('S', [['1', '2']])
    check('no formulas: same object', recalculate(plain) === plain)
  }
}
export default suite
