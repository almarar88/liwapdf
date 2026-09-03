import { useEffect, useRef, useState } from 'react'
import { Check, X, Type } from 'lucide-react'
import { useApp } from '../store/app'
import { Button } from './ui'
import type { Paragraph } from '../lib/pdf/paragraphs'

/**
 * Editing a PDF's text where it sits, rather than in a dialog beside it.
 *
 * The paragraphs the page is made of are drawn as clickable boxes over the
 * rendered canvas, positioned by the same viewport the canvas used. Clicking
 * one turns it into a text box at the paragraph's own size, direction and
 * alignment, so what the user types looks like what will be written back.
 * Applying hands the block to rewriteParagraph, which strikes the old text
 * from the file and sets the new one in its place.
 */

export interface TextEditLayerProps {
  paragraphs: Paragraph[]
  /** Page height in PDF points, to flip the y axis. */
  pageHeight: number
  /** Rendered pixels per PDF point. */
  scale: number
  busy: boolean
  onApply: (paragraph: Paragraph, text: string, color: string) => Promise<void>
}

export function TextEditLayer({ paragraphs, pageHeight, scale, busy, onApply }: TextEditLayerProps): React.JSX.Element {
  const t = useApp((state) => state.t)
  const [editing, setEditing] = useState<number | null>(null)
  const [text, setText] = useState('')
  const [color, setColor] = useState('#000000')
  const areaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing === null) return
    const area = areaRef.current
    if (!area) return
    area.focus()
    area.setSelectionRange(area.value.length, area.value.length)
  }, [editing])

  useEffect(() => {
    setEditing(null)
  }, [paragraphs])

  const box = (paragraph: Paragraph): React.CSSProperties => {
    const pad = paragraph.size * 0.3
    const top = (pageHeight - (paragraph.y + paragraph.height - paragraph.size + paragraph.size)) * scale
    return {
      left: (paragraph.x - 2) * scale,
      top: Math.max(0, top - pad * scale),
      width: (paragraph.width + 4) * scale,
      height: (paragraph.height + pad * 1.6) * scale
    }
  }

  return (
    <div className="text-edit-layer">
      {paragraphs.map((paragraph) => {
        const style = box(paragraph)
        if (editing === paragraph.id) {
          return (
            <div key={paragraph.id} className="te-editing" style={style}>
              <textarea
                ref={areaRef}
                className="te-input"
                dir={paragraph.rtl ? 'rtl' : 'ltr'}
                style={{
                  fontSize: Math.max(9, paragraph.size * scale * 0.92),
                  lineHeight: `${paragraph.leading * scale}px`,
                  textAlign: paragraph.rtl ? 'right' : 'left',
                  color
                }}
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    setEditing(null)
                  }
                  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault()
                    void onApply(paragraph, text, color).then(() => setEditing(null))
                  }
                }}
              />
              <div className="te-bar" onMouseDown={(event) => event.preventDefault()}>
                <span className="te-size" title={t('edit.size')}>
                  <Type size={13} />
                  {Math.round(paragraph.size)}
                </span>
                <input
                  className="te-color"
                  type="color"
                  value={color}
                  aria-label={t('opt.color')}
                  onChange={(event) => setColor(event.target.value)}
                />
                <Button
                  size="sm"
                  variant="primary"
                  disabled={busy || !text.trim() || text === paragraph.text}
                  onClick={() => void onApply(paragraph, text, color).then(() => setEditing(null))}
                >
                  <Check size={14} />
                  {t('action.apply')}
                </Button>
                <Button size="sm" variant="ghost" icon title={t('action.cancel')} onClick={() => setEditing(null)}>
                  <X size={14} />
                </Button>
              </div>
            </div>
          )
        }
        return (
          <button
            key={paragraph.id}
            className="te-box"
            style={style}
            title={t('edit.clickToEdit')}
            onClick={() => {
              setEditing(paragraph.id)
              setText(paragraph.text)
            }}
          />
        )
      })}
    </div>
  )
}
