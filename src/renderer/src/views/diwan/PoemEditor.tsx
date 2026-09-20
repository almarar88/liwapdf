import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BookMarked,
  ChevronDown,
  Copy,
  Eye,
  FileDown,
  History,
  Mic,
  PenLine,
  Plus,
  Share2,
  Square,
  Trash2,
  Wand2,
  Sparkles
} from 'lucide-react'
import { useApp } from '../../store/app'
import { usePhone } from '../../hooks/usePhone'
import { useDiwan } from '../../store/diwan'
import { Button, Checkbox, Field, Modal, Segmented, TextArea, TextInput } from '../../components/ui'
import { saveBytes } from '../../lib/files'
import { escapeHtml, formatRelativeTime } from '../../lib/format'
import { guessRhyme, poemToText } from '../../lib/diwan/parse'
import { TranscribeError, transcribeRecording, wordsToVerses } from '../../lib/diwan/transcribe'
import { uid } from '../../lib/format'
import {
  FUSHA_METERS,
  NABATI_MELODIES,
  PURPOSES,
  filledVerses,
  poemLabel,
  type Poem,
  type PoemForm,
  type Verse
} from '../../lib/diwan/types'
import {
  RecordingError,
  extensionFor,
  formatClock,
  recordingSupported,
  startRecording,
  type Recorder
} from '../../lib/diwan/audio'

/**
 * One poem, being written.
 *
 * The verse rows are the whole point: two fields per verse, Enter moving
 * from sadr to ajuz and from ajuz to the next verse, so a poem is typed the
 * way it is spoken — half, half, next — without a hand leaving the keys.
 * Everything else on the screen (the meter, the occasion, the recording,
 * the card) is folded away until it is wanted.
 */
export function PoemEditor({ id }: { id: string }): React.JSX.Element {
  const t = useApp((state) => state.t)
  const language = useApp((state) => state.settings.language)
  const notify = useApp((state) => state.notify)
  const confirm = useApp((state) => state.confirm)
  const setBusy = useApp((state) => state.setBusy)
  const poem = useDiwan((state) => state.poems.find((entry) => entry.id === id))
  const poet = useDiwan((state) => state.poet)
  const pendingSave = useDiwan((state) => state.pendingSave)
  const open = useDiwan((state) => state.open)
  const update = useDiwan((state) => state.update)
  const remove = useDiwan((state) => state.remove)
  const flush = useDiwan((state) => state.flush)
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  const [sharing, setSharing] = useState(false)
  const phone = usePhone()

  // Leaving the poem writes it at once rather than after the debounce.
  useEffect(() => () => void flush(), [flush])

  if (!poem) {
    return (
      <div className="row">
        <Button onClick={() => open(null)}>{t('diwan.back')}</Button>
      </div>
    )
  }

  const Back = language === 'ar' ? ArrowRight : ArrowLeft

  const exportPdf = async (): Promise<void> => {
    setBusy({ label: t('diwan.pdf.one'), progress: null })
    try {
      const { renderDiwanPdf } = await import('../../lib/diwan/pdf')
      const bytes = await renderDiwanPdf([poem], {
        title: poemLabel(poem, t('diwan.untitled')),
        poet,
        language,
        cover: false,
        index: false,
        occasions: true,
        pagePerPoem: true,
        pageSize: 'A4'
      })
      const outcome = await saveBytes(bytes, `${safeName(poemLabel(poem, 'poem'))}.pdf`, [
        { name: 'file.pdf', extensions: ['pdf'] }
      ])
      if (outcome.saved) notify({ kind: 'success', title: t('diwan.pdf.saved'), message: outcome.path })
    } catch (error) {
      notify({ kind: 'error', title: t('msg.error'), message: String(error) })
    } finally {
      setBusy(null)
    }
  }

  const copyText = async (): Promise<void> => {
    const text = [poemLabel(poem, ''), poemToText(poem)].filter(Boolean).join('\n\n')
    await window.alcode.clipboard.writeText(text)
    notify({ kind: 'success', title: t('diwan.copied') })
  }

  const insertIntoDocument = async (): Promise<void> => {
    const app = useApp.getState()
    const html = poemHtml(poem, poet)
    if (app.editorDoc && app.editorDoc.source.kind === 'rich') {
      app.replaceEditorHtml(`${app.editorDoc.html}${html}`)
    } else {
      app.openEditorDocument({
        name: `${safeName(poemLabel(poem, 'poem'))}.docx`,
        path: null,
        format: 'docx',
        kind: 'rich',
        html,
        direction: 'rtl',
        warnings: [],
        originalBytes: new Uint8Array()
      })
    }
    app.navigate('editor')
    notify({ kind: 'success', title: t('diwan.insert.done') })
  }

  const destroy = async (): Promise<void> => {
    const ok = await confirm({
      title: t('diwan.delete'),
      body: t('diwan.delete.confirm'),
      confirmLabel: t('diwan.delete'),
      danger: true
    })
    if (ok) await remove(poem.id)
  }

  return (
    <div className="dw-editor">
      <div className="dw-bar">
        {/* data-mobile-back: the phone's hardware back returns to the shelf,
            not to the home screen. */}
        <button className="btn secondary icon" title={t('diwan.back')} aria-label={t('diwan.back')} data-mobile-back onClick={() => open(null)}>
          <Back size={16} />
        </button>
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'edit', label: t('diwan.edit'), icon: <PenLine size={14} /> },
            { value: 'preview', label: t('diwan.preview'), icon: <Eye size={14} /> }
          ]}
        />
        <span className="dw-status">{pendingSave ? t('diwan.saving') : t('diwan.saved')}</span>
        <div className="spacer" />
        <Button size="sm" onClick={() => setSharing(true)} title={t('diwan.share.d')}>
          <Share2 size={14} /> {t('diwan.share')}
        </Button>
        <Button size="sm" onClick={() => void exportPdf()}>
          <FileDown size={14} /> {t('diwan.pdf.one')}
        </Button>
        {/* The document editor is a desktop thing; the phone links poems to
            journal days instead, from the day's page. */}
        {phone ? null : (
          <Button size="sm" onClick={() => void insertIntoDocument()} title={t('diwan.insert.d')}>
            <BookMarked size={14} /> {t('diwan.insert')}
          </Button>
        )}
        <Button size="sm" icon title={t('diwan.copy')} onClick={() => void copyText()}>
          <Copy size={14} />
        </Button>
        <Button size="sm" icon ghostDanger variant="danger" title={t('diwan.delete')} onClick={() => void destroy()}>
          <Trash2 size={14} />
        </Button>
      </div>

      <input
        className="dw-title"
        value={poem.title}
        placeholder={t('diwan.title.ph')}
        aria-label={t('diwan.title.ph')}
        dir={poem.title ? 'auto' : undefined}
        onChange={(event) => update(poem.id, { title: event.target.value })}
      />

      {mode === 'preview' ? (
        <Canvas poem={poem} poet={poet} />
      ) : (
        <>
          <VerseRows poem={poem} />
          <details className="dw-fold">
            <summary>
              <Wand2 size={15} /> {t('diwan.details')} <ChevronDown size={15} />
            </summary>
            <div className="body">
              <MetaFields poem={poem} />
            </div>
          </details>
        </>
      )}

      <RecorderPanel poem={poem} />

      <ShareCardModal open={sharing} onClose={() => setSharing(false)} poem={poem} poet={poet} />
    </div>
  )
}

/* -------------------------------------------------------------- metadata */

function MetaFields({ poem }: { poem: Poem }): React.JSX.Element {
  const t = useApp((state) => state.t)
  const update = useDiwan((state) => state.update)
  const meters = poem.form === 'fusha' ? FUSHA_METERS : NABATI_MELODIES
  const listId = `dw-meters-${poem.id}`
  const purposeId = `dw-purposes-${poem.id}`

  return (
    <div className="dw-meta">
      <Field label={t('diwan.form')}>
        <Segmented<PoemForm>
          value={poem.form}
          onChange={(form) => update(poem.id, { form })}
          options={[
            { value: 'nabati', label: t('diwan.form.nabati') },
            { value: 'fusha', label: t('diwan.form.fusha') },
            { value: 'free', label: t('diwan.form.free') }
          ]}
        />
      </Field>
      <Field label={t('diwan.meter')}>
        <input
          className="input"
          list={listId}
          value={poem.meter}
          placeholder={t('diwan.meter.ph')}
          onChange={(event) => update(poem.id, { meter: event.target.value })}
        />
        <datalist id={listId}>
          {meters.map((meter) => (
            <option key={meter} value={meter} />
          ))}
        </datalist>
      </Field>
      <Field label={t('diwan.purpose')}>
        <input
          className="input"
          list={purposeId}
          value={poem.purpose}
          placeholder={t('diwan.purpose.ph')}
          onChange={(event) => update(poem.id, { purpose: event.target.value })}
        />
        <datalist id={purposeId}>
          {PURPOSES.map((purpose) => (
            <option key={purpose} value={purpose} />
          ))}
        </datalist>
      </Field>
      <Field label={t('diwan.rhyme')}>
        <div className="with-btn">
          <input
            className="input"
            value={poem.rhyme}
            onChange={(event) => update(poem.id, { rhyme: event.target.value })}
          />
          <Button size="sm" onClick={() => update(poem.id, { rhyme: guessRhyme(poem) })}>
            {t('diwan.rhyme.guess')}
          </Button>
        </div>
      </Field>
      <Field label={t('diwan.place')}>
        <TextInput value={poem.place} onChange={(place) => update(poem.id, { place })} />
      </Field>
      <Field label={t('diwan.date')}>
        <TextInput type="date" value={poem.saidOn} onChange={(saidOn) => update(poem.id, { saidOn })} />
      </Field>
      <div className="field wide">
        <label>{t('diwan.occasion')}</label>
        <TextArea
          value={poem.occasion}
          onChange={(occasion) => update(poem.id, { occasion })}
          rows={3}
          placeholder={t('diwan.occasion.ph')}
        />
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- verses */

function VerseRows({ poem }: { poem: Poem }): React.JSX.Element {
  const t = useApp((state) => state.t)
  const language = useApp((state) => state.settings.language)
  const notify = useApp((state) => state.notify)
  const updateVerse = useDiwan((state) => state.updateVerse)
  const insertVerse = useDiwan((state) => state.insertVerse)
  const removeVerse = useDiwan((state) => state.removeVerse)
  const moveVerse = useDiwan((state) => state.moveVerse)
  const keepVersion = useDiwan((state) => state.keepVersion)
  const restoreVersion = useDiwan((state) => state.restoreVersion)
  const [history, setHistory] = useState<string | null>(null)
  const container = useRef<HTMLDivElement>(null)
  const focusNext = useRef<{ verseId: string; half: 'sadr' | 'ajuz' } | null>(null)

  // A verse created by Enter gets the caret as soon as it exists.
  useEffect(() => {
    const target = focusNext.current
    if (!target || !container.current) return
    const input = container.current.querySelector<HTMLInputElement>(
      `input[data-verse="${target.verseId}"][data-half="${target.half}"]`
    )
    if (input) {
      input.focus()
      focusNext.current = null
    }
  })

  const focus = useCallback((verseId: string, half: 'sadr' | 'ajuz'): void => {
    const input = container.current?.querySelector<HTMLInputElement>(
      `input[data-verse="${verseId}"][data-half="${half}"]`
    )
    if (input) input.focus()
    else focusNext.current = { verseId, half }
  }, [])

  const onKey = (event: React.KeyboardEvent<HTMLInputElement>, verse: Verse, half: 'sadr' | 'ajuz', index: number): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      if (half === 'sadr' && poem.form !== 'free') {
        focus(verse.id, 'ajuz')
        return
      }
      const next = poem.verses[index + 1]
      if (next) focus(next.id, 'sadr')
      else {
        const created = insertVerse(poem.id, verse.id)
        focusNext.current = { verseId: created, half: 'sadr' }
      }
    } else if (event.key === 'Backspace' && !verse.sadr && !verse.ajuz && poem.verses.length > 1) {
      event.preventDefault()
      const previous = poem.verses[index - 1] ?? poem.verses[index + 1]
      removeVerse(poem.id, verse.id)
      if (previous) focus(previous.id, poem.form === 'free' ? 'sadr' : 'ajuz')
    }
  }

  const versions = history ? poem.versions.filter((version) => version.verseId === history) : []

  return (
    <div className="dw-verses" ref={container}>
      {poem.verses.map((verse, index) => (
        <div className="dw-verse" key={verse.id}>
          <span className="n">{index + 1}</span>
          <input
            data-verse={verse.id}
            data-half="sadr"
            value={verse.sadr}
            dir={verse.sadr ? 'auto' : undefined}
            placeholder={t('diwan.sadr')}
            aria-label={`${t('diwan.sadr')} ${index + 1}`}
            enterKeyHint="next"
            autoComplete="off"
            onChange={(event) => updateVerse(poem.id, verse.id, { sadr: event.target.value })}
            onKeyDown={(event) => onKey(event, verse, 'sadr', index)}
          />
          <span className="star" aria-hidden>
            {poem.form === 'free' ? '' : '✦'}
          </span>
          {poem.form === 'free' ? (
            <span />
          ) : (
            <input
              data-verse={verse.id}
              data-half="ajuz"
              value={verse.ajuz}
              dir={verse.ajuz ? 'auto' : undefined}
              placeholder={t('diwan.ajuz')}
              aria-label={`${t('diwan.ajuz')} ${index + 1}`}
              enterKeyHint="next"
              autoComplete="off"
              onChange={(event) => updateVerse(poem.id, verse.id, { ajuz: event.target.value })}
              onKeyDown={(event) => onKey(event, verse, 'ajuz', index)}
            />
          )}
          <span className="tools">
            <Button
              icon
              variant="ghost"
              size="sm"
              title={t('diwan.verse.keep')}
              onClick={() => {
                keepVersion(poem.id, verse.id)
                notify({ kind: 'success', title: t('diwan.verse.kept') })
              }}
            >
              <History size={14} />
            </Button>
            <Button icon variant="ghost" size="sm" title={t('diwan.verse.versions')} onClick={() => setHistory(verse.id)}>
              <ChevronDown size={14} />
            </Button>
            <Button icon variant="ghost" size="sm" title={t('diwan.verse.up')} disabled={index === 0} onClick={() => moveVerse(poem.id, verse.id, -1)}>
              <ArrowUp size={14} />
            </Button>
            <Button
              icon
              variant="ghost"
              size="sm"
              title={t('diwan.verse.down')}
              disabled={index === poem.verses.length - 1}
              onClick={() => moveVerse(poem.id, verse.id, 1)}
            >
              <ArrowDown size={14} />
            </Button>
            <Button icon variant="ghost" size="sm" title={t('diwan.verse.remove')} onClick={() => removeVerse(poem.id, verse.id)}>
              <Trash2 size={14} />
            </Button>
          </span>
        </div>
      ))}
      <div className="row">
        <Button
          onClick={() => {
            const created = insertVerse(poem.id, null)
            focusNext.current = { verseId: created, half: 'sadr' }
          }}
        >
          <Plus size={15} /> {t('diwan.verse.add')}
        </Button>
      </div>

      <Modal open={history !== null} onClose={() => setHistory(null)} title={t('diwan.verse.versions')} icon={<History size={16} />}>
        {versions.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--fg-3)', lineHeight: 1.7 }}>{t('diwan.verse.noVersions')}</p>
        ) : (
          <div className="dw-versions">
            {[...versions].reverse().map((version) => (
              <div className="dw-version" key={version.savedAt}>
                <span className="text" dir="auto">
                  {version.sadr}
                  {version.ajuz ? ` ✦ ${version.ajuz}` : ''}
                </span>
                <time>{formatRelativeTime(version.savedAt, language)}</time>
                <Button
                  size="sm"
                  onClick={() => {
                    restoreVersion(poem.id, version.verseId, version.savedAt)
                    setHistory(null)
                  }}
                >
                  {t('diwan.verse.restore')}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  )
}

/* ---------------------------------------------------------------- canvas */

/** The poem as it prints, in the calligraphic face, at a size the longest half decides. */
export function Canvas({ poem, poet }: { poem: Poem; poet: string }): React.JSX.Element {
  const t = useApp((state) => state.t)
  const verses = filledVerses(poem)
  const longest = Math.max(1, ...verses.flatMap((verse) => [verse.sadr.trim().length, verse.ajuz.trim().length]))
  // 20px down to 15px as the halves get long; measured in characters, which
  // is close enough for a preview that the PDF lays out precisely later.
  const size = Math.max(15, Math.min(21, Math.round(760 / longest)))
  const meta = [poem.meter.trim(), poem.purpose.trim(), poem.rhyme.trim() ? `${t('diwan.rhyme')}: ${poem.rhyme.trim()}` : '']
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="dw-canvas" style={{ '--dw-verse-size': `${size}px` } as React.CSSProperties}>
      <h2 dir="auto">{poemLabel(poem, t('diwan.untitled'))}</h2>
      {meta ? <div className="meta">{meta}</div> : null}
      <div className="orn">✦</div>
      <div className="rows">
        {verses.map((verse) => (
          <div className={`row${poem.form === 'free' ? ' free' : ''}`} key={verse.id}>
            <span className="s" dir="auto">{verse.sadr.trim() || verse.ajuz.trim()}</span>
            {poem.form === 'free' ? null : (
              <>
                <span className="d">{verse.sadr.trim() && verse.ajuz.trim() ? '✦' : ''}</span>
                <span className="a" dir="auto">{verse.sadr.trim() ? verse.ajuz.trim() : ''}</span>
              </>
            )}
          </div>
        ))}
      </div>
      {poem.occasion.trim() ? <div className="note" dir="auto">{poem.occasion.trim()}</div> : null}
      {poet.trim() ? <div className="sign">— {poet.trim()}</div> : null}
    </div>
  )
}

/* ------------------------------------------------------------- recording */

function RecorderPanel({ poem }: { poem: Poem }): React.JSX.Element {
  const t = useApp((state) => state.t)
  const notify = useApp((state) => state.notify)
  const confirm = useApp((state) => state.confirm)
  const attachRecording = useDiwan((state) => state.attachRecording)
  const loadRecording = useDiwan((state) => state.loadRecording)
  const dropRecording = useDiwan((state) => state.dropRecording)
  const update = useDiwan((state) => state.update)
  const transcriptionKey = useApp((state) => state.settings.transcriptionKey)
  const language = useApp((state) => state.settings.language)
  const setBusy = useApp((state) => state.setBusy)
  const [recorder, setRecorder] = useState<Recorder | null>(null)
  const [seconds, setSeconds] = useState(0)
  const [url, setUrl] = useState<string | null>(null)
  const [heard, setHeard] = useState<Verse[] | null>(null)
  const startedAt = useRef(0)

  /**
   * The recording, written down. Everything else in the app stays on the
   * device; this sends the audio to the service the user chose by pasting
   * their key, and only when they press the button.
   */
  const transcribe = async (): Promise<void> => {
    if (!transcriptionKey.trim()) {
      notify({
        kind: 'info',
        title: t('diwan.transcribe'),
        message: t('diwan.transcribe.noKey'),
        action: { label: t('diwan.transcribe.settings'), run: () => useApp.getState().navigate('settings') }
      })
      return
    }
    const blob = await loadRecording(poem.id)
    if (!blob) return
    setBusy({ label: t('diwan.transcribe.running'), progress: null })
    try {
      const transcript = await transcribeRecording(blob, transcriptionKey, language)
      const verses = wordsToVerses(transcript.words, uid, transcript.text)
      if (verses.length === 0) throw new TranscribeError('empty')
      setHeard(verses)
    } catch (error) {
      const reason = error instanceof TranscribeError ? error.reason : 'network'
      const key =
        reason === 'unauthorized'
          ? 'diwan.transcribe.unauthorized'
          : reason === 'empty'
            ? 'diwan.transcribe.empty'
            : reason === 'rejected'
              ? 'diwan.transcribe.rejected'
              : 'diwan.transcribe.network'
      notify({ kind: 'error', title: t(key, { code: error instanceof Error ? error.message : '' }) })
    } finally {
      setBusy(null)
    }
  }

  const adopt = (replace: boolean): void => {
    if (!heard) return
    const existing = filledVerses(poem)
    update(poem.id, { verses: replace || existing.length === 0 ? heard : [...existing, ...heard] })
    notify({ kind: 'success', title: t('diwan.transcribe.done', { n: heard.length }) })
    setHeard(null)
  }

  // The stored recording, as a playable URL while the poem is open.
  useEffect(() => {
    let revoked = false
    let created: string | null = null
    if (poem.hasRecording) {
      void loadRecording(poem.id).then((blob) => {
        if (revoked || !blob) return
        created = URL.createObjectURL(blob)
        setUrl(created)
      })
    } else {
      setUrl(null)
    }
    return () => {
      revoked = true
      if (created) URL.revokeObjectURL(created)
    }
  }, [poem.id, poem.hasRecording, poem.recordingSeconds, loadRecording])

  useEffect(() => {
    if (!recorder) return undefined
    const timer = window.setInterval(() => setSeconds((Date.now() - startedAt.current) / 1000), 250)
    return () => window.clearInterval(timer)
  }, [recorder])

  // Leaving the screen mid-recording releases the microphone.
  useEffect(() => () => recorder?.cancel(), [recorder])

  const begin = async (): Promise<void> => {
    try {
      const started = await startRecording()
      startedAt.current = Date.now()
      setSeconds(0)
      setRecorder(started)
    } catch (error) {
      const reason = error instanceof RecordingError ? error.reason : 'unknown'
      const key =
        reason === 'denied'
          ? 'diwan.record.denied'
          : reason === 'busy'
            ? 'diwan.record.busy'
            : 'diwan.record.unsupported'
      notify({ kind: 'error', title: t(key) })
    }
  }

  const finish = async (): Promise<void> => {
    if (!recorder) return
    const blob = await recorder.stop()
    const length = (Date.now() - startedAt.current) / 1000
    setRecorder(null)
    if (blob.size === 0) return
    try {
      await attachRecording(poem.id, blob, length)
      notify({ kind: 'success', title: t('diwan.record.saved') })
    } catch (error) {
      notify({ kind: 'error', title: t('msg.error'), message: String(error) })
    }
  }

  const exportAudio = async (): Promise<void> => {
    const blob = await loadRecording(poem.id)
    if (!blob) return
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const outcome = await saveBytes(bytes, `${safeName(poemLabel(poem, 'poem'))}.${extensionFor(blob.type)}`, [
      { name: 'file.all', extensions: [extensionFor(blob.type)] }
    ])
    if (outcome.saved) notify({ kind: 'success', title: t('diwan.pdf.saved'), message: outcome.path })
  }

  const erase = async (): Promise<void> => {
    const ok = await confirm({
      title: t('diwan.record.delete'),
      body: t('diwan.delete.confirm'),
      confirmLabel: t('diwan.record.delete'),
      danger: true
    })
    if (ok) await dropRecording(poem.id)
  }

  return (
    <div className="dw-record">
      {recorder ? (
        <button className="mic live" onClick={() => void finish()}>
          <Square size={16} /> {t('diwan.record.stop')}
          <span className="clock" dir="ltr">
            {formatClock(seconds)}
          </span>
        </button>
      ) : (
        <button className="mic" onClick={() => void begin()} disabled={!recordingSupported()}>
          <Mic size={17} /> {t('diwan.record')}
        </button>
      )}
      {recorder ? (
        <p>{t('diwan.recording')}…</p>
      ) : url ? (
        <>
          <audio controls src={url} preload="metadata" aria-label={t('diwan.record.listen')} />
          <span className="dw-status" dir="ltr">
            {formatClock(poem.recordingSeconds)}
          </span>
          <Button size="sm" variant="primary" onClick={() => void transcribe()} title={t('diwan.transcribe.d')}>
            <Sparkles size={14} /> {t('diwan.transcribe')}
          </Button>
          <Button size="sm" onClick={() => void exportAudio()}>
            <FileDown size={14} /> {t('diwan.record.export')}
          </Button>
          <Button size="sm" ghostDanger variant="danger" onClick={() => void erase()}>
            <Trash2 size={14} /> {t('diwan.record.delete')}
          </Button>
        </>
      ) : (
        <p>{recordingSupported() ? t('diwan.record.hint') : t('diwan.record.unsupported')}</p>
      )}

      <Modal
        open={heard !== null}
        onClose={() => setHeard(null)}
        title={t('diwan.transcribe.preview')}
        icon={<Sparkles size={16} />}
        footer={
          <>
            <Button onClick={() => setHeard(null)}>{t('action.cancel')}</Button>
            {filledVerses(poem).length > 0 ? (
              <Button onClick={() => adopt(true)}>{t('diwan.transcribe.replace')}</Button>
            ) : null}
            <Button variant="primary" onClick={() => adopt(false)}>
              {t('diwan.transcribe.append')}
            </Button>
          </>
        }
      >
        <div className="stack">
          <span className="hint">{t('diwan.transcribe.hint')}</span>
          <div className="dw-canvas" style={{ padding: '14px 12px', '--dw-verse-size': '16px' } as React.CSSProperties}>
            <div className="rows">
              {(heard ?? []).map((verse) => (
                <div className="row" key={verse.id}>
                  <span className="s">{verse.sadr}</span>
                  <span className="d">{verse.ajuz ? '✦' : ''}</span>
                  <span className="a">{verse.ajuz}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  )
}

/* ------------------------------------------------------------ share card */

function ShareCardModal({
  open,
  onClose,
  poem,
  poet
}: {
  open: boolean
  onClose: () => void
  poem: Poem
  poet: string
}): React.JSX.Element {
  const t = useApp((state) => state.t)
  const notify = useApp((state) => state.notify)
  const verses = useMemo(() => filledVerses(poem), [poem])
  const [theme, setTheme] = useState<'paper' | 'night' | 'ivory'>('paper')
  const [picked, setPicked] = useState<string[]>([])
  const [preview, setPreview] = useState<string | null>(null)
  const [blob, setBlob] = useState<Blob | null>(null)

  // The first two verses are the default pick; a card with six is a wall.
  useEffect(() => {
    if (open) setPicked(verses.slice(0, 2).map((verse) => verse.id))
  }, [open, verses])

  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    let created: string | null = null
    const chosen = verses.filter((verse) => picked.includes(verse.id))
    void import('../../lib/diwan/card')
      .then(({ renderVerseCard }) =>
        renderVerseCard(poem, { poet, theme, verses: chosen, title: poem.title })
      )
      .then((image) => {
        if (cancelled) return
        created = URL.createObjectURL(image)
        setBlob(image)
        setPreview(created)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
      if (created) URL.revokeObjectURL(created)
    }
  }, [open, picked, theme, poem, poet, verses])

  const toggle = (id: string): void => {
    setPicked((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : current.length >= 6 ? current : [...current, id]
    )
  }

  const save = async (): Promise<void> => {
    if (!blob) return
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const outcome = await saveBytes(bytes, `${safeName(poemLabel(poem, 'verse'))}-card.png`, [
      { name: 'file.images', extensions: ['png'] }
    ])
    if (outcome.saved) {
      notify({
        kind: 'success',
        title: t('diwan.share.saved'),
        message: outcome.path,
        action: { label: t('action.share'), run: () => void window.alcode.shell.reveal(outcome.path ?? '') }
      })
      onClose()
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('diwan.share')}
      icon={<Share2 size={16} />}
      footer={
        <>
          <Button onClick={onClose}>{t('action.cancel')}</Button>
          <Button variant="primary" disabled={!blob || picked.length === 0} onClick={() => void save()}>
            {t('diwan.share.save')}
          </Button>
        </>
      }
    >
      <div className="stack">
        {preview ? <img className="dw-card-preview" src={preview} alt="" /> : <div className="dw-card-preview" />}
        <Field label={t('diwan.share.theme')}>
          <Segmented
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'paper', label: t('diwan.share.paper') },
              { value: 'night', label: t('diwan.share.night') },
              { value: 'ivory', label: t('diwan.share.ivory') }
            ]}
          />
        </Field>
        <Field label={t('diwan.share.pick')}>
          <div className="dw-pick">
            {verses.map((verse) => (
              <Checkbox
                key={verse.id}
                checked={picked.includes(verse.id)}
                onChange={() => toggle(verse.id)}
                label={`${verse.sadr.trim()}${verse.ajuz.trim() ? ` ✦ ${verse.ajuz.trim()}` : ''}`}
              />
            ))}
          </div>
        </Field>
      </div>
    </Modal>
  )
}

/* --------------------------------------------------------------- helpers */

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'poem'
}

/**
 * The poem as a two-column table for the rich editor: the sadr on the
 * right, the ajuz on the left, the ornament between — the same page the
 * PDF prints, in the markup the editor and every exporter understand.
 */
function poemHtml(poem: Poem, poet: string): string {
  const rows = filledVerses(poem)
    .map((verse) =>
      poem.form === 'free'
        ? `<tr><td colspan="3" style="text-align:right">${escapeHtml(verse.sadr.trim() || verse.ajuz.trim())}</td></tr>`
        : `<tr><td style="text-align:right;width:47%">${escapeHtml(verse.sadr.trim())}</td>` +
          `<td style="text-align:center;width:6%;color:#a8823f">✦</td>` +
          `<td style="text-align:left;width:47%">${escapeHtml(verse.ajuz.trim())}</td></tr>`
    )
    .join('')
  const title = poem.title.trim() ? `<h2 style="text-align:center">${escapeHtml(poem.title.trim())}</h2>` : ''
  const meta = [poem.meter.trim(), poem.purpose.trim()].filter(Boolean).join(' · ')
  const line = meta ? `<p style="text-align:center;color:#6f665a">${escapeHtml(meta)}</p>` : ''
  const note = poem.occasion.trim() ? `<p style="color:#6f665a;font-size:0.9em">${escapeHtml(poem.occasion.trim())}</p>` : ''
  const sign = poet.trim() ? `<p style="text-align:center;color:#a8823f">— ${escapeHtml(poet.trim())}</p>` : ''
  return (
    `<section dir="rtl" style="font-family:'Amiri','Sakkal Majalla','Traditional Arabic',serif;line-height:1.9">` +
    `${title}${line}<table style="width:100%;border-collapse:collapse">${rows}</table>${note}${sign}</section><p></p>`
  )
}
