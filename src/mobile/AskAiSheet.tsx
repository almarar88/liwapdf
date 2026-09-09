import { useEffect, useMemo, useState } from 'react'
import { AlignLeft, ListChecks, Scissors, Wand2, Table2, Copy, FileDown, ShieldCheck } from 'lucide-react'
import { useApp } from '../renderer/src/store/app'
import { Button, Field, Modal, Segmented } from '../renderer/src/components/ui'
import {
  summarize,
  shorten,
  simplify,
  keyPoints,
  extractFacts,
  readingStats
} from '../renderer/src/lib/text/intelligence'
import { tapFeedback } from './shell'

type Task = 'summary' | 'points' | 'short' | 'plain' | 'facts'

/**
 * Asking questions of the document without sending it anywhere.
 *
 * The honest version of this feature. Every answer is built from the
 * document's own sentences by code that runs on the phone — no model, no
 * account, no upload — which costs the ability to write new prose and buys
 * three things that matter more for a contract or a report: it works with the
 * plane in flight mode, it cannot invent a clause, and the file never leaves
 * the device. The banner at the bottom says so, because a user who has been
 * trained by every other app to expect an upload deserves to be told.
 */
export function AskAiSheet({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element {
  const t = useApp((state) => state.t)
  const doc = useApp((state) => state.doc)
  const editorDoc = useApp((state) => state.editorDoc)
  const notify = useApp((state) => state.notify)
  const openEditorDocument = useApp((state) => state.openEditorDocument)
  const navigate = useApp((state) => state.navigate)

  const [task, setTask] = useState<Task>('summary')
  const [source, setSource] = useState('')
  const [loading, setLoading] = useState(false)

  // The text is pulled once per sheet opening: a hundred-page PDF is seconds
  // of extraction, and re-doing it on every tab change would make the tabs
  // feel broken.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    const pull = async (): Promise<void> => {
      setLoading(true)
      try {
        if (editorDoc) {
          const text =
            editorDoc.source.kind === 'sheet'
              ? editorDoc.sheets
                  .flatMap((sheet) => sheet.rows.map((row) => row.map((cell) => cell.text).join('\t')))
                  .join('\n')
              : editorDoc.source.kind === 'code'
                ? editorDoc.text
                : editorDoc.html.replace(/<[^>]+>/g, ' ')
          if (!cancelled) setSource(text.replace(/\s+/g, ' ').trim())
          return
        }
        if (doc) {
          const { pdfToPlainText } = await import('../renderer/src/lib/convert')
          const text = await pdfToPlainText(doc.bytes, doc.password)
          // The extractor marks page breaks with "--- 3 ---" so a saved text
          // file keeps the pagination. They are not sentences, and left in
          // they turn up in the summary as though they were.
          if (!cancelled) setSource(text.replace(/^-{2,}\s*\d+\s*-{2,}$/gm, '').trim())
          return
        }
        if (!cancelled) setSource('')
      } catch (error) {
        if (!cancelled) {
          notify({ kind: 'error', title: t('msg.error'), message: String((error as Error)?.message ?? error) })
          setSource('')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void pull()
    return () => {
      cancelled = true
    }
  }, [open, doc, editorDoc, notify, t])

  const stats = useMemo(() => (source ? readingStats(source) : null), [source])

  const answer = useMemo(() => {
    if (!source) return ''
    if (task === 'summary') return summarize(source, { ratio: 0.25 })
    if (task === 'short') return shorten(source)
    if (task === 'plain') return simplify(source)
    if (task === 'points') return keyPoints(source, 7).map((point) => `• ${point}`).join('\n')
    const facts = extractFacts(source)
    const rows: string[] = []
    const add = (label: string, values: string[]): void => {
      if (values.length > 0) rows.push(`${label}: ${values.slice(0, 12).join('  ·  ')}`)
    }
    add(t('ai.facts.dates'), facts.dates)
    add(t('ai.facts.amounts'), facts.amounts)
    add(t('ai.facts.percentages'), facts.percentages)
    add(t('ai.facts.emails'), facts.emails)
    add(t('ai.facts.phones'), facts.phones)
    add(t('ai.facts.ibans'), facts.ibans)
    add(t('ai.facts.urls'), facts.urls)
    return rows.join('\n')
  }, [source, task, t])

  const tasks: { value: Task; label: string; icon: React.JSX.Element }[] = [
    { value: 'summary', label: t('ai.summarize'), icon: <AlignLeft size={14} /> },
    { value: 'points', label: t('ai.keyPoints'), icon: <ListChecks size={14} /> },
    { value: 'short', label: t('ai.shorten'), icon: <Scissors size={14} /> },
    { value: 'plain', label: t('ai.simplify'), icon: <Wand2 size={14} /> },
    { value: 'facts', label: t('ai.facts'), icon: <Table2 size={14} /> }
  ]

  return (
    <Modal open={open} onClose={onClose} title={t('phone.card.ai')}>
      <div className="stack">
        <div className="ai-tabs">
          <Segmented value={task} onChange={setTask} options={tasks} />
        </div>

        {loading ? (
          <p className="muted" style={{ margin: 0 }}>{t('msg.loading')}</p>
        ) : !source ? (
          <p className="muted" style={{ margin: 0 }}>{t('ai.needsText')}</p>
        ) : (
          <>
            {stats ? (
              <p className="muted" style={{ margin: 0, fontSize: 'var(--text-xs)' }}>
                {t('ai.stats', { words: stats.words, minutes: stats.minutes })}
              </p>
            ) : null}

            <Field label={t('ai.result')}>
              <div className="ai-answer" dir="auto">
                {answer || t('ai.nothing')}
              </div>
            </Field>

            <div className="row" style={{ gap: 8 }}>
              <Button
                disabled={!answer}
                onClick={() => {
                  tapFeedback()
                  void navigator.clipboard.writeText(answer)
                  notify({ kind: 'success', title: t('ai.copied') })
                }}
              >
                <Copy size={15} />
                {t('action.copy')}
              </Button>
              <Button
                variant="primary"
                disabled={!answer}
                onClick={() => {
                  const html = answer
                    .split('\n')
                    .map((line) => `<p>${escapeHtml(line)}</p>`)
                    .join('')
                  openEditorDocument({
                    name: `${t(TASK_TITLE[task])}.docx`,
                    path: null,
                    format: 'docx',
                    kind: 'rich',
                    html: html || '<p></p>',
                    direction: /[؀-ۿ]/.test(answer) ? 'rtl' : 'ltr',
                    warnings: [],
                    // Derived text, not a file that was read: there is no
                    // original to save back over.
                    originalBytes: new Uint8Array()
                  })
                  onClose()
                  navigate('editor')
                }}
              >
                <FileDown size={15} />
                {t('ai.openAsDocument')}
              </Button>
            </div>
          </>
        )}

        <p className="ai-privacy">
          <ShieldCheck size={14} />
          {t('ai.privacy')}
        </p>
      </div>
    </Modal>
  )
}

const TASK_TITLE: Record<Task, Parameters<ReturnType<typeof useApp.getState>['t']>[0]> = {
  summary: 'ai.summarize',
  points: 'ai.keyPoints',
  short: 'ai.shorten',
  plain: 'ai.simplify',
  facts: 'ai.facts'
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
