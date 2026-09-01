import JSZip from 'jszip'
import { uid } from '../format'

/**
 * Writes an EPUB 3 book.
 *
 * The app could already read EPUB and not write one, which is the wrong way
 * round for the people who most need it: an author's manuscript lives in a
 * word processor and has to leave as a book. Everything a reader app requires
 * is here — a container, a package with a spine, and a navigation document —
 * because a file missing any of them opens in nothing.
 */
export interface EpubOptions {
  title: string
  author?: string
  language: string
  rightToLeft: boolean
  /** Cover image as a data URL, if the author picked one. */
  coverDataUrl?: string
}

interface Chapter {
  id: string
  title: string
  xhtml: string
}

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

/**
 * Splits the manuscript at each top-level heading.
 *
 * A book delivered as one enormous XHTML file technically opens, and then
 * every reader app struggles to paginate it and none of them can offer a
 * chapter list. Splitting on <h1> is what makes the result behave like a book
 * rather than a very long page.
 */
function splitChapters(html: string, fallbackTitle: string): Chapter[] {
  const container = document.createElement('div')
  container.innerHTML = html

  const chapters: Chapter[] = []
  let current: { title: string; nodes: Node[] } | null = null

  for (const node of Array.from(container.childNodes)) {
    const isHeading = node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === 'H1'
    if (isHeading) {
      if (current) chapters.push(buildChapter(current, chapters.length))
      current = { title: (node.textContent ?? '').trim() || fallbackTitle, nodes: [node] }
      continue
    }
    if (!current) current = { title: fallbackTitle, nodes: [] }
    current.nodes.push(node)
  }
  if (current) chapters.push(buildChapter(current, chapters.length))

  // A manuscript with no headings at all is still a book, just a one-chapter
  // one — never return nothing, or the spine is empty and no reader opens it.
  if (chapters.length === 0) {
    chapters.push(buildChapter({ title: fallbackTitle, nodes: [] }, 0))
  }
  return chapters
}

function buildChapter(part: { title: string; nodes: Node[] }, index: number): Chapter {
  const holder = document.createElement('div')
  for (const node of part.nodes) holder.appendChild(node.cloneNode(true))
  return {
    id: `chapter-${index + 1}`,
    title: part.title,
    // XHTML, not HTML: an EPUB is parsed by an XML parser, which rejects the
    // unclosed <br> and <img> tags a browser accepts without complaint.
    xhtml: holder.innerHTML
      .replace(/<(br|hr|img)([^>]*?)\s*\/?>/gi, '<$1$2 />')
      .replace(/&nbsp;/g, '&#160;')
  }
}

function chapterDocument(chapter: Chapter, options: EpubOptions): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${escapeXml(options.language)}" lang="${escapeXml(options.language)}" dir="${options.rightToLeft ? 'rtl' : 'ltr'}">
<head>
  <meta charset="utf-8" />
  <title>${escapeXml(chapter.title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css" />
</head>
<body>
${chapter.xhtml}
</body>
</html>`
}

/** A stylesheet that reads well on an e-reader and never fights its settings. */
const STYLESHEET = `html { font-size: 100%; }
body {
  margin: 0 5%;
  line-height: 1.7;
  text-align: justify;
  font-family: serif;
}
h1 { font-size: 1.6em; margin: 2em 0 0.8em; line-height: 1.35; page-break-before: always; }
h2 { font-size: 1.3em; margin: 1.6em 0 0.6em; }
h3 { font-size: 1.1em; margin: 1.3em 0 0.5em; }
p { margin: 0 0 0.85em; text-indent: 0; }
blockquote { margin: 1em 1.5em; font-style: italic; }
img { max-width: 100%; height: auto; }
table { border-collapse: collapse; width: 100%; }
td, th { border: 1px solid #999; padding: 0.35em 0.5em; }
`

export async function htmlToEpub(html: string, options: EpubOptions): Promise<Uint8Array> {
  const chapters = splitChapters(html, options.title)
  const bookId = `urn:uuid:${uid()}-${uid()}`
  const zip = new JSZip()

  // The mimetype must be the archive's first entry and must be stored, not
  // deflated: readers sniff those exact bytes at that exact offset.
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })

  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>`
  )

  zip.file('OEBPS/style.css', STYLESHEET)
  for (const chapter of chapters) {
    zip.file(`OEBPS/${chapter.id}.xhtml`, chapterDocument(chapter, options))
  }

  let coverManifest = ''
  let coverMeta = ''
  if (options.coverDataUrl?.startsWith('data:image/')) {
    const [header, base64] = options.coverDataUrl.split(',')
    const type = header.slice(5, header.indexOf(';')) || 'image/png'
    const extension = type.includes('png') ? 'png' : 'jpg'
    zip.file(`OEBPS/cover.${extension}`, base64, { base64: true })
    coverManifest = `<item id="cover-image" href="cover.${extension}" media-type="${type}" properties="cover-image" />`
    coverMeta = '<meta name="cover" content="cover-image" />'
  }

  const manifest = chapters
    .map(
      (chapter) =>
        `<item id="${chapter.id}" href="${chapter.id}.xhtml" media-type="application/xhtml+xml" />`
    )
    .join('\n    ')
  const spine = chapters.map((chapter) => `<itemref idref="${chapter.id}" />`).join('\n    ')

  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${escapeXml(options.language)}" dir="${options.rightToLeft ? 'rtl' : 'ltr'}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">${escapeXml(bookId)}</dc:identifier>
    <dc:title>${escapeXml(options.title)}</dc:title>
    <dc:language>${escapeXml(options.language)}</dc:language>
    ${options.author ? `<dc:creator>${escapeXml(options.author)}</dc:creator>` : ''}
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta>
    ${coverMeta}
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
    <item id="style" href="style.css" media-type="text/css" />
    ${coverManifest}
    ${manifest}
  </manifest>
  <spine page-progression-direction="${options.rightToLeft ? 'rtl' : 'ltr'}">
    ${spine}
  </spine>
</package>`
  )

  zip.file(
    'OEBPS/nav.xhtml',
    `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXml(options.language)}" dir="${options.rightToLeft ? 'rtl' : 'ltr'}">
<head><meta charset="utf-8" /><title>${escapeXml(options.title)}</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>${escapeXml(options.title)}</h1>
    <ol>
      ${chapters
        .map(
          (chapter) =>
            `<li><a href="${chapter.id}.xhtml">${escapeXml(chapter.title)}</a></li>`
        )
        .join('\n      ')}
    </ol>
  </nav>
</body>
</html>`
  )

  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}
