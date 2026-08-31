import { useEffect, useMemo, useRef, useState } from 'react'
import { Braces, WrapText, Minimize2 } from 'lucide-react'
import { useApp } from '../../store/app'
import { Button } from '../../components/ui'
import type { DocumentFormat } from '../../lib/documents/formats'

interface CodeEditorProps {
  text: string
  format: DocumentFormat
  zoom: number
  onChange: (text: string) => void
}

/**
 * A plain-text editor with a synchronised gutter. Deliberately not a full code
 * editor: no syntax engine to ship, no reflow surprises, and it stays fast on
 * multi-megabyte logs.
 */
export function CodeEditor({ text, format, zoom, onChange }: CodeEditorProps): React.JSX.Element {
  const t = useApp((state) => state.t)
  const notify = useApp((state) => state.notify)
  const [wrap, setWrap] = useState(true)
  const [tabEscapes, setTabEscapes] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)

  const lineCount = useMemo(() => text.split('\n').length, [text])

  useEffect(() => {
    const textarea = textareaRef.current
    const gutter = gutterRef.current
    if (!textarea || !gutter) return undefined
    const sync = (): void => {
      gutter.scrollTop = textarea.scrollTop
    }
    textarea.addEventListener('scroll', sync, { passive: true })
    return () => textarea.removeEventListener('scroll', sync)
  }, [])

  const formatDocument = (): void => {
    if (format === 'json') {
      try {
        onChange(JSON.stringify(JSON.parse(text), null, 2))
      } catch (error) {
        notify({ kind: 'error', title: t('msg.error'), message: (error as Error).message })
      }
      return
    }
    if (format === 'xml') {
      onChange(formatXml(text))
      return
    }
    // Everything else: normalise line endings and drop trailing whitespace.
    onChange(
      text
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line) => line.replace(/[ \t]+$/, ''))
        .join('\n')
    )
  }

  const minify = (): void => {
    if (format === 'json') {
      try {
        onChange(JSON.stringify(JSON.parse(text)))
      } catch (error) {
        notify({ kind: 'error', title: t('msg.error'), message: (error as Error).message })
      }
      return
    }
    onChange(text.replace(/\n\s*\n+/g, '\n').replace(/[ \t]+$/gm, ''))
  }

  /**
   * Tab inserts an indent, which makes the textarea a keyboard trap: once
   * focus is inside, nothing but a mouse gets it out again. Escape arms the
   * standard escape hatch — the next Tab leaves instead of indenting — and
   * Shift+Tab always leaves, since it never inserted anything anyway.
   */
  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Escape') {
      setTabEscapes(true)
      return
    }
    if (event.key !== 'Tab') {
      if (tabEscapes) setTabEscapes(false)
      return
    }
    if (tabEscapes || event.shiftKey) {
      setTabEscapes(false)
      return
    }
    event.preventDefault()
    const textarea = event.currentTarget
    const { selectionStart, selectionEnd, value } = textarea
    const next = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`
    onChange(next)
    requestAnimationFrame(() => {
      textarea.selectionStart = selectionStart + 2
      textarea.selectionEnd = selectionStart + 2
    })
  }

  return (
    <div className="code-shell">
      <div className="toolbar">
        <Button size="sm" variant="ghost" onClick={formatDocument}>
          <Braces size={15} />
          {t('code.format')}
        </Button>
        <Button size="sm" variant="ghost" onClick={minify}>
          <Minimize2 size={15} />
          {t('code.minify')}
        </Button>
        <Button
          size="sm"
          variant={wrap ? 'primary' : 'ghost'}
          onClick={() => setWrap((value) => !value)}
        >
          <WrapText size={15} />
          {t('code.wrap')}
        </Button>
        <span className="spacer" />
        <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
          {t('code.tabHint')}
        </span>
        <span className="muted mono" dir="ltr">
          {lineCount} {t('code.lines')}
        </span>
      </div>

      <div className="code-body" style={{ fontSize: `${13 * zoom}px` }}>
        <div className="code-gutter" ref={gutterRef}>
          {Array.from({ length: lineCount }, (_, index) => (
            <div key={index}>{index + 1}</div>
          ))}
        </div>
        <textarea
          ref={textareaRef}
          className="code-area"
          dir="ltr"
          spellCheck={false}
          wrap={wrap ? 'soft' : 'off'}
          style={{ whiteSpace: wrap ? 'pre-wrap' : 'pre' }}
          value={text}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
    </div>
  )
}

/** Re-indents XML by walking tag boundaries — no parser, no reordering. */
function formatXml(xml: string): string {
  const normalized = xml.replace(/>\s*</g, '><').trim()
  const lines: string[] = []
  let depth = 0

  for (const token of normalized.split(/(?=<)/)) {
    if (!token) continue
    if (/^<\//.test(token)) depth = Math.max(0, depth - 1)
    lines.push('  '.repeat(depth) + token.trim())
    if (
      /^<[^!?/]/.test(token) &&
      !/\/>$/.test(token) &&
      !/<\/[^>]+>$/.test(token)
    ) {
      depth += 1
    }
  }
  return lines.join('\n')
}
