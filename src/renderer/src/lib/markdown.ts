import { escapeHtml } from './format'

/**
 * A deliberately small Markdown subset renderer — headings, emphasis, lists,
 * quotes, code, tables, links, images and rules. Enough to make .md files look
 * right in the editor and in exported PDFs without shipping a parser.
 */
export function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const output: string[] = []
  let inCode = false
  let codeBuffer: string[] = []
  let listType: 'ul' | 'ol' | null = null
  let inQuote = false

  const closeList = (): void => {
    if (listType) {
      output.push(`</${listType}>`)
      listType = null
    }
  }
  const closeQuote = (): void => {
    if (inQuote) {
      output.push('</blockquote>')
      inQuote = false
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]

    if (/^\s*```/.test(line)) {
      if (inCode) {
        output.push(`<pre><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>`)
        codeBuffer = []
        inCode = false
      } else {
        closeList()
        closeQuote()
        inCode = true
      }
      continue
    }
    if (inCode) {
      codeBuffer.push(line)
      continue
    }

    if (!line.trim()) {
      closeList()
      closeQuote()
      continue
    }

    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      closeList()
      closeQuote()
      output.push('<hr />')
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      closeList()
      closeQuote()
      const level = heading[1].length
      output.push(`<h${level}>${inline(heading[2])}</h${level}>`)
      continue
    }

    // Table: a header row followed by a separator row.
    if (line.includes('|') && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[index + 1] ?? '')) {
      closeList()
      closeQuote()
      const header = splitRow(line)
      const rows: string[][] = []
      let cursor = index + 2
      while (cursor < lines.length && lines[cursor].includes('|') && lines[cursor].trim()) {
        rows.push(splitRow(lines[cursor]))
        cursor += 1
      }
      index = cursor - 1
      output.push(
        `<table><thead><tr>${header
          .map((cell) => `<th>${inline(cell)}</th>`)
          .join('')}</tr></thead><tbody>${rows
          .map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table>`
      )
      continue
    }

    const quote = /^\s*>\s?(.*)$/.exec(line)
    if (quote) {
      closeList()
      if (!inQuote) {
        output.push('<blockquote>')
        inQuote = true
      }
      output.push(`<p>${inline(quote[1])}</p>`)
      continue
    }
    closeQuote()

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line)
    if (bullet) {
      if (listType !== 'ul') {
        closeList()
        output.push('<ul>')
        listType = 'ul'
      }
      output.push(`<li>${inline(bullet[1])}</li>`)
      continue
    }

    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (numbered) {
      if (listType !== 'ol') {
        closeList()
        output.push('<ol>')
        listType = 'ol'
      }
      output.push(`<li>${inline(numbered[1])}</li>`)
      continue
    }

    closeList()
    output.push(`<p>${inline(line)}</p>`)
  }

  if (inCode && codeBuffer.length > 0) {
    output.push(`<pre><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>`)
  }
  closeList()
  closeQuote()
  return output.join('\n')
}

function splitRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

function inline(text: string): string {
  let value = escapeHtml(text)
  value = value.replace(/`([^`]+)`/g, '<code>$1</code>')
  value = value.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1" />')
  value = value.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
  value = value.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
  value = value.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  value = value.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
  value = value.replace(/~~([^~]+)~~/g, '<s>$1</s>')
  return value
}
