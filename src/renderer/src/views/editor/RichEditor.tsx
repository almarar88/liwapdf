import { useEffect, useRef, useState } from 'react'
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Columns3,
  Eraser,
  Sparkles,
  Coins,
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
  ListTree,
  Signature,
  Trash2,
  Underline
} from 'lucide-react'
import { useApp } from '../../store/app'
import { Button, Select, Modal, Field, Checkbox, TextInput, Segmented } from '../../components/ui'
import { cleanArabicDom, DEFAULT_CLEANUP, type CleanupOptions } from '../../lib/text/cleanup'
import { CURRENCIES, spellNumber, tafqeet, type Currency } from '../../lib/text/tafqeet'
import { FILTERS, pickOneFile } from '../../lib/files'
import { sanitize } from '../../lib/documents/read'
import { formatGregorian, formatHijri } from '../../lib/pdf/typography'
import { SignaturePad } from '../../components/SignaturePad'

/** Dates are inserted as markup, so a stray angle bracket must not be one. */
function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

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

/**
 * Dates a letter or a memo in this region actually carries.
 *
 * The Hijri conversion is the tabular Umm al-Qura calendar, which can sit a
 * day either side of the sighting — so the dual form names both calendars
 * rather than presenting one as the authority.
 */
function dateOptions(language: 'ar' | 'en'): { value: string; label: string }[] {
  const now = new Date()
  const hijri = formatHijri(now, language)
  const gregorian = formatGregorian(now, language)
  const dual = language === 'ar' ? `${hijri} الموافق ${gregorian}` : `${hijri} / ${gregorian}`
  const numeric = now.toISOString().slice(0, 10)
  return [
    { value: gregorian, label: gregorian },
    { value: hijri, label: hijri },
    { value: dual, label: dual },
    { value: numeric, label: numeric }
  ]
}

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
  const notify = useApp((state) => state.notify)
  const language = useApp((state) => state.settings.language)
  const editorRef = useRef<HTMLDivElement>(null)
  const loadedKey = useRef<string | null>(null)
  const [cleanupOpen, setCleanupOpen] = useState(false)
  const [cleanup, setCleanup] = useState<CleanupOptions>(DEFAULT_CLEANUP)
  const [amountOpen, setAmountOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [amountCurrency, setAmountCurrency] = useState<Currency>('SAR')
  const [amountLanguage, setAmountLanguage] = useState<'ar' | 'en'>(language)
  const [amountFormal, setAmountFormal] = useState(true)
  const amountValue = Number(amount.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/,/g, ''))
  const amountText = Number.isFinite(amountValue) && amount.trim() !== ''
    ? amountLanguage === 'ar'
      ? tafqeet(amountValue, { currency: amountCurrency, formal: amountFormal })
      : spellNumber(amountValue, { currency: amountCurrency, formal: amountFormal })
    : ''

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
  const [signOpen, setSignOpen] = useState(false)

  /**
   * Builds a contents list from the headings already in the manuscript.
   *
   * Typed by hand it goes stale the first time a chapter is renamed, which is
   * why nobody keeps one up to date. Inserted at the caret as ordinary
   * markup so it exports to every format like the rest of the document.
   */
  const insertContents = (): void => {
    const editor = editorRef.current
    if (!editor) return
    const headings = Array.from(editor.querySelectorAll('h1, h2, h3'))
    if (headings.length === 0) {
      notify({ kind: 'info', title: t('word.tocEmpty') })
      return
    }
    const items = headings
      .map((heading) => {
        const depth = Number(heading.tagName.slice(1)) - 1
        const label = (heading.textContent ?? '').trim()
        if (!label) return ''
        const indent = depth * 18
        return `<li style="margin-inline-start:${indent}px">${escapeHtml(label)}</li>`
      })
      .filter(Boolean)
      .join('')
    insertHtml(`<h2>${escapeHtml(t('word.tocTitle'))}</h2><ul>${items}</ul>`)
  }
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
          onChange={(value) => value && insertHtml(escapeHtml(value))}
          options={[{ value: '', label: t('word.insertDate') }, ...dateOptions(language)]}
        />
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
        <Button size="sm" variant="ghost" icon title={t('word.toc')} onClick={insertContents}>
          <ListTree size={15} />
        </Button>
        <Button size="sm" variant="ghost" icon title={t('sign.insert')} onClick={() => setSignOpen(true)}>
          <Signature size={15} />
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
        <Button size="sm" variant="ghost" icon title={t('word.cleanup')} onClick={() => setCleanupOpen(true)}>
          <Sparkles size={15} />
        </Button>
        <Button size="sm" variant="ghost" icon title={t('word.amountWords')} onClick={() => setAmountOpen(true)}>
          <Coins size={15} />
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

      <Modal
        open={cleanupOpen}
        onClose={() => setCleanupOpen(false)}
        title={t('word.cleanup')}
        footer={
          <>
            <Button onClick={() => setCleanupOpen(false)}>{t('action.cancel')}</Button>
            <Button
              variant="primary"
              onClick={() => {
                const editor = editorRef.current
                if (!editor) return
                const changed = cleanArabicDom(editor, cleanup)
                if (changed > 0) sync()
                notify({
                  kind: changed > 0 ? 'success' : 'info',
                  title: changed > 0 ? t('word.cleanupDone', { n: changed }) : t('word.cleanupNone')
                })
                setCleanupOpen(false)
              }}
            >
              {t('action.apply')}
            </Button>
          </>
        }
      >
        <div className="stack">
          <p className="muted">{t('word.cleanup.d')}</p>
          <Checkbox checked={cleanup.tashkeel} onChange={(v) => setCleanup({ ...cleanup, tashkeel: v })} label={t('word.cleanup.tashkeel')} />
          <Checkbox checked={cleanup.tatweel} onChange={(v) => setCleanup({ ...cleanup, tatweel: v })} label={t('word.cleanup.tatweel')} />
          <Checkbox checked={cleanup.punctuation} onChange={(v) => setCleanup({ ...cleanup, punctuation: v })} label={t('word.cleanup.punctuation')} />
          <Checkbox checked={cleanup.spaces} onChange={(v) => setCleanup({ ...cleanup, spaces: v })} label={t('word.cleanup.spaces')} />
          <Checkbox checked={cleanup.hamza} onChange={(v) => setCleanup({ ...cleanup, hamza: v })} label={t('word.cleanup.hamza')} />
          <Field label={t('word.cleanup.digits')}>
            <Segmented
              value={cleanup.digits}
              onChange={(value) => setCleanup({ ...cleanup, digits: value })}
              options={[
                { value: 'keep', label: t('word.cleanup.digits.keep') },
                { value: 'arabic', label: t('word.cleanup.digits.arabic') },
                { value: 'western', label: t('word.cleanup.digits.western') }
              ]}
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={amountOpen}
        onClose={() => setAmountOpen(false)}
        title={t('word.amountWords')}
        footer={
          <>
            <Button onClick={() => setAmountOpen(false)}>{t('action.cancel')}</Button>
            <Button
              variant="primary"
              disabled={!amountText}
              onClick={() => {
                insertHtml(escapeHtml(amountText))
                setAmountOpen(false)
              }}
            >
              {t('word.insert')}
            </Button>
          </>
        }
      >
        <div className="stack">
          <Field label={t('word.amount')}>
            <TextInput value={amount} onChange={setAmount} placeholder="1250.50" autoFocus />
          </Field>
          <Field label={t('word.currency')}>
            <Select
              value={amountCurrency}
              onChange={setAmountCurrency}
              options={[
                { value: 'none', label: t('cur.none') },
                ...(Object.keys(CURRENCIES) as Currency[]).map((code) => ({ value: code, label: `${t(`cur.${code}` as never)} (${code})` }))
              ]}
            />
          </Field>
          <Field label={t('settings.language')}>
            <Segmented
              value={amountLanguage}
              onChange={setAmountLanguage}
              options={[
                { value: 'ar', label: 'العربية' },
                { value: 'en', label: 'English' }
              ]}
            />
          </Field>
          <Checkbox checked={amountFormal} onChange={setAmountFormal} label={t('word.formal')} />
          {amountText ? (
            <div className="card card-pad" style={{ fontSize: 'var(--text-md)', lineHeight: 1.8 }}>
              <bdi>{amountText}</bdi>
            </div>
          ) : null}
        </div>
      </Modal>

      <SignaturePad
        open={signOpen}
        onClose={() => setSignOpen(false)}
        onUse={(dataUrl) => {
          // Sized in millimetres rather than pixels: a signature has a real
          // width on a page, and one sized to the drawing canvas would land
          // the width of the screen.
          insertHtml(`<img src="${dataUrl}" alt="signature" style="width:52mm;height:auto" />`)
          setSignOpen(false)
        }}
      />
    </div>
  )
}
