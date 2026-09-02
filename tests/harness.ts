export interface Result {
  suite: string
  name: string
  ok: boolean
  detail?: string
}

export type Check = (name: string, ok: boolean, detail?: string) => void
export type Suite = { name: string; run: (check: Check) => Promise<void> }

declare global {
  interface Window {
    __results: Result[]
    __done: boolean
  }
}

/** Equality check with a readable diff line. */
export const eq =
  (check: Check) =>
  (name: string, got: unknown, want: unknown): void =>
    check(name, got === want, `got «${String(got)}» want «${String(want)}»`)

export async function runSuites(suites: Suite[]): Promise<void> {
  const results: Result[] = []
  for (const suite of suites) {
    const check: Check = (name, ok, detail) => results.push({ suite: suite.name, name, ok, detail })
    try {
      await suite.run(check)
    } catch (error) {
      results.push({ suite: suite.name, name: 'suite threw', ok: false, detail: String((error as Error).stack ?? error) })
    }
  }
  window.__results = results
  window.__done = true
}
