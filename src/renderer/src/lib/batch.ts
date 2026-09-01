import { freeName, sanitize } from './files'

/**
 * Runs one job over many files.
 *
 * Every operation in this app is already a pure `(bytes, options) => bytes`,
 * and `saveBatch` already writes many outputs into one folder — what was
 * missing was the loop between them, so doing the same thing to a folder of
 * contracts meant opening, setting and saving each one by hand.
 *
 * Two rules shape it. Files are read **one at a time** and both buffers are
 * dropped before the next, because the multi-select dialog eagerly loads every
 * file into memory and a folder of two hundred scans exhausts it. And a
 * failure is per-file: one unreadable document must not abandon the other
 * hundred and ninety-nine, which is what a single try around the whole loop
 * would do.
 */
export interface BatchItem {
  path: string
  name: string
}

export interface BatchOutcome {
  succeeded: number
  failed: { name: string; reason: string }[]
  /** Where the outputs were written, when any were. */
  directory: string | null
  cancelled: boolean
}

export interface BatchJob {
  /** Produces the output for one file, or null to skip it without failing. */
  run: (input: { bytes: Uint8Array; name: string }) => Promise<{ bytes: Uint8Array; name: string } | null>
}

export async function runBatch(
  items: BatchItem[],
  job: BatchJob,
  report: (done: number, total: number, name: string) => void,
  signal: AbortSignal
): Promise<BatchOutcome> {
  const failed: BatchOutcome['failed'] = []
  if (items.length === 0) return { succeeded: 0, failed, directory: null, cancelled: false }

  const directory = await window.alcode.dialog.directory()
  if (!directory) return { succeeded: 0, failed, directory: null, cancelled: true }

  const separator = directory.includes('\\') ? '\\' : '/'
  const taken = new Set<string>()
  let succeeded = 0

  for (const [index, item] of items.entries()) {
    if (signal.aborted) return { succeeded, failed, directory, cancelled: true }
    report(index, items.length, item.name)

    try {
      const file = await window.alcode.fs.read(item.path)
      const produced = await job.run({ bytes: file.data, name: file.name })
      if (!produced) continue

      const name = await freeName(directory, separator, sanitize(produced.name), taken)
      taken.add(name.toLowerCase())
      await window.alcode.fs.write(`${directory}${separator}${name}`, produced.bytes)
      succeeded += 1
    } catch (error) {
      failed.push({ name: item.name, reason: (error as Error)?.message ?? String(error) })
    }
  }

  report(items.length, items.length, '')
  return { succeeded, failed, directory, cancelled: false }
}
