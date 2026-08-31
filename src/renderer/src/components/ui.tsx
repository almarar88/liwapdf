import { AnimatePresence, motion } from 'framer-motion'
import {
  ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties
} from 'react'
import { Check, X, AlertCircle, Info, CheckCircle2, Loader2 } from 'lucide-react'
import { useApp } from '../store/app'
import { formatBytes } from '../lib/format'

/* ------------------------------------------------------------------ button */

interface ButtonProps {
  children?: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  icon?: boolean
  block?: boolean
  disabled?: boolean
  title?: string
  ghostDanger?: boolean
  type?: 'button' | 'submit'
}

export function Button({
  children,
  onClick,
  variant = 'secondary',
  size = 'md',
  icon,
  block,
  disabled,
  title,
  ghostDanger,
  type = 'button'
}: ButtonProps): React.JSX.Element {
  const classes = [
    'btn',
    variant,
    ghostDanger ? 'ghost' : '',
    size === 'sm' ? 'sm' : size === 'lg' ? 'lg' : '',
    icon ? 'icon' : '',
    block ? 'block' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button className={classes} onClick={onClick} disabled={disabled} title={title} type={type}>
      {children}
    </button>
  )
}

/* ------------------------------------------------------------- form fields */

export function Field({
  label,
  hint,
  children
}: {
  label?: string
  hint?: string
  children: ReactNode
}): React.JSX.Element {
  return (
    <div className="field">
      {label ? <label>{label}</label> : null}
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  )
}

export function TextInput({
  value,
  onChange,
  placeholder,
  type = 'text',
  min,
  max,
  step,
  autoFocus,
  onEnter
}: {
  value: string | number
  onChange: (value: string) => void
  placeholder?: string
  type?: string
  min?: number
  max?: number
  step?: number
  autoFocus?: boolean
  onEnter?: () => void
}): React.JSX.Element {
  return (
    <input
      className="input"
      value={value}
      type={type}
      min={min}
      max={max}
      step={step}
      autoFocus={autoFocus}
      placeholder={placeholder}
      onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && onEnter) onEnter()
      }}
    />
  )
}

export function TextArea({
  value,
  onChange,
  placeholder,
  rows = 4
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  rows?: number
}): React.JSX.Element {
  return (
    <textarea
      className="textarea"
      value={value}
      rows={rows}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

export function Select<T extends string>({
  value,
  onChange,
  options
}: {
  value: T
  onChange: (value: T) => void
  options: { value: T; label: string }[]
}): React.JSX.Element {
  return (
    <select className="select" value={value} onChange={(event) => onChange(event.target.value as T)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

export function Switch({
  checked,
  onChange,
  label
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
}): React.JSX.Element {
  const id = useId()
  return (
    <div className="row" style={{ gap: 10 }}>
      <button
        id={id}
        role="switch"
        aria-checked={checked}
        className={`switch${checked ? ' on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span className="knob" />
      </button>
      {label ? (
        <label htmlFor={id} style={{ cursor: 'pointer' }}>
          {label}
        </label>
      ) : null}
    </div>
  )
}

export function Slider({
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix
}: {
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  step?: number
  suffix?: string
}): React.JSX.Element {
  return (
    <div className="row">
      <input
        className="slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="mono muted" style={{ minWidth: 52, textAlign: 'end' }}>
        {value}
        {suffix ?? ''}
      </span>
    </div>
  )
}

export function ColorInput({
  value,
  onChange
}: {
  value: string
  onChange: (value: string) => void
}): React.JSX.Element {
  return (
    <div className="row" style={{ gap: 8 }}>
      <input
        type="color"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={{
          width: 34,
          height: 34,
          padding: 2,
          border: '1px solid var(--hairline)',
          borderRadius: 'var(--r-sm)',
          background: 'var(--surface-solid)',
          cursor: 'pointer'
        }}
      />
      <input
        className="input mono"
        dir="ltr"
        style={{ flex: 1 }}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  onChange,
  options
}: {
  value: T
  onChange: (value: T) => void
  options: { value: T; label: string; icon?: ReactNode }[]
}): React.JSX.Element {
  const groupId = useId()
  return (
    <div className="segmented">
      {options.map((option) => (
        <button
          key={option.value}
          className={option.value === value ? 'active' : ''}
          onClick={() => onChange(option.value)}
        >
          {option.value === value ? (
            <motion.span layoutId={`seg-${groupId}`} className="thumb" transition={SPRING} />
          ) : null}
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  )
}

export const SPRING = { type: 'spring', stiffness: 420, damping: 34, mass: 0.7 } as const

/* ------------------------------------------------------------------ modal */

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}): React.JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null)
  const returnFocusTo = useRef<HTMLElement | null>(null)
  const headingId = useId()

  /**
   * A dialog has to hold focus while it is open: without this, tabbing out of
   * a tool panel lands on the tiles behind the scrim, which are still clickable
   * to a screen reader and invisible to everyone else.
   */
  useEffect(() => {
    if (!open) return undefined
    returnFocusTo.current = document.activeElement as HTMLElement | null

    const focusables = (): HTMLElement[] =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      ).filter((element) => element.offsetParent !== null || element === document.activeElement)

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) {
        event.preventDefault()
        panelRef.current?.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (!panelRef.current?.contains(active)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      } else if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    const timer = window.setTimeout(() => {
      const items = focusables()
      ;(items[0] ?? panelRef.current)?.focus()
    }, 40)

    window.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('keydown', onKey)
      returnFocusTo.current?.focus?.()
    }
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose()
          }}
        >
          <motion.div
            ref={panelRef}
            className={`modal${wide ? ' wide' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby={headingId}
            tabIndex={-1}
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={SPRING}
          >
            <div className="modal-head">
              <h2 id={headingId}>{title}</h2>
              <button className="btn ghost icon sm close" onClick={onClose} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <div className="modal-body">{children}</div>
            {footer ? <div className="modal-foot">{footer}</div> : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

/* --------------------------------------------------------------- dropzone */

export function Dropzone({
  onFiles,
  title,
  subtitle,
  icon,
  accept
}: {
  onFiles: (paths: string[]) => void
  title: string
  subtitle: string
  icon: ReactNode
  accept?: string[]
}): React.JSX.Element {
  const [over, setOver] = useState(false)

  return (
    <div
      className={`dropzone${over ? ' over' : ''}`}
      onDragOver={(event) => {
        event.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault()
        setOver(false)
        const paths = Array.from(event.dataTransfer.files)
          .map((file) => {
            try {
              return window.alcode.pathForFile(file)
            } catch {
              // Not a real file on disk (dragged text, a URL, a browser image).
              return ''
            }
          })
          .filter((path): path is string => Boolean(path))
          .filter((path) => !accept || accept.some((ext) => path.toLowerCase().endsWith(ext)))
        if (paths.length > 0) onFiles(paths)
      }}
    >
      <div className="dz-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{subtitle}</p>
    </div>
  )
}

/* ---------------------------------------------------------------- feedback */

export function Toasts(): React.JSX.Element {
  const toasts = useApp((state) => state.toasts)
  const dismiss = useApp((state) => state.dismissToast)

  return (
    <div className="toasts">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            className={`toast ${toast.kind}`}
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24, scale: 0.96 }}
            transition={SPRING}
          >
            <span className="t-icon">
              {toast.kind === 'success' ? (
                <CheckCircle2 size={17} />
              ) : toast.kind === 'error' ? (
                <AlertCircle size={17} />
              ) : (
                <Info size={17} />
              )}
            </span>
            <div className="t-body">
              <div className="t-title">{toast.title}</div>
              {/* Toast messages are usually file paths, which must not be
                  reordered by the surrounding Arabic. */}
              {toast.message ? (
                <div className="t-msg">
                  <bdi>{toast.message}</bdi>
                </div>
              ) : null}
              {toast.action ? (
                <div style={{ marginTop: 8 }}>
                  <Button size="sm" onClick={toast.action.run}>
                    {toast.action.label}
                  </Button>
                </div>
              ) : null}
            </div>
            <button className="btn ghost icon sm" onClick={() => dismiss(toast.id)}>
              <X size={14} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

export function BusyVeil(): React.JSX.Element | null {
  const busy = useApp((state) => state.busy)
  if (!busy) return null
  return (
    <motion.div
      className="busy-veil"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.14 }}
    >
      <Loader2 size={26} className="spin" style={{ animation: 'spin 900ms linear infinite' }} />
      <div style={{ fontWeight: 600 }}>{busy.label}</div>
      {busy.progress !== null ? (
        <div style={{ width: 220 }}>
          <div className="progress">
            <div className="bar" style={{ width: `${Math.round(busy.progress * 100)}%` }} />
          </div>
        </div>
      ) : null}
      {busy.cancel ? <CancelBusyButton onCancel={busy.cancel} /> : null}
    </motion.div>
  )
}

/** The stop button on the busy veil, once the job has said it can be stopped. */
function CancelBusyButton({ onCancel }: { onCancel: () => void }): React.JSX.Element {
  const t = useApp((state) => state.t)
  const [stopping, setStopping] = useState(false)
  return (
    <Button
      size="sm"
      disabled={stopping}
      onClick={() => {
        setStopping(true)
        onCancel()
      }}
    >
      {stopping ? t('action.stopping') : t('action.cancel')}
    </Button>
  )
}

export function Empty({
  icon,
  title,
  subtitle,
  action
}: {
  icon: ReactNode
  title: string
  subtitle?: string
  action?: ReactNode
}): React.JSX.Element {
  return (
    <div className="empty">
      <div className="e-icon">{icon}</div>
      <h3>{title}</h3>
      {subtitle ? <p style={{ margin: 0, maxWidth: '46ch' }}>{subtitle}</p> : null}
      {action}
    </div>
  )
}

export function Checkbox({
  checked,
  onChange,
  label
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}): React.JSX.Element {
  return (
    <button
      className="row"
      style={{ gap: 9, padding: '4px 0' }}
      onClick={() => onChange(!checked)}
      role="checkbox"
      aria-checked={checked}
    >
      <span
        style={{
          width: 18,
          height: 18,
          borderRadius: 5,
          display: 'grid',
          placeItems: 'center',
          border: `1.5px solid ${checked ? 'var(--accent)' : 'var(--hairline)'}`,
          background: checked ? 'var(--accent)' : 'transparent',
          color: '#fff',
          flex: 'none',
          transition: 'all 140ms var(--ease-out)'
        }}
      >
        {checked ? <Check size={12} strokeWidth={3} /> : null}
      </span>
      <span style={{ fontSize: 'var(--text-base)' }}>{label}</span>
    </button>
  )
}

export function Card({
  children,
  style,
  pad = true
}: {
  children: ReactNode
  style?: CSSProperties
  pad?: boolean
}): React.JSX.Element {
  return (
    <div className={`card${pad ? ' card-pad' : ''}`} style={style}>
      {children}
    </div>
  )
}

/**
 * Renders a byte size as an isolated LTR run. Without this, "328 B" reorders
 * to "B 328" inside the Arabic (RTL) interface.
 */
export function Bytes({ value }: { value: number }): React.JSX.Element {
  return <span dir="ltr">{formatBytes(value)}</span>
}

/** Tracks the pointer so the tool tiles can light up under the cursor. */
export function useSpotlight(): { onMouseMove: (event: React.MouseEvent<HTMLElement>) => void } {
  const frame = useRef(0)
  return {
    onMouseMove: (event) => {
      const element = event.currentTarget
      cancelAnimationFrame(frame.current)
      const rect = element.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      frame.current = requestAnimationFrame(() => {
        element.style.setProperty('--mx', `${x}px`)
        element.style.setProperty('--my', `${y}px`)
      })
    }
  }
}
