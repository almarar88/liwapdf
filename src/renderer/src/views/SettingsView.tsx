import { useEffect, useState } from 'react'
import { Check, FolderOpen, Github, Moon, Sun, SunMoon } from 'lucide-react'
import { useApp } from '../store/app'
import { Button, Card, Field, Segmented, Switch } from '../components/ui'
import type { AppSettings } from '@shared/types'

const ACCENTS: { id: AppSettings['accent']; color: string }[] = [
  { id: 'blue', color: '#0a84ff' },
  { id: 'purple', color: '#8b5cf6' },
  { id: 'pink', color: '#ff2d78' },
  { id: 'green', color: '#22a565' },
  { id: 'orange', color: '#ff8a00' },
  { id: 'graphite', color: '#5a6474' }
]

export function SettingsView(): React.JSX.Element {
  const t = useApp((state) => state.t)
  const settings = useApp((state) => state.settings)
  const setSettings = useApp((state) => state.setSettings)
  const [info, setInfo] = useState<{
    version: string
    platform: string
    arch: string
    electron: string
    chrome: string
  } | null>(null)

  useEffect(() => {
    void window.alcode.app.info().then(setInfo)
  }, [])

  const shortcuts: [string, string][] = [
    ['Ctrl/Cmd + O', t('sc.open')],
    ['Ctrl/Cmd + S', t('sc.save')],
    ['Ctrl/Cmd + K', t('sc.palette')],
    ['Ctrl/Cmd + F', t('sc.search')],
    ['Ctrl/Cmd + +', t('sc.zoomIn')],
    ['Ctrl/Cmd + -', t('sc.zoomOut')],
    ['Ctrl/Cmd + Z', t('action.undo')],
    ['Ctrl/Cmd + Shift + Z', t('action.redo')]
  ]

  return (
    <div className="view">
      <div className="page-head">
        <div>
          <h1>{t('settings.title')}</h1>
          <p>{t('settings.sub')}</p>
        </div>
      </div>

      <h2 className="section-title">{t('settings.appearance')}</h2>
      <Card>
        <div className="stack">
          <Field label={t('settings.theme')}>
            <Segmented
              value={settings.theme}
              onChange={(value) => void setSettings({ theme: value })}
              options={[
                { value: 'light', label: t('settings.theme.light'), icon: <Sun size={14} /> },
                { value: 'dark', label: t('settings.theme.dark'), icon: <Moon size={14} /> },
                { value: 'system', label: t('settings.theme.system'), icon: <SunMoon size={14} /> }
              ]}
            />
          </Field>

          <Field label={t('settings.accent')}>
            <div className="swatches">
              {ACCENTS.map((accent) => (
                <button
                  key={accent.id}
                  className={`swatch${settings.accent === accent.id ? ' active' : ''}`}
                  style={{ background: accent.color }}
                  onClick={() => void setSettings({ accent: accent.id })}
                  aria-label={accent.id}
                >
                  {settings.accent === accent.id ? (
                    <Check size={13} strokeWidth={3} color="#fff" />
                  ) : null}
                </button>
              ))}
            </div>
          </Field>

          <Field label={t('settings.language')}>
            <Segmented
              value={settings.language}
              onChange={(value) => void setSettings({ language: value })}
              options={[
                { value: 'ar', label: 'العربية' },
                { value: 'en', label: 'English' }
              ]}
            />
          </Field>

          <Field hint={t('settings.reduceMotionHint')}>
            <Switch
              checked={settings.reduceMotion}
              onChange={(checked) => void setSettings({ reduceMotion: checked })}
              label={t('settings.reduceMotion')}
            />
          </Field>

          <Field hint={t('settings.spellcheckHint')}>
            <Switch
              checked={settings.spellcheck}
              onChange={(checked) => void setSettings({ spellcheck: checked })}
              label={t('settings.spellcheck')}
            />
          </Field>
        </div>
      </Card>

      <h2 className="section-title">{t('settings.behavior')}</h2>
      <Card>
        <div className="stack">
          <Field label={t('settings.exportDir')} hint={t('settings.exportDirHint')}>
            <div className="row">
              <span className="grow truncate mono muted">
                {settings.defaultExportDir ?? '—'}
              </span>
              <Button
                onClick={async () => {
                  const directory = await window.alcode.dialog.directory()
                  if (directory) void setSettings({ defaultExportDir: directory })
                }}
              >
                <FolderOpen size={15} />
                {t('action.browse')}
              </Button>
            </div>
          </Field>

          <Switch
            checked={settings.rememberSession}
            onChange={(checked) => void setSettings({ rememberSession: checked })}
            label={t('settings.rememberSession')}
          />
        </div>
      </Card>

      <h2 className="section-title">{t('settings.shortcuts')}</h2>
      <Card pad={false}>
        {shortcuts.map(([keys, label]) => (
          <div className="list-row" key={keys}>
            <span className="grow">{label}</span>
            <span className="kbd">{keys}</span>
          </div>
        ))}
      </Card>

      <h2 className="section-title">{t('settings.about')}</h2>
      <Card>
        <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
          <span
            style={{
              width: 46,
              height: 46,
              borderRadius: 14,
              display: 'grid',
              placeItems: 'center',
              background: 'linear-gradient(140deg, var(--accent), var(--accent-strong))',
              color: '#fff',
              fontWeight: 800,
              fontSize: 20,
              flex: 'none'
            }}
          >
            A
          </span>
          <div className="grow">
            <div style={{ fontWeight: 700, fontSize: 'var(--text-md)' }}>Alcode Editor</div>
            <div className="muted" style={{ marginTop: 2 }}>
              {t('settings.aboutText')}
            </div>
            {info ? (
              <div className="row wrap" style={{ marginTop: 12, gap: 8 }}>
                <span className="badge">
                  {t('settings.version')} {info.version}
                </span>
                <span className="badge">
                  {t('settings.platform')} {info.platform} · {info.arch}
                </span>
                <span className="badge">
                  {t('settings.engine')} Electron {info.electron}
                </span>
                <span className="badge">Chromium {info.chrome}</span>
              </div>
            ) : null}
          </div>
          <Button
            variant="ghost"
            onClick={() => void window.alcode.shell.external('https://github.com')}
            title="Alcode"
          >
            <Github size={16} />
          </Button>
        </div>
      </Card>
    </div>
  )
}
