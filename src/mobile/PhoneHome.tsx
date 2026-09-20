import { useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import { BookOpen, CalendarDays, ChevronLeft, ChevronRight, Feather, Languages, PenLine, UserRound } from 'lucide-react'
import { useApp } from '../renderer/src/store/app'
import { useJournal } from '../renderer/src/store/journal'
import { useDiwan } from '../renderer/src/store/diwan'
import { useAccount } from '../renderer/src/store/account'
import { MOODS, entryExcerpt, todayIso, wordCount, type JournalEntry } from '../renderer/src/lib/journal/types'
import { poemLabel } from '../renderer/src/lib/diwan/types'
import { formatRelativeTime } from '../renderer/src/lib/format'
import { tapFeedback } from './shell'
import '../renderer/src/styles/journal.css'

/**
 * The phone's home screen: tonight's page, and the way to the two books.
 *
 * A journal app has one job at 11pm, which is to open on the page for
 * today with the keyboard one tap away. So the first thing on the screen
 * is that page, then the two shelves — the days and the poems — with
 * their counts, then the last few days written, for the pleasure of
 * reading them back. There is no toolbox: the app does two things.
 */
export function PhoneHome(): React.JSX.Element {
  const t = useApp((state) => state.t)
  const navigate = useApp((state) => state.navigate)
  const language = useApp((state) => state.settings.language)
  const setSettings = useApp((state) => state.setSettings)
  const entries = useJournal((state) => state.entries)
  const journalLoaded = useJournal((state) => state.loaded)
  const loadJournal = useJournal((state) => state.load)
  const openToday = useJournal((state) => state.openToday)
  const openEntry = useJournal((state) => state.open)
  const poems = useDiwan((state) => state.poems)
  const diwanLoaded = useDiwan((state) => state.loaded)
  const loadDiwan = useDiwan((state) => state.load)
  const profile = useAccount((state) => state.profile)
  const user = useAccount((state) => state.user)

  useEffect(() => {
    if (!journalLoaded) void loadJournal()
    if (!diwanLoaded) void loadDiwan()
  }, [journalLoaded, loadJournal, diwanLoaded, loadDiwan])

  const today = todayIso()
  const todayEntry = entries.find((entry) => entry.day === today)
  const recent = useMemo(() => entries.filter((entry) => entry.day !== today).slice(0, 4), [entries, today])
  const year = today.slice(0, 4)
  const daysThisYear = entries.filter((entry) => entry.day.startsWith(year)).length
  const words = entries.reduce((sum, entry) => sum + wordCount(entry.body), 0)
  const hour = new Date().getHours()
  const greeting = hour < 12 ? t('phone.greeting.morning') : t('phone.greeting.evening')
  const name = profile.displayName || profile.poetName
  const Chevron = language === 'ar' ? ChevronLeft : ChevronRight

  const go = (run: () => void): void => {
    tapFeedback('medium')
    run()
  }

  return (
    <div className="phone-home">
      <header className="ph-top">
        <div className="ph-top-group">
          <button className="ph-round" aria-label={t('nav.account')} onClick={() => go(() => navigate('account'))}>
            {user ? <span className="ph-avatar">{(name || user.email || '?').charAt(0).toUpperCase()}</span> : <UserRound size={19} />}
          </button>
          <button
            className="ph-lang"
            lang={language === 'ar' ? 'en' : 'ar'}
            dir={language === 'ar' ? 'ltr' : 'rtl'}
            aria-label={t('settings.language')}
            onClick={() => {
              tapFeedback()
              void setSettings({ language: language === 'ar' ? 'en' : 'ar' })
            }}
          >
            <Languages size={15} />
            {language === 'ar' ? 'English' : 'العربية'}
          </button>
        </div>
      </header>

      <div className="ph-greet">
        <h1>
          {greeting}
          {name ? `، ${name}` : ''}
        </h1>
        <p>{todayEntry ? t('journal.continue') : t('journal.today.d')}</p>
      </div>

      <motion.button
        className="jn-today ph-today"
        onClick={() =>
          go(() => {
            openToday()
            navigate('journal')
          })
        }
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
      >
        <span className="ic">
          <PenLine size={20} />
        </span>
        <span className="text">
          <b>{todayEntry ? t('journal.continue') : t('journal.today')}</b>
          <span>{todayEntry ? entryExcerpt(todayEntry, 70) || t('journal.today.d') : t('journal.today.d')}</span>
        </span>
        <Chevron size={18} />
      </motion.button>

      <div className="ph-shelves">
        <motion.button
          className="ph-shelf"
          onClick={() =>
            go(() => {
              openEntry(null)
              navigate('journal')
            })
          }
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.06, duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
        >
          <span className="ph-shelf-icon">
            <CalendarDays size={19} />
          </span>
          <b>{t('phone.days')}</b>
          <span>
            {t('journal.count', { n: entries.length })} · {t('journal.words', { n: words })}
          </span>
          <small>
            {t('phone.this.year')}: {daysThisYear}
          </small>
        </motion.button>
        <motion.button
          className="ph-shelf poems"
          onClick={() => go(() => navigate('diwan'))}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
        >
          <span className="ph-shelf-icon">
            <Feather size={19} />
          </span>
          <b>{t('phone.poems')}</b>
          <span>{t('diwan.count', { n: poems.length })}</span>
          <small>{poems[0] ? poemLabel(poems[0], t('diwan.untitled')) : t('diwan.new.d')}</small>
        </motion.button>
      </div>

      {recent.length > 0 ? (
        <section className="ph-recent">
          <div className="row between">
            <h3>{t('journal.recent')}</h3>
            <button
              className="ph-more"
              onClick={() =>
                go(() => {
                  openEntry(null)
                  navigate('journal')
                })
              }
            >
              {t('journal.all')} <Chevron size={14} />
            </button>
          </div>
          <div className="jn-days">
            {recent.map((entry) => (
              <RecentDay
                key={entry.id}
                entry={entry}
                onOpen={() =>
                  go(() => {
                    openEntry(entry.id)
                    navigate('journal')
                  })
                }
              />
            ))}
          </div>
        </section>
      ) : null}

      <button className="ph-diwan" onClick={() => go(() => navigate('diwan'))}>
        <span className="ph-diwan-icon">
          <BookOpen size={19} />
        </span>
        <span className="ph-diwan-text">
          <b>{t('nav.diwan')}</b>
          <span>{t('phone.card.diwan.d')}</span>
        </span>
        <Chevron size={18} />
      </button>
    </div>
  )
}

function RecentDay({ entry, onOpen }: { entry: JournalEntry; onOpen: () => void }): React.JSX.Element {
  const language = useApp((state) => state.settings.language)
  const mood = MOODS.find((item) => item.key === entry.mood)
  const date = new Date(`${entry.day}T12:00:00`)
  return (
    <button className="jn-day" onClick={onOpen}>
      <span className="date">
        <b>{new Intl.DateTimeFormat(language === 'ar' ? 'ar-SA-u-nu-arab-ca-gregory' : 'en-GB', { day: 'numeric' }).format(date)}</b>
        <span>{new Intl.DateTimeFormat(language === 'ar' ? 'ar' : 'en-GB', { month: 'short' }).format(date)}</span>
      </span>
      <span className="text">
        {entry.title.trim() ? <b dir="auto">{entry.title.trim()}</b> : null}
        <span dir="auto">{entryExcerpt(entry) || '…'}</span>
        <span className="meta">
          {mood ? <span>{mood.glyph}</span> : null}
          <span>{formatRelativeTime(entry.updatedAt, language)}</span>
        </span>
      </span>
    </button>
  )
}
