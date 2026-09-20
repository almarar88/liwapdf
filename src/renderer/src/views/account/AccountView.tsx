import { useEffect, useState } from 'react'
import { CloudOff, CloudUpload, LogIn, LogOut, RefreshCw, Settings as SettingsIcon, ShieldCheck, UserRound } from 'lucide-react'
import { useApp } from '../../store/app'
import { useAccount, type AuthFailure } from '../../store/account'
import { useDiwan } from '../../store/diwan'
import { Button, Field, Segmented, TextInput } from '../../components/ui'
import { formatRelativeTime } from '../../lib/format'
import '../../styles/diwan.css'
import '../../styles/journal.css'

/**
 * The account screen: sign in or create an account; once in, the name,
 * the poet name, the state of the cloud copy and the way out. It says
 * plainly what an account is for and what it is not, because a journal
 * is the one thing a person will not put anywhere they do not trust.
 */
export function AccountView(): React.JSX.Element {
  const t = useApp((state) => state.t)
  const user = useAccount((state) => state.user)
  const ready = useAccount((state) => state.ready)

  return (
    <div className="view">
      <div className="diwan journal">
        <header className="dw-head">
          <div>
            <h1>{t('account.title')}</h1>
            <p>{t('account.sub')}</p>
          </div>
        </header>
        {!ready ? null : user ? <SignedIn /> : <SignIn />}
        <p className="ac-privacy">
          <ShieldCheck size={15} /> {t('account.privacy')}
        </p>
      </div>
    </div>
  )
}

function SignIn(): React.JSX.Element {
  const t = useApp((state) => state.t)
  const notify = useApp((state) => state.notify)
  const signIn = useAccount((state) => state.signIn)
  const signUp = useAccount((state) => state.signUp)
  const resetPassword = useAccount((state) => state.resetPassword)
  const awaiting = useAccount((state) => state.awaitingConfirmation)
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<AuthFailure | null>(null)

  const submit = async (): Promise<void> => {
    if (!email.trim() || password.length < 8) {
      setError(password.length < 8 ? 'weak' : 'invalid')
      return
    }
    setBusy(true)
    setError(null)
    const failure = mode === 'signin' ? await signIn(email, password) : await signUp(email, password, name)
    setBusy(false)
    if (failure && failure !== 'confirm') setError(failure)
  }

  const forgot = async (): Promise<void> => {
    if (!email.trim()) {
      setError('invalid')
      return
    }
    const failure = await resetPassword(email)
    if (failure) setError(failure)
    else notify({ kind: 'success', title: t('account.reset.sent') })
  }

  return (
    <div className="ac-card">
      <div className="ac-local">
        <CloudOff size={18} />
        <span>
          <b>{t('account.local')}</b>
          <span>{t('account.local.d')}</span>
        </span>
      </div>

      <Segmented<'signin' | 'signup'>
        value={mode}
        onChange={(next) => {
          setMode(next)
          setError(null)
        }}
        options={[
          { value: 'signin', label: t('account.signin'), icon: <LogIn size={14} /> },
          { value: 'signup', label: t('account.signup'), icon: <UserRound size={14} /> }
        ]}
      />

      {awaiting ? <div className="ac-notice">{t('account.confirm')}</div> : null}
      {error ? <div className="ac-error">{t(`account.err.${error === 'confirm' ? 'unknown' : error}`)}</div> : null}

      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        {mode === 'signup' ? (
          <Field label={t('account.name')}>
            <input className="input" value={name} placeholder={t('account.name.ph')} autoComplete="name" onChange={(event) => setName(event.target.value)} />
          </Field>
        ) : null}
        <Field label={t('account.email')}>
          <input className="input" type="email" value={email} dir="ltr" autoComplete="email" inputMode="email" onChange={(event) => setEmail(event.target.value)} />
        </Field>
        <Field label={t('account.password')} hint={mode === 'signup' ? t('account.password.hint') : undefined}>
          <input
            className="input"
            type="password"
            value={password}
            dir="ltr"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <div className="row between wrap">
          <Button type="submit" variant="primary" size="lg" disabled={busy}>
            {mode === 'signin' ? t('account.signin') : t('account.signup')}
          </Button>
          {mode === 'signin' ? (
            <Button variant="ghost" size="sm" onClick={() => void forgot()}>
              {t('account.forgot')}
            </Button>
          ) : null}
        </div>
      </form>
    </div>
  )
}

function SignedIn(): React.JSX.Element {
  const t = useApp((state) => state.t)
  const language = useApp((state) => state.settings.language)
  const navigate = useApp((state) => state.navigate)
  const notify = useApp((state) => state.notify)
  const user = useAccount((state) => state.user)
  const profile = useAccount((state) => state.profile)
  const saveProfile = useAccount((state) => state.saveProfile)
  const sync = useAccount((state) => state.sync)
  const syncing = useAccount((state) => state.syncing)
  const lastSyncAt = useAccount((state) => state.lastSyncAt)
  const report = useAccount((state) => state.lastReport)
  const signOut = useAccount((state) => state.signOut)
  const setPoet = useDiwan((state) => state.setPoet)
  const [displayName, setDisplayName] = useState(profile.displayName)
  const [poetName, setPoetName] = useState(profile.poetName)

  useEffect(() => {
    setDisplayName(profile.displayName)
    setPoetName(profile.poetName)
  }, [profile.displayName, profile.poetName])

  const save = async (): Promise<void> => {
    await saveProfile({ displayName, poetName })
    setPoet(poetName)
    notify({ kind: 'success', title: t('account.saved') })
  }

  const online = typeof navigator === 'undefined' || navigator.onLine !== false

  return (
    <div className="stack">
      <div className="ac-card">
        <div className="ac-who">
          <span className="avatar">{(displayName || user?.email || '?').trim().charAt(0).toUpperCase()}</span>
          <span>
            <b>{displayName || t('account.profile')}</b>
            <span dir="ltr">{user?.email}</span>
          </span>
        </div>
        <div className="ac-sync">
          {!online ? (
            <span className="ac-notice">{t('account.offline')}</span>
          ) : (
            <span className="dw-status">
              {syncing
                ? t('account.syncing')
                : lastSyncAt
                  ? `${t('account.lastSync', { when: formatRelativeTime(lastSyncAt, language) })}${
                      report ? ` · ${t('account.syncReport', { pushed: report.pushed, pulled: report.pulled })}` : ''
                    }`
                  : t('account.neverSynced')}
              {report && report.errors.length > 0 ? ` · ${t('account.syncError', { error: report.errors[0] })}` : ''}
            </span>
          )}
          <Button size="sm" disabled={syncing || !online} onClick={() => void sync()}>
            {syncing ? <RefreshCw size={14} className="spin" /> : <CloudUpload size={14} />} {t('account.sync')}
          </Button>
        </div>
      </div>

      <div className="ac-card">
        <b className="ac-h">{t('account.profile')}</b>
        <Field label={t('account.name')}>
          <TextInput value={displayName} onChange={setDisplayName} placeholder={t('account.name.ph')} />
        </Field>
        <Field label={t('account.poet')}>
          <TextInput value={poetName} onChange={setPoetName} />
        </Field>
        <div className="row">
          <Button variant="primary" onClick={() => void save()}>
            {t('account.save')}
          </Button>
        </div>
      </div>

      <div className="row between wrap">
        <Button onClick={() => navigate('settings')}>
          <SettingsIcon size={15} /> {t('account.settings')}
        </Button>
        <Button ghostDanger variant="danger" onClick={() => void signOut()}>
          <LogOut size={15} /> {t('account.signout')}
        </Button>
      </div>
    </div>
  )
}
