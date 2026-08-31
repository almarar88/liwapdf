import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  List,
  ListOrdered,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Quote,
  Table as TableIcon,
  Image as ImageIcon,
  Link2,
  Minus,
  Eraser,
  Replace,
  FileDown,
  FilePlus2,
  FolderOpen,
  Languages,
  SeparatorHorizontal
} from 'lucide-react'
import { useApp } from '../store/app'
import { useDocumentActions } from '../hooks/useDocumentActions'
import { Button, Field, Modal, Select, TextInput } from '../components/ui'
import { FILTERS, pickOneFile } from '../lib/files'

const FONTS = [
  'Calibri',
  'Arial',
  'Times New Roman',
  'Georgia',
  'Tahoma',
  'Segoe UI',
  'Consolas',
  'Amiri',
  'Dubai'
]
const SIZES = ['12', '14', '16', '18', '20', '24', '28', '32', '40']

export function WordView(): React.JSX.Element {
  const t = useApp((state) => state.t)
  const wordDoc = useApp((state) => state.wordDoc)
  const setWordDoc = useApp((state) => state.setWordDoc)
  const updateWordHtml = useApp((state) => state.updateWordHtml)
  const notify = useApp((state) => state.notify)
  const language = useApp((state) => state.settings.language)
  const { openDialog, saveWordAs } = useDocumentActions()

  const editorRef = useRef<HTMLDivElement>(null)
  const [direction, setDirection] = useState<'rtl' | 'ltr'>(language === 'ar' ? 'rtl' : 'ltr')
  const [findOpen, setFindOpen] = useState(false)
  const [findText, setFindText] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [stats, setStats] = useState({ words: 0, characters: 0 })
  const [font, setFont] = useState(FONTS[0])
  const [size, setSize] = useState('16')

  // Load document HTML into the editor only when a different document arrives;
  // re-writing innerHTML on every keystroke would destroy the caret.
  const loadedName = useRef<string | null>(null)
  useEffect(() => {
    if (!wordDoc || !editorRef.current) return
    if (loadedName.current === `${wordDoc.name}|${wordDoc.path ?? ''}`) return
    editorRef.current.innerHTML = wordDoc.html
    loadedName.current = `${wordDoc.name}|${wordDoc.path ?? ''}`
    recomputeStats()
  }, [wordDoc])

  const recomputeStats = (): void => {
    const text = editorRef.current?.innerText ?? ''
    setStats({
      words: text.trim() ? text.trim().split(/\s+/).length : 0,
      characters: text.length
    })
  }

  const exec = (command: string, value?: string): void => {
    editorRef.current?.focus()
    document.execCommand(command, false, value)
    syncHtml()
  }

  const syncHtml = (): void => {
    if (!editorRef.current) return
    updateWordHtml(editorRef.current.innerHTML)
    recomputeStats()
  }

  const insertHtml = (html: string): void => {
    editorRef.current?.focus()
    document.execCommand('insertHTML', false, html)
    syncHtml()
  }

  const readTime = useMemo(() => Math.max(1, Math.round(stats.words / 220)), [stats.words])

  if (!wordDoc) {
    return (
      <div className="view">
        <div className="page-head">
          <div>
            <h1>{t('word.title')}</h1>
            <p>{t('word.sub')}</p>
          </div>
        </div>
        <div className="grid cols-2">
          <button
            className="tool"
            onClick={() =>
              setWordDoc({
                name: 'document.docx',
                path: null,
                html: '<h1>عنوان المستند</h1><p>ابدأ الكتابة هنا…</p>',
                dirty: false
              })
            }
          >
            <span className="icon">
              <FilePlus2 size={19} />
            </span>
            <h3>{t('word.newDoc')}</h3>
            <p>{t('word.sub')}</p>
          </button>
          <button className="tool" onClick={() => void openDialog()}>
            <span className="icon">
              <FolderOpen size={19} />
            </span>
            <h3>{t('action.openWord')}</h3>
            <p>{t('convert.wordToPdf.d')}</p>
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="view flush" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="toolbar">
        <Select
          value={font}
          onChange={(value) => {
            setFont(value)
            exec('fontName', value)
          }}
          options={FONTS.map((item) => ({ value: item, label: item }))}
        />
        <Select
          value={size}
          onChange={(value) => {
            setSize(value)
            document.execCommand('fontSize', false, '7')
            // execCommand only supports 1..7; map the real size onto the spans it made.
            for (const element of Array.from(
              editorRef.current?.querySelectorAll('font[size="7"]') ?? []
            )) {
              const span = document.createElement('span')
              span.style.fontSize = `${value}px`
              span.innerHTML = element.innerHTML
              element.replaceWith(span)
            }
            syncHtml()
          }}
          options={SIZES.map((item) => ({ value: item, label: item }))}
        />

        <span className="sep" />

        <Button size="sm" variant="ghost" icon title={t('word.bold')} onClick={() => exec('bold')}>
          <Bold size={15} />
        </Button>
        <Button size="sm" variant="ghost" icon title={t('word.italic')} onClick={() => exec('italic')}>
          <Italic size={15} />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon
          title={t('word.underline')}
          onClick={() => exec('underline')}
        >
          <Underline size={15} />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon
          title={t('word.strike')}
          onClick={() => exec('strikeThrough')}
        >
          <Strikethrough size={15} />
        </Button>

        <input
          type="color"
          title={t('word.textColor')}
          onChange={(event) => exec('foreColor', event.target.value)}
          style={{
            width: 28,
            height: 28,
            padding: 2,
            border: '1px solid var(--hairline)',
            borderRadius: 6,
            background: 'var(--surface-solid)',
            cursor: 'pointer'
          }}
        />
        <input
          type="color"
          title={t('word.highlight')}
          defaultValue="#ffe066"
          onChange={(event) => exec('hiliteColor', event.target.value)}
          style={{
            width: 28,
            height: 28,
            padding: 2,
            border: '1px solid var(--hairline)',
            borderRadius: 6,
            background: 'var(--surface-solid)',
            cursor: 'pointer'
          }}
        />

        <span className="sep" />

        <Select
          value="p"
          onChange={(value) => exec('formatBlock', value)}
          options={[
            { value: 'p', label: t('word.paragraph') },
            { value: 'h1', label: t('word.h1') },
            { value: 'h2', label: t('word.h2') },
            { value: 'h3', label: t('word.h3') },
            { value: 'blockquote', label: t('word.quote') }
          ]}
        />

        <Button
          size="sm"
          variant="ghost"
          icon
          title={t('word.bullets')}
          onClick={() => exec('insertUnorderedList')}
        >
          <List size={15} />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon
          title={t('word.numbers')}
          onClick={() => exec('insertOrderedList')}
        >
          <ListOrdered size={15} />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon
          title={t('word.quote')}
          onClick={() => exec('formatBlock', 'blockquote')}
        >
          <Quote size={15} />
        </Button>

        <span className="sep" />

        <Button size="sm" variant="ghost" icon onClick={() => exec('justifyLeft')} title={t('word.alignStart')}>
          <AlignLeft size={15} />
        </Button>
        <Button size="sm" variant="ghost" icon onClick={() => exec('justifyCenter')} title={t('word.alignCenter')}>
          <AlignCenter size={15} />
        </Button>
        <Button size="sm" variant="ghost" icon onClick={() => exec('justifyRight')} title={t('word.alignEnd')}>
          <AlignRight size={15} />
        </Button>
        <Button size="sm" variant="ghost" icon onClick={() => exec('justifyFull')} title={t('word.justify')}>
          <AlignJustify size={15} />
        </Button>

        <span className="sep" />

        <Button
          size="sm"
          variant="ghost"
          icon
          title={t('word.insertTable')}
          onClick={() => {
            const rows = 3
            const columns = 3
            const cells = Array.from({ length: columns }, () => '<td><br /></td>').join('')
            const header = Array.from({ length: columns }, () => '<th><br /></th>').join('')
            insertHtml(
              `<table><thead><tr>${header}</tr></thead><tbody>${Array.from(
                { length: rows },
                () => `<tr>${cells}</tr>`
              ).join('')}</tbody></table><p><br /></p>`
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
        <Button
          size="sm"
          variant="ghost"
          icon
          title={t('word.clearFormat')}
          onClick={() => exec('removeFormat')}
        >
          <Eraser size={15} />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon
          title={t('word.direction')}
          onClick={() => setDirection((value) => (value === 'rtl' ? 'ltr' : 'rtl'))}
        >
          <Languages size={15} />
        </Button>
        <Button size="sm" variant="ghost" icon title={t('word.findReplace')} onClick={() => setFindOpen(true)}>
          <Replace size={15} />
        </Button>

        <span className="spacer" />

        <Button size="sm" onClick={() => void saveWordAs('docx')}>
          <FileDown size={15} />
          {t('word.exportDocx')}
        </Button>
        <Button size="sm" variant="primary" onClick={() => void saveWordAs('pdf')}>
          {t('word.exportPdf')}
        </Button>
        <Select
          value=""
          onChange={(value) => {
            if (value === 'html' || value === 'txt') void saveWordAs(value)
          }}
          options={[
            { value: '', label: t('action.export') },
            { value: 'html', label: t('word.exportHtml') },
            { value: 'txt', label: t('word.exportTxt') }
          ]}
        />
      </div>

      <div className="doc-scroll">
        <div
          ref={editorRef}
          className="doc-sheet"
          dir={direction}
          contentEditable
          suppressContentEditableWarning
          spellCheck
          onInput={syncHtml}
          onBlur={syncHtml}
        />
      </div>

      <div className="counter-bar">
        <span>
          {stats.words} {t('word.words')}
        </span>
        <span>
          {stats.characters} {t('word.chars')}
        </span>
        <span>
          {readTime} {t('word.readTime')}
        </span>
        <span className="spacer" style={{ marginInlineStart: 'auto' }}>
          {wordDoc.dirty ? '●' : ''} {wordDoc.name}
        </span>
      </div>

      <Modal
        open={findOpen}
        onClose={() => setFindOpen(false)}
        title={t('word.findReplace')}
        footer={
          <>
            <Button onClick={() => setFindOpen(false)}>{t('action.cancel')}</Button>
            <Button
              variant="primary"
              onClick={() => {
                const editor = editorRef.current
                if (!editor || !findText) return
                const count = replaceInNode(editor, findText, replaceText)
                syncHtml()
                notify({ kind: 'success', title: t('word.replacedCount', { n: count }) })
                setFindOpen(false)
              }}
            >
              {t('word.replaceAll')}
            </Button>
          </>
        }
      >
        <div className="stack">
          <Field label={t('word.find')}>
            <TextInput value={findText} onChange={setFindText} autoFocus />
          </Field>
          <Field label={t('word.replace')}>
            <TextInput value={replaceText} onChange={setReplaceText} />
          </Field>
        </div>
      </Modal>
    </div>
  )
}

/** Replaces text in place across text nodes, leaving all markup untouched. */
function replaceInNode(root: Node, find: string, replacement: string): number {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let count = 0
  const targets: Text[] = []
  while (walker.nextNode()) targets.push(walker.currentNode as Text)

  for (const node of targets) {
    const value = node.nodeValue ?? ''
    if (!value.includes(find)) continue
    count += value.split(find).length - 1
    node.nodeValue = value.split(find).join(replacement)
  }
  return count
}
