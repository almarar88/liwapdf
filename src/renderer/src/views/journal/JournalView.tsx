import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CalendarDays,
  Feather,
  MapPin,
  PenLine,
  Plus,
  Search,
  Tag,
  Trash2
} from 'lucide-react'
import { useApp } from '../../store/app'
import { useJournal } from '../../store/journal'
import { useDiwan } from '../../store/diwan'
import { useAccount } from '../../store/account'
import { Button, Checkbox, Empty, Field, Modal, TextInput } from '../../components/ui'
import { saveBytes } from '../../lib/files'
import { formatGregorian, formatHijri, formatRelativeTime } from '../../lib/format'
import { MOODS, entryExcerpt, todayIso, wordCount, type JournalEntry } from '../../lib/journal/types'
import { filledVerses, poemLabel, type Poem } from '../../lib/diwan/types'
import { AiError, ai, type Reflection } from '../../lib/ai/client'
import { Sparkles, FileDown } from 'lucide-react'
import { escapeHtml } from '../../lib/format'
import '../../styles/diwan.css'
import '../../styles/journal.css'

/**
 * The journal: the days, and the one being written.
 *
 * The list is the calendar the writer actually has — the days they wrote,
 * newest first, each with the words it opens with — and the editor is a
 * page: date at the top, the text in the middle, the small facts (mood,
 * place, tags, the poem said that day) folded under it. Nothing asks to
 * be filled in; a day with one line is a day.
 */
export function JournalView(): React.JSX.Element {
  const t = useApp((state) => state.t)
  const activeId = useJournal((state) => state.activeId)
  const loaded = useJournal((state) => state.loaded)
  const load = useJournal((state) => state.load)
  const diwanLoaded = useDiwan((state) => state.loaded)
  const loadDiwan = useDiwan((state) => state.load)

  useEffect(() => {
    if (!loaded) void load()
    if (!diwanLoaded) void loadDiwan()
  }, [loaded, load, diwanLoaded, loadDiwan])

  return (
    <div className="view">
      <div className="diwan journal">
        {activeId ? <EntryEditor id={activeId} /> : <Days />}
        {!loaded ? <span className="dw-status">{t('diwan.saving')}</span> : null}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ list */

function Days(): React.JSX.Element {
  const t = useApp((state) => state.t)
  const language = useApp((state) => state.settings.language)
  const entries = useJournal((state) => state.entries)
  const openToday = useJournal((state) => state.openToday)
  const create = useJournal((state) => state.create)
  const open = useJournal((state) => state.open)
  const [query, setQuery] = useState('')
  const [printing, setPrinting] = useState(false)
  const [reflection, setReflection] = useState<Reflection | null>(null)
  const [reflecting, setReflecting] = useState(false)
  const notify = useApp((state) => state.notify)
  const setBusy = useApp((state) => state.setBusy)

  /** The assistant reads the last fortnight and writes back, warmly. */
  const reflect = async (): Promise<void> => {
    const recent = entries.slice(0, 14).filter((entry) => entry.body.trim())
    if (recent.length === 0) {
      notify({ kind: 'info', title: t('ai.reflect.none') })
      return
    }
    setReflecting(true)
    try {
      const text = recent.map((entry) => `${entry.day}${entry.title ? ` — ${entry.title}` : ''}${entry.mood ? ` (${t(`journal.mood.${entry.mood}` as 'journal.mood.joy')})` : ''}\n${entry.body.trim()}`).join('\n\n')
      setReflection(await ai.reflect(text))
    } catch (error) {
      const reason = error instanceof AiError ? error.reason : 'upstream'
      notify({ kind: 'error', title: t(`ai.err.${reason}`) })
    } finally {
      setReflecting(false)
    }
  }

  const exportDocx = async (): Promise<void> => {
    setBusy({ label: t('journal.export.docx'), progress: null })
    try {
      const { htmlToDocx } = await import('../../lib/docx/write')
      const html = `<div dir="rtl" style="font-family:'Amiri','Sakkal Majalla',serif;line-height:1.9">${[...entries]
        .sort((a, b) => a.day.localeCompare(b.day))
        .map(
          (entry) =>
            `<h2>${escapeHtml(entry.day)}${entry.title.trim() ? ` — ${escapeHtml(entry.title.trim())}` : ''}</h2>` +
            entry.body
              .split(/\n{2,}/)
              .map((paragraph) => `<p>${escapeHtml(paragraph.trim()).replace(/\n/g, '<br/>')}</p>`)
              .join('')
        )
        .join('')}</div>`
      const bytes = await htmlToDocx(html, { title: t('nav.journal'), rightToLeft: true })
      const outcome = await saveBytes(bytes, 'journal.docx', [{ name: 'file.word', extensions: ['docx'] }])
      if (outcome.saved) notify({ kind: 'success', title: t('diwan.pdf.saved'), message: outcome.path })
    } catch (error) {
      notify({ kind: 'error', title: t('msg.error'), message: String(error) })
    } finally {
      setBusy(null)
    }
  }

  const today = todayIso()
  const todayEntry = entries.find((entry) => entry.day === today)
  const words = useMemo(() => entries.reduce((sum, entry) => sum + wordCount(entry.body), 0), [entries])
  const streak = useMemo(() => countStreak(entries), [entries])

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return entries
    return entries.filter(
      (entry) =>
        entry.title.toLowerCase().includes(needle) ||
        entry.body.toLowerCase().includes(needle) ||
        entry.tags.some((tag) => tag.toLowerCase().includes(needle)) ||
        entry.place.toLowerCase().includes(needle)
    )
  }, [entries, query])

  const groups = useMemo(() => {
    const map = new Map<string, JournalEntry[]>()
    for (const entry of shown) {
      const key = monthKey(entry.day, language)
      map.set(key, [...(map.get(key) ?? []), entry])
    }
    return [...map.entries()]
  }, [shown, language])

  return (
    <>
      <header className="dw-head">
        <div>
          <h1>{t('nav.journal')}</h1>
          <p>{t('journal.sub')}</p>
        </div>
      </header>

      <button className="jn-today" onClick={() => openToday()}>
        <span className="ic">
          <PenLine size={20} />
        </span>
        <span className="text">
          <b>{todayEntry ? t('journal.continue') : t('journal.today')}</b>
          <span>{todayEntry ? entryExcerpt(todayEntry, 80) || t('journal.today.d') : t('journal.today.d')}</span>
        </span>
      </button>

      <div className="jn-stats">
        <span>
          <b>{entries.length}</b> {t('journal.count', { n: '' }).trim()}
        </span>
        <span>
          <b>{words}</b> {t('journal.words', { n: '' }).trim()}
        </span>
        {streak > 1 ? <span className="hot">{t('journal.streak', { n: streak })}</span> : null}
      </div>

      <div className="dw-actions">
        <button className="dw-action" onClick={() => create()}>
          <span className="ic">
            <Plus size={18} />
          </span>
          <span>
            <b>{t('journal.new')}</b>
            <span>{t('journal.date')}</span>
          </span>
        </button>
        <button className="dw-action" onClick={() => setPrinting(true)} disabled={entries.length === 0}>
          <span className="ic">
            <BookOpen size={18} />
          </span>
          <span>
            <b>{t('journal.book')}</b>
            <span>{t('journal.book.d')}</span>
          </span>
        </button>
        <button className="dw-action" onClick={() => void reflect()} disabled={entries.length === 0 || reflecting}>
          <span className="ic">
            <Sparkles size={18} />
          </span>
          <span>
            <b>{reflecting ? t('ai.working') : t('ai.reflect')}</b>
            <span>{t('ai.reflect.d')}</span>
          </span>
        </button>
        <button className="dw-action" onClick={() => void exportDocx()} disabled={entries.length === 0}>
          <span className="ic">
            <FileDown size={18} />
          </span>
          <span>
            <b>{t('journal.export.docx')}</b>
            <span>{t('journal.count', { n: entries.length })}</span>
          </span>
        </button>
      </div>

      <Modal open={reflection !== null} onClose={() => setReflection(null)} title={t('ai.reflect')} icon={<Sparkles size={16} />}>
        {reflection ? (
          <div className="dw-ai">
            <div className="item"><p dir="auto">{reflection.summary}</p></div>
            <h4>{t('ai.themes')}</h4>
            <ul>{reflection.themes.map((theme, index) => <li key={index} dir="auto">{theme}</li>)}</ul>
            <h4>{t('ai.mood')}</h4>
            <div className="item"><p dir="auto">{reflection.mood}</p></div>
            <h4>{t('ai.highlight')}</h4>
            <div className="item"><p dir="auto">{reflection.highlight}</p></div>
            <h4>{t('ai.question')}</h4>
            <div className="item"><p dir="auto">{reflection.question}</p></div>
          </div>
        ) : null}
      </Modal>

      {entries.length > 4 ? (
        <label className="jn-search">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('journal.search')} />
        </label>
      ) : null}

      {entries.length === 0 ? (
        <Empty
          icon={<CalendarDays size={26} />}
          title={t('journal.empty')}
          subtitle={t('journal.empty.d')}
          action={
            <Button variant="primary" onClick={() => openToday()}>
              {t('journal.today')}
            </Button>
          }
        />
      ) : (
        groups.map(([month, list]) => (
          <section className="jn-month" key={month}>
            <h3>{month}</h3>
            <div className="jn-days">
              {list.map((entry) => (
                <DayCard key={entry.id} entry={entry} onOpen={() => open(entry.id)} />
              ))}
            </div>
          </section>
        ))
      )}

      <MemoirModal open={printing} onClose={() => setPrinting(false)} entries={entries} />
    </>
  )
}

function DayCard({ entry, onOpen }: { entry: JournalEntry; onOpen: () => void }): React.JSX.Element {
  const language = useApp((state) => state.settings.language)
  const mood = MOODS.find((item) => item.key === entry.mood)
  const date = new Date(`${entry.day}T12:00:00`)
  return (
    <button className="jn-day" onClick={onOpen}>
      <span className="date">
        <b>{new Intl.DateTimeFormat(language === 'ar' ? 'ar-SA-u-nu-arab-ca-gregory' : 'en-GB', { day: 'numeric' }).format(date)}</b>
        <span>{new Intl.DateTimeFormat(language === 'ar' ? 'ar' : 'en-GB', { weekday: 'short' }).format(date)}</span>
      </span>
      <span className="text">
        {entry.title.trim() ? <b dir="auto">{entry.title.trim()}</b> : null}
        <span dir="auto">{entryExcerpt(entry) || '…'}</span>
        <span className="meta">
          {mood ? <span>{mood.glyph}</span> : null}
          {entry.poemIds.length > 0 ? (
            <span>
              <Feather size={11} /> {entry.poemIds.length}
            </span>
          ) : null}
          {entry.place.trim() ? (
            <span>
              <MapPin size={11} /> {entry.place.trim()}
            </span>
          ) : null}
          <span>{formatRelativeTime(entry.updatedAt, language)}</span>
        </span>
      </span>
    </button>
  )
}

/* ---------------------------------------------------------------- editor */

function EntryEditor({ id }: { id: string }): React.JSX.Element {
  const t = useApp((state) => state.t)
  const language = useApp((state) => state.settings.language)
  const confirm = useApp((state) => state.confirm)
  const entry = useJournal((state) => state.entries.find((item) => item.id === id))
  const pendingSave = useJournal((state) => state.pendingSave)
  const open = useJournal((state) => state.open)
  const update = useJournal((state) => state.update)
  const remove = useJournal((state) => state.remove)
  const flush = useJournal((state) => state.flush)
  const discardIfEmpty = useJournal((state) => state.discardIfEmpty)
  const poems = useDiwan((state) => state.poems)
  const user = useAccount((state) => state.user)
  const [picking, setPicking] = useState(false)

  // Leaving writes at once, and a page never written in is not kept.
  useEffect(
    () => () => {
      void flush().then(() => discardIfEmpty(id))
    },
    [flush, discardIfEmpty, id]
  )

  if (!entry) {
    return (
      <div className="row">
        <Button onClick={() => open(null)}>{t('nav.journal')}</Button>
      </div>
    )
  }

  const Back = language === 'ar' ? ArrowRight : ArrowLeft
  const date = new Date(`${entry.day}T12:00:00`)
  const linked = entry.poemIds.map((poemId) => poems.find((poem) => poem.id === poemId)).filter((poem): poem is Poem => Boolean(poem))

  const destroy = async (): Promise<void> => {
    const ok = await confirm({ title: t('journal.delete'), body: t('journal.delete.confirm'), confirmLabel: t('journal.delete'), danger: true })
    if (ok) await remove(entry.id)
  }

  return (
    <div className="dw-editor jn-editor">
      <div className="dw-bar">
        <button className="btn secondary icon" title={t('nav.journal')} aria-label={t('nav.journal')} data-mobile-back onClick={() => open(null)}>
          <Back size={16} />
        </button>
        <label className="jn-date">
          <CalendarDays size={15} />
          <input type="date" value={entry.day} max={todayIso()} onChange={(event) => update(entry.id, { day: event.target.value || entry.day })} />
        </label>
        <span className="dw-status">{pendingSave ? t('diwan.saving') : user ? t('journal.synced') : t('journal.saved')}</span>
        <div className="spacer" />
        <Button size="sm" icon ghostDanger variant="danger" title={t('journal.delete')} onClick={() => void destroy()}>
          <Trash2 size={14} />
        </Button>
      </div>

      <div className="jn-dateline">
        {formatGregorian(date, language)} · {formatHijri(date, language)}
      </div>

      <input
        className="dw-title"
        value={entry.title}
        placeholder={t('journal.title.ph')}
        aria-label={t('journal.title.ph')}
        dir={entry.title ? 'auto' : undefined}
        onChange={(event) => update(entry.id, { title: event.target.value })}
      />

      <textarea
        className="jn-body"
        value={entry.body}
        placeholder={t('journal.body.ph')}
        aria-label={t('journal.body.ph')}
        dir={entry.body ? 'auto' : undefined}
        rows={Math.max(8, entry.body.split('\n').length + 2)}
        onChange={(event) => update(entry.id, { body: event.target.value })}
      />
      <div className="jn-count">{t('journal.words', { n: wordCount(entry.body) })}</div>

      <div className="jn-moods" role="radiogroup" aria-label={t('journal.mood')}>
        <span className="lbl">{t('journal.mood')}</span>
        {MOODS.map((mood) => (
          <button
            key={mood.key}
            role="radio"
            aria-checked={entry.mood === mood.key}
            className={`jn-mood${entry.mood === mood.key ? ' on' : ''}`}
            title={t(`journal.mood.${mood.key}`)}
            onClick={() => update(entry.id, { mood: entry.mood === mood.key ? '' : mood.key })}
          >
            <span>{mood.glyph}</span>
            <small>{t(`journal.mood.${mood.key}`)}</small>
          </button>
        ))}
      </div>

      <div className="dw-meta">
        <Field label={t('journal.tags')}>
          <div className="with-icon">
            <Tag size={14} />
            <input
              className="input"
              value={entry.tags.join('، ')}
              placeholder={t('journal.tags.ph')}
              onChange={(event) =>
                update(entry.id, {
                  tags: event.target.value
                    .split(/[،,]/)
                    .map((tag) => tag.trim())
                    .filter((tag, index, all) => tag && all.indexOf(tag) === index)
                })
              }
            />
          </div>
        </Field>
        <Field label={t('journal.place')}>
          <div className="with-icon">
            <MapPin size={14} />
            <TextInput value={entry.place} onChange={(place) => update(entry.id, { place })} />
          </div>
        </Field>
      </div>

      <div className="jn-poems">
        <div className="row between">
          <b>
            <Feather size={14} /> {t('journal.poems')}
          </b>
          <Button size="sm" onClick={() => setPicking(true)}>
            <Plus size={14} /> {t('journal.poems.pick')}
          </Button>
        </div>
        {linked.map((poem) => (
          <div className="jn-poem" key={poem.id}>
            <span dir="auto">
              <b>{poemLabel(poem, t('diwan.untitled'))}</b>
              {filledVerses(poem)[0] ? <span> — {filledVerses(poem)[0].sadr} ✦ {filledVerses(poem)[0].ajuz}</span> : null}
            </span>
            <Button size="sm" icon variant="ghost" title={t('action.remove')} onClick={() => update(entry.id, { poemIds: entry.poemIds.filter((item) => item !== poem.id) })}>
              <Trash2 size={13} />
            </Button>
          </div>
        ))}
      </div>

      <Modal open={picking} onClose={() => setPicking(false)} title={t('journal.poems.pick')} icon={<Feather size={16} />}>
        {poems.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--fg-3)' }}>{t('journal.poems.none')}</p>
        ) : (
          <div className="dw-pick">
            {poems.map((poem) => (
              <Checkbox
                key={poem.id}
                checked={entry.poemIds.includes(poem.id)}
                onChange={(checked) =>
                  update(entry.id, {
                    poemIds: checked ? [...entry.poemIds, poem.id] : entry.poemIds.filter((item) => item !== poem.id)
                  })
                }
                label={poemLabel(poem, t('diwan.untitled'))}
              />
            ))}
          </div>
        )}
      </Modal>
    </div>
  )
}

/* ------------------------------------------------------------------ book */

function MemoirModal({ open, onClose, entries }: { open: boolean; onClose: () => void; entries: JournalEntry[] }): React.JSX.Element {
  const t = useApp((state) => state.t)
  const language = useApp((state) => state.settings.language)
  const notify = useApp((state) => state.notify)
  const setBusy = useApp((state) => state.setBusy)
  const poems = useDiwan((state) => state.poems)
  const profile = useAccount((state) => state.profile)
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [cover, setCover] = useState(true)
  const [index, setIndex] = useState(true)
  const [includePoems, setIncludePoems] = useState(true)

  useEffect(() => {
    if (open && !author) setAuthor(profile.displayName)
  }, [open, author, profile.displayName])

  const suggested = t('journal.book.title.ph', { name: author || profile.displayName || '…' })

  const make = async (): Promise<void> => {
    const chosen = entries.filter((entry) => (!from || entry.day >= from) && (!to || entry.day <= to))
    if (chosen.length === 0) {
      notify({ kind: 'info', title: t('journal.book.none') })
      return
    }
    setBusy({ label: t('journal.book.make'), progress: null })
    try {
      const { renderMemoirPdf } = await import('../../lib/journal/pdf')
      const bytes = await renderMemoirPdf(chosen, new Map(poems.map((poem) => [poem.id, poem])), {
        title: title.trim() || suggested,
        author,
        language,
        cover,
        index,
        includePoems,
        pageSize: 'A5',
        from: from || undefined,
        to: to || undefined
      })
      const outcome = await saveBytes(bytes, `${(title.trim() || 'memoir').replace(/[\\/:*?"<>|]/g, ' ')}.pdf`, [{ name: 'file.pdf', extensions: ['pdf'] }])
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
      title={t('journal.book')}
      icon={<BookOpen size={16} />}
      footer={
        <>
          <Button onClick={onClose}>{t('action.cancel')}</Button>
          <Button variant="primary" onClick={() => void make()}>
            {t('journal.book.make')}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Field label={t('journal.book.title')}>
          <TextInput value={title} onChange={setTitle} placeholder={suggested} />
        </Field>
        <Field label={t('journal.book.author')}>
          <TextInput value={author} onChange={setAuthor} />
        </Field>
        <div className="dw-meta">
          <Field label={t('journal.book.from')}>
            <TextInput type="date" value={from} onChange={setFrom} />
          </Field>
          <Field label={t('journal.book.to')}>
            <TextInput type="date" value={to} onChange={setTo} />
          </Field>
        </div>
        <Checkbox checked={cover} onChange={setCover} label={t('diwan.book.cover')} />
        <Checkbox checked={index} onChange={setIndex} label={t('diwan.book.index')} />
        <Checkbox checked={includePoems} onChange={setIncludePoems} label={t('journal.book.poems')} />
      </div>
    </Modal>
  )
}

/* --------------------------------------------------------------- helpers */

function monthKey(day: string, language: 'ar' | 'en'): string {
  return new Intl.DateTimeFormat(language === 'ar' ? 'ar-SA-u-nu-arab-ca-gregory' : 'en-GB', { month: 'long', year: 'numeric' }).format(new Date(`${day}T12:00:00`))
}

/** Consecutive days written, counting back from today or yesterday. */
export function countStreak(entries: JournalEntry[], today = todayIso()): number {
  const days = new Set(entries.map((entry) => entry.day))
  const cursor = new Date(`${today}T12:00:00`)
  if (!days.has(todayIso(cursor))) cursor.setDate(cursor.getDate() - 1)
  let streak = 0
  while (days.has(todayIso(cursor))) {
    streak += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}
