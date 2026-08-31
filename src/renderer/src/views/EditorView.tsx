import { useEffect, useMemo, useState } from 'react'
import {
  FileDown,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Languages,
  ListTree,
  Minus,
  Plus,
  Replace,
  SpellCheck,
  X
} from 'lucide-react'
import { useApp } from '../store/app'
import { useDocumentActions } from '../hooks/useDocumentActions'
import {
  Button,
  Card,
  Checkbox,
  Field,
  Modal,
  Segmented,
  Select,
  TextInput,
  Bytes,
  useSpotlight
} from '../components/ui'
import { RichEditor } from './editor/RichEditor'
import { SheetEditor } from './editor/SheetEditor'
import { CodeEditor } from './editor/CodeEditor'
import { exportTargetsFor, formatInfo, FORMATS, type DocumentFormat } from '../lib/documents/formats'
import { htmlToPlainText } from '../lib/documents/write'
import { inferCell, type SheetData } from '../lib/documents/sheets'
import { replacePattern, substituteAll, type ReplaceOptions } from '../lib/documents/find'
import { clamp } from '../lib/format'
import { TEMPLATES } from './editor/templates'

export function EditorView(): React.JSX.Element {
  const t = useApp((state) => state.t)
  const doc = useApp((state) => state.editorDoc)
  const updateHtml = useApp((state) => state.updateEditorHtml)
  const updateSheets = useApp((state) => state.updateEditorSheets)
  const updateText = useApp((state) => state.updateEditorText)
  const setActiveSheet = useApp((state) => state.setActiveSheet)
  const setDirection = useApp((state) => state.setEditorDirection)
  const closeEditor = useApp((state) => state.closeEditor)
  const confirmDiscard = useApp((state) => state.confirmDiscard)
  const notify = useApp((state) => state.notify)
  const { openDialog, exportEditorAs, newDocument } = useDocumentActions()

  const [zoom, setZoom] = useState(1)
  // Follows the app setting: on the platforms where Chromium would have to
  // fetch a dictionary, spellcheck stays off until the user asks for it.
  const spellcheckAllowed = useApp((state) => state.settings.spellcheck)
  const [spellCheck, setSpellCheck] = useState(spellcheckAllowed)
  const [navigatorOpen, setNavigatorOpen] = useState(false)
  const [findOpen, setFindOpen] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'h') {
        event.preventDefault()
        setFindOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!doc) return <EditorLanding onOpen={openDialog} onNew={newDocument} />

  const info = formatInfo(doc.source.format)
  const targets = exportTargetsFor(doc.source.kind)
  const stats = computeStats(doc.source.kind, doc.html, doc.text)

  return (
    <div className="view flush" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="toolbar">
        <span className="badge accent">{info?.label ?? doc.source.format.toUpperCase()}</span>
        {info && !info.writable ? (
          <span className="badge">{t('editor.readOnlyFormat', { target: fallbackLabel(doc.source.kind) })}</span>
        ) : null}
        {doc.source.encoding ? (
          <span className="badge" dir="ltr" title={t('editor.encoding')}>
            {doc.source.encoding.toUpperCase()}
          </span>
        ) : null}
        {doc.source.originalBytes.byteLength > 0 ? (
          <span className="badge">
            <Bytes value={doc.source.originalBytes.byteLength} />
          </span>
        ) : null}

        <span className="sep" />

        <Button
          size="sm"
          variant={navigatorOpen ? 'primary' : 'ghost'}
          icon
          title={t('editor.navigator')}
          onClick={() => setNavigatorOpen((open) => !open)}
        >
          <ListTree size={15} />
        </Button>
        <Button size="sm" variant="ghost" icon title={t('word.findReplace')} onClick={() => setFindOpen(true)}>
          <Replace size={15} />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon
          title={t('word.direction')}
          onClick={() => setDirection(doc.direction === 'rtl' ? 'ltr' : 'rtl')}
        >
          <Languages size={15} />
        </Button>
        <Button
          size="sm"
          variant={spellCheck ? 'primary' : 'ghost'}
          icon
          title={t('editor.spellcheck')}
          onClick={() => setSpellCheck((value) => !value)}
        >
          <SpellCheck size={15} />
        </Button>

        <span className="sep" />

        <Button size="sm" variant="ghost" icon title={t('viewer.zoomOut')} onClick={() => setZoom((z) => clamp(z - 0.1, 0.5, 2.5))}>
          <Minus size={15} />
        </Button>
        <span className="mono muted" style={{ minWidth: 44, textAlign: 'center' }}>
          {Math.round(zoom * 100)}%
        </span>
        <Button size="sm" variant="ghost" icon title={t('viewer.zoomIn')} onClick={() => setZoom((z) => clamp(z + 0.1, 0.5, 2.5))}>
          <Plus size={15} />
        </Button>

        <span className="spacer" />

        <Select
          value=""
          onChange={(value) => value && void exportEditorAs(value as DocumentFormat)}
          options={[
            { value: '', label: t('action.export') },
            ...targets.map((target) => ({
              value: target,
              label: formatInfo(target)?.label ?? target.toUpperCase()
            }))
          ]}
        />
        <Button size="sm" variant="primary" onClick={() => void exportEditorAs(defaultTarget(doc.source.kind))}>
          <FileDown size={15} />
          {formatInfo(defaultTarget(doc.source.kind))?.label}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon
          title={t('editor.closeDoc')}
          onClick={() => void confirmDiscard().then((ok) => ok && closeEditor())}
        >
          <X size={15} />
        </Button>
      </div>

      <div className={navigatorOpen ? 'editor-body with-nav' : 'editor-body'}>
        {navigatorOpen ? <Navigator html={doc.html} kind={doc.source.kind} /> : null}

        <div className="editor-main">
          {doc.source.kind === 'sheet' ? (
            <SheetEditor
              sheets={doc.sheets}
              activeSheet={doc.activeSheet}
              direction={doc.direction}
              zoom={zoom}
              onChange={updateSheets}
              onActiveSheetChange={setActiveSheet}
            />
          ) : doc.source.kind === 'code' ? (
            <CodeEditor text={doc.text} format={doc.source.format} zoom={zoom} onChange={updateText} />
          ) : doc.source.kind === 'image' ? (
            <ImagePane dataUrl={doc.source.imageDataUrl ?? ''} name={doc.source.name} />
          ) : (
            <RichEditor
              html={doc.html}
              direction={doc.direction}
              zoom={zoom}
              spellCheck={spellCheck}
              documentKey={doc.id}
              onChange={updateHtml}
            />
          )}
        </div>
      </div>

      <div className="counter-bar">
        {stats.words !== null ? (
          <span>
            {stats.words} {t('word.words')}
          </span>
        ) : null}
        {stats.words !== null ? (
          <span>
            {stats.characters} {t('word.chars')}
          </span>
        ) : null}
        {stats.paragraphs !== null ? (
          <span>
            {stats.paragraphs} {t('editor.paragraphs')}
          </span>
        ) : null}
        {stats.words !== null ? (
          <span>
            {Math.max(1, Math.round(stats.words / 220))} {t('word.readTime')}
          </span>
        ) : null}
        <span style={{ marginInlineStart: 'auto' }}>
          {doc.dirty ? '● ' : ''}
          <bdi>{doc.source.name}</bdi>
        </span>
      </div>

      <FindReplaceModal
        open={findOpen}
        onClose={() => setFindOpen(false)}
        onReplace={(find, replace, options) => {
          const count = applyReplace(doc.source.kind, find, replace, options, {
            html: doc.html,
            text: doc.text,
            sheets: doc.sheets,
            setHtml: updateHtml,
            setText: updateText,
            setSheets: updateSheets
          })
          notify({ kind: 'success', title: t('word.replacedCount', { n: count }) })
          setFindOpen(false)
        }}
      />
    </div>
  )
}

/* ------------------------------------------------------------- landing */

function EditorLanding({
  onOpen,
  onNew
}: {
  onOpen: () => Promise<void>
  onNew: (kind: 'rich' | 'sheet' | 'code', template?: string) => void
}): React.JSX.Element {
  const t = useApp((state) => state.t)
  const spotlight = useSpotlight()
  const [templatesOpen, setTemplatesOpen] = useState(false)

  const readable = FORMATS.filter((format) => format.readable && format.format !== 'unknown')

  return (
    <div className="view">
      <div className="page-head">
        <div>
          <h1>{t('editor.title')}</h1>
          <p>{t('editor.sub')}</p>
        </div>
      </div>

      <div className="grid cols-2">
        <button className="tool" {...spotlight} onClick={() => void onOpen()}>
          <span className="icon">
            <FolderOpen size={19} />
          </span>
          <h3>{t('editor.openAny')}</h3>
          <p>{t('editor.openAny.d')}</p>
        </button>
        <button className="tool" {...spotlight} onClick={() => onNew('rich')}>
          <span className="icon">
            <FilePlus2 size={19} />
          </span>
          <h3>{t('editor.new.rich')}</h3>
          <p>{t('editor.new.rich.d')}</p>
        </button>
        <button className="tool" {...spotlight} onClick={() => onNew('sheet')}>
          <span className="icon">
            <FileSpreadsheet size={19} />
          </span>
          <h3>{t('editor.new.sheet')}</h3>
          <p>{t('editor.new.sheet.d')}</p>
        </button>
        <button className="tool" {...spotlight} onClick={() => onNew('code')}>
          <span className="icon">
            <FileText size={19} />
          </span>
          <h3>{t('editor.new.code')}</h3>
          <p>{t('editor.new.code.d')}</p>
        </button>
      </div>

      <h2 className="section-title">{t('editor.templates')}</h2>
      <div className="row wrap">
        {TEMPLATES.map((template) => (
          <Button key={template.id} onClick={() => onNew('rich', template.markdown)}>
            {t(template.labelKey)}
          </Button>
        ))}
        <Button variant="ghost" onClick={() => setTemplatesOpen(true)}>
          {t('editor.supported')}
        </Button>
      </div>

      <Modal open={templatesOpen} onClose={() => setTemplatesOpen(false)} title={t('editor.supported')} wide>
        <div className="grid cols-3">
          {readable.map((format) => (
            <Card key={format.format} style={{ background: 'var(--surface-2)' }}>
              <div style={{ fontWeight: 650 }}>{format.label}</div>
              <div className="muted mono" style={{ fontSize: 'var(--text-sm)', marginTop: 4 }}>
                {format.extensions.slice(0, 6).map((extension) => `.${extension}`).join(' ')}
              </div>
              <div style={{ marginTop: 8 }}>
                <span className={`badge ${format.writable ? 'green' : ''}`}>
                  {format.writable ? '↔' : '→'} {format.writable ? 'read / write' : 'read only'}
                </span>
              </div>
            </Card>
          ))}
        </div>
      </Modal>
    </div>
  )
}

/* ------------------------------------------------------------ navigator */

function Navigator({ html, kind }: { html: string; kind: string }): React.JSX.Element {
  const t = useApp((state) => state.t)

  const headings = useMemo(() => {
    if (kind !== 'rich' && kind !== 'slides') return []
    const container = document.createElement('div')
    container.innerHTML = html
    return Array.from(container.querySelectorAll('h1, h2, h3, h4')).map((element, index) => ({
      index,
      level: Number(element.tagName[1]),
      text: (element.textContent ?? '').trim().slice(0, 90)
    }))
  }, [html, kind])

  return (
    <aside className="panel editor-nav">
      <h4>{t('editor.navigator')}</h4>
      {headings.length === 0 ? (
        <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>
          {t('editor.noHeadings')}
        </p>
      ) : (
        headings.map((heading) => (
          <button
            key={heading.index}
            className="nav-item"
            style={{ paddingInlineStart: 8 + (heading.level - 1) * 12 }}
            onClick={() => {
              const targets = document.querySelectorAll('.doc-sheet h1, .doc-sheet h2, .doc-sheet h3, .doc-sheet h4')
              targets[heading.index]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }}
          >
            <span className="truncate">{heading.text || '—'}</span>
          </button>
        ))
      )}
    </aside>
  )
}

/* ---------------------------------------------------------------- image */

function ImagePane({ dataUrl, name }: { dataUrl: string; name: string }): React.JSX.Element {
  const t = useApp((state) => state.t)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)

  return (
    <div className="doc-scroll" style={{ display: 'grid', placeItems: 'center' }}>
      <div className="stack" style={{ alignItems: 'center' }}>
        <img
          src={dataUrl}
          alt={name}
          style={{ maxWidth: '100%', maxHeight: '70vh', borderRadius: 'var(--r-md)', boxShadow: 'var(--shadow-lg)' }}
          onLoad={(event) =>
            setSize({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight
            })
          }
        />
        {size ? (
          <span className="badge">
            {t('image.dimensions')} {size.width} × {size.height}
          </span>
        ) : null}
      </div>
    </div>
  )
}

/* ------------------------------------------------------- find & replace */

function FindReplaceModal({
  open,
  onClose,
  onReplace
}: {
  open: boolean
  onClose: () => void
  onReplace: (find: string, replace: string, options: ReplaceOptions) => void
}): React.JSX.Element {
  const t = useApp((state) => state.t)
  const [find, setFind] = useState('')
  const [replace, setReplace] = useState('')
  const [options, setOptions] = useState<ReplaceOptions>({
    regex: false,
    caseSensitive: false,
    wholeWord: false
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('word.findReplace')}
      footer={
        <>
          <Button onClick={onClose}>{t('action.cancel')}</Button>
          <Button variant="primary" disabled={!find} onClick={() => onReplace(find, replace, options)}>
            {t('word.replaceAll')}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Field label={t('word.find')}>
          <TextInput value={find} onChange={setFind} autoFocus />
        </Field>
        <Field label={t('word.replace')}>
          <TextInput value={replace} onChange={setReplace} />
        </Field>
        <Checkbox
          checked={options.caseSensitive}
          onChange={(checked) => setOptions({ ...options, caseSensitive: checked })}
          label={t('find.caseSensitive')}
        />
        <Checkbox
          checked={options.wholeWord}
          onChange={(checked) => setOptions({ ...options, wholeWord: checked })}
          label={t('find.wholeWord')}
        />
        <Checkbox
          checked={options.regex}
          onChange={(checked) => setOptions({ ...options, regex: checked })}
          label={t('find.regex')}
        />
      </div>
    </Modal>
  )
}

interface ReplaceTargets {
  html: string
  text: string
  sheets: SheetData[]
  setHtml: (value: string) => void
  setText: (value: string) => void
  setSheets: (value: SheetData[]) => void
}

function applyReplace(
  kind: string,
  find: string,
  replace: string,
  options: ReplaceOptions,
  targets: ReplaceTargets
): number {
  const pattern = replacePattern(find, options)
  if (!pattern) return 0

  let count = 0
  const substitute = (value: string): string => {
    const result = substituteAll(value, pattern, replace)
    count += result.count
    return result.text
  }

  if (kind === 'code') {
    targets.setText(substitute(targets.text))
    return count
  }

  if (kind === 'sheet') {
    targets.setSheets(
      targets.sheets.map((sheet) => ({
        ...sheet,
        rows: sheet.rows.map((row) =>
          row.map((cell) => {
            const next = substitute(cell.text)
            return next === cell.text ? cell : inferCell(next, cell)
          })
        )
      }))
    )
    return count
  }

  // Rich text: only text nodes are rewritten, so markup survives intact.
  const container = document.createElement('div')
  container.innerHTML = targets.html
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)
  for (const node of nodes) {
    const value = node.nodeValue ?? ''
    const next = substitute(value)
    if (next !== value) node.nodeValue = next
  }
  targets.setHtml(container.innerHTML)
  return count
}

/* ---------------------------------------------------------------- misc */

function computeStats(
  kind: string,
  html: string,
  text: string
): { words: number | null; characters: number; paragraphs: number | null } {
  if (kind === 'code') {
    const trimmed = text.trim()
    return {
      words: trimmed ? trimmed.split(/\s+/).length : 0,
      characters: text.length,
      paragraphs: null
    }
  }
  if (kind === 'sheet') {
    return { words: null, characters: 0, paragraphs: null }
  }
  const plain = htmlToPlainText(html)
  const container = document.createElement('div')
  container.innerHTML = html
  return {
    words: plain ? plain.split(/\s+/).filter(Boolean).length : 0,
    characters: plain.length,
    paragraphs: container.querySelectorAll('p, h1, h2, h3, h4, li').length
  }
}

function defaultTarget(kind: string): DocumentFormat {
  if (kind === 'sheet') return 'xlsx'
  if (kind === 'code') return 'txt'
  return 'docx'
}

function fallbackLabel(kind: string): string {
  return formatInfo(defaultTarget(kind))?.label ?? 'DOCX'
}
