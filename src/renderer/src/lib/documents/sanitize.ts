import DOMPurify, { type Config } from 'dompurify'

/**
 * The single gate every piece of document-derived HTML passes through.
 *
 * It lives in its own module so the DOCX reader can call it too: mammoth's
 * output used to reach the PDF printer and the HTML exporter unsanitised,
 * which meant a .docx was the one format that could carry markup straight past
 * the app's trust boundary.
 */

/**
 * Attributes that carry a plain value rather than a reference.
 *
 * DOMPurify runs every attribute it does not already consider URI-safe
 * through ALLOWED_URI_REGEXP. The app's regexp is deliberately narrow — it
 * exists to stop a document reaching the network — and a narrow regexp
 * rejects "rtl" as surely as it rejects "http://evil". So the tightening
 * that was meant to guard `src` and `href` was quietly deleting `dir`,
 * `colspan` and every other ordinary attribute: a Word file's paragraph
 * directions and merged table cells disappeared on the way in. Listing them
 * here exempts them from the URI test without loosening it for references.
 */
const PLAIN_ATTRIBUTES = [
  'dir',
  'lang',
  'colspan',
  'rowspan',
  'span',
  'start',
  'reversed',
  'align',
  'valign',
  'width',
  'height',
  'cellpadding',
  'cellspacing',
  'border',
  'bgcolor',
  'color',
  'face',
  'size',
  'type',
  'scope',
  'headers',
  'abbr'
]

const SHARED: Config = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form'],
  FORBID_ATTR: ['srcset', 'formaction', 'background', 'ping'],
  ADD_ATTR: PLAIN_ATTRIBUTES,
  ADD_URI_SAFE_ATTR: PLAIN_ATTRIBUTES
}

export function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    ...SHARED,
    ALLOWED_URI_REGEXP: /^(?:data:image\/[a-z+.-]+;base64,|https?:|mailto:|#)/i
  })
}

/**
 * Same, minus any reference that would reach the network. Used for the
 * offscreen print window, so converting a document can never turn into a
 * request to whoever wrote it.
 */
export function sanitizeForPrint(html: string): string {
  return DOMPurify.sanitize(html, {
    ...SHARED,
    ALLOWED_URI_REGEXP: /^(?:data:image\/[a-z+.-]+;base64,|#)/i
  })
}
