import {
  Combine,
  Scissors,
  SplitSquareHorizontal,
  FileOutput,
  Trash2,
  RotateCw,
  Rows3,
  Ruler,
  Crop,
  Shrink,
  Minimize2,
  ShieldCheck,
  ShieldOff,
  Wand2,
  Info,
  Droplets,
  Hash,
  PanelTop,
  Paintbrush,
  Stamp,
  Images,
  ClipboardList,
  GitCompare,
  ListTree,
  Paperclip,
  ScanText,
  EyeOff,
  Layers,
  Files,
  Gauge,
  PenTool,
  BookCopy,
  QrCode,
  ScanSearch,
  Replace,
  TextCursorInput
} from 'lucide-react'
import type { TranslationKey } from '../i18n'

export type ToolId =
  | 'merge'
  | 'split'
  | 'splitSize'
  | 'extract'
  | 'deletePages'
  | 'rotate'
  | 'nup'
  | 'resize'
  | 'crop'
  | 'booklet'
  | 'qr'
  | 'replaceText'
  | 'rewriteParagraph'
  | 'inspect'
  | 'compress'
  | 'compressAny'
  | 'protect'
  | 'unlock'
  | 'optimize'
  | 'metadata'
  | 'watermark'
  | 'pageNumbers'
  | 'headerFooter'
  | 'background'
  | 'stamp'
  | 'extractImages'
  | 'forms'
  | 'compare'
  | 'bookmarks'
  | 'attachments'
  | 'ocr'
  | 'redact'
  | 'batch'

export type ToolGroup = 'pages' | 'optimize' | 'content'

/** One of the fixed tile colours declared in theme.css. */
export type Tone = 'blue' | 'green' | 'purple' | 'amber' | 'rose' | 'teal' | 'indigo'

export interface ToolDescriptor {
  id: ToolId
  group: ToolGroup
  titleKey: TranslationKey
  descriptionKey: TranslationKey
  icon: React.JSX.Element
  /** Tools that operate on the document currently open in the workspace. */
  needsDocument: boolean
  /**
   * The tile colour. Related tools share one — the destructive ones are rose,
   * protection is amber, anything that makes a file smaller is green — so the
   * grid can be scanned by colour before it is read.
   */
  tone: Tone
}

export const TOOLS: ToolDescriptor[] = [
  { id: 'merge', group: 'pages', titleKey: 'tool.merge', descriptionKey: 'tool.merge.d', icon: <Combine size={19} />, needsDocument: false, tone: 'blue' },
  { id: 'split', group: 'pages', titleKey: 'tool.split', descriptionKey: 'tool.split.d', icon: <Scissors size={19} />, needsDocument: true, tone: 'teal' },
  { id: 'splitSize', group: 'pages', titleKey: 'tool.splitSize', descriptionKey: 'tool.splitSize.d', icon: <SplitSquareHorizontal size={19} />, needsDocument: true, tone: 'teal' },
  { id: 'extract', group: 'pages', titleKey: 'tool.extract', descriptionKey: 'tool.extract.d', icon: <FileOutput size={19} />, needsDocument: true, tone: 'indigo' },
  { id: 'deletePages', group: 'pages', titleKey: 'tool.deletePages', descriptionKey: 'tool.deletePages.d', icon: <Trash2 size={19} />, needsDocument: true, tone: 'rose' },
  { id: 'rotate', group: 'pages', titleKey: 'tool.rotate', descriptionKey: 'tool.rotate.d', icon: <RotateCw size={19} />, needsDocument: true, tone: 'blue' },
  { id: 'nup', group: 'pages', titleKey: 'tool.nup', descriptionKey: 'tool.nup.d', icon: <Rows3 size={19} />, needsDocument: true, tone: 'indigo' },
  { id: 'resize', group: 'pages', titleKey: 'tool.resize', descriptionKey: 'tool.resize.d', icon: <Ruler size={19} />, needsDocument: true, tone: 'purple' },
  { id: 'crop', group: 'pages', titleKey: 'tool.crop', descriptionKey: 'tool.crop.d', icon: <Crop size={19} />, needsDocument: true, tone: 'purple' },
  { id: 'booklet', group: 'pages', titleKey: 'tool.booklet', descriptionKey: 'tool.booklet.d', icon: <BookCopy size={19} />, needsDocument: true, tone: 'indigo' },

  { id: 'compress', group: 'optimize', titleKey: 'tool.compress', descriptionKey: 'tool.compress.d', icon: <Shrink size={19} />, needsDocument: true, tone: 'green' },
  { id: 'compressAny', group: 'optimize', titleKey: 'tool.compressAny', descriptionKey: 'tool.compressAny.d', icon: <Minimize2 size={19} />, needsDocument: false, tone: 'green' },
  { id: 'protect', group: 'optimize', titleKey: 'tool.protect', descriptionKey: 'tool.protect.d', icon: <ShieldCheck size={19} />, needsDocument: true, tone: 'amber' },
  { id: 'unlock', group: 'optimize', titleKey: 'tool.unlock', descriptionKey: 'tool.unlock.d', icon: <ShieldOff size={19} />, needsDocument: false, tone: 'amber' },
  { id: 'redact', group: 'optimize', titleKey: 'tool.redact', descriptionKey: 'tool.redact.d', icon: <EyeOff size={19} />, needsDocument: true, tone: 'rose' },
  { id: 'optimize', group: 'optimize', titleKey: 'tool.optimize', descriptionKey: 'tool.optimize.d', icon: <Wand2 size={19} />, needsDocument: true, tone: 'green' },
  { id: 'metadata', group: 'optimize', titleKey: 'tool.metadata', descriptionKey: 'tool.metadata.d', icon: <Info size={19} />, needsDocument: true, tone: 'indigo' },
  { id: 'inspect', group: 'optimize', titleKey: 'tool.inspect', descriptionKey: 'tool.inspect.d', icon: <ScanSearch size={19} />, needsDocument: true, tone: 'indigo' },

  { id: 'watermark', group: 'content', titleKey: 'tool.watermark', descriptionKey: 'tool.watermark.d', icon: <Droplets size={19} />, needsDocument: true, tone: 'blue' },
  { id: 'pageNumbers', group: 'content', titleKey: 'tool.pageNumbers', descriptionKey: 'tool.pageNumbers.d', icon: <Hash size={19} />, needsDocument: true, tone: 'indigo' },
  { id: 'headerFooter', group: 'content', titleKey: 'tool.headerFooter', descriptionKey: 'tool.headerFooter.d', icon: <PanelTop size={19} />, needsDocument: true, tone: 'indigo' },
  { id: 'background', group: 'content', titleKey: 'tool.background', descriptionKey: 'tool.background.d', icon: <Paintbrush size={19} />, needsDocument: true, tone: 'purple' },
  { id: 'stamp', group: 'content', titleKey: 'tool.stamp', descriptionKey: 'tool.stamp.d', icon: <Stamp size={19} />, needsDocument: true, tone: 'rose' },
  { id: 'qr', group: 'content', titleKey: 'tool.qr', descriptionKey: 'tool.qr.d', icon: <QrCode size={19} />, needsDocument: true, tone: 'teal' },
  { id: 'replaceText', group: 'content', titleKey: 'tool.replaceText', descriptionKey: 'tool.replaceText.d', icon: <Replace size={19} />, needsDocument: true, tone: 'amber' },
  { id: 'rewriteParagraph', group: 'content', titleKey: 'tool.rewriteParagraph', descriptionKey: 'tool.rewriteParagraph.d', icon: <TextCursorInput size={19} />, needsDocument: true, tone: 'amber' },
  { id: 'extractImages', group: 'content', titleKey: 'tool.extractImages', descriptionKey: 'tool.extractImages.d', icon: <Images size={19} />, needsDocument: true, tone: 'teal' },
  { id: 'forms', group: 'content', titleKey: 'tool.forms', descriptionKey: 'tool.forms.d', icon: <ClipboardList size={19} />, needsDocument: true, tone: 'amber' },
  { id: 'compare', group: 'content', titleKey: 'tool.compare', descriptionKey: 'tool.compare.d', icon: <GitCompare size={19} />, needsDocument: false, tone: 'purple' },
  { id: 'bookmarks', group: 'content', titleKey: 'tool.bookmarks', descriptionKey: 'tool.bookmarks.d', icon: <ListTree size={19} />, needsDocument: true, tone: 'teal' },
  { id: 'attachments', group: 'content', titleKey: 'tool.attachments', descriptionKey: 'tool.attachments.d', icon: <Paperclip size={19} />, needsDocument: true, tone: 'blue' },
  { id: 'ocr', group: 'content', titleKey: 'tool.ocr', descriptionKey: 'tool.ocr.d', icon: <ScanText size={19} />, needsDocument: true, tone: 'green' },
  { id: 'batch', group: 'content', titleKey: 'tool.batch', descriptionKey: 'tool.batch.d', icon: <Layers size={19} />, needsDocument: false, tone: 'amber' }
]

/** Tools plus the eight converters shown on the Convert screen. */
export const TOOL_COUNT = TOOLS.length + 8

export const TOOL_GROUPS: { id: ToolGroup; labelKey: TranslationKey; icon: React.JSX.Element; tone: Tone }[] = [
  { id: 'pages', labelKey: 'tools.group.pages', icon: <Files size={15} />, tone: 'blue' },
  { id: 'optimize', labelKey: 'tools.group.optimize', icon: <Gauge size={15} />, tone: 'green' },
  { id: 'content', labelKey: 'tools.group.content', icon: <PenTool size={15} />, tone: 'purple' }
]

export function toolById(id: string): ToolDescriptor | undefined {
  return TOOLS.find((tool) => tool.id === id)
}
