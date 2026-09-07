import { useEffect, useState } from 'react'

/**
 * True while the app is running as a phone, false everywhere else.
 *
 * Two things have to be true at once: the shell installed the mobile bridge
 * (so this is the Android build, not a narrow desktop window), and the screen
 * is phone-sized rather than a tablet's. Layout that only differs by width is
 * CSS's job — this hook exists for the places where a phone needs different
 * *behaviour*: a thumbnail rail that starts closed instead of open, a toolbar
 * whose overflow lives in a sheet, a page fitted to the glass rather than to
 * a desktop's generous margin.
 */
export function usePhone(): boolean {
  const [phone, setPhone] = useState(isPhone)

  useEffect(() => {
    const media = window.matchMedia(PHONE_WIDTH)
    const update = (): void => setPhone(isPhone())
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  return phone
}

const PHONE_WIDTH = '(max-width: 767px)'

function isPhone(): boolean {
  if (typeof document === 'undefined') return false
  return (
    document.documentElement.dataset.mobile === 'true' && window.matchMedia(PHONE_WIDTH).matches
  )
}
