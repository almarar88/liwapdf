import DOMPurify from 'dompurify'

/**
 * The single gate every piece of document-derived HTML passes through.
 *
 * It lives in its own module so the DOCX reader can call it too: mammoth's
 * output used to reach the PDF printer and the HTML exporter unsanitised,
 * which meant a .docx was the one format that could carry markup straight past
 * the app's trust boundary.
 */
export function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ALLOWED_URI_REGEXP: /^(?:data:image\/[a-z+.-]+;base64,|https?:|mailto:|#)/i,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form'],
    FORBID_ATTR: ['srcset', 'formaction', 'background', 'ping'],
    ADD_ATTR: ['dir', 'colspan', 'rowspan']
  })
}

/**
 * Same, minus any reference that would reach the network. Used for the
 * offscreen print window, so converting a document can never turn into a
 * request to whoever wrote it.
 */
export function sanitizeForPrint(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ALLOWED_URI_REGEXP: /^(?:data:image\/[a-z+.-]+;base64,|#)/i,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form'],
    FORBID_ATTR: ['srcset', 'formaction', 'background', 'ping'],
    ADD_ATTR: ['dir', 'colspan', 'rowspan']
  })
}
