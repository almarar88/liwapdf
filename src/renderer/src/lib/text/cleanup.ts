/**
 * Tidying Arabic text the way a copy editor would before it goes to print.
 *
 * Text that has passed through a PDF, an old Word file or a web page
 * arrives with tashkeel nobody wants in a contract, tatweel used as
 * padding, a mix of Arabic-Indic and Western digits in one paragraph, and a
 * space before every comma. Each fix here is separately switchable, and
 * none touches the letters themselves unless asked (hamza normalisation is
 * off by default because it changes spelling, not just presentation).
 */

export interface CleanupOptions {
  /** Strip harakat and other combining marks. */
  tashkeel: boolean
  /** Remove the kashida (ـ) used to stretch words. */
  tatweel: boolean
  /** Unify the digits used in the text. */
  digits: 'keep' | 'arabic' | 'western'
  /** No space before ، . ؛ : ! ؟ and exactly one after. */
  punctuation: boolean
  /** Collapse runs of spaces and trim line ends. */
  spaces: boolean
  /** أ إ آ → ا: a spelling change, so opt-in. Final ى is left alone — إلى and على are correct as written. */
  hamza: boolean
}

export const DEFAULT_CLEANUP: CleanupOptions = {
  tashkeel: true,
  tatweel: true,
  digits: 'keep',
  punctuation: true,
  spaces: true,
  hamza: false
}

const TASHKEEL = /[ً-ٰٟۖ-ۭ]/g
const TATWEEL = /ـ/g
const WESTERN_DIGIT = /[0-9]/g
const ARABIC_DIGIT = /[٠-٩۰-۹]/g
const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩'

export function cleanArabicText(text: string, options: CleanupOptions = DEFAULT_CLEANUP): string {
  let out = text
  if (options.tashkeel) out = out.replace(TASHKEEL, '')
  if (options.tatweel) out = out.replace(TATWEEL, '')
  if (options.digits === 'arabic') out = out.replace(WESTERN_DIGIT, (d) => ARABIC_INDIC[Number(d)])
  else if (options.digits === 'western') {
    out = out.replace(ARABIC_DIGIT, (d) => {
      const code = d.codePointAt(0)!
      return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660)
    })
  }
  if (options.hamza) {
    out = out.replace(/[أإآ]/g, 'ا')
  }
  if (options.punctuation) {
    // No space before closing punctuation; one after it unless a line ends.
    out = out.replace(/[ \t ]+([،.؛:!؟,;])/g, '$1')
    out = out.replace(/([،؛؟!])(?=[^\s\n\r،؛؟!.)\]}"'0-9])/g, '$1 ')
    // Arabic comma and question mark where a Latin one sits between Arabic words.
    out = out.replace(/([؀-ۿ])\s*,\s*(?=[؀-ۿ])/g, '$1، ')
    out = out.replace(/([؀-ۿ])\s*\?/g, '$1؟')
    // Inside brackets and quotes, no padding.
    out = out.replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').replace(/«\s+/g, '«').replace(/\s+»/g, '»')
  }
  if (options.spaces) {
    out = out.replace(/[ \t ]{2,}/g, ' ').replace(/[ \t]+$/gm, '').replace(/^[ \t]+/gm, '')
  }
  return out
}

/**
 * Applies the cleanup to every text node under the root, in place, so a
 * contenteditable surface keeps its markup, its images and its caret.
 * Returns how many nodes changed.
 */
export function cleanArabicDom(root: Node, options: CleanupOptions = DEFAULT_CLEANUP): number {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let changed = 0
  const nodes: Text[] = []
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)
  for (const node of nodes) {
    const parent = node.parentElement
    if (parent && parent.closest('pre, code')) continue
    const next = cleanArabicText(node.data, options)
    if (next !== node.data) {
      node.data = next
      changed += 1
    }
  }
  return changed
}
