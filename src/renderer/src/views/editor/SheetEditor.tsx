import { useMemo, useState } from 'react'
import {
  ArrowDownAZ,
  ArrowUpAZ,
  Columns3,
  Plus,
  Rows3,
  Trash2
} from 'lucide-react'
import { useApp } from '../../store/app'
import { Button } from '../../components/ui'
import { columnLabel, trimGrid, type SheetData } from '../../lib/documents/sheets'

interface SheetEditorProps {
  sheets: SheetData[]
  activeSheet: number
  direction: 'rtl' | 'ltr'
  zoom: number
  onChange: (sheets: SheetData[]) => void
  onActiveSheetChange: (index: number) => void
}

interface CellRef {
  row: number
  column: number
}

/**
 * A spreadsheet grid built on plain inputs.
 *
 * Values are strings throughout — the point is faithful editing and export,
 * not a formula engine — but the status bar still totals whatever numeric
 * cells fall inside the current selection.
 */
export function SheetEditor({
  sheets,
  activeSheet,
  direction,
  zoom,
  onChange,
  onActiveSheetChange
}: SheetEditorProps): React.JSX.Element {
  const t = useApp((state) => state.t)
  const [cursor, setCursor] = useState<CellRef>({ row: 0, column: 0 })
  const [anchor, setAnchor] = useState<CellRef | null>(null)

  const sheet = sheets[activeSheet] ?? sheets[0]
  const rows = sheet?.rows ?? []
  const columnCount = Math.max(1, ...rows.map((row) => row.length))

  const stats = useMemo(() => {
    const trimmed = trimGrid(rows)
    const filled = trimmed.reduce(
      (total, row) => total + row.filter((cell) => cell !== '').length,
      0
    )
    return { rows: trimmed.length, columns: trimmed[0]?.length ?? 0, filled }
  }, [rows])

  const selection = useMemo(() => {
    if (!anchor) return null
    const top = Math.min(anchor.row, cursor.row)
    const bottom = Math.max(anchor.row, cursor.row)
    const left = Math.min(anchor.column, cursor.column)
    const right = Math.max(anchor.column, cursor.column)

    const numbers: number[] = []
    for (let row = top; row <= bottom; row += 1) {
      for (let column = left; column <= right; column += 1) {
        const value = Number((rows[row]?.[column] ?? '').replace(/[,\s]/g, ''))
        if (Number.isFinite(value) && (rows[row]?.[column] ?? '') !== '') numbers.push(value)
      }
    }
    if (numbers.length === 0) return null
    const sum = numbers.reduce((total, value) => total + value, 0)
    return { count: numbers.length, sum, average: sum / numbers.length }
  }, [anchor, cursor, rows])

  const mutate = (next: SheetData): void => {
    onChange(sheets.map((item, index) => (index === activeSheet ? next : item)))
  }

  const setCell = (row: number, column: number, value: string): void => {
    const grid = rows.map((current) => [...current])
    while (grid.length <= row) grid.push(new Array(columnCount).fill(''))
    while (grid[row].length <= column) grid[row].push('')
    grid[row][column] = value
    mutate({ ...sheet, rows: grid })
  }

  const addRow = (at = rows.length): void => {
    const grid = rows.map((current) => [...current])
    grid.splice(at, 0, new Array(columnCount).fill(''))
    mutate({ ...sheet, rows: grid })
  }

  const addColumn = (at = columnCount): void => {
    mutate({
      ...sheet,
      rows: rows.map((row) => {
        const copy = [...row]
        while (copy.length < columnCount) copy.push('')
        copy.splice(at, 0, '')
        return copy
      })
    })
  }

  const deleteRow = (at: number): void => {
    if (rows.length <= 1) return
    const grid = rows.map((current) => [...current])
    grid.splice(at, 1)
    mutate({ ...sheet, rows: grid })
  }

  const deleteColumn = (at: number): void => {
    if (columnCount <= 1) return
    mutate({ ...sheet, rows: rows.map((row) => row.filter((_, index) => index !== at)) })
  }

  const sortByColumn = (column: number, ascending: boolean): void => {
    // The first row is treated as a header and stays put.
    const [header, ...body] = rows
    const sorted = [...body].sort((left, right) => {
      const a = left[column] ?? ''
      const b = right[column] ?? ''
      const numericA = Number(a.replace(/[,\s]/g, ''))
      const numericB = Number(b.replace(/[,\s]/g, ''))
      const bothNumeric = a !== '' && b !== '' && Number.isFinite(numericA) && Number.isFinite(numericB)
      const comparison = bothNumeric ? numericA - numericB : a.localeCompare(b, undefined, { numeric: true })
      return ascending ? comparison : -comparison
    })
    mutate({ ...sheet, rows: [header, ...sorted] })
  }

  const onCellKeyDown = (event: React.KeyboardEvent, row: number, column: number): void => {
    const move = (nextRow: number, nextColumn: number): void => {
      event.preventDefault()
      const target = document.querySelector<HTMLInputElement>(
        `[data-cell="${nextRow}-${nextColumn}"]`
      )
      target?.focus()
      target?.select()
      setCursor({ row: nextRow, column: nextColumn })
      if (!event.shiftKey) setAnchor(null)
    }

    if (event.key === 'Enter' || (event.key === 'ArrowDown' && !event.altKey)) {
      move(Math.min(row + 1, rows.length - 1), column)
    } else if (event.key === 'ArrowUp' && !event.altKey) {
      move(Math.max(row - 1, 0), column)
    } else if (event.key === 'Tab') {
      move(row, event.shiftKey ? Math.max(column - 1, 0) : Math.min(column + 1, columnCount - 1))
    } else if (event.key === 'Delete' && event.ctrlKey) {
      event.preventDefault()
      deleteRow(row)
    }
  }

  if (!sheet) return <div className="empty">{t('msg.noDocument')}</div>

  return (
    <div className="sheet-shell">
      <div className="toolbar sheet-toolbar">
        <Button size="sm" variant="ghost" onClick={() => addRow(cursor.row + 1)}>
          <Rows3 size={15} />
          {t('sheet.addRow')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => addColumn(cursor.column + 1)}>
          <Columns3 size={15} />
          {t('sheet.addColumn')}
        </Button>
        <Button
          size="sm"
          variant="danger"
          ghostDanger
          onClick={() => deleteRow(cursor.row)}
          title={t('sheet.deleteRow')}
        >
          <Trash2 size={15} />
          {t('sheet.deleteRow')}
        </Button>
        <Button
          size="sm"
          variant="danger"
          ghostDanger
          onClick={() => deleteColumn(cursor.column)}
          title={t('sheet.deleteColumn')}
        >
          <Trash2 size={15} />
          {t('sheet.deleteColumn')}
        </Button>

        <span className="sep" />

        <Button
          size="sm"
          variant="ghost"
          onClick={() => sortByColumn(cursor.column, true)}
          title={t('sheet.sortAsc')}
        >
          <ArrowUpAZ size={15} />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => sortByColumn(cursor.column, false)}
          title={t('sheet.sortDesc')}
        >
          <ArrowDownAZ size={15} />
        </Button>

        <span className="spacer" />
        <span className="mono muted">
          {columnLabel(cursor.column)}
          {cursor.row + 1}
        </span>
      </div>

      <div className="sheet-scroll" dir={direction}>
        <table className="sheet-grid" style={{ fontSize: `${13 * zoom}px` }}>
          <thead>
            <tr>
              <th className="corner" />
              {Array.from({ length: columnCount }, (_, column) => (
                <th
                  key={column}
                  className={column === cursor.column ? 'active' : ''}
                  onClick={() => setCursor((current) => ({ ...current, column }))}
                >
                  {columnLabel(column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <th
                  className={`row-head${rowIndex === cursor.row ? ' active' : ''}`}
                  onClick={() => setCursor((current) => ({ ...current, row: rowIndex }))}
                >
                  {rowIndex + 1}
                </th>
                {Array.from({ length: columnCount }, (_, column) => {
                  const value = row[column] ?? ''
                  const isCursor = cursor.row === rowIndex && cursor.column === column
                  const inSelection =
                    anchor !== null &&
                    rowIndex >= Math.min(anchor.row, cursor.row) &&
                    rowIndex <= Math.max(anchor.row, cursor.row) &&
                    column >= Math.min(anchor.column, cursor.column) &&
                    column <= Math.max(anchor.column, cursor.column)

                  return (
                    <td key={column} className={inSelection && !isCursor ? 'selected' : ''}>
                      <input
                        data-cell={`${rowIndex}-${column}`}
                        className={isCursor ? 'cursor' : ''}
                        value={value}
                        dir="auto"
                        onFocus={() => setCursor({ row: rowIndex, column })}
                        onMouseDown={(event) => {
                          if (event.shiftKey) {
                            if (!anchor) setAnchor(cursor)
                          } else {
                            setAnchor({ row: rowIndex, column })
                          }
                        }}
                        onChange={(event) => setCell(rowIndex, column, event.target.value)}
                        onKeyDown={(event) => onCellKeyDown(event, rowIndex, column)}
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="sheet-tabs">
        {sheets.map((item, index) => (
          <button
            key={`${item.name}-${index}`}
            className={`sheet-tab${index === activeSheet ? ' active' : ''}`}
            onClick={() => onActiveSheetChange(index)}
            onDoubleClick={() => {
              const next = window.prompt(t('sheet.renameSheet'), item.name)
              if (next?.trim()) {
                onChange(
                  sheets.map((entry, position) =>
                    position === index ? { ...entry, name: next.trim() } : entry
                  )
                )
              }
            }}
          >
            {item.name}
          </button>
        ))}
        <button
          className="sheet-tab add"
          title={t('sheet.newSheet')}
          onClick={() => {
            onChange([
              ...sheets,
              { name: `Sheet${sheets.length + 1}`, rows: Array.from({ length: 24 }, () => new Array(8).fill('')) }
            ])
            onActiveSheetChange(sheets.length)
          }}
        >
          <Plus size={14} />
        </button>
        {sheets.length > 1 ? (
          <button
            className="sheet-tab"
            title={t('sheet.deleteSheet')}
            onClick={() => {
              onChange(sheets.filter((_, index) => index !== activeSheet))
              onActiveSheetChange(Math.max(0, activeSheet - 1))
            }}
          >
            <Trash2 size={13} />
          </button>
        ) : null}

        <span className="spacer" style={{ marginInlineStart: 'auto' }} />
        <span className="muted">
          {stats.rows} {t('sheet.rows')} · {stats.columns} {t('sheet.columns')} · {stats.filled}{' '}
          {t('sheet.cells')}
        </span>
        {selection ? (
          <span className="muted" style={{ marginInlineStart: 14 }}>
            {t('sheet.sum')} {formatNumber(selection.sum)} · {t('sheet.average')}{' '}
            {formatNumber(selection.average)}
          </span>
        ) : null}
      </div>
    </div>
  )
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}
