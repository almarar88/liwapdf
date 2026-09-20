import App from '../renderer/src/App'
import { usePhone } from '../renderer/src/hooks/usePhone'
import { PhoneHome } from './PhoneHome'
import { PhoneNav } from './PhoneNav'

/**
 * The phone app: a journal and a diwan.
 *
 * The shared App supplies the routes, the dialogs, the toasts and the
 * settings; the phone supplies its own home screen and a four-tab bar.
 * On a tablet the desktop sidebar takes over and the home screen is the
 * same one.
 */
export function MobileApp(): React.JSX.Element {
  const phone = usePhone()
  return (
    <>
      <App home={<PhoneHome />} />
      {phone ? <PhoneNav /> : null}
    </>
  )
}
