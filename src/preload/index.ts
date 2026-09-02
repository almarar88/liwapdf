import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AppSettings,
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
} from '../shared/types'

const api = {
  dialog: {
    open: (options: OpenDialogOptions = {}): Promise<PickedFile[]> =>
      ipcRenderer.invoke('dialog:open', options),
    save: (options: SaveDialogOptions = {}): Promise<SaveResult> =>
      ipcRenderer.invoke('dialog:save', options),
    directory: (): Promise<string | null> => ipcRenderer.invoke('dialog:directory')
  },
  fs: {
    read: (path: string): Promise<PickedFile> => ipcRenderer.invoke('fs:read', path),
    write: (path: string, data: Uint8Array): Promise<void> =>
      ipcRenderer.invoke('fs:write', path, data),
    writeText: (path: string, text: string): Promise<void> =>
      ipcRenderer.invoke('fs:writeText', path, text),
    exists: (path: string): Promise<boolean> => ipcRenderer.invoke('fs:exists', path)
  },
  /** Electron 32+ no longer exposes File.path; this is the supported route. */
  pathForFile: (file: File): string => webUtils.getPathForFile(file),
  shell: {
    reveal: (path: string): Promise<void> => ipcRenderer.invoke('shell:reveal', path),
    external: (url: string): Promise<void> => ipcRenderer.invoke('shell:external', url)
  },
  clipboard: {
    writeText: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:writeText', text)
  },
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
    set: (patch: Partial<AppSettings>): Promise<AppSettings> =>
      ipcRenderer.invoke('settings:set', patch)
  },
  signatures: {
    list: (): Promise<unknown[]> => ipcRenderer.invoke('signatures:list'),
    save: (entry: unknown): Promise<unknown[]> => ipcRenderer.invoke('signatures:save', entry),
    remove: (id: string): Promise<unknown[]> => ipcRenderer.invoke('signatures:delete', id)
  },
  draft: {
    save: (value: unknown): Promise<boolean> => ipcRenderer.invoke('draft:save', value),
    read: (): Promise<unknown> => ipcRenderer.invoke('draft:read'),
    clear: (): Promise<boolean> => ipcRenderer.invoke('draft:clear')
  },
  recents: {
    list: (): Promise<RecentFile[]> => ipcRenderer.invoke('recents:list'),
    clear: (): Promise<RecentFile[]> => ipcRenderer.invoke('recents:clear')
  },
  app: {
    info: (): Promise<{
      version: string
      platform: string
      arch: string
      electron: string
      chrome: string
      node: string
      documentsDir: string
    }> => ipcRenderer.invoke('app:info'),
    takePendingFile: (): Promise<string | null> => ipcRenderer.invoke('app:takePendingFile')
  },
  print: {
    html: (html: string, options: PdfPrintOptions = {}): Promise<Uint8Array> =>
      ipcRenderer.invoke('print:html', html, options),
    job: (options: PrintJobOptions): Promise<boolean> => ipcRenderer.invoke('print:job', options),
    printers: (): Promise<PrinterOption[]> => ipcRenderer.invoke('print:printers')
  },
  theme: {
    isDark: (): Promise<boolean> => ipcRenderer.invoke('theme:isDark'),
    onChange: (handler: (dark: boolean) => void): (() => void) => {
      const listener = (_e: unknown, dark: boolean): void => handler(dark)
      ipcRenderer.on('theme:changed', listener)
      return () => ipcRenderer.off('theme:changed', listener)
    }
  },
  window: {
    minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: (): Promise<boolean> => ipcRenderer.invoke('window:toggleMaximize'),
    close: (): Promise<void> => ipcRenderer.invoke('window:close'),
    forceClose: (): Promise<void> => ipcRenderer.invoke('window:forceClose'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized'),
    onState: (handler: (state: WindowState) => void): (() => void) => {
      const listener = (_e: unknown, state: WindowState): void => handler(state)
      ipcRenderer.on('window:state', listener)
      return () => ipcRenderer.off('window:state', listener)
    }
  },
  update: {
    check: (): Promise<void> => ipcRenderer.invoke('update:check'),
    download: (): Promise<void> => ipcRenderer.invoke('update:download'),
    install: (): Promise<void> => ipcRenderer.invoke('update:install'),
    onEvent: (handler: (event: UpdateEvent) => void): (() => void) => {
      const listener = (_e: unknown, event: UpdateEvent): void => handler(event)
      ipcRenderer.on('update:event', listener)
      return () => ipcRenderer.off('update:event', listener)
    }
  },
  on: {
    openPath: (handler: (path: string) => void): (() => void) => {
      const listener = (_e: unknown, path: string): void => handler(path)
      ipcRenderer.on('app:open-path', listener)
      return () => ipcRenderer.off('app:open-path', listener)
    },
    menuAction: (handler: (action: string) => void): (() => void) => {
      const listener = (_e: unknown, action: string): void => handler(action)
      ipcRenderer.on('menu:action', listener)
      return () => ipcRenderer.off('menu:action', listener)
    },
    menuNavigate: (handler: (route: string) => void): (() => void) => {
      const listener = (_e: unknown, route: string): void => handler(route)
      ipcRenderer.on('menu:navigate', listener)
      return () => ipcRenderer.off('menu:navigate', listener)
    }
  }
}

export type AlcodeApi = typeof api

contextBridge.exposeInMainWorld('alcode', api)
