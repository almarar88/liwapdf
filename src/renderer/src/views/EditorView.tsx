import { useEffect, useMemo, useState } from 'react'
import {
  Volume2,
  VolumeX,
  FileDown,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Languages,
  ListTree,
  Minus,
  Maximize2,
  Minimize2,
  Plus,
  Replace,
  Target,
  SpellCheck,
  ChevronDown,
  ChevronUp,
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
import { clamp, ltr } from '../lib/format'
import { clearDraft, documentFromDraft, readDraft, type Draft } from '../lib/documents/draft'
import { normalizeForSearch } from '../lib/text/encoding'
import { foldWithOffsets } from '../lib/pdf/render'
import { TEMPLATES } from './editor/templates'
import { speak, type SpeechHandle } from '../lib/speech'

export function EditorView(): React.JSX.Element {
  const t = useApp((state) => state.t)
  const doc = useApp((state) => state.editorDoc)
  const updateHtml = useApp((state) => state.updateEditorHtml)
  const replaceHtml = useApp((state) => state.replaceEditorHtml)
  const updateSheets = useApp((state) => state.updateEditorSheets)
  const updateText = useApp((state) => state.updateEditorText)
  const setActiveSheet = useApp((state) => state.setActiveSheet)
  const setDirection = useApp((state) => state.setEditorDirection)
  const closeEditor = useApp((state) => state.closeEditor)
  // The PDF the editor's text came from, so the two views are one place.
  const pdf = useApp((state) => state.doc)
  const navigate = useApp((state) => state.navigate)
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
  const [searchOpen, setSearchOpen] = useState(false)
  // A word target is per-document and per-session: it belongs to the sitting,
  // not to the file, and persisting it would resurrect yesterday's number.
  const [goal, setGoal] = useState('')
  const [focus, setFocus] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'h') {
        event.preventDefault()
        setFindOpen(true)
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        setSearchOpen(true)
      }
      if (event.key === 'Escape') {
        setSearchOpen(false)
        setFocus(false)
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
    <div
      className={focus ? 'view flush focus-mode' : 'view flush'}
      style={{ display: 'flex', flexDirection: 'column' }}
    >
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
        <Button
          size="sm"
          variant={focus ? 'primary' : 'ghost'}
          icon
          title={t('editor.focus')}
          onClick={() => setFocus((value) => !value)}
        >
          {focus ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
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
        {pdf ? (
          <Button size="sm" variant="ghost" title={t('edit.backToViewer')} onClick={() => navigate('viewer')}>
            <FileText size={15} />
            {t('edit.backToViewer')}
          </Button>
        ) : null}
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

      {searchOpen ? <FindBar onClose={() => setSearchOpen(false)} /> : null}

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
              revision={doc.revision}
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
        {stats.words !== null ? (
          <GoalMeter words={stats.words} goal={goal} onGoalChange={setGoal} />
        ) : null}
        {stats.words !== null ? (
          <ReadAloudButton
            text={() =>
              window.getSelection()?.toString().trim() ||
              (doc.source.kind === 'code' ? doc.text : doc.source.kind === 'sheet' ? '' : htmlToPlainText(doc.html))
            }
          />
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
            setHtml: replaceHtml,
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
  const openEditorDocument = useApp((state) => state.openEditorDocument)
  const notify = useApp((state) => state.notify)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)

  // Offered rather than restored: silently reopening yesterday's unsaved work
  // in place of the empty document someone asked for is its own surprise.
  useEffect(() => {
    void readDraft().then(setDraft)
  }, [])

  const readable = FORMATS.filter((format) => format.readable && format.format !== 'unknown')

  return (
    <div className="view">
      <div className="page-head">
        <div>
          <h1>{t('editor.title')}</h1>
          <p>{t('editor.sub')}</p>
        </div>
      </div>

      {draft ? (
        <div className="recovery">
          <div>
            <b>{t('editor.recoverTitle')}</b>
            <p className="muted" style={{ margin: '2px 0 0' }}>
              {t('editor.recoverBody', { name: draft.name })}
            </p>
          </div>
          <span className="spacer" />
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              openEditorDocument(documentFromDraft(draft))
              notify({ kind: 'success', title: t('editor.recovered') })
              setDraft(null)
            }}
          >
            {t('editor.recoverOpen')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void clearDraft()
              setDraft(null)
            }}
          >
            {t('editor.recoverDiscard')}
          </Button>
        </div>
      ) : null}

      <div className="grid cols-2">
        <button className="tool tone-blue" {...spotlight} onClick={() => void onOpen()}>
          <span className="icon">
            <FolderOpen size={19} />
          </span>
          <h3>{t('editor.openAny')}</h3>
          <p>{t('editor.openAny.d')}</p>
        </button>
        <button className="tool tone-indigo" {...spotlight} onClick={() => onNew('rich')}>
          <span className="icon">
            <FilePlus2 size={19} />
          </span>
          <h3>{t('editor.new.rich')}</h3>
          <p>{t('editor.new.rich.d')}</p>
        </button>
        <button className="tool tone-green" {...spotlight} onClick={() => onNew('sheet')}>
          <span className="icon">
            <FileSpreadsheet size={19} />
          </span>
          <h3>{t('editor.new.sheet')}</h3>
          <p>{t('editor.new.sheet.d')}</p>
        </button>
        <button className="tool tone-amber" {...spotlight} onClick={() => onNew('code')}>
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

/**
 * Ctrl+F: find as you type, with a live count and next/previous.
 *
 * Matches are painted through the CSS Custom Highlight API rather than by
 * wrapping them in <mark>. Inserting elements into a contenteditable surface
 * would dirty the document, land in the exported file, and be undone by the
 * user's next Ctrl+Z — a search must leave no trace in what it searches.
 * Where the API is missing the bar still counts and scrolls; only the tint
 * is absent.
 */
function FindBar({ onClose }: { onClose: () => void }): React.JSX.Element {
  const t = useApp((state) => state.t)
  const [query, setQuery] = useState('')
  const [total, setTotal] = useState(0)
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const highlights = (
      CSS as unknown as { highlights?: Map<string, unknown> & { delete(k: string): void } }
    ).highlights
    const HighlightCtor = (window as unknown as { Highlight?: new (...r: Range[]) => unknown })
      .Highlight

    const surface = document.querySelector('.doc-sheet, .code-body')
    if (!surface) return
    const needle = normalizeForSearch(query.trim())
    highlights?.delete('alcode-find')
    highlights?.delete('alcode-find-active')
    if (needle.length < 1) {
      setTotal(0)
      setIndex(0)
      return
    }

    const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT)
    const ranges: Range[] = []
    while (walker.nextNode()) {
      const node = walker.currentNode as Text
      const { folded, offsets } = foldWithOffsets(node.nodeValue ?? '')
      let at = folded.indexOf(needle)
      while (at !== -1) {
        const range = document.createRange()
        range.setStart(node, offsets[at] ?? 0)
        range.setEnd(node, offsets[at + needle.length] ?? (node.nodeValue?.length ?? 0))
        ranges.push(range)
        at = folded.indexOf(needle, at + Math.max(1, needle.length))
      }
    }

    setTotal(ranges.length)
    const current = ranges.length === 0 ? 0 : Math.min(index, ranges.length - 1)
    if (current !== index) setIndex(current)
    if (ranges.length === 0) return

    if (highlights && HighlightCtor) {
      const others = ranges.filter((_, position) => position !== current)
      if (others.length > 0) highlights.set('alcode-find', new HighlightCtor(...others))
      highlights.set('alcode-find-active', new HighlightCtor(ranges[current]))
    }
    ranges[current].startContainer.parentElement?.scrollIntoView({ block: 'center' })

    return () => {
      highlights?.delete('alcode-find')
      highlights?.delete('alcode-find-active')
    }
  }, [query, index])

  const step = (delta: number): void => {
    if (total === 0) return
    setIndex((current) => (current + delta + total) % total)
  }

  return (
    <div className="find-bar">
      <TextInput value={query} onChange={setQuery} placeholder={t('word.find')} autoFocus />
      <span className="muted mono" style={{ minWidth: 64, textAlign: 'center' }}>
        {total === 0 ? t('find.noMatches') : ltr(`${index + 1} / ${total}`)}
      </span>
      <Button size="sm" variant="ghost" icon title={t('viewer.prevMatch')} onClick={() => step(-1)}>
        <ChevronUp size={15} />
      </Button>
      <Button size="sm" variant="ghost" icon title={t('viewer.nextMatch')} onClick={() => step(1)}>
        <ChevronDown size={15} />
      </Button>
      <Button size="sm" variant="ghost" icon title={t('action.cancel')} onClick={onClose}>
        <X size={15} />
      </Button>
    </div>
  )
}

/**
 * A word target and how far along it is.
 *
 * Writing a book is measured in sittings, and the single most useful number
 * during one is the distance left. The bar is off until a target is typed, so
 * it never nags anyone who did not ask to be counted.
 */
function GoalMeter({
  words,
  goal,
  onGoalChange
}: {
  words: number
  goal: string
  onGoalChange: (value: string) => void
}): React.JSX.Element {
  const t = useApp((state) => state.t)
  const target = Math.max(0, Number(goal) || 0)
  const done = target > 0 && words >= target
  const fraction = target > 0 ? Math.min(1, words / target) : 0

  return (
    <span className="goal" title={t('editor.goalHint')}>
      <Target size={13} />
      <input
        className="goal-input"
        value={goal}
        onChange={(event) => onGoalChange(event.target.value.replace(/[^0-9]/g, ''))}
        placeholder={t('editor.goal')}
        inputMode="numeric"
        dir="ltr"
      />
      {target > 0 ? (
        <>
          <span className="goal-track">
            <span
              className={done ? 'goal-fill done' : 'goal-fill'}
              style={{ width: `${Math.round(fraction * 100)}%` }}
            />
          </span>
          <span className="muted">
            {done
              ? t('editor.goalDone', { done: words })
              : t('editor.goalProgress', { done: words, goal: target })}
          </span>
        </>
      ) : null}
    </span>
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

/**
 * Reads the selection, or the whole document when nothing is selected,
 * through the system's voices. Stops on its own at the end and when the
 * document changes underneath it.
 */
function ReadAloudButton({ text }: { text: () => string }): React.JSX.Element {
  const t = useApp((state) => state.t)
  const notify = useApp((state) => state.notify)
  const [speech, setSpeech] = useState<SpeechHandle | null>(null)

  useEffect(() => () => speech?.stop(), [speech])

  return (
    <button
      className="btn ghost sm"
      title={speech ? t('viewer.stopReading') : t('viewer.readAloud')}
      onClick={() => {
        if (speech) {
          speech.stop()
          setSpeech(null)
          return
        }
        const content = text()
        if (!content.trim()) return
        const handle = speak(content, { onEnd: () => setSpeech(null) })
        if (!handle) {
          notify({ kind: 'info', title: t('viewer.noVoice') })
          return
        }
        setSpeech(handle)
      }}
    >
      {speech ? <VolumeX size={14} /> : <Volume2 size={14} />}
      {speech ? t('viewer.stopReading') : t('viewer.readAloud')}
    </button>
  )
}
