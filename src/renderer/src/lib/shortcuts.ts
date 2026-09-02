import type { TranslationKey } from '../i18n'

/**
 * The keyboard shortcuts the app answers to, in one place: the settings page
 * and the Ctrl+/ sheet both read this list, so neither can drift from the
 * other.
 */
export const SHORTCUTS: { keys: string; labelKey: TranslationKey }[] = [
  { keys: 'Ctrl/Cmd + O', labelKey: 'sc.open' },
  { keys: 'Ctrl/Cmd + S', labelKey: 'sc.save' },
  { keys: 'Ctrl/Cmd + K', labelKey: 'sc.palette' },
  { keys: 'Ctrl/Cmd + /', labelKey: 'sc.help' },
  { keys: 'Ctrl/Cmd + F', labelKey: 'sc.search' },
  { keys: 'Ctrl/Cmd + +', labelKey: 'sc.zoomIn' },
  { keys: 'Ctrl/Cmd + -', labelKey: 'sc.zoomOut' },
  { keys: 'Ctrl/Cmd + Z', labelKey: 'action.undo' },
  { keys: 'Ctrl/Cmd + Shift + Z', labelKey: 'action.redo' }
]
