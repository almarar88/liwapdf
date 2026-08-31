import { useState } from 'react'
import { EyeOff, FileDown, Search } from 'lucide-react'
import { useApp } from '../../store/app'
import { Button, Checkbox, Field, TextInput } from '../../components/ui'
import { findTextRegions, applyRedactions, type TextMatch } from '../../lib/pdf/redact'
import { saveText } from '../../lib/files'
import { documentBaseName } from '../../hooks/useDocumentActions'
import { ltr } from '../../lib/format'
import { useRunner, type ToolPanelProps } from './shared'
import type { TranslationKey } from '../../i18n'

/**
 * Patterns for the things people actually redact.
 *
 * Each is deliberately a little loose: a hit the user rejects in the list costs
 * one click, a miss costs a leaked identifier. The list is reviewed before
 * anything is destroyed, so recall is worth more than precision here.
 */
/**
 * How many hits get a row of their own.
 *
 * A query that matches on four hundred pages is the normal case, and every
 * row is a checkbox plus two lines of context — past a few hundred the modal
 * becomes slower to open than the redaction takes to run. The rest are still
 * selected and still redacted; the panel says so rather than quietly dropping
 * them, and the exported list has every one.
 */
const LIST_LIMIT = 300

const PRESETS: { id: string; labelKey: TranslationKey; pattern: string }[] = [
  {
    id: 'email',
    labelKey: 'redact.preset.email',
    pattern: "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}"
  },
  {
    id: 'phone',
    labelKey: 'redact.preset.phone',
    pattern: "(?:\\+|00)?[0-9\\u0660-\\u0669][0-9\\u0660-\\u0669 ()-]{7,}[0-9\\u0660-\\u0669]"
  },
  {
    id: 'iban',
    labelKey: 'redact.preset.iban',
    pattern: "[A-Z]{2}[0-9]{2}(?:[ ]?[A-Za-z0-9]{4}){2,7}[A-Za-z0-9]{0,4}"
  },
  {
    id: 'nationalId',
    labelKey: 'redact.preset.nationalId',
    pattern: "(?<![0-9\\u0660-\\u0669])[12\\u0661\\u0662][0-9\\u0660-\\u0669]{9}(?![0-9\\u0660-\\u0669])"
  },
  {
    id: 'card',
    labelKey: 'redact.preset.card',
    pattern: "(?<![0-9])(?:[0-9]{4}[ -]?){3}[0-9]{4}(?![0-9])"
  },
  {
    id: 'date',
    labelKey: 'redact.preset.date',
    pattern: "[0-9\\u0660-\\u0669]{1,4}[/\\u002D.][0-9\\u0660-\\u0669]{1,2}[/\\u002D.][0-9\\u0660-\\u0669]{2,4}"
  }
]

/**
 * Search-and-redact: find every occurrence of something, review the list, then
 * destroy it everywhere at once.
 *
 * Drawing a box per instance — the only way redaction worked before — is fine
 * for one signature and unusable for an ID number that appears on four hundred
 * pages, which is the case redaction is actually for. Nothing is removed until
 * the hits have been shown with their surrounding words, because a regex that
 * over-matches would otherwise quietly delete a paragraph.
 */
export function RedactPanel({ onClose }: ToolPanelProps): React.JSX.Element {
  const t = useApp((state) => state.t)
  const doc = useApp((state) => state.doc)
  const applyPdfBytes = useApp((state) => state.applyPdfBytes)
  const notify = useApp((state) => state.notify)
  const run = useRunner()

  const [query, setQuery] = useState('')
  const [regex, setRegex] = useState(false)
  const [matches, setMatches] = useState<TextMatch[] | null>(null)
  const [chosen, setChosen] = useState<Set<number>>(new Set())

  if (!doc) return <p className="muted">{t('msg.noDocument')}</p>

  const usePreset = (pattern: string): void => {
    setQuery(pattern)
    setRegex(true)
    setMatches(null)
    setChosen(new Set())
  }

  const find = (): Promise<void> =>
    run(t('redact.searching'), async () => {
      const found = await findTextRegions(doc.bytes, query, {
        regex,
        password: doc.password,
        limit: 2000
      })
      setMatches(found)
      setChosen(new Set(found.map((_, index) => index)))
      if (found.length === 0) notify({ kind: 'info', title: t('redact.noHits') })
    })

  const apply = (): Promise<void> =>
    run(
      t('msg.redacting'),
      async (report) => {
        const picked = (matches ?? []).filter((_, index) => chosen.has(index))
        if (picked.length === 0) return
        const result = await applyRedactions(
          doc.bytes,
          picked.map((match) => match.region),
          doc.password,
          (fraction) => report(fraction, 1)
        )
        await applyPdfBytes(result.bytes)
        setMatches(null)
        setChosen(new Set())

        const flattened =
          result.rasterizedPages.length > 0
            ? ' ' +
              t('msg.redactedFlattened').replace(
                '{pages}',
                result.rasterizedPages.map((index) => index + 1).join(', ')
              )
            : ''
        notify({
          kind: result.verified ? 'success' : 'info',
          title: t(result.verified ? 'msg.redacted' : 'redact.unverified'),
          message:
            t('msg.redactedDetail')
              .replace('{runs}', String(result.removedRuns))
              .replace('{annots}', String(result.removedAnnotations)) +
            (result.verified ? ` ${t('redact.reportVerified')}` : '') +
            flattened,
          action: {
            label: t('redact.saveReport'),
            run: () => {
              void saveText(
                reportText(t, doc.name, picked, result),
                `${documentBaseName(doc.name)}-redaction.txt`,
                [{ name: 'file.text', extensions: ['txt'] }]
              )
            }
          }
        })
        onClose()
      },
      { cancellable: false }
    )

  const toggle = (index: number): void =>
    setChosen((current) => {
      const next = new Set(current)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })

  const pageCounts = new Map<number, number>()
  for (const match of matches ?? [])
    pageCounts.set(match.pageIndex, (pageCounts.get(match.pageIndex) ?? 0) + 1)

  return (
    <div className="stack">
      <p className="muted">{t('tool.redact.d')}</p>

      <Field label={t('redact.query')} hint={t('redact.queryHint')}>
        <TextInput
          value={query}
          onChange={(value) => {
            setQuery(value)
            setMatches(null)
          }}
          placeholder={t('redact.placeholder')}
        />
      </Field>

      <Checkbox
        checked={regex}
        onChange={(value) => {
          setRegex(value)
          setMatches(null)
        }}
        label={t('redact.regex')}
      />

      <Field label={t('redact.presets')}>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {PRESETS.map((preset) => (
            <Button key={preset.id} size="sm" variant="ghost" onClick={() => usePreset(preset.pattern)}>
              {t(preset.labelKey)}
            </Button>
          ))}
        </div>
      </Field>

      <div className="row" style={{ gap: 8 }}>
        <Button variant="secondary" onClick={() => void find()} disabled={query.trim().length === 0}>
          <Search size={15} />
          {t('redact.find')}
        </Button>
        {matches && matches.length > 0 ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => setChosen(new Set(matches.map((_, index) => index)))}>
              {t('redact.selectAll')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setChosen(new Set())}>
              {t('redact.selectNone')}
            </Button>
          </>
        ) : null}
      </div>

      {matches && matches.length > 0 ? (
        <>
          <p className="hint">
            {t('redact.summary')
              .replace('{hits}', String(matches.length))
              .replace('{pages}', String(pageCounts.size))}
          </p>
          <div
            className="stack"
            style={{
              gap: 2,
              maxHeight: 260,
              overflowY: 'auto',
              padding: 6,
              borderRadius: 'var(--r-sm)',
              background: 'var(--surface-sunken)',
              border: '1px solid var(--hairline-soft)'
            }}
          >
            {matches.slice(0, LIST_LIMIT).map((match, index) => (
              <label
                key={`${match.pageIndex}-${index}`}
                className="row"
                style={{ gap: 8, alignItems: 'flex-start', padding: '4px 2px', cursor: 'pointer' }}
              >
                <input
                  type="checkbox"
                  checked={chosen.has(index)}
                  onChange={() => toggle(index)}
                  style={{ marginTop: 3 }}
                />
                <span style={{ minWidth: 0 }}>
                  <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
                    {ltr(`${t('msg.pages')} ${match.pageIndex + 1}`)}
                  </span>
                  <br />
                  <span style={{ fontSize: 'var(--text-sm)' }}>{match.context || match.text}</span>
                </span>
              </label>
            ))}
          </div>
          {matches.length > LIST_LIMIT ? (
            <p className="hint">
              {t('redact.listCapped').replace('{n}', String(matches.length - LIST_LIMIT))}
            </p>
          ) : null}
        </>
      ) : null}

      <p className="hint">{t('annotate.redactHint')}</p>

      <Button variant="primary" onClick={() => void apply()} disabled={chosen.size === 0}>
        <EyeOff size={15} />
        {t('redact.apply').replace('{n}', String(chosen.size))}
      </Button>

      {matches && matches.length > 0 ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            void saveText(
              previewText(t, doc.name, (matches ?? []).filter((_, index) => chosen.has(index))),
              `${documentBaseName(doc.name)}-redaction-preview.txt`,
              [{ name: 'file.text', extensions: ['txt'] }]
            )
          }}
        >
          <FileDown size={15} />
          {t('redact.exportList')}
        </Button>
      ) : null}
    </div>
  )
}

type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string

/** The list of hits, before anything has been destroyed. */
function previewText(t: Translate, name: string, matches: TextMatch[]): string {
  const lines = [t('redact.reportTitle'), name, '', ...matches.map(describe)]
  return lines.join('\n')
}

/**
 * A record of what was destroyed.
 *
 * Redaction is irreversible by design, so the one thing the user cannot get
 * back afterwards is the answer to "what did it take out?". This writes that
 * down — including, honestly, the pages that had to be flattened to an image.
 */
function reportText(
  t: Translate,
  name: string,
  matches: TextMatch[],
  result: { removedRuns: number; removedAnnotations: number; rasterizedPages: number[]; verified: boolean }
): string {
  const lines = [
    t('redact.reportTitle'),
    name,
    '',
    t('msg.redactedDetail')
      .replace('{runs}', String(result.removedRuns))
      .replace('{annots}', String(result.removedAnnotations)),
    result.verified ? t('redact.reportVerified') : t('redact.unverified')
  ]
  if (result.rasterizedPages.length > 0) {
    lines.push(
      t('msg.redactedFlattened').replace(
        '{pages}',
        result.rasterizedPages.map((index) => index + 1).join(', ')
      )
    )
  }
  lines.push('', ...matches.map(describe))
  return lines.join('\n')
}

function describe(match: TextMatch): string {
  return `- [${match.pageIndex + 1}] ${match.text.replace(/\s+/g, ' ').trim()}`
}
