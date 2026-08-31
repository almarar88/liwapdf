/** Every document format the editor understands, and what it can do with it. */

export type DocumentFormat =
  | 'pdf'
  | 'docx'
  | 'doc'
  | 'rtf'
  | 'odt'
  | 'txt'
  | 'md'
  | 'html'
  | 'csv'
  | 'tsv'
  | 'xlsx'
  | 'xls'
  | 'ods'
  | 'pptx'
  | 'epub'
  | 'json'
  | 'xml'
  | 'code'
  | 'image'
  | 'unknown'

/** How the editor should present a document of this format. */
export type DocumentKind = 'rich' | 'sheet' | 'code' | 'slides' | 'image' | 'pdf'

export interface FormatInfo {
  format: DocumentFormat
  kind: DocumentKind
  label: string
  extensions: string[]
  /** The editor can open and edit it. */
  readable: boolean
  /** The editor can write this format back out. */
  writable: boolean
}

export const FORMATS: FormatInfo[] = [
  { format: 'pdf', kind: 'pdf', label: 'PDF', extensions: ['pdf'], readable: true, writable: true },
  { format: 'docx', kind: 'rich', label: 'Word (DOCX)', extensions: ['docx'], readable: true, writable: true },
  { format: 'doc', kind: 'rich', label: 'Word 97 (DOC)', extensions: ['doc'], readable: true, writable: false },
  { format: 'rtf', kind: 'rich', label: 'Rich Text (RTF)', extensions: ['rtf'], readable: true, writable: true },
  { format: 'odt', kind: 'rich', label: 'OpenDocument Text', extensions: ['odt'], readable: true, writable: true },
  { format: 'txt', kind: 'rich', label: 'Plain text', extensions: ['txt', 'log', 'text'], readable: true, writable: true },
  { format: 'md', kind: 'rich', label: 'Markdown', extensions: ['md', 'markdown', 'mdown'], readable: true, writable: true },
  { format: 'html', kind: 'rich', label: 'HTML', extensions: ['html', 'htm', 'xhtml'], readable: true, writable: true },
  { format: 'csv', kind: 'sheet', label: 'CSV', extensions: ['csv'], readable: true, writable: true },
  { format: 'tsv', kind: 'sheet', label: 'TSV', extensions: ['tsv', 'tab'], readable: true, writable: true },
  { format: 'xlsx', kind: 'sheet', label: 'Excel (XLSX)', extensions: ['xlsx', 'xlsm'], readable: true, writable: true },
  { format: 'xls', kind: 'sheet', label: 'Excel 97 (XLS)', extensions: ['xls'], readable: true, writable: false },
  { format: 'ods', kind: 'sheet', label: 'OpenDocument Sheet', extensions: ['ods'], readable: true, writable: true },
  { format: 'pptx', kind: 'slides', label: 'PowerPoint (PPTX)', extensions: ['pptx', 'ppsx'], readable: true, writable: false },
  { format: 'epub', kind: 'rich', label: 'EPUB', extensions: ['epub'], readable: true, writable: false },
  { format: 'json', kind: 'code', label: 'JSON', extensions: ['json', 'jsonc', 'geojson'], readable: true, writable: true },
  { format: 'xml', kind: 'code', label: 'XML', extensions: ['xml', 'svg', 'rss', 'atom', 'plist'], readable: true, writable: true },
  {
    format: 'code',
    kind: 'code',
    label: 'Code / text',
    extensions: [
      'js', 'jsx', 'ts', 'tsx', 'css', 'scss', 'less', 'py', 'rb', 'go', 'rs', 'java', 'kt',
      'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'sh', 'bash', 'zsh', 'ps1', 'sql', 'yml', 'yaml',
      'toml', 'ini', 'cfg', 'conf', 'env', 'gitignore', 'srt', 'vtt', 'tex'
    ],
    readable: true,
    writable: true
  },
  {
    format: 'image',
    kind: 'image',
    label: 'Image',
    extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'tif', 'tiff'],
    readable: true,
    writable: false
  }
]

const BY_EXTENSION = new Map<string, FormatInfo>()
for (const info of FORMATS) {
  for (const extension of info.extensions) BY_EXTENSION.set(extension, info)
}

export function formatInfo(format: DocumentFormat): FormatInfo | null {
  return FORMATS.find((info) => info.format === format) ?? null
}

export function formatFromName(name: string): FormatInfo | null {
  const match = /\.([^./\\]+)$/.exec(name)
  if (!match) return null
  return BY_EXTENSION.get(match[1].toLowerCase()) ?? null
}

/**
 * Identifies a file from its bytes when the extension is missing or lying.
 * Container formats (DOCX/XLSX/PPTX/ODT/EPUB are all ZIPs) still need the
 * extension or an entry-name probe to be told apart, which `readDocument` does.
 */
export function formatFromBytes(bytes: Uint8Array): DocumentFormat | null {
  const starts = (...signature: number[]): boolean =>
    signature.every((byte, index) => bytes[index] === byte)

  if (starts(0x25, 0x50, 0x44, 0x46)) return 'pdf' // %PDF
  if (starts(0x7b, 0x5c, 0x72, 0x74, 0x66)) return 'rtf' // {\rtf
  if (starts(0xd0, 0xcf, 0x11, 0xe0)) return 'doc' // OLE2 compound file
  if (starts(0x89, 0x50, 0x4e, 0x47)) return 'image' // PNG
  if (starts(0xff, 0xd8, 0xff)) return 'image' // JPEG
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'image' // GIF
  if (starts(0x42, 0x4d)) return 'image' // BMP
  if (bytes.length > 12 && starts(0x52, 0x49, 0x46, 0x46) &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return 'image' // WEBP
  }
  return null
}

export function isZipContainer(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)
}

/** Formats the editor can export the current document to, given its kind. */
export function exportTargetsFor(kind: DocumentKind): DocumentFormat[] {
  if (kind === 'sheet') return ['xlsx', 'ods', 'csv', 'tsv', 'html', 'pdf']
  if (kind === 'code') return ['txt', 'md', 'html', 'pdf']
  if (kind === 'slides') return ['docx', 'html', 'md', 'txt', 'pdf']
  return ['docx', 'pdf', 'html', 'md', 'txt', 'rtf', 'odt']
}

export const ALL_READABLE_EXTENSIONS = FORMATS.filter((info) => info.readable).flatMap(
  (info) => info.extensions
)
