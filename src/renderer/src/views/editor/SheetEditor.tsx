import { useEffect, useMemo, useRef, useState } from 'react'
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
import { recalculate } from '../../lib/documents/formulas'
import {
  columnLabel,
  emptyCell,
  inferCell,
  numericValue,
  type SheetCell,
  type SheetData
} from '../../lib/documents/sheets'

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

const ROW_HEIGHT = 27
const COLUMN_WIDTH = 116
const OVERSCAN = 6

/**
 * A spreadsheet grid built on plain inputs.
 *
 * Only the rows and columns inside the scroll window are mounted: a controlled
 * `<input>` per cell is cheap until a workbook has fifty thousand of them, at
 * which point every keystroke re-renders the lot. Editing is likewise kept
 * local until the cell is left, so typing costs one component render rather
 * than a full-grid clone through the store.
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
  const [draft, setDraft] = useState<{ row: number; column: number; value: string } | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const [window_, setWindow] = useState({ top: 0, left: 0, height: 600, width: 900 })

  const sheet = sheets[activeSheet] ?? sheets[0]
  const rows = useMemo(() => sheet?.rows ?? [], [sheet])
  const columnCount = useMemo(
    () => Math.max(1, ...rows.map((row) => row.length)),
    [rows]
  )

  const rowHeight = ROW_HEIGHT * zoom
  const columnWidth = COLUMN_WIDTH * zoom

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return undefined
    let frame = 0
    const sync = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() =>
        setWindow({
          top: container.scrollTop,
          left: Math.abs(container.scrollLeft),
          height: container.clientHeight,
          width: container.clientWidth
        })
      )
    }
    sync()
    container.addEventListener('scroll', sync, { passive: true })
    const observer = new ResizeObserver(sync)
    observer.observe(container)
    return () => {
      container.removeEventListener('scroll', sync)
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [])

  const firstRow = Math.max(0, Math.floor(window_.top / rowHeight) - OVERSCAN)
  const lastRow = Math.min(
    rows.length - 1,
    Math.ceil((window_.top + window_.height) / rowHeight) + OVERSCAN
  )
  const firstColumn = Math.max(0, Math.floor(window_.left / columnWidth) - 2)
  const lastColumn = Math.min(
    columnCount - 1,
    Math.ceil((window_.left + window_.width) / columnWidth) + 2
  )

  // Counting filled cells is O(cells); doing it on every keystroke is what a
  // 20,000-row sheet cannot afford, so it only re-runs when the grid itself
  // changes identity.
  const stats = useMemo(() => {
    let filled = 0
    let lastRowWithData = -1
    let lastColumnWithData = -1
    for (let r = 0; r < rows.length; r += 1) {
      for (let c = 0; c < rows[r].length; c += 1) {
        if (rows[r][c]?.text !== '') {
          filled += 1
          if (r > lastRowWithData) lastRowWithData = r
          if (c > lastColumnWithData) lastColumnWithData = c
        }
      }
    }
    return { rows: lastRowWithData + 1, columns: lastColumnWithData + 1, filled }
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
        const value = numericValue(rows[row]?.[column])
        if (value !== null) numbers.push(value)
      }
    }
    if (numbers.length === 0) return null
    const sum = numbers.reduce((total, value) => total + value, 0)
    return { count: numbers.length, sum, average: sum / numbers.length }
  }, [anchor, cursor, rows])

  // Every edit re-evaluates the sheet's formulas; rows without any are
  // shared with the input, so the common edit still costs one row copy.
  const mutate = (next: SheetData): void => {
    const evaluated = recalculate(next)
    onChange(sheets.map((item, index) => (index === activeSheet ? evaluated : item)))
  }

  /** Copy-on-write of the affected row only — the rest of the grid is shared. */
  const commitCell = (row: number, column: number, value: string): void => {
    const existing = rows[row]?.[column]
    if (existing && existing.text === value) return
    // Leaving a formula cell without touching it must not dirty the document.
    if (existing && existing.formula !== undefined && value === '=' + existing.formula) return
    const grid = [...rows]
    while (grid.length <= row) grid.push(Array.from({ length: columnCount }, emptyCell))
    const line = [...grid[row]]
    while (line.length <= column) line.push(emptyCell())
    // Re-infer the type from what was typed, keeping the previous number format.
    line[column] = inferCell(value, line[column])
    grid[row] = line
    mutate({ ...sheet, rows: grid })
  }

  /**
   * Copy and paste a rectangle, in the tab-separated form every spreadsheet
   * puts on the clipboard.
   *
   * Without this the grid could only be filled one cell at a time, which is
   * not a way anyone moves a table out of Excel. Pasting writes the whole
   * block in one update rather than one per cell: a 50x10 paste would
   * otherwise deep-copy the grid five hundred times.
   */
  const selectedRect = (): { top: number; left: number; bottom: number; right: number } => {
    const start = anchor ?? cursor
    return {
      top: Math.min(start.row, cursor.row),
      left: Math.min(start.column, cursor.column),
      bottom: Math.max(start.row, cursor.row),
      right: Math.max(start.column, cursor.column)
    }
  }

  const copySelection = async (): Promise<void> => {
    const box = selectedRect()
    const lines: string[] = []
    for (let r = box.top; r <= box.bottom; r += 1) {
      const line: string[] = []
      for (let c = box.left; c <= box.right; c += 1) line.push(rows[r]?.[c]?.text ?? '')
      lines.push(line.join('\t'))
    }
    await navigator.clipboard.writeText(lines.join('\n')).catch(() => undefined)
  }

  const pasteBlock = (clip: string): void => {
    const block = clip.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').map((line) => line.split('\t'))
    if (block.length === 0) return
    const grid = [...rows]
    for (const [rowOffset, line] of block.entries()) {
      const row = cursor.row + rowOffset
      while (grid.length <= row) grid.push(Array.from({ length: columnCount }, emptyCell))
      const target = [...grid[row]]
      for (const [columnOffset, value] of line.entries()) {
        const column = cursor.column + columnOffset
        while (target.length <= column) target.push(emptyCell())
        target[column] = inferCell(value, target[column])
      }
      grid[row] = target
    }
    mutate({ ...sheet, rows: grid })
  }

  const flushDraft = (): void => {
    if (!draft) return
    commitCell(draft.row, draft.column, draft.value)
    setDraft(null)
  }

  const addRow = (at = rows.length): void => {
    const grid = [...rows]
    grid.splice(at, 0, Array.from({ length: columnCount }, emptyCell))
    mutate({ ...sheet, rows: grid })
  }

  const addColumn = (at = columnCount): void => {
    mutate({
      ...sheet,
      rows: rows.map((row) => {
        const copy = [...row]
        while (copy.length < columnCount) copy.push(emptyCell())
        copy.splice(at, 0, emptyCell())
        return copy
      })
    })
  }

  const deleteRow = (at: number): void => {
    if (rows.length <= 1) return
    const grid = [...rows]
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
      const numericA = numericValue(left[column])
      const numericB = numericValue(right[column])
      const comparison =
        numericA !== null && numericB !== null
          ? numericA - numericB
          : (left[column]?.text ?? '').localeCompare(right[column]?.text ?? '', undefined, { numeric: true })
      return ascending ? comparison : -comparison
    })
    mutate({ ...sheet, rows: [header, ...sorted] })
  }

  const focusCell = (row: number, column: number): void => {
    setCursor({ row, column })
    requestAnimationFrame(() => {
      const target = document.querySelector<HTMLInputElement>(`[data-cell="${row}-${column}"]`)
      target?.focus()
      target?.select()
    })
  }

  const onCellKeyDown = (event: React.KeyboardEvent, row: number, column: number): void => {
    // Handled here rather than by the browser: the cells are inputs, so a
    // plain Ctrl+C would copy the one being edited, never the selected block.
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !draft) {
      const pressed = event.key.toLowerCase()
      if (pressed === 'c') {
        event.preventDefault()
        void copySelection()
        return
      }
      if (pressed === 'v') {
        event.preventDefault()
        void navigator.clipboard
          .readText()
          .then((clip) => clip && pasteBlock(clip))
          .catch(() => undefined)
        return
      }
    }

    const move = (nextRow: number, nextColumn: number): void => {
      // Only swallow the key when the move actually goes somewhere. At the
      // last cell Tab must be allowed through, or the grid is a keyboard trap
      // with no way out but the mouse.
      if (nextRow === row && nextColumn === column) return
      event.preventDefault()
      flushDraft()
      focusCell(nextRow, nextColumn)
      if (!event.shiftKey) setAnchor(null)
    }

    if (event.key === 'Enter' || (event.key === 'ArrowDown' && !event.altKey)) {
      move(Math.min(row + 1, rows.length - 1), column)
    } else if (event.key === 'ArrowUp' && !event.altKey) {
      move(Math.max(row - 1, 0), column)
    } else if (event.key === 'Tab') {
      move(row, event.shiftKey ? Math.max(column - 1, 0) : Math.min(column + 1, columnCount - 1))
    } else if (event.key === 'Escape') {
      setDraft(null)
    } else if (event.key === 'Delete' && event.ctrlKey) {
      event.preventDefault()
      deleteRow(row)
    }
  }

  if (!sheet) return <div className="empty">{t('msg.noDocument')}</div>

  const visibleRows: number[] = []
  for (let row = firstRow; row <= lastRow; row += 1) visibleRows.push(row)
  const visibleColumns: number[] = []
  for (let column = firstColumn; column <= lastColumn; column += 1) visibleColumns.push(column)

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
          aria-label={t('sheet.sortAsc')}
        >
          <ArrowUpAZ size={15} />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => sortByColumn(cursor.column, false)}
          title={t('sheet.sortDesc')}
          aria-label={t('sheet.sortDesc')}
        >
          <ArrowDownAZ size={15} />
        </Button>

        <span className="spacer" />
        <span className="mono muted" dir="ltr">
          {columnLabel(cursor.column)}
          {cursor.row + 1}
        </span>
      </div>

      <div className="sheet-scroll" dir={direction} ref={scrollRef}>
        <div
          className="sheet-canvas"
          style={{
            height: rows.length * rowHeight + rowHeight,
            width: columnCount * columnWidth + 52 * zoom,
            fontSize: `${13 * zoom}px`
          }}
          role="grid"
          aria-rowcount={rows.length}
          aria-colcount={columnCount}
        >
          <div className="sheet-head" style={{ height: rowHeight }}>
            <div className="sheet-corner" style={{ width: 52 * zoom, height: rowHeight }} />
            {visibleColumns.map((column) => (
              <div
                key={column}
                className={`sheet-col-head${column === cursor.column ? ' active' : ''}`}
                style={{
                  insetInlineStart: 52 * zoom + column * columnWidth,
                  width: columnWidth,
                  height: rowHeight
                }}
                onClick={() => setCursor((current) => ({ ...current, column }))}
              >
                {columnLabel(column)}
              </div>
            ))}
          </div>

          {visibleRows.map((rowIndex) => {
            const row = rows[rowIndex] ?? []
            return (
              <div
                key={rowIndex}
                className="sheet-row"
                style={{ top: rowHeight + rowIndex * rowHeight, height: rowHeight }}
                role="row"
              >
                <div
                  className={`sheet-row-head${rowIndex === cursor.row ? ' active' : ''}`}
                  style={{ width: 52 * zoom, height: rowHeight }}
                  onClick={() => setCursor((current) => ({ ...current, row: rowIndex }))}
                >
                  {rowIndex + 1}
                </div>
                {visibleColumns.map((column) => {
                  const cell = row[column] ?? EMPTY
                  const isCursor = cursor.row === rowIndex && cursor.column === column
                  const inSelection =
                    anchor !== null &&
                    rowIndex >= Math.min(anchor.row, cursor.row) &&
                    rowIndex <= Math.max(anchor.row, cursor.row) &&
                    column >= Math.min(anchor.column, cursor.column) &&
                    column <= Math.max(anchor.column, cursor.column)
                  const editing =
                    draft !== null && draft.row === rowIndex && draft.column === column

                  return (
                    <div
                      key={column}
                      className={`sheet-cell${inSelection && !isCursor ? ' selected' : ''}`}
                      style={{
                        insetInlineStart: 52 * zoom + column * columnWidth,
                        width: columnWidth,
                        height: rowHeight
                      }}
                      role="gridcell"
                    >
                      <input
                        data-cell={`${rowIndex}-${column}`}
                        className={isCursor ? 'cursor' : ''}
                        value={editing ? draft.value : cell.text}
                        title={cell.formula ? '=' + cell.formula : undefined}
                        aria-label={`${columnLabel(column)}${rowIndex + 1}`}
                        dir="auto"
                        onFocus={() => {
                          setCursor({ row: rowIndex, column })
                          // A formula cell shows its result; editing it means editing the formula.
                          if (cell.formula !== undefined) setDraft({ row: rowIndex, column, value: '=' + cell.formula })
                        }}
                        onBlur={flushDraft}
                        onMouseDown={(event) => {
                          if (event.shiftKey) {
                            if (!anchor) setAnchor(cursor)
                          } else {
                            setAnchor({ row: rowIndex, column })
                          }
                        }}
                        onChange={(event) =>
                          setDraft({ row: rowIndex, column, value: event.target.value })
                        }
                        onKeyDown={(event) => onCellKeyDown(event, rowIndex, column)}
                      />
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
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
          aria-label={t('sheet.newSheet')}
          onClick={() => {
            onChange([
              ...sheets,
              { name: `Sheet${sheets.length + 1}`, rows: Array.from({ length: 24 }, () => Array.from({ length: 8 }, emptyCell)) }
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
            aria-label={t('sheet.deleteSheet')}
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
          <span dir="ltr">{stats.rows}</span> {t('sheet.rows')} ·{' '}
          <span dir="ltr">{stats.columns}</span> {t('sheet.columns')} ·{' '}
          <span dir="ltr">{stats.filled}</span> {t('sheet.cells')}
        </span>
        {selection ? (
          <span className="muted" style={{ marginInlineStart: 14 }}>
            {t('sheet.sum')} <span dir="ltr">{formatNumber(selection.sum)}</span> ·{' '}
            {t('sheet.average')} <span dir="ltr">{formatNumber(selection.average)}</span>
          </span>
        ) : null}
      </div>
    </div>
  )
}

const EMPTY: SheetCell = { text: '' }

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}
