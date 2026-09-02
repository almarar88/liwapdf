import type { SheetCell, SheetData } from './sheets'
import { currencyFromText, spellNumber, tafqeet } from '../text/tafqeet'

/**
 * A small formula engine for the spreadsheet grid.
 *
 * The grid used to accept "=SUM(A1:A5)" and then display those characters,
 * which is a text box wearing a spreadsheet's clothes. This evaluates the
 * everyday subset — arithmetic, cell references, ranges, comparisons, text
 * joining, and the functions people actually type into a budget or a grade
 * sheet — and writes the result into the cell's display text while keeping
 * the formula, so the file round-trips and Excel recalculates it the same way.
 *
 * Deliberately not implemented: cross-sheet references, array formulas,
 * dates beyond TODAY, and the long tail of statistical functions. A cell
 * that uses one shows #NAME? rather than a wrong number.
 */

type Scalar = number | string | boolean
type Value = Scalar | Scalar[][] | FormulaError

class FormulaError {
  constructor(public readonly code: string) {}
}

const ERR = {
  div0: new FormulaError('#DIV/0!'),
  name: new FormulaError('#NAME?'),
  ref: new FormulaError('#REF!'),
  value: new FormulaError('#VALUE!'),
  cycle: new FormulaError('#CYCLE!')
}

/* ------------------------------------------------------------- tokenizer */

type Token =
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'name'; value: string }
  | { kind: 'op'; value: string }

const ARABIC_DIGITS = /[٠-٩۰-۹]/g

function tokenize(source: string): Token[] {
  const text = source
    .replace(ARABIC_DIGITS, (d) => String((d.codePointAt(0)! - (d >= '۰' ? 0x06f0 : 0x0660)) % 10))
    .replace(/،|؛/g, ',')
  const tokens: Token[] = []
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (/\s/.test(ch)) {
      i += 1
      continue
    }
    if (/[0-9.]/.test(ch)) {
      const match = /^[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?|^[0-9]+\./.exec(text.slice(i))
      if (!match) throw ERR.value
      tokens.push({ kind: 'number', value: Number(match[0]) })
      i += match[0].length
      continue
    }
    if (ch === "'") {
      // A quoted sheet name: 'My Sheet'!A1
      const close = text.indexOf("'", i + 1)
      if (close === -1) throw ERR.value
      tokens.push({ kind: 'name', value: text.slice(i + 1, close) })
      i = close + 1
      continue
    }
    if (ch === '"') {
      let j = i + 1
      let out = ''
      while (j < text.length) {
        if (text[j] === '"') {
          if (text[j + 1] === '"') {
            out += '"'
            j += 2
            continue
          }
          break
        }
        out += text[j]
        j += 1
      }
      tokens.push({ kind: 'string', value: out })
      i = j + 1
      continue
    }
    if (/[A-Za-z_$]/.test(ch)) {
      const match = /^[$A-Za-z_][$A-Za-z0-9_.]*/.exec(text.slice(i))!
      tokens.push({ kind: 'name', value: match[0].toUpperCase() })
      i += match[0].length
      continue
    }
    const two = text.slice(i, i + 2)
    if (two === '<=' || two === '>=' || two === '<>') {
      tokens.push({ kind: 'op', value: two })
      i += 2
      continue
    }
    if ('+-*/^&=<>(),:;%!'.includes(ch)) {
      tokens.push({ kind: 'op', value: ch === ';' ? ',' : ch })
      i += 1
      continue
    }
    throw ERR.value
  }
  return tokens
}

/* ---------------------------------------------------------------- parser */

type Node =
  | { type: 'number'; value: number }
  | { type: 'string'; value: string }
  | { type: 'ref'; row: number; column: number; sheet?: string }
  | { type: 'range'; from: { row: number; column: number }; to: { row: number; column: number }; sheet?: string }
  | { type: 'call'; name: string; args: Node[] }
  | { type: 'unary'; op: string; operand: Node }
  | { type: 'binary'; op: string; left: Node; right: Node }
  | { type: 'percent'; operand: Node }

const REF = /^\$?([A-Z]{1,3})\$?([0-9]{1,7})$/

export function parseReference(name: string): { row: number; column: number } | null {
  const match = REF.exec(name)
  if (!match) return null
  let column = 0
  for (const letter of match[1]) column = column * 26 + (letter.charCodeAt(0) - 64)
  return { row: Number(match[2]) - 1, column: column - 1 }
}

class Parser {
  private index = 0
  constructor(private readonly tokens: Token[]) {}

  parse(): Node {
    const node = this.comparison()
    if (this.index < this.tokens.length) throw ERR.value
    return node
  }

  private peek(): Token | undefined {
    return this.tokens[this.index]
  }

  private takeOp(...ops: string[]): string | null {
    const token = this.peek()
    if (token && token.kind === 'op' && ops.includes(token.value)) {
      this.index += 1
      return token.value
    }
    return null
  }

  private comparison(): Node {
    let left = this.concat()
    let op: string | null
    while ((op = this.takeOp('=', '<>', '<', '>', '<=', '>=')) !== null) {
      left = { type: 'binary', op, left, right: this.concat() }
    }
    return left
  }

  private concat(): Node {
    let left = this.additive()
    while (this.takeOp('&') !== null) left = { type: 'binary', op: '&', left, right: this.additive() }
    return left
  }

  private additive(): Node {
    let left = this.multiplicative()
    let op: string | null
    while ((op = this.takeOp('+', '-')) !== null) {
      left = { type: 'binary', op, left, right: this.multiplicative() }
    }
    return left
  }

  private multiplicative(): Node {
    let left = this.power()
    let op: string | null
    while ((op = this.takeOp('*', '/')) !== null) {
      left = { type: 'binary', op, left, right: this.power() }
    }
    return left
  }

  private power(): Node {
    const base = this.unary()
    if (this.takeOp('^') !== null) return { type: 'binary', op: '^', left: base, right: this.power() }
    return base
  }

  private unary(): Node {
    const op = this.takeOp('-', '+')
    if (op) return { type: 'unary', op, operand: this.unary() }
    return this.postfix()
  }

  private postfix(): Node {
    let node = this.primary()
    while (this.takeOp('%') !== null) node = { type: 'percent', operand: node }
    return node
  }

  private primary(): Node {
    const token = this.peek()
    if (!token) throw ERR.value
    this.index += 1
    if (token.kind === 'number') return { type: 'number', value: token.value }
    if (token.kind === 'string') return { type: 'string', value: token.value }
    if (token.kind === 'op' && token.value === '(') {
      const inner = this.comparison()
      if (this.takeOp(')') === null) throw ERR.value
      return inner
    }
    if (token.kind === 'name') {
      // Sheet2!A1 or 'Sheet two'!A1:B3 — the name before the bang is a sheet.
      if (this.takeOp('!') !== null) {
        const next = this.peek()
        this.index += 1
        const ref = next && next.kind === 'name' ? parseReference(next.value) : null
        if (!ref) throw ERR.ref
        if (this.takeOp(':') !== null) {
          const after = this.peek()
          this.index += 1
          const to = after && after.kind === 'name' ? parseReference(after.value) : null
          if (!to) throw ERR.ref
          return { type: 'range', from: ref, to, sheet: token.value }
        }
        return { type: 'ref', row: ref.row, column: ref.column, sheet: token.value }
      }
      if (this.takeOp('(') !== null) {
        const args: Node[] = []
        if (this.takeOp(')') === null) {
          do args.push(this.comparison())
          while (this.takeOp(',') !== null)
          if (this.takeOp(')') === null) throw ERR.value
        }
        return { type: 'call', name: token.value, args }
      }
      const ref = parseReference(token.value)
      if (ref) {
        if (this.takeOp(':') !== null) {
          const next = this.peek()
          this.index += 1
          const to = next && next.kind === 'name' ? parseReference(next.value) : null
          if (!to) throw ERR.ref
          return { type: 'range', from: ref, to }
        }
        return { type: 'ref', row: ref.row, column: ref.column }
      }
      if (token.value === 'TRUE' || token.value === 'FALSE') return { type: 'call', name: token.value, args: [] }
      throw ERR.name
    }
    throw ERR.value
  }
}

/* ------------------------------------------------------------- evaluator */

class Evaluator {
  private readonly cache = new Map<string, Value>()
  private readonly visiting = new Set<string>()
  /** The sheet whose formulas are being evaluated right now. */
  private current: number

  constructor(
    private readonly workbook: SheetData[],
    sheetIndex: number
  ) {
    this.current = sheetIndex
  }

  private sheetIndex(name: string | undefined): number {
    if (name === undefined) return this.current
    const wanted = name.trim().toLowerCase()
    const index = this.workbook.findIndex((sheet) => sheet.name.trim().toLowerCase() === wanted)
    return index
  }

  cell(row: number, column: number, sheet?: string): Value {
    const index = this.sheetIndex(sheet)
    if (index < 0) return ERR.ref
    const key = `${index}:${row}:${column}`
    const cached = this.cache.get(key)
    if (cached !== undefined) return cached
    const cell = this.workbook[index]?.rows[row]?.[column]
    if (!cell) return ''
    if (cell.formula === undefined) return literal(cell)
    if (this.visiting.has(key)) return ERR.cycle
    this.visiting.add(key)
    // A formula on another sheet reads its own neighbours as "here".
    const previous = this.current
    this.current = index
    let value: Value
    try {
      value = this.evaluate(new Parser(tokenize(cell.formula)).parse())
    } catch (error) {
      value = error instanceof FormulaError ? error : ERR.value
    }
    this.current = previous
    this.visiting.delete(key)
    this.cache.set(key, value)
    return value
  }

  evaluate(node: Node): Value {
    switch (node.type) {
      case 'number':
        return node.value
      case 'string':
        return node.value
      case 'ref':
        return this.cell(node.row, node.column, node.sheet)
      case 'range': {
        const top = Math.min(node.from.row, node.to.row)
        const bottom = Math.max(node.from.row, node.to.row)
        const left = Math.min(node.from.column, node.to.column)
        const right = Math.max(node.from.column, node.to.column)
        if ((bottom - top + 1) * (right - left + 1) > 250000) return ERR.ref
        const out: Scalar[][] = []
        for (let r = top; r <= bottom; r += 1) {
          const line: Scalar[] = []
          for (let c = left; c <= right; c += 1) {
            const value = this.cell(r, c, node.sheet)
            if (value instanceof FormulaError) return value
            line.push(Array.isArray(value) ? '' : value)
          }
          out.push(line)
        }
        return out
      }
      case 'percent': {
        const value = this.evaluate(node.operand)
        return typeof value === 'number' ? value / 100 : toNumber(value) instanceof FormulaError ? ERR.value : (toNumber(value) as number) / 100
      }
      case 'unary': {
        const value = toNumber(this.evaluate(node.operand))
        if (value instanceof FormulaError) return value
        return node.op === '-' ? -value : value
      }
      case 'binary':
        return this.binary(node.op, this.evaluate(node.left), this.evaluate(node.right))
      case 'call':
        return this.call(node.name, node.args)
    }
  }

  private binary(op: string, left: Value, right: Value): Value {
    if (left instanceof FormulaError) return left
    if (right instanceof FormulaError) return right
    if (op === '&') return `${toText(scalar(left))}${toText(scalar(right))}`
    if (op === '=' || op === '<>' || op === '<' || op === '>' || op === '<=' || op === '>=') {
      return compare(op, scalar(left), scalar(right))
    }
    const a = toNumber(left)
    const b = toNumber(right)
    if (a instanceof FormulaError) return a
    if (b instanceof FormulaError) return b
    switch (op) {
      case '+':
        return a + b
      case '-':
        return a - b
      case '*':
        return a * b
      case '/':
        return b === 0 ? ERR.div0 : a / b
      case '^':
        return a ** b
    }
    return ERR.value
  }

  private numbersOf(args: Node[], includeText = false): number[] | FormulaError {
    const out: number[] = []
    for (const arg of args) {
      const value = this.evaluate(arg)
      if (value instanceof FormulaError) return value
      if (Array.isArray(value)) {
        for (const line of value) {
          for (const item of line) {
            if (typeof item === 'number') out.push(item)
            else if (typeof item === 'boolean') out.push(item ? 1 : 0)
            else if (includeText && item !== '') out.push(Number.NaN)
          }
        }
      } else {
        const number = toNumber(value)
        if (number instanceof FormulaError) {
          if (includeText) out.push(Number.NaN)
          else return number
        } else out.push(number)
      }
    }
    return out
  }

  private call(name: string, args: Node[]): Value {
    switch (name) {
      case 'SUM': {
        const values = this.numbersOf(args)
        return values instanceof FormulaError ? values : values.reduce((a, b) => a + b, 0)
      }
      case 'AVERAGE': {
        const values = this.numbersOf(args)
        if (values instanceof FormulaError) return values
        return values.length === 0 ? ERR.div0 : values.reduce((a, b) => a + b, 0) / values.length
      }
      case 'MIN':
      case 'MAX': {
        const values = this.numbersOf(args)
        if (values instanceof FormulaError) return values
        if (values.length === 0) return 0
        return name === 'MIN' ? Math.min(...values) : Math.max(...values)
      }
      case 'COUNT': {
        const values = this.numbersOf(args)
        return values instanceof FormulaError ? values : values.length
      }
      case 'COUNTA': {
        let count = 0
        for (const arg of args) {
          const value = this.evaluate(arg)
          if (value instanceof FormulaError) return value
          if (Array.isArray(value)) count += value.flat().filter((item) => item !== '').length
          else if (value !== '') count += 1
        }
        return count
      }
      case 'IF': {
        if (args.length < 2) return ERR.value
        const test = this.evaluate(args[0])
        if (test instanceof FormulaError) return test
        const truthy = typeof test === 'number' ? test !== 0 : typeof test === 'boolean' ? test : test !== ''
        return truthy ? this.evaluate(args[1]) : args[2] ? this.evaluate(args[2]) : false
      }
      case 'AND':
      case 'OR': {
        const values = this.numbersOf(args)
        if (values instanceof FormulaError) return values
        return name === 'AND' ? values.every((v) => v !== 0) : values.some((v) => v !== 0)
      }
      case 'NOT': {
        const value = toNumber(this.evaluate(args[0]))
        return value instanceof FormulaError ? value : value === 0
      }
      case 'ROUND':
      case 'ROUNDUP':
      case 'ROUNDDOWN': {
        const value = toNumber(this.evaluate(args[0]))
        const digits = args[1] ? toNumber(this.evaluate(args[1])) : 0
        if (value instanceof FormulaError) return value
        if (digits instanceof FormulaError) return digits
        const factor = 10 ** digits
        const scaled = value * factor
        const rounded = name === 'ROUND' ? Math.round(scaled) : name === 'ROUNDUP' ? Math.ceil(Math.abs(scaled)) * Math.sign(scaled) : Math.trunc(scaled)
        return rounded / factor
      }
      case 'ABS':
      case 'SQRT':
      case 'INT': {
        const value = toNumber(this.evaluate(args[0]))
        if (value instanceof FormulaError) return value
        if (name === 'ABS') return Math.abs(value)
        if (name === 'INT') return Math.floor(value)
        return value < 0 ? ERR.value : Math.sqrt(value)
      }
      case 'MOD':
      case 'POWER': {
        const a = toNumber(this.evaluate(args[0]))
        const b = toNumber(this.evaluate(args[1]))
        if (a instanceof FormulaError) return a
        if (b instanceof FormulaError) return b
        if (name === 'POWER') return a ** b
        return b === 0 ? ERR.div0 : a - b * Math.floor(a / b)
      }
      case 'LEN':
        return toText(scalar(this.evaluate(args[0]))).length
      case 'CONCAT':
      case 'CONCATENATE': {
        let out = ''
        for (const arg of args) {
          const value = this.evaluate(arg)
          if (value instanceof FormulaError) return value
          out += Array.isArray(value) ? value.flat().map(toText).join('') : toText(value)
        }
        return out
      }
      case 'UPPER':
      case 'LOWER':
      case 'TRIM': {
        const text = toText(scalar(this.evaluate(args[0])))
        return name === 'UPPER' ? text.toUpperCase() : name === 'LOWER' ? text.toLowerCase() : text.trim().replace(/\s+/g, ' ')
      }
      case 'SUMIF':
      case 'COUNTIF': {
        const range = this.evaluate(args[0])
        const criterion = scalar(this.evaluate(args[1]))
        if (range instanceof FormulaError) return range
        if (criterion instanceof FormulaError) return criterion
        const sums = name === 'SUMIF' && args[2] ? this.evaluate(args[2]) : range
        if (sums instanceof FormulaError) return sums
        const cells = Array.isArray(range) ? range : [[range]]
        const values = Array.isArray(sums) ? sums : [[sums]]
        const test = criterionTest(criterion)
        let total = 0
        let count = 0
        for (const [r, line] of cells.entries()) {
          for (const [c, item] of line.entries()) {
            if (!test(item)) continue
            count += 1
            const value = values[r]?.[c]
            if (typeof value === 'number') total += value
          }
        }
        return name === 'SUMIF' ? total : count
      }
      case 'TAFQEET':
      case 'SPELLNUMBER': {
        // =TAFQEET(A1; "SAR"; TRUE) — amount in words, with the currency's
        // grammar, optionally in the cheque form.
        const value = toNumber(this.evaluate(args[0]))
        if (value instanceof FormulaError) return value
        const currency = currencyFromText(args[1] ? toText(scalar(this.evaluate(args[1]))) : '')
        const formalValue = args[2] ? toNumber(this.evaluate(args[2])) : 0
        const formal = !(formalValue instanceof FormulaError) && formalValue !== 0
        return name === 'TAFQEET' ? tafqeet(value, { currency, formal }) : spellNumber(value, { currency, formal })
      }
      case 'PI':
        return Math.PI
      case 'TODAY': {
        // Excel serial: days since 1899-12-30.
        const now = new Date()
        const utc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
        return Math.floor((utc - Date.UTC(1899, 11, 30)) / 86400000)
      }
      case 'TRUE':
        return true
      case 'FALSE':
        return false
      default:
        return ERR.name
    }
  }
}

function literal(cell: SheetCell): Scalar {
  if (typeof cell.value === 'number' || typeof cell.value === 'boolean') return cell.value
  const trimmed = cell.text.trim()
  if (trimmed !== '' && /^-?[0-9]*\.?[0-9]+$/.test(trimmed)) return Number(trimmed)
  return cell.text
}

function scalar(value: Value): Scalar | FormulaError {
  if (Array.isArray(value)) return value[0]?.[0] ?? ''
  return value
}

function toNumber(value: Value): number | FormulaError {
  if (value instanceof FormulaError) return value
  if (Array.isArray(value)) return toNumber(value[0]?.[0] ?? '')
  if (typeof value === 'number') return value
  if (typeof value === 'boolean') return value ? 1 : 0
  if (value.trim() === '') return 0
  const number = Number(value.replace(ARABIC_DIGITS, (d) => String((d.codePointAt(0)! - (d >= '۰' ? 0x06f0 : 0x0660)) % 10)))
  return Number.isFinite(number) ? number : ERR.value
}

function toText(value: Scalar | FormulaError): string {
  if (value instanceof FormulaError) return value.code
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (typeof value === 'number') return formatNumber(value)
  return value
}

function compare(op: string, left: Scalar | FormulaError, right: Scalar | FormulaError): Value {
  if (left instanceof FormulaError) return left
  if (right instanceof FormulaError) return right
  let order: number
  if (typeof left === 'number' && typeof right === 'number') order = left - right
  else if (typeof left === 'string' && typeof right === 'string') order = left.localeCompare(right, undefined, { sensitivity: 'accent' })
  else order = String(left).localeCompare(String(right))
  switch (op) {
    case '=':
      return order === 0
    case '<>':
      return order !== 0
    case '<':
      return order < 0
    case '>':
      return order > 0
    case '<=':
      return order <= 0
    default:
      return order >= 0
  }
}

function criterionTest(criterion: Scalar): (value: Scalar) => boolean {
  if (typeof criterion === 'string') {
    const match = /^(<>|<=|>=|<|>|=)(.*)$/.exec(criterion)
    if (match) {
      const target: Scalar = /^-?[0-9.]+$/.test(match[2].trim()) ? Number(match[2]) : match[2]
      // A numeric criterion only looks at numbers, as Excel does: an empty
      // cell is not "less than 15".
      if (typeof target === 'number') return (value) => typeof value === 'number' && compare(match[1], value, target) === true
      return (value) => compare(match[1], value, target) === true
    }
    const wanted = criterion.toLowerCase()
    return (value) => String(value).toLowerCase() === wanted
  }
  return (value) => value === criterion
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '#NUM!'
  if (Number.isInteger(value)) return String(value)
  return String(Number(value.toPrecision(12)))
}

/* --------------------------------------------------------------- recalc */

/**
 * Evaluates every formula in the sheet and writes its result into the
 * cell's display text and typed value. Rows without formulas are shared with
 * the input, so the common edit costs one row copy.
 */
export function recalculate(sheet: SheetData, workbook?: SheetData[]): SheetData {
  const book = workbook && workbook.includes(sheet) ? workbook : [sheet]
  const evaluator = new Evaluator(book, book.indexOf(sheet))
  let changed = false
  const rows = sheet.rows.map((row, r) => {
    let copy: SheetCell[] | null = null
    for (const [c, cell] of row.entries()) {
      if (cell.formula === undefined) continue
      const result = evaluator.cell(r, c)
      const text = toText(scalar(result))
      const value = typeof result === 'number' || typeof result === 'boolean' ? result : undefined
      if (cell.text === text && cell.value === value) continue
      if (!copy) copy = [...row]
      copy[c] = { ...cell, text, value }
      changed = true
    }
    return copy ?? row
  })
  return changed ? { ...sheet, rows } : sheet
}

/** True when any cell in the sheet carries a formula. */
export function hasFormulas(sheet: SheetData): boolean {
  return sheet.rows.some((row) => row.some((cell) => cell.formula !== undefined))
}
