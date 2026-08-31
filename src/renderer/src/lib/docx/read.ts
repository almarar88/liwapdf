import mammoth from 'mammoth'
import { sanitize } from '../documents/sanitize'

export interface DocxReadResult {
  html: string
  warnings: string[]
}

const STYLE_MAP = [
  "p[style-name='Title'] => h1.doc-title:fresh",
  "p[style-name='Subtitle'] => h2.doc-subtitle:fresh",
  "p[style-name='Heading 1'] => h1:fresh",
  "p[style-name='Heading 2'] => h2:fresh",
  "p[style-name='Heading 3'] => h3:fresh",
  "p[style-name='Heading 4'] => h4:fresh",
  "p[style-name='Quote'] => blockquote:fresh",
  "p[style-name='Intense Quote'] => blockquote.intense:fresh",
  'r[style-name="Strong"] => strong',
  'r[style-name="Emphasis"] => em'
]

/**
 * Converts a .docx into editable HTML. Images are inlined as data URIs so the
 * document stays self-contained once it is in the editor.
 */
export async function docxToHtml(bytes: Uint8Array): Promise<DocxReadResult> {
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer

  const result = await mammoth.convertToHtml(
    { arrayBuffer },
    {
      styleMap: STYLE_MAP,
      includeDefaultStyleMap: true,
      convertImage: mammoth.images.imgElement(async (image) => {
        const base64 = await image.read('base64')
        return { src: `data:${image.contentType};base64,${base64}` }
      })
    }
  )

  // Sanitised here rather than at each call site: this is the one place
  // mammoth's output can escape from, and the PDF and HTML exporters used to
  // forget.
  return {
    html: sanitize(result.value || '<p></p>'),
    warnings: result.messages.map((message) => message.message)
  }
}

export async function docxToText(bytes: Uint8Array): Promise<string> {
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer
  const result = await mammoth.extractRawText({ arrayBuffer })
  return result.value
}
