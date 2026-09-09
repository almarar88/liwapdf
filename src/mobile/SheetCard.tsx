import { tapFeedback } from './shell'

/**
 * The card the whole phone interface is built from.
 *
 * One shape, one target size, one place the icon sits — used for the four on
 * the home screen and for every entry inside a sheet, so a user who has learnt
 * the home screen has already learnt the rest of the app. The tone is the only
 * thing that varies, and it varies to group rather than to decorate.
 */
export type CardTone = 'plain' | 'yellow' | 'green' | 'orange' | 'blue' | 'violet'

export interface SheetEntry {
  key: string
  icon: React.JSX.Element
  title: string
  detail?: string
  tone?: CardTone
  disabled?: boolean
  run: () => void
}

export function SheetCards({ entries }: { entries: SheetEntry[] }): React.JSX.Element {
  return (
    <div className="sheet-cards">
      {entries.map((entry) => (
        <button
          key={entry.key}
          className={`sheet-card tone-${entry.tone ?? 'plain'}`}
          disabled={entry.disabled}
          onClick={() => {
            tapFeedback()
            entry.run()
          }}
        >
          <span className="sheet-card-icon">{entry.icon}</span>
          <b>{entry.title}</b>
          {entry.detail ? <span>{entry.detail}</span> : null}
        </button>
      ))}
    </div>
  )
}
