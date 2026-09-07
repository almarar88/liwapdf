import { App as CapacitorApp } from '@capacitor/app'
import { Haptics, ImpactStyle } from '@capacitor/haptics'
import { StatusBar, Style } from '@capacitor/status-bar'
import { useApp } from '../renderer/src/store/app'

/**
 * The part of a phone app that has no desktop equivalent: the hardware back
 * button, the status bar, and the fact that a finger is not a mouse.
 *
 * The root gets `data-mobile`, which is what the stylesheet keys the phone
 * and tablet layouts off. Everything else here is behaviour the platform
 * expects: back closes what is open before it leaves the app, the status bar
 * follows the theme, and a tap on something consequential is felt.
 */

export function startMobileShell(): void {
  document.documentElement.dataset.mobile = 'true'
  document.documentElement.dataset.touch = 'true'

  applyStatusBar()
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyStatusBar)

  // Back should retreat through the app, not out of it: a sheet, then a
  // dialog, then the viewer, and only from the home screen does it exit.
  void CapacitorApp.addListener('backButton', ({ canGoBack }) => {
    // `.modal .btn.close` is the dialog's own close control — the shared Modal
    // renders exactly one, and pressing it runs the same onClose the scrim
    // does, so a sheet unwinds its state instead of being torn off screen.
    const closer = document.querySelector<HTMLElement>(
      '[data-mobile-dismiss], .modal .btn.close'
    )
    if (closer) {
      closer.click()
      return
    }
    const back = document.querySelector<HTMLElement>('[data-mobile-back]')
    if (back) {
      back.click()
      return
    }
    // Anywhere but the home screen, back means "up one level" — leaving the
    // app from the middle of a document is not what the gesture promises.
    const app = useApp.getState()
    if (app.route !== 'home') {
      app.navigate('home')
      return
    }
    if (canGoBack) {
      window.history.back()
      return
    }
    void CapacitorApp.exitApp()
  })
}

function applyStatusBar(): void {
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
  void StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => undefined)
  void StatusBar.setOverlaysWebView({ overlay: false }).catch(() => undefined)
  void StatusBar.setBackgroundColor({ color: dark ? '#0f1116' : '#f6f7fb' }).catch(() => undefined)
}

/** A short tap for a completed action; silently ignored where unsupported. */
export function tapFeedback(style: 'light' | 'medium' = 'light'): void {
  void Haptics.impact({ style: style === 'medium' ? ImpactStyle.Medium : ImpactStyle.Light }).catch(
    () => undefined
  )
}
