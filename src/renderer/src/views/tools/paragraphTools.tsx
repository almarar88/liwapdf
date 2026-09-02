import { useEffect, useState } from 'react'
import { AlignLeft, AlignRight } from 'lucide-react'
import { useApp } from '../../store/app'
import { Button, ColorInput, Field, TextArea, TextInput } from '../../components/ui'
import { useApplied, useRunner, type ToolPanelProps } from './shared'
import type { Paragraph } from '../../lib/pdf/paragraphs'

/**
 * Rewrite a paragraph in place: pick a page, pick one of its paragraphs,
 * type the new text, and the block is re-set at its own size and width.
 */
export function RewriteParagraphPanel({ onClose }: ToolPanelProps): React.JSX.Element {
  const t = useApp((state) => state.t)
  const doc = useApp((state) => state.doc)
  const currentPage = useApp((state) => state.currentPage)
  const notify = useApp((state) => state.notify)
  const applied = useApplied()
  const run = useRunner()
  const [pageText, setPageText] = useState(String(currentPage))
  const [paragraphs, setParagraphs] = useState<Paragraph[] | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [text, setText] = useState('')
  const [color, setColor] = useState('#000000')

  const pageCount = doc?.pageCount ?? 0
  const pageNumber = Math.min(Math.max(1, Number.parseInt(pageText, 10) || 1), Math.max(1, pageCount))

  useEffect(() => {
    if (!doc) return
    let cancelled = false
    setParagraphs(null)
    setSelected(null)
    void import('../../lib/pdf/paragraphs')
      .then(({ extractParagraphs }) => extractParagraphs(doc.bytes, pageNumber - 1, doc.password))
      .then((found) => {
        if (!cancelled) setParagraphs(found)
      })
      .catch(() => {
        if (!cancelled) setParagraphs([])
      })
    return () => {
      cancelled = true
    }
  }, [doc, pageNumber])

  if (!doc) return <p className="muted">{t('msg.noDocument')}</p>
  const paragraph = paragraphs?.find((item) => item.id === selected) ?? null

  return (
    <div className="stack">
      <p className="muted">{t('tool.rewriteParagraph.d')}</p>
      <Field label={t('rewrite.page')} hint={t('rewrite.pageHint', { n: pageCount })}>
        <TextInput value={pageText} onChange={setPageText} />
      </Field>

      <Field label={t('rewrite.pick')}>
        {paragraphs === null ? (
          <p className="muted">{t('msg.working')}</p>
        ) : paragraphs.length === 0 ? (
          <p className="muted">{t('rewrite.none')}</p>
        ) : (
          <div className="paragraph-list" role="listbox" aria-label={t('rewrite.pick')}>
            {paragraphs.map((item) => (
              <button
                key={item.id}
                role="option"
                aria-selected={selected === item.id}
                className={`paragraph-row${selected === item.id ? ' active' : ''}`}
                dir={item.rtl ? 'rtl' : 'ltr'}
                onClick={() => {
                  setSelected(item.id)
                  setText(item.text)
                }}
              >
                <span className="pr-icon">{item.rtl ? <AlignRight size={13} /> : <AlignLeft size={13} />}</span>
                <span className="pr-text">{excerpt(item.text)}</span>
                <span className="badge">{t('rewrite.lines', { n: item.lines.length })}</span>
              </button>
            ))}
          </div>
        )}
      </Field>

      {paragraph ? (
        <>
          <Field label={t('rewrite.text')} hint={t('rewrite.textHint', { size: Math.round(paragraph.size) })}>
            <TextArea value={text} onChange={setText} rows={Math.min(10, Math.max(4, paragraph.lines.length + 1))} />
          </Field>
          <Field label={t('opt.color')}>
            <ColorInput value={color} onChange={setColor} />
          </Field>
          <Button
            variant="primary"
            disabled={!text.trim() || text === paragraph.text}
            onClick={() =>
              void run(t('msg.working'), async () => {
                const { rewriteParagraph } = await import('../../lib/pdf/paragraphs')
                const result = await rewriteParagraph(doc.bytes, { paragraph, text, color, password: doc.password })
                await applied(result.bytes, 'tool.rewriteParagraph')
                const notes = [
                  result.overflowed ? t('rewrite.overflow') : '',
                  result.size < paragraph.size ? t('rewrite.shrunk', { size: Math.round(result.size) }) : '',
                  result.covered > 0 ? t('replace.covered', { n: result.covered }) : ''
                ].filter(Boolean)
                if (notes.length > 0) notify({ kind: 'info', title: t('rewrite.done'), message: notes.join(' · ') })
                onClose()
              })
            }
          >
            {t('action.apply')}
          </Button>
        </>
      ) : null}
    </div>
  )
}

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > 90 ? `${flat.slice(0, 88)}…` : flat
}
