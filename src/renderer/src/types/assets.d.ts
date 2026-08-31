declare module '*.ttf?url' {
  const url: string
  export default url
}

declare module '*.otf?url' {
  const url: string
  export default url
}

declare module 'bidi-js' {
  export interface EmbeddingLevels {
    levels: Uint8Array
    paragraphs: { start: number; end: number; level: number }[]
  }

  export interface BidiApi {
    getEmbeddingLevels(text: string, baseDirection?: 'ltr' | 'rtl' | 'auto'): EmbeddingLevels
    getReorderSegments(
      text: string,
      embeddingLevels: EmbeddingLevels,
      start?: number,
      end?: number
    ): [number, number][]
    getReorderedString(text: string, embeddingLevels: EmbeddingLevels): string
    getMirroredCharacter(char: string): string | null
  }

  export default function bidiFactory(): BidiApi
}

/**
 * fontkit ships no typings for its browser build. Only the surface pdf-lib's
 * `registerFontkit` needs is declared here; @cantoo/pdf-lib validates the rest
 * structurally at the call site.
 */
declare module 'fontkit' {
  export function create(buffer: Uint8Array, postscriptName?: string): unknown
  export function openSync(path: string, postscriptName?: string): unknown
}
