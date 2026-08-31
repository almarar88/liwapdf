import type { AlcodeApi } from './index'

declare global {
  interface Window {
    alcode: AlcodeApi
  }
}

export {}
