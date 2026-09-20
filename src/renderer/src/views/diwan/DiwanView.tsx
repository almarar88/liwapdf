import { useEffect, useMemo, useState } from 'react'
import {
  BookOpen,
  ClipboardPaste,
  Download,
  Feather,
  Mic,
  Plus,
  ScrollText,
  Upload
} from 'lucide-react'
import { useApp } from '../../store/app'
import { useDiwan } from '../../store/diwan'
import { Button, Checkbox, Empty, Field, Modal, Segmented, TextArea, TextInput } from '../../components/ui'
import { pickOneFile, saveBytes, saveText } from '../../lib/files'
import { formatRelativeTime, uid } from '../../lib/format'
import { splitIntoVerses } from '../../lib/diwan/parse'
import { parseDiwan, serializeDiwan } from '../../lib/diwan/store'
import { filledVerses, poemLabel, type Poem } from '../../lib/diwan/types'
import { PoemEditor } from './PoemEditor'
import { AiError, ai } from '../../lib/ai/client'
import { diwanDocx } from '../../lib/diwan/export'
import { Sparkles, FileDown } from 'lucide-react'
import '../../styles/diwan.css'

/**
 * The diwan: the shelf of poems, and the one poem being written.
 *
 * The shelf is deliberately not a file list. A poem has no extension and no
 * size; what a poet recognises it by is its first verse, its meter and
 * whether it has been recited yet, so that is what the card shows.
 */
export function DiwanView(): React.JSX.Element {
  const t = useApp((state) => state.t)
  const activeId = useDiwan((state) => state.activeId)
  const loaded = useDiwan((state) => state.loaded)
  const load = useDiwan((state) => state.load)

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  return (
    <div className="view">
      <div className="diwan">
        {activeId ? <PoemEditor id={activeId} /> : <Shelf />}
        {!loaded ? <span className="dw-status">{t('diwan.saving')}</span> : null}
      </div>
    </div>
  )
}

function Shelf(): React.JSX.Element {
  const t = useApp((state) => state.t)
  const language = useApp((state) => state.settings.language)
  const notify = useApp((state) => state.notify)
  const poems = useDiwan((state) => state.poems)
  const poet = useDiwan((state) => state.poet)
  const setPoet = useDiwan((state) => state.setPoet)
  const create = useDiwan((state) => state.create)
  const open = useDiwan((state) => state.open)
  const importPoems = useDiwan((state) => state.importPoems)
  const [pasting, setPasting] = useState(false)
  const [printing, setPrinting] = useState(false)

  const backup = async (): Promise<void> => {
    const outcome = await saveText(serializeDiwan(poems), `diwan-${new Date().toISOString().slice(0, 10)}.json`, [
      { name: 'file.all', extensions: ['json'] }
    ])
    if (outcome.saved) notify({ kind: 'success', title: t('diwan.pdf.saved') })
  }

  const restore = async (): Promise<void> => {
    const file = await pickOneFile([{ name: 'file.all', extensions: ['json'] }])
    if (!file) return
    try {
      const incoming = parseDiwan(new TextDecoder().decode(file.data))
      const added = await importPoems(incoming)
      notify({ kind: 'success', title: t('diwan.import.done', { n: added }) })
    } catch {
      notify({ kind: 'error', title: t('diwan.import.bad') })
    }
  }

  return (
    <>
      <header className="dw-head">
        <div>
          <h1>{t('nav.diwan')}</h1>
          <p>{t('diwan.sub')}</p>
        </div>
        <div className="spacer" />
        <label className="dw-poet" title={t('diwan.poet.ph')}>
          <Feather size={16} />
          <input
            value={poet}
            placeholder={t('diwan.poet')}
            aria-label={t('diwan.poet')}
            onChange={(event) => setPoet(event.target.value)}
          />
        </label>
      </header>

      <div className="dw-actions">
        <button className="dw-action primary" onClick={() => create()}>
          <span className="ic">
            <Plus size={18} />
          </span>
          <span>
            <b>{t('diwan.new')}</b>
            <span>{t('diwan.new.d')}</span>
          </span>
        </button>
        <button className="dw-action" onClick={() => setPasting(true)}>
          <span className="ic">
            <ClipboardPaste size={18} />
          </span>
          <span>
            <b>{t('diwan.paste')}</b>
            <span>{t('diwan.paste.d')}</span>
          </span>
        </button>
        <button className="dw-action" onClick={() => setPrinting(true)} disabled={poems.length === 0}>
          <span className="ic">
            <BookOpen size={18} />
          </span>
          <span>
            <b>{t('diwan.book')}</b>
            <span>{t('diwan.book.d')}</span>
          </span>
        </button>
        <button className="dw-action" onClick={() => void (poems.length > 0 ? backup() : restore())}>
          <span className="ic">{poems.length > 0 ? <Download size={18} /> : <Upload size={18} />}</span>
          <span>
            <b>{poems.length > 0 ? t('diwan.backup') : t('diwan.restore')}</b>
            <span>{t('diwan.count', { n: poems.length })}</span>
          </span>
        </button>
      </div>

      {poems.length === 0 ? (
        <Empty
          icon={<ScrollText size={26} />}
          title={t('diwan.empty')}
          subtitle={t('diwan.empty.d')}
          action={
            <div className="row">
              <Button variant="primary" onClick={() => create()}>
                {t('diwan.new')}
              </Button>
              <Button onClick={() => void restore()}>{t('diwan.restore')}</Button>
            </div>
          }
        />
      ) : (
        <div className="dw-shelf">
          {poems.map((poem) => (
            <PoemCard key={poem.id} poem={poem} onOpen={() => open(poem.id)} />
          ))}
        </div>
      )}

      {poems.length > 0 ? (
        <div className="row wrap" style={{ justifyContent: 'center' }}>
          <Button size="sm" onClick={() => void restore()}>
            <Upload size={14} /> {t('diwan.restore')}
          </Button>
          <Button
            size="sm"
            onClick={() =>
              void (async () => {
                const title = t('diwan.book.title.ph', { poet: poet || '…' })
                const bytes = await diwanDocx(poems, title, poet)
                const outcome = await saveBytes(bytes, `${title.replace(/[\\/:*?"<>|]/g, ' ')}.docx`, [{ name: 'file.word', extensions: ['docx'] }])
                if (outcome.saved) notify({ kind: 'success', title: t('diwan.pdf.saved'), message: outcome.path })
              })()
            }
          >
            <FileDown size={14} /> {t('diwan.export.diwanDocx')}
          </Button>
        </div>
      ) : null}

      <PasteModal open={pasting} onClose={() => setPasting(false)} />
      <BookModal open={printing} onClose={() => setPrinting(false)} poems={poems} poet={poet} language={language} />
    </>
  )
}

function PoemCard({ poem, onOpen }: { poem: Poem; onOpen: () => void }): React.JSX.Element {
  const t = useApp((state) => state.t)
  const language = useApp((state) => state.settings.language)
  const verses = filledVerses(poem)
  const first = verses[0]
  return (
    <button className="dw-poem" onClick={onOpen}>
      <h3>{poemLabel(poem, t('diwan.untitled'))}</h3>
      {first ? (
        <span className="first" dir="auto">
          {first.sadr.trim()}
          {first.ajuz.trim() ? ` ✦ ${first.ajuz.trim()}` : ''}
        </span>
      ) : null}
      <span className="meta">
        {poem.meter.trim() ? <span className="dw-tag">{poem.meter.trim()}</span> : null}
        {poem.purpose.trim() ? <span className="dw-tag">{poem.purpose.trim()}</span> : null}
        <span className="dw-tag">{t('diwan.verses', { n: verses.length })}</span>
        {poem.hasRecording ? (
          <span className="dw-tag voice">
            <Mic size={11} /> {t('diwan.recorded')}
          </span>
        ) : null}
        <span className="dw-tag">{formatRelativeTime(poem.updatedAt, language)}</span>
      </span>
    </button>
  )
}

/** Pasted text, split into verses and opened as a new poem. */
function PasteModal({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element {
  const t = useApp((state) => state.t)
  const notify = useApp((state) => state.notify)
  const create = useDiwan((state) => state.create)
  const [text, setText] = useState('')
  const [thinking, setThinking] = useState(false)

  const preview = useMemo(() => splitIntoVerses(text, uid), [text])

  /** The assistant reads the text as a poet would: verses, meter, purpose, rhyme, title. */
  const arrange = async (): Promise<void> => {
    if (!text.trim()) return
    setThinking(true)
    try {
      const arranged = await ai.arrange(text)
      const verses = arranged.verses.filter((verse) => verse.sadr.trim() || verse.ajuz.trim()).map((verse) => ({ id: uid(), sadr: verse.sadr.trim(), ajuz: verse.ajuz.trim() }))
      if (verses.length === 0) throw new AiError('refused')
      create({
        title: arranged.title.trim(),
        form: arranged.form,
        meter: arranged.meter.trim(),
        purpose: arranged.purpose.trim(),
        rhyme: arranged.rhyme.trim(),
        verses
      })
      if (arranged.note.trim()) notify({ kind: 'info', title: t('ai.note'), message: arranged.note.trim() })
      setText('')
      onClose()
    } catch (error) {
      const reason = error instanceof AiError ? error.reason : 'upstream'
      notify({ kind: 'error', title: t(`ai.err.${reason}`) })
    } finally {
      setThinking(false)
    }
  }

  const finish = (): void => {
    if (preview.length === 0) return
    const lines = text.split('\n').map((line) => line.trim()).filter(Boolean)
    // A short first line with no pair is a title, not a verse.
    const titled = lines.length > 1 && lines[0].split(/\s+/).length <= 4 && !/[*✦]/.test(lines[0])
    create({
      title: titled ? lines[0] : '',
      verses: titled ? splitIntoVerses(lines.slice(1).join('\n'), uid) : preview
    })
    setText('')
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('diwan.paste')}
      icon={<ClipboardPaste size={16} />}
      footer={
        <>
          <Button onClick={onClose}>{t('action.cancel')}</Button>
          <Button disabled={preview.length === 0 || thinking} onClick={finish}>
            {t('ai.arrange.local')} · {preview.length}
          </Button>
          <Button variant="primary" disabled={!text.trim() || thinking} onClick={() => void arrange()} title={t('ai.arrange.d')}>
            <Sparkles size={14} /> {thinking ? t('ai.working') : t('ai.arrange')}
          </Button>
        </>
      }
    >
      <div className="stack">
        <TextArea value={text} onChange={setText} rows={8} placeholder={t('diwan.paste.ph')} />
        <span className="hint">{t('ai.arrange.d')} · {t('diwan.split.hint')}</span>
        {preview.length > 0 ? (
          <div className="dw-canvas compact" style={{ padding: '14px 12px', '--dw-verse-size': '16px' } as React.CSSProperties}>
            <div className="rows">
              {preview.slice(0, 4).map((verse) => (
                <div className="row" key={verse.id}>
                  <span className="s">{verse.sadr}</span>
                  <span className="d">✦</span>
                  <span className="a">{verse.ajuz}</span>
                </div>
              ))}
              {preview.length > 4 ? <div className="meta">…</div> : null}
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  )
}

/** The whole diwan as a printed book. */
export function BookModal({
  open,
  onClose,
  poems,
  poet,
  language
}: {
  open: boolean
  onClose: () => void
  poems: Poem[]
  poet: string
  language: 'ar' | 'en'
}): React.JSX.Element {
  const t = useApp((state) => state.t)
  const notify = useApp((state) => state.notify)
  const setBusy = useApp((state) => state.setBusy)
  const [title, setTitle] = useState('')
  const [cover, setCover] = useState(true)
  const [index, setIndex] = useState(true)
  const [occasions, setOccasions] = useState(true)
  const [pagePerPoem, setPagePerPoem] = useState(true)
  const [pageSize, setPageSize] = useState<'A4' | 'A5' | 'Letter'>('A5')

  const ready = poems.filter((poem) => filledVerses(poem).length > 0)
  const suggested = t('diwan.book.title.ph', { poet: poet || '…' })

  const make = async (): Promise<void> => {
    if (ready.length === 0) {
      notify({ kind: 'info', title: t('diwan.book.none') })
      return
    }
    setBusy({ label: t('diwan.book.make'), progress: null })
    try {
      const { renderDiwanPdf } = await import('../../lib/diwan/pdf')
      const bytes = await renderDiwanPdf(ready, {
        title: title.trim() || suggested,
        poet,
        language,
        cover,
        index,
        occasions,
        pagePerPoem,
        pageSize
      })
      const outcome = await saveBytes(bytes, `${(title.trim() || 'diwan').replace(/[\\/:*?"<>|]/g, ' ')}.pdf`, [
        { name: 'file.pdf', extensions: ['pdf'] }
      ])
      if (outcome.saved) {
        notify({ kind: 'success', title: t('diwan.pdf.saved'), message: outcome.path })
        onClose()
      }
    } catch (error) {
      notify({ kind: 'error', title: t('msg.error'), message: String(error) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('diwan.book')}
      icon={<BookOpen size={16} />}
      footer={
        <>
          <Button onClick={onClose}>{t('action.cancel')}</Button>
          <Button variant="primary" onClick={() => void make()} disabled={ready.length === 0}>
            {t('diwan.book.make')} · {ready.length}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Field label={t('diwan.book.title')}>
          <TextInput value={title} onChange={setTitle} placeholder={suggested} />
        </Field>
        <Field label={t('diwan.book.size')}>
          <Segmented
            value={pageSize}
            onChange={setPageSize}
            options={[
              { value: 'A5', label: 'A5' },
              { value: 'A4', label: 'A4' },
              { value: 'Letter', label: 'Letter' }
            ]}
          />
        </Field>
        <Checkbox checked={cover} onChange={setCover} label={t('diwan.book.cover')} />
        <Checkbox checked={index} onChange={setIndex} label={t('diwan.book.index')} />
        <Checkbox checked={pagePerPoem} onChange={setPagePerPoem} label={t('diwan.book.pagePerPoem')} />
        <Checkbox checked={occasions} onChange={setOccasions} label={t('diwan.book.occasions')} />
      </div>
    </Modal>
  )
}
