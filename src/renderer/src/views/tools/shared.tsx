import { useCallback, useState } from 'react'
import { useApp } from '../../store/app'
import { Field, TextInput } from '../../components/ui'
import type { Anchor } from '../../lib/pdf/ops'
import { parsePageRange } from '../../lib/format'
import type { TranslationKey } from '../../i18n'

export interface ToolPanelProps {
  onClose: () => void
}

/**
 * Wraps a tool action with the busy veil, error reporting and a success toast.
 *
 * The action is handed an AbortSignal. A Cancel button appears on the veil
 * only when the caller passes `cancellable`, so the button is never offered
 * for work that would ignore it.
 */
export function useRunner(): (
  label: string,
  action: (
    report: (done: number, total: number) => void,
    signal: AbortSignal
  ) => Promise<string | void>,
  options?: { cancellable?: boolean }
) => Promise<void> {
  const store = useApp
  return useCallback(
    async (label, action, options) => {
      const state = store.getState()
      const controller = new AbortController()
      const cancel = options?.cancellable ? (): void => controller.abort() : undefined
      state.setBusy({ label, progress: null, cancel })
      try {
        const message = await action((done, total) => {
          store.getState().setBusy({
            label,
            progress: total > 0 ? done / total : null,
            cancel
          })
        }, controller.signal)
        store.getState().setBusy(null)
        // A cancelled job is not a failure and not a success; it just stops.
        if (controller.signal.aborted) return
        if (message !== undefined) {
          store.getState().notify({
            kind: 'success',
            title: store.getState().t('msg.exported'),
            message: message || undefined
          })
        }
      } catch (error) {
        if (!controller.signal.aborted) store.getState().reportError(error)
      } finally {
        store.getState().setBusy(null)
      }
    },
    [store]
  )
}

export function useDoc(): NonNullable<ReturnType<typeof useApp.getState>['doc']> | null {
  return useApp((state) => state.doc)
}

export function RangeField({
  value,
  onChange
}: {
  value: string
  onChange: (value: string) => void
}): React.JSX.Element {
  const t = useApp((state) => state.t)
  return (
    <Field label={t('opt.range')} hint={t('opt.rangeHint')}>
      <TextInput value={value} onChange={onChange} placeholder="1-3, 5, 8-10" />
    </Field>
  )
}

export function resolveRange(expression: string, pageCount: number): number[] {
  const indices = parsePageRange(expression, pageCount)
  if (indices.length === 0) throw new Error('no-pages-selected')
  return indices
}

const ANCHORS: Anchor[][] = [
  ['topLeft', 'topCenter', 'topRight'],
  ['middleLeft', 'center', 'middleRight'],
  ['bottomLeft', 'bottomCenter', 'bottomRight']
]

const ANCHOR_LABELS: Record<Anchor, TranslationKey> = {
  topLeft: 'opt.pos.topLeft',
  topCenter: 'opt.pos.topCenter',
  topRight: 'opt.pos.topRight',
  middleLeft: 'opt.pos.middleLeft',
  center: 'opt.pos.center',
  middleRight: 'opt.pos.middleRight',
  bottomLeft: 'opt.pos.bottomLeft',
  bottomCenter: 'opt.pos.bottomCenter',
  bottomRight: 'opt.pos.bottomRight'
}

export function AnchorPicker({
  value,
  onChange
}: {
  value: Anchor
  onChange: (value: Anchor) => void
}): React.JSX.Element {
  const t = useApp((state) => state.t)
  return (
    <Field label={t('opt.position')}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 4,
          width: 120,
          padding: 4,
          borderRadius: 'var(--r-sm)',
          background: 'var(--surface-sunken)',
          border: '1px solid var(--hairline-soft)'
        }}
      >
        {ANCHORS.flat().map((anchor) => (
          <button
            key={anchor}
            title={t(ANCHOR_LABELS[anchor])}
            onClick={() => onChange(anchor)}
            style={{
              height: 26,
              borderRadius: 6,
              background: value === anchor ? 'var(--accent)' : 'var(--surface-solid)',
              border: '1px solid var(--hairline-soft)',
              transition: 'background 140ms var(--ease-out)'
            }}
          />
        ))}
      </div>
    </Field>
  )
}

export function useLocalState<T extends object>(initial: T): [T, (patch: Partial<T>) => void] {
  const [state, setState] = useState<T>(initial)
  return [state, (patch) => setState((current) => ({ ...current, ...patch }))]
}

export const PAGE_SIZE_OPTIONS = ['A4', 'A3', 'A5', 'Letter', 'Legal', 'Tabloid'] as const
export type PageSizeName = (typeof PAGE_SIZE_OPTIONS)[number] | 'custom' | 'keep'
