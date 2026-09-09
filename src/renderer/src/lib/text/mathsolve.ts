/**
 * Solving the arithmetic in a photographed problem.
 *
 * A phone pointed at a worksheet already has the two halves of this: the
 * camera and the bundled OCR. What was missing is the part in between —
 * reading what came back as mathematics rather than as a string, and being
 * honest when it is not.
 *
 * Recognised text is not clean text. Tesseract returns × as x, ÷ as +, a
 * minus as an em dash, and Arabic worksheets are written with Arabic-Indic
 * digits and an Arabic decimal separator. All of that is normalised before
 * parsing, and the parser itself is a plain precedence-climbing evaluator
 * with no `eval` anywhere near it: the input is a photograph of unknown
 * provenance, and handing that to a JavaScript interpreter would be a
 * remote-code-execution bug with a camera attached.
 *
 * Two shapes are handled: an expression, which is evaluated, and a linear
 * equation in one unknown, which is solved by evaluating each side twice and
 * reading off the slope. Anything else is reported as unsolved rather than
 * guessed at.
 */

export interface Solution {
  /** The cleaned-up problem, as it was understood. */
  problem: string
  /** The answer, formatted for reading. */
  answer: string
  /** How it was reached, one line per step. */
  steps: string[]
  kind: 'expression' | 'equation'
}

export class MathError extends Error {}

/* ------------------------------------------------------------ normalising */

const ARABIC_DIGITS = /[٠-٩۰-۹]/g

/** Everything OCR turns an operator into, and what it should have been. */
// `x` is deliberately absent: it is the unknown far more often than it is a
// mangled multiplication sign, and the one case where it is not is handled
// before this list runs.
const OPERATORS: [RegExp, string][] = [
  [/[×✕✖*]/g, '*'],
  [/[÷➗:]/g, '/'],
  [/[−–—‒]/g, '-'],
  // 1,000 is a thousands separator; 1,5 is how half is written in most of the
  // world. Three digits and then no fourth means the former.
  [/(\d),(?=\d{3}\b)/g, '$1'],
  [/[٫,](?=\d)/g, '.'],
  [/[٬]/g, ''],
  [/[（［]/g, '('],
  [/[）］]/g, ')'],
  [/[=＝]+/g, '='],
  // `\b` is defined on ASCII word characters, so it never fires between an
  // Arabic letter and a space: these need explicit letter lookarounds.
  [/(?<![\p{L}])مقسوم على(?![\p{L}])/gu, '/'],
  [/(?<![\p{L}])مضروب في(?![\p{L}])/gu, '*'],
  [/(?<![\p{L}])من(?![\p{L}])/gu, ' of '],
  [/(?<![\p{L}])في(?![\p{L}])/gu, '*'],
  [/(?<![\p{L}])زائد(?![\p{L}])/gu, '+'],
  [/(?<![\p{L}])ناقص(?![\p{L}])/gu, '-'],
  [/\bdivided by\b/gi, '/'],
  [/\btimes\b/gi, '*'],
  [/\bplus\b/gi, '+'],
  [/\bminus\b/gi, '-']
]

/**
 * Turns a line of recognised text into something a parser can read.
 *
 * The `x` case is the awkward one: in `3 x 4` it is a multiplication sign OCR
 * mangled, and in `2x + 5` it is the unknown. It is treated as an operator
 * only when it stands between two numbers with space around it.
 */
export function normalizeProblem(raw: string): string {
  let out = raw
    .replace(ARABIC_DIGITS, (digit) => String('٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹'.indexOf(digit) % 10))
    .replace(/[٪]/g, '%')
    .replace(/\s+/g, ' ')
    .trim()

  out = out.replace(/(\d)\s*[xX×]\s*(?=[\d(])/g, '$1*')
  for (const [pattern, replacement] of OPERATORS) out = out.replace(pattern, replacement)
  // The unknown may be written س in Arabic or x/y elsewhere; one name inside.
  out = out.replace(/(?<![\p{L}])[سxXyY](?![\p{L}])/gu, 'x')
  return out.replace(/\s{2,}/g, ' ').trim()
}

/* ----------------------------------------------------------------- solve */

/** Reads a photographed or typed problem and answers it. */
export function solve(raw: string): Solution {
  const problem = normalizeProblem(raw)
  if (!problem) throw new MathError('empty')

  const sides = problem.split('=').map((side) => side.trim()).filter(Boolean)
  if (problem.includes('=') && sides.length === 2) return solveEquation(problem, sides[0], sides[1])

  const value = evaluate(problem)
  return {
    problem,
    answer: format(value),
    kind: 'expression',
    steps: [`${problem} = ${format(value)}`]
  }
}

/**
 * Solves a linear equation by probing it.
 *
 * f(x) = left − right is a straight line when the equation is linear, so two
 * evaluations give its slope and intercept and the root is −b/a. Probing also
 * verifies linearity for free: if a third point is off the line the equation
 * is not linear and is refused rather than answered wrongly.
 */
function solveEquation(problem: string, left: string, right: string): Solution {
  const at = (x: number): number => evaluate(left, x) - evaluate(right, x)
  const f0 = at(0)
  const f1 = at(1)
  const slope = f1 - f0

  if (Math.abs(slope) < 1e-12) {
    throw new MathError(Math.abs(f0) < 1e-12 ? 'always-true' : 'no-solution')
  }
  const root = -f0 / slope
  // A quadratic passes through the same two points as its chord; the third
  // probe is what stops x² + 1 = 0 being reported as having a root.
  if (Math.abs(at(2) - (f0 + slope * 2)) > 1e-6 * Math.max(1, Math.abs(f0))) {
    throw new MathError('not-linear')
  }

  return {
    problem,
    answer: `x = ${format(root)}`,
    kind: 'equation',
    steps: [problem, `${format(slope)}x ${f0 >= 0 ? '+' : '−'} ${format(Math.abs(f0))} = 0`, `x = ${format(root)}`]
  }
}

/* ---------------------------------------------------------------- parser */

type Token = { kind: 'number'; value: number } | { kind: 'x' } | { kind: 'op'; value: string }

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < input.length) {
    const character = input[i]
    if (character === ' ') {
      i += 1
      continue
    }
    if (/\d|\./.test(character)) {
      let end = i
      while (end < input.length && /[\d.]/.test(input[end])) end += 1
      const value = Number(input.slice(i, end))
      if (!Number.isFinite(value)) throw new MathError('bad-number')
      tokens.push({ kind: 'number', value })
      i = end
      continue
    }
    if (character === 'x') {
      tokens.push({ kind: 'x' })
      i += 1
      continue
    }
    if (input.startsWith('of', i)) {
      // "15% of 240" is a multiplication once the percent has been applied.
      tokens.push({ kind: 'op', value: '*' })
      i += 2
      continue
    }
    if ('+-*/^()%'.includes(character)) {
      tokens.push({ kind: 'op', value: character })
      i += 1
      continue
    }
    throw new MathError('unreadable')
  }
  if (tokens.length === 0) throw new MathError('empty')
  return tokens
}

const PRECEDENCE: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 3 }

/**
 * Evaluates an expression, with `x` bound to the given value.
 *
 * Precedence climbing rather than a grammar of nested functions: it is short
 * enough to read in one screen, and it makes implicit multiplication — the
 * `2x` and `3(4+1)` every worksheet is full of — a two-line special case
 * instead of a parser rewrite.
 */
export function evaluate(expression: string, x = 0): number {
  const tokens = tokenize(expression)
  let position = 0

  const peek = (): Token | undefined => tokens[position]

  const parseAtom = (): number => {
    const token = tokens[position]
    if (!token) throw new MathError('incomplete')
    if (token.kind === 'op' && (token.value === '-' || token.value === '+')) {
      position += 1
      const value = parseAtom()
      return token.value === '-' ? -value : value
    }
    if (token.kind === 'op' && token.value === '(') {
      position += 1
      const value = parseExpression(0)
      const close = tokens[position]
      if (!close || close.kind !== 'op' || close.value !== ')') throw new MathError('unbalanced')
      position += 1
      return withPercent(value)
    }
    if (token.kind === 'number') {
      position += 1
      return withPercent(token.value)
    }
    if (token.kind === 'x') {
      position += 1
      return withPercent(x)
    }
    throw new MathError('unreadable')
  }

  // A trailing % turns the number into its hundredth, which is what makes
  // "15% of 240" and "240 * 15%" both come out at 36.
  const withPercent = (value: number): number => {
    const next = peek()
    if (next && next.kind === 'op' && next.value === '%') {
      position += 1
      return value / 100
    }
    return value
  }

  const parseExpression = (minimum: number): number => {
    let left = parseAtom()
    for (;;) {
      const token = peek()
      if (!token) break

      // Implicit multiplication: 2x, 3(4+1), (a)(b).
      if (token.kind === 'number' || token.kind === 'x' || (token.kind === 'op' && token.value === '(')) {
        if (PRECEDENCE['*'] < minimum) break
        left *= parseExpression(PRECEDENCE['*'] + 1)
        continue
      }

      if (token.kind !== 'op') break
      const precedence = PRECEDENCE[token.value]
      if (precedence === undefined || precedence < minimum) break
      position += 1
      // ^ is right-associative; the rest are left-associative.
      const right = parseExpression(token.value === '^' ? precedence : precedence + 1)
      left =
        token.value === '+'
          ? left + right
          : token.value === '-'
            ? left - right
            : token.value === '*'
              ? left * right
              : token.value === '/'
                ? divide(left, right)
                : left ** right
    }
    return left
  }

  const result = parseExpression(0)
  if (position !== tokens.length) throw new MathError('unreadable')
  if (!Number.isFinite(result)) throw new MathError('undefined-result')
  return result
}

function divide(left: number, right: number): number {
  if (right === 0) throw new MathError('divide-by-zero')
  return left / right
}

/** Trims floating-point dust without rounding a real fraction away. */
export function format(value: number): string {
  if (Number.isInteger(value)) return String(value)
  const rounded = Number(value.toFixed(6))
  return String(Number.isInteger(rounded) ? rounded : rounded)
}

/**
 * Picks the lines of recognised text that look like problems.
 *
 * A worksheet photograph carries a heading, a page number and the pupil's
 * name; a line qualifies only if it has a digit and an operator, which leaves
 * the mathematics and nothing else.
 */
export function findProblems(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    // `\d` is ASCII-only in JavaScript, and an Arabic worksheet is written
    // in Arabic-Indic digits: matching only `\d` would skip every line of it.
    .filter((line) => /[\d٠-٩۰-۹]/.test(line) && /[+\-*/×÷^=%]|[سxX]\s*[+\-=]/.test(line))
    .filter((line) => line.replace(/[^\p{L}]/gu, '').length <= line.length / 2)
    .slice(0, 40)
}
