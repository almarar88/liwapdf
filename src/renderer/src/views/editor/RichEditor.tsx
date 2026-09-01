import { useEffect, useRef, useState } from 'react'
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Columns3,
  Eraser,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Quote,
  Rows3,
  SeparatorHorizontal,
  Strikethrough,
  Table as TableIcon,
  Trash2,
  Underline
} from 'lucide-react'
import { useApp } from '../../store/app'
import { Button, Select } from '../../components/ui'
import { FILTERS, pickOneFile } from '../../lib/files'
import { sanitize } from '../../lib/documents/read'

// Latin faces first, then the Arabic document faces people actually expect to
// find — Word's own Arabic defaults and the two classic naskh text faces.
// Amiri is calligraphic and belongs at the end of that group, not as the only
// Arabic option on offer.
const FONTS = [
  'Calibri',
  'Arial',
  'Times New Roman',
  'Georgia',
  'Tahoma',
  'Verdana',
  'Segoe UI',
  'Consolas',
  'Sakkal Majalla',
  'Traditional Arabic',
  'Simplified Arabic',
  'Arabic Typesetting',
  'Noto Naskh Arabic',
  'Dubai',
  'Cairo',
  'Amiri'
]
const SIZES = ['10', '11', '12', '14', '16', '18', '20', '24', '28', '32', '40', '48']

interface RichEditorProps {
  html: string
  direction: 'rtl' | 'ltr'
  zoom: number
  spellCheck: boolean
  /** Identity of the loaded document; changing it reloads the surface. */
  documentKey: string
  /** Bumped when the html changed by some route other than typing here. */
  revision: number
  onChange: (html: string) => void
}

export function RichEditor({
  html,
  direction,
  zoom,
  spellCheck,
  documentKey,
  revision,
  onChange
}: RichEditorProps): React.JSX.Element {
  const t = useApp((state) => state.t)
  const editorRef = useRef<HTMLDivElement>(null)
  const loadedKey = useRef<string | null>(null)

  // innerHTML is written on a new document and on a change this surface did
  // not make — never on its own output, which would destroy the caret on every
  // keystroke. Keying on identity alone was the reason find and replace
  // reported a count over a document it had not visibly touched: the store
  // held the new markup and the DOM never saw it.
  useEffect(() => {
    const editor = editorRef.current
    const key = `${documentKey}:${revision}`
    if (!editor || loadedKey.current === key) return
    editor.innerHTML = html || '<p><br /></p>'
    loadedKey.current = key
  }, [documentKey, revision, html])

  const sync = (): void => {
    if (editorRef.current) onChange(editorRef.current.innerHTML)
  }

  const exec = (command: string, value?: string): void => {
    editorRef.current?.focus()
    document.execCommand(command, false, value)
    sync()
  }

  const insertHtml = (markup: string): void => {
    editorRef.current?.focus()
    document.execCommand('insertHTML', false, markup)
    sync()
  }

  /** The table cell the caret currently sits in, if any. */
  const currentCell = (): HTMLTableCellElement | null => {
    const selection = window.getSelection()
    const node = selection?.anchorNode
    if (!node) return null
    const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
    return element?.closest('td, th') ?? null
  }

  const withTable = (action: (cell: HTMLTableCellElement, table: HTMLTableElement) => void): void => {
    const cell = currentCell()
    const table = cell?.closest('table')
    if (!cell || !table) return
    action(cell, table)
    sync()
  }

  const addTableRow = (): void =>
    withTable((cell) => {
      const row = cell.closest('tr')
      if (!row) return
      const clone = row.cloneNode(true) as HTMLTableRowElement
      Array.from(clone.cells).forEach((target) => {
        target.innerHTML = '<br />'
      })
      row.after(clone)
    })

  const addTableColumn = (): void =>
    withTable((cell, table) => {
      const index = cell.cellIndex
      Array.from(table.rows).forEach((row) => {
        const reference = row.cells[index]
        const fresh = document.createElement(reference?.tagName === 'TH' ? 'th' : 'td')
        fresh.innerHTML = '<br />'
        reference ? reference.after(fresh) : row.appendChild(fresh)
      })
    })

  const deleteTableRow = (): void =>
    withTable((cell, table) => {
      if (table.rows.length <= 1) table.remove()
      else cell.closest('tr')?.remove()
    })

  const deleteTableColumn = (): void =>
    withTable((cell, table) => {
      const index = cell.cellIndex
      if ((table.rows[0]?.cells.length ?? 0) <= 1) {
        table.remove()
        return
      }
      Array.from(table.rows).forEach((row) => row.cells[index]?.remove())
    })

  // Whether the caret sits in a table has to be state, not a call made while
  // rendering: moving the caret does not re-render, so the row and column
  // buttons were gated on a value that was only ever sampled at mount — they
  // never appeared, and table editing was unreachable from the toolbar.
  const [inTable, setInTable] = useState(false)
  useEffect(() => {
    const update = (): void => {
      const editor = editorRef.current
      const node = window.getSelection()?.anchorNode
      if (!editor || !node || !editor.contains(node)) {
        setInTable(false)
        return
      }
      const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
      setInTable(Boolean(element?.closest('td, th')))
    }
    document.addEventListener('selectionchange', update)
    return () => document.removeEventListener('selectionchange', update)
  }, [])

  return (
    <div className="rich-shell">
      <div className="toolbar">
        <Select
          value=""
          onChange={(value) => value && exec('fontName', value)}
          options={[{ value: '', label: t('word.fontFamily') }, ...FONTS.map((font) => ({ value: font, label: font }))]}
        />
        <Select
          value=""
          onChange={(value) => {
            if (!value) return
            // execCommand only understands sizes 1-7, so tag then rewrite.
            document.execCommand('fontSize', false, '7')
            for (const element of Array.from(
              editorRef.current?.querySelectorAll('font[size="7"]') ?? []
            )) {
              const span = document.createElement('span')
              span.style.fontSize = `${value}px`
              span.innerHTML = element.innerHTML
              element.replaceWith(span)
            }
            sync()
          }}
          options={[{ value: '', label: t('word.fontSize') }, ...SIZES.map((size) => ({ value: size, label: size }))]}
        />

        <span className="sep" />

        <Button size="sm" variant="ghost" icon title={t('word.bold')} onClick={() => exec('bold')}>
          <Bold size={15} />
        </Button>
        <Button size="sm" variant="ghost" icon title={t('word.italic')} onClick={() => exec('italic')}>
          <Italic size={15} />
        </Button>
        <Button size="sm" variant="ghost" icon title={t('word.underline')} onClick={() => exec('underline')}>
          <Underline size={15} />
        </Button>
        <Button size="sm" variant="ghost" icon title={t('word.strike')} onClick={() => exec('strikeThrough')}>
          <Strikethrough size={15} />
        </Button>

        <input
          type="color"
          className="color-chip"
          title={t('word.textColor')}
          onChange={(event) => exec('foreColor', event.target.value)}
        />
        <input
          type="color"
          className="color-chip"
          title={t('word.highlight')}
          defaultValue="#ffe066"
          onChange={(event) => exec('hiliteColor', event.target.value)}
        />

        <span className="sep" />

        <Select
          value=""
          onChange={(value) => value && exec('formatBlock', value)}
          options={[
            { value: '', label: t('word.paragraph') },
            { value: 'p', label: t('word.paragraph') },
            { value: 'h1', label: t('word.h1') },
            { value: 'h2', label: t('word.h2') },
            { value: 'h3', label: t('word.h3') },
            { value: 'blockquote', label: t('word.quote') },
            { value: 'pre', label: 'Code' }
          ]}
        />

        <Button size="sm" variant="ghost" icon title={t('word.bullets')} onClick={() => exec('insertUnorderedList')}>
          <List size={15} />
        </Button>
        <Button size="sm" variant="ghost" icon title={t('word.numbers')} onClick={() => exec('insertOrderedList')}>
          <ListOrdered size={15} />
        </Button>
        <Button size="sm" variant="ghost" icon title={t('word.quote')} onClick={() => exec('formatBlock', 'blockquote')}>
          <Quote size={15} />
        </Button>

        <span className="sep" />

        <Button size="sm" variant="ghost" icon title={t('word.alignStart')} onClick={() => exec('justifyLeft')}>
          <AlignLeft size={15} />
        </Button>
        <Button size="sm" variant="ghost" icon title={t('word.alignCenter')} onClick={() => exec('justifyCenter')}>
          <AlignCenter size={15} />
        </Button>
        <Button size="sm" variant="ghost" icon title={t('word.alignEnd')} onClick={() => exec('justifyRight')}>
          <AlignRight size={15} />
        </Button>
        <Button size="sm" variant="ghost" icon title={t('word.justify')} onClick={() => exec('justifyFull')}>
          <AlignJustify size={15} />
        </Button>

        <span className="sep" />

        <Button
          size="sm"
          variant="ghost"
          icon
          title={t('word.insertTable')}
          onClick={() => {
            const header = '<th><br /></th>'.repeat(3)
            const cells = '<td><br /></td>'.repeat(3)
            insertHtml(
              `<table><thead><tr>${header}</tr></thead><tbody>${`<tr>${cells}</tr>`.repeat(
                3
              )}</tbody></table><p><br /></p>`
            )
          }}
        >
          <TableIcon size={15} />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon
          title={t('word.insertImage')}
          onClick={async () => {
            const picked = await pickOneFile(FILTERS.images)
            if (!picked) return
            const blob = new Blob([picked.data.slice().buffer as ArrayBuffer])
            const reader = new FileReader()
            reader.onload = () => insertHtml(`<img src="${String(reader.result)}" alt="" />`)
            reader.readAsDataURL(blob)
          }}
        >
          <ImageIcon size={15} />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon
          title={t('word.insertLink')}
          onClick={() => {
            const url = window.prompt('URL', 'https://')
            if (url) exec('createLink', url)
          }}
        >
          <Link2 size={15} />
        </Button>
        <Button size="sm" variant="ghost" icon title={t('word.insertRule')} onClick={() => insertHtml('<hr />')}>
          <Minus size={15} />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon
          title={t('word.insertPageBreak')}
          onClick={() => insertHtml('<div class="page-break"></div><p><br /></p>')}
        >
          <SeparatorHorizontal size={15} />
        </Button>
        <Button size="sm" variant="ghost" icon title={t('word.clearFormat')} onClick={() => exec('removeFormat')}>
          <Eraser size={15} />
        </Button>
      </div>

      {inTable ? (
        <div className="toolbar sub">
          <span className="muted">{t('word.insertTable')}</span>
          <Button size="sm" variant="ghost" onClick={addTableRow}>
            <Rows3 size={14} />
            {t('sheet.addRow')}
          </Button>
          <Button size="sm" variant="ghost" onClick={addTableColumn}>
            <Columns3 size={14} />
            {t('sheet.addColumn')}
          </Button>
          <Button size="sm" variant="danger" ghostDanger onClick={deleteTableRow}>
            <Trash2 size={14} />
            {t('sheet.deleteRow')}
          </Button>
          <Button size="sm" variant="danger" ghostDanger onClick={deleteTableColumn}>
            <Trash2 size={14} />
            {t('sheet.deleteColumn')}
          </Button>
        </div>
      ) : null}

      <div className="doc-scroll">
        <div
          ref={editorRef}
          className="doc-sheet"
          dir={direction}
          style={{ zoom }}
          contentEditable
          suppressContentEditableWarning
          spellCheck={spellCheck}
          onInput={sync}
          onBlur={sync}
          onPaste={(event) => {
            // Pasted markup is untrusted: run it through the same sanitizer
            // that opened files go through instead of trusting the clipboard.
            const clipboardHtml = event.clipboardData.getData('text/html')
            if (!clipboardHtml) return
            event.preventDefault()
            document.execCommand('insertHTML', false, sanitize(clipboardHtml))
            sync()
          }}
        />
      </div>
    </div>
  )
}
