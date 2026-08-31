/**
 * The matching half of Find & Replace, separated from the panel that drives it.
 *
 * The rules here decide whether an Arabic search works at all, so they belong
 * somewhere a test can reach without mounting a React tree.
 */
export interface ReplaceOptions {
  regex: boolean
  caseSensitive: boolean
  wholeWord: boolean
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Builds the pattern a replace pass runs, or null when the user's own regex
 * does not compile.
 *
 * JS `\b` is defined against `[A-Za-z0-9_]`, so a whole-word search for an
 * Arabic term matched nothing at all — every position beside an Arabic letter
 * counts as a word boundary by that definition. The Unicode lookarounds are
 * the general form of the same idea, and they also stop "cat" matching inside
 * "concatenate".
 */
export function replacePattern(find: string, options: ReplaceOptions): RegExp | null {
  if (!find) return null
  try {
    const source = options.regex ? find : escapeRegExp(find)
    const body = options.wholeWord
      ? `(?<![\\p{L}\\p{M}\\p{N}])(?:${source})(?![\\p{L}\\p{M}\\p{N}])`
      : source
    return new RegExp(body, options.caseSensitive ? 'gu' : 'giu')
  } catch {
    return null
  }
}

/** Applies a pattern to one string and reports how many times it fired. */
export function substituteAll(
  value: string,
  pattern: RegExp,
  replacement: string
): { text: string; count: number } {
  let count = 0
  const text = value.replace(pattern, () => {
    count += 1
    return replacement
  })
  return { text, count }
}
