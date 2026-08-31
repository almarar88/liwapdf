declare module 'mammoth' {
  export interface ConversionMessage {
    type: string
    message: string
  }

  export interface ConversionResult {
    value: string
    messages: ConversionMessage[]
  }

  export interface ConversionInput {
    arrayBuffer: ArrayBuffer
  }

  export interface ConversionOptions {
    styleMap?: string | string[]
    includeDefaultStyleMap?: boolean
    convertImage?: unknown
    ignoreEmptyParagraphs?: boolean
  }

  export interface ImageElement {
    contentType: string
    read(encoding: string): Promise<string>
  }

  export const images: {
    imgElement(
      handler: (image: ImageElement) => Promise<{ src: string; alt?: string }>
    ): unknown
  }

  export function convertToHtml(
    input: ConversionInput,
    options?: ConversionOptions
  ): Promise<ConversionResult>

  export function extractRawText(input: ConversionInput): Promise<ConversionResult>

  const mammoth: {
    convertToHtml: typeof convertToHtml
    extractRawText: typeof extractRawText
    images: typeof images
  }
  export default mammoth
}

declare module '*?url' {
  const url: string
  export default url
}
