import { App as CapacitorApp } from '@capacitor/app'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Preferences } from '@capacitor/preferences'
import { Share } from '@capacitor/share'
import { registerPlugin } from '@capacitor/core'
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/types'
import type {
  OpenDialogOptions,
  PdfPrintOptions,
  PickedFile,
  PrinterOption,
  PrintJobOptions,
  RecentFile,
  SaveDialogOptions,
  SaveResult,
  WindowState,
  UpdateEvent
} from '@shared/types'

/**
 * The same platform contract the desktop app gets from its preload, served on
 * Android by Capacitor.
 *
 * The renderer is the whole application — every reader, converter and editor
 * lives there and touches nothing but `window.alcode`. So the phone build
 * does not fork the app: it installs an implementation of that one interface
 * before React starts, and the forty call sites carry on unchanged.
 *
 * Where a phone genuinely differs, it differs honestly rather than
 * pretending: there are no window controls, no printer list, and "paths" are
 * content URIs the system picker handed back, not filesystem paths a user
 * could type. Saving means writing into the app's documents folder and
 * offering the share sheet, which is how a file leaves an Android app.
 */

/** HTML → PDF and the system print dialog, implemented natively. */
export interface AlcodePrintPlugin {
  toPdf(options: { html: string; name: string; width?: number; height?: number; margins?: number[] }): Promise<{ base64: string }>
  print(options: { html: string; name: string }): Promise<{ printed: boolean }>
}

/** Saving a produced file where the user can find it, and opening one. */
export interface AlcodeFilesPlugin {
  saveToDownloads(options: { name: string; base64: string; mime: string }): Promise<{ uri: string; display: string }>
  readUri(options: { uri: string }): Promise<{ name: string; base64: string }>
  /** The intent that started the app, if it carried a document. */
  takeIntentFile(): Promise<{ name: string; base64: string } | Record<string, never>>
}

export const AlcodePrint = registerPlugin<AlcodePrintPlugin>('AlcodePrint')
export const AlcodeFiles = registerPlugin<AlcodeFilesPlugin>('AlcodeFiles')

const SETTINGS_KEY = 'alcode.settings'
const SIGNATURES_KEY = 'alcode.signatures'
const DRAFT_KEY = 'alcode.draft'
const RECENTS_KEY = 'alcode.recents'

/* ------------------------------------------------------------ conversions */

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function fromBase64(base64: string): Uint8Array {
  const clean = base64.includes(',') ? base64.slice(base64.indexOf(',') + 1) : base64
  const binary = atob(clean)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function readPreference<T>(key: string, fallback: T): Promise<T> {
  try {
    const { value } = await Preferences.get({ key })
    return value ? (JSON.parse(value) as T) : fallback
  } catch {
    return fallback
  }
}

async function writePreference(key: string, value: unknown): Promise<void> {
  await Preferences.set({ key, value: JSON.stringify(value) }).catch(() => undefined)
}

/* ----------------------------------------------------------------- files */

/**
 * The system file picker, reached through a hidden input.
 *
 * Android's WebView wires `<input type="file">` to the document picker, which
 * is the picker users know and the one that can reach Drive and the SD card.
 * A custom plugin would only reimplement it worse.
 */
function pickFiles(options: OpenDialogOptions): Promise<PickedFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = Boolean(options.multiple)
    const extensions = (options.filters ?? []).flatMap((filter) => filter.extensions)
    if (extensions.length > 0 && !extensions.includes('*')) {
      input.accept = extensions.map((extension) => `.${extension}`).join(',')
    }
    input.style.display = 'none'
    document.body.append(input)

    let settled = false
    const finish = async (files: FileList | null): Promise<void> => {
      if (settled) return
      settled = true
      input.remove()
      const picked: PickedFile[] = []
      for (const file of Array.from(files ?? [])) {
        picked.push({
          name: file.name,
          path: `content://picked/${encodeURIComponent(file.name)}`,
          data: new Uint8Array(await file.arrayBuffer()),
          size: file.size
        })
      }
      resolve(picked)
    }

    input.addEventListener('change', () => void finish(input.files))
    // A cancelled picker fires no event on some devices; the focus returning
    // to the page is the only signal there is.
    window.addEventListener(
      'focus',
      () => setTimeout(() => void finish(input.files), 800),
      { once: true }
    )
    input.click()
  })
}

/** Everything the app writes lands here first, under the app's own documents. */
async function writeDocument(name: string, bytes: Uint8Array): Promise<string> {
  const path = `Alcode/${name}`
  await Filesystem.mkdir({ path: 'Alcode', directory: Directory.Documents, recursive: true }).catch(
    () => undefined
  )
  await Filesystem.writeFile({ path, directory: Directory.Documents, data: toBase64(bytes) })
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Documents })
  return uri
}

function mimeFor(name: string): string {
  const extension = name.split('.').pop()?.toLowerCase() ?? ''
  const types: Record<string, string> = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain',
    md: 'text/markdown',
    html: 'text/html',
    csv: 'text/csv',
    json: 'application/json',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    zip: 'application/zip',
    epub: 'application/epub+zip',
    rtf: 'application/rtf'
  }
  return types[extension] ?? 'application/octet-stream'
}

/* ------------------------------------------------------------- listeners */

type Listener<T> = (value: T) => void
const openPathListeners = new Set<Listener<string>>()
const menuActionListeners = new Set<Listener<string>>()
const menuNavigateListeners = new Set<Listener<string>>()

/** A file the app was opened with, kept until the renderer asks for it. */
let pendingFile: { name: string; bytes: Uint8Array } | null = null

export function takePendingMobileFile(): { name: string; bytes: Uint8Array } | null {
  const file = pendingFile
  pendingFile = null
  return file
}

async function absorbIntentFile(): Promise<void> {
  try {
    const result = await AlcodeFiles.takeIntentFile()
    if (!result || !('name' in result) || !result.name) return
    pendingFile = { name: result.name, bytes: fromBase64(result.base64) }
    for (const listener of openPathListeners) listener(result.name)
  } catch {
    // No plugin on this build, or nothing was shared in.
  }
}

/* ------------------------------------------------------------------ bridge */

export function installMobileBridge(): void {
  const api = {
    dialog: {
      open: (options: OpenDialogOptions = {}): Promise<PickedFile[]> => pickFiles(options),
      /**
       * A phone has no save dialog. The file is written where the user can
       * find it and the share sheet is offered, which is how a document
       * actually leaves an Android app.
       */
      save: async (options: SaveDialogOptions = {}): Promise<SaveResult> => {
        const name = options.defaultName?.split('/').pop() ?? 'document'
        return { canceled: false, path: `alcode://save/${encodeURIComponent(name)}` }
      },
      directory: async (): Promise<string | null> => null
    },
    fs: {
      read: async (path: string): Promise<PickedFile> => {
        const result = await AlcodeFiles.readUri({ uri: path })
        const data = fromBase64(result.base64)
        return { name: result.name, path, data, size: data.byteLength }
      },
      write: async (path: string, data: Uint8Array): Promise<void> => {
        const name = decodeURIComponent(path.split('/').pop() ?? 'document')
        const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
        try {
          const saved = await AlcodeFiles.saveToDownloads({
            name,
            base64: toBase64(bytes),
            mime: mimeFor(name)
          })
          lastSaved = { uri: saved.uri, display: saved.display, name }
        } catch {
          const uri = await writeDocument(name, bytes)
          lastSaved = { uri, display: `Documents/Alcode/${name}`, name }
        }
      },
      writeText: async (path: string, text: string): Promise<void> => {
        await api.fs.write(path, new TextEncoder().encode(text))
      },
      exists: async (): Promise<boolean> => false
    },
    pathForFile: (file: File): string => `content://picked/${encodeURIComponent(file.name)}`,
    shell: {
      /** Sharing is the phone's "show me where you put it". */
      reveal: async (): Promise<void> => {
        if (!lastSaved) return
        await Share.share({
          title: lastSaved.name,
          url: lastSaved.uri,
          dialogTitle: lastSaved.name
        }).catch(() => undefined)
      },
      external: async (url: string): Promise<void> => {
        window.open(url, '_blank', 'noopener')
      }
    },
    clipboard: {
      writeText: async (text: string): Promise<void> => {
        await navigator.clipboard?.writeText(text).catch(() => undefined)
      }
    },
    settings: {
      get: async (): Promise<AppSettings> => ({
        ...DEFAULT_SETTINGS,
        ...(await readPreference<Partial<AppSettings>>(SETTINGS_KEY, {}))
      }),
      set: async (patch: Partial<AppSettings>): Promise<AppSettings> => {
        const next = { ...(await api.settings.get()), ...patch }
        await writePreference(SETTINGS_KEY, next)
        return next
      }
    },
    signatures: {
      list: (): Promise<unknown[]> => readPreference<unknown[]>(SIGNATURES_KEY, []),
      save: async (entry: unknown): Promise<unknown[]> => {
        const all = [...(await readPreference<Record<string, unknown>[]>(SIGNATURES_KEY, [])), entry as Record<string, unknown>]
        await writePreference(SIGNATURES_KEY, all)
        return all
      },
      remove: async (id: string): Promise<unknown[]> => {
        const all = (await readPreference<Record<string, unknown>[]>(SIGNATURES_KEY, [])).filter(
          (entry) => entry.id !== id
        )
        await writePreference(SIGNATURES_KEY, all)
        return all
      }
    },
    draft: {
      save: async (value: unknown): Promise<boolean> => {
        await writePreference(DRAFT_KEY, value)
        return true
      },
      read: (): Promise<unknown> => readPreference<unknown>(DRAFT_KEY, null),
      clear: async (): Promise<boolean> => {
        await Preferences.remove({ key: DRAFT_KEY }).catch(() => undefined)
        return true
      }
    },
    recents: {
      list: (): Promise<RecentFile[]> => readPreference<RecentFile[]>(RECENTS_KEY, []),
      clear: async (): Promise<RecentFile[]> => {
        await writePreference(RECENTS_KEY, [])
        return []
      }
    },
    app: {
      info: async (): Promise<{
        version: string
        platform: string
        arch: string
        electron: string
        chrome: string
        node: string
        documentsDir: string
      }> => {
        const info = await CapacitorApp.getInfo().catch(() => ({ version: '', build: '' }))
        return {
          version: info.version || '0.0.0',
          platform: 'android',
          arch: 'arm64',
          electron: '',
          chrome: /Chrome\/([\d.]+)/.exec(navigator.userAgent)?.[1] ?? '',
          node: '',
          documentsDir: 'Documents/Alcode'
        }
      },
      takePendingFile: async (): Promise<string | null> => (pendingFile ? pendingFile.name : null)
    },
    print: {
      html: async (html: string, options: PdfPrintOptions = {}): Promise<Uint8Array> => {
        const box = options.pageBox
        const result = await AlcodePrint.toPdf({
          html,
          name: 'document',
          width: box?.width,
          height: box?.height,
          margins: box ? [box.margins.top, box.margins.right, box.margins.bottom, box.margins.left] : undefined
        })
        return fromBase64(result.base64)
      },
      /**
       * The app hands the printer rendered page images; on Android those go
       * to the system print service as a page of images, which is what the
       * print dialog there expects.
       */
      job: async (options: PrintJobOptions): Promise<boolean> => {
        const pages = options.pages
          .map(
            (page) =>
              `<img src="${page.dataUrl}" style="width:${page.widthPt}pt;height:${page.heightPt}pt;display:block;page-break-after:always">`
          )
          .join('')
        const html = `<!doctype html><html><head><meta charset="utf-8"><style>@page{margin:0}body{margin:0}</style></head><body>${pages}</body></html>`
        const result = await AlcodePrint.print({ html, name: 'document' })
        return result.printed
      },
      printers: async (): Promise<PrinterOption[]> => []
    },
    theme: {
      isDark: async (): Promise<boolean> => window.matchMedia('(prefers-color-scheme: dark)').matches,
      onChange: (handler: (dark: boolean) => void): (() => void) => {
        const query = window.matchMedia('(prefers-color-scheme: dark)')
        const listener = (event: MediaQueryListEvent): void => handler(event.matches)
        query.addEventListener('change', listener)
        return () => query.removeEventListener('change', listener)
      }
    },
    // A phone window is the screen; these exist so shared code can call them.
    window: {
      minimize: async (): Promise<void> => undefined,
      toggleMaximize: async (): Promise<boolean> => true,
      close: async (): Promise<void> => {
        await CapacitorApp.exitApp().catch(() => undefined)
      },
      forceClose: async (): Promise<void> => {
        await CapacitorApp.exitApp().catch(() => undefined)
      },
      isMaximized: async (): Promise<boolean> => true,
      onState: (handler: (state: WindowState) => void): (() => void) => {
        handler({ maximized: true, focused: true })
        return () => undefined
      }
    },
    /** Updates come from the store, not from inside the app. */
    update: {
      check: async (): Promise<void> => undefined,
      download: async (): Promise<void> => undefined,
      install: async (): Promise<void> => undefined,
      onEvent: (_handler: (event: UpdateEvent) => void): (() => void) => () => undefined
    },
    on: {
      openPath: (handler: (path: string) => void): (() => void) => {
        openPathListeners.add(handler)
        return () => openPathListeners.delete(handler)
      },
      menuAction: (handler: (action: string) => void): (() => void) => {
        menuActionListeners.add(handler)
        return () => menuActionListeners.delete(handler)
      },
      menuNavigate: (handler: (route: string) => void): (() => void) => {
        menuNavigateListeners.add(handler)
        return () => menuNavigateListeners.delete(handler)
      }
    }
  }

  let lastSaved: { uri: string; display: string; name: string } | null = null
  ;(window as unknown as { alcode: typeof api }).alcode = api

  void absorbIntentFile()
  void CapacitorApp.addListener('appUrlOpen', () => void absorbIntentFile())
  void CapacitorApp.addListener('resume', () => void absorbIntentFile())
}

/** Lets the shell fire the same events the desktop menus fire. */
export function emitMobileAction(action: string): void {
  for (const listener of menuActionListeners) listener(action)
}

export function emitMobileNavigate(route: string): void {
  for (const listener of menuNavigateListeners) listener(route)
}
