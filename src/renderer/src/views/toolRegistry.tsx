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
  ScanText
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

export type ToolGroup = 'pages' | 'optimize' | 'content'

export interface ToolDescriptor {
  id: ToolId
  group: ToolGroup
  titleKey: TranslationKey
  descriptionKey: TranslationKey
  icon: React.JSX.Element
  /** Tools that operate on the document currently open in the workspace. */
  needsDocument: boolean
}

export const TOOLS: ToolDescriptor[] = [
  { id: 'merge', group: 'pages', titleKey: 'tool.merge', descriptionKey: 'tool.merge.d', icon: <Combine size={19} />, needsDocument: false },
  { id: 'split', group: 'pages', titleKey: 'tool.split', descriptionKey: 'tool.split.d', icon: <Scissors size={19} />, needsDocument: true },
  { id: 'splitSize', group: 'pages', titleKey: 'tool.splitSize', descriptionKey: 'tool.splitSize.d', icon: <SplitSquareHorizontal size={19} />, needsDocument: true },
  { id: 'extract', group: 'pages', titleKey: 'tool.extract', descriptionKey: 'tool.extract.d', icon: <FileOutput size={19} />, needsDocument: true },
  { id: 'deletePages', group: 'pages', titleKey: 'tool.deletePages', descriptionKey: 'tool.deletePages.d', icon: <Trash2 size={19} />, needsDocument: true },
  { id: 'rotate', group: 'pages', titleKey: 'tool.rotate', descriptionKey: 'tool.rotate.d', icon: <RotateCw size={19} />, needsDocument: true },
  { id: 'nup', group: 'pages', titleKey: 'tool.nup', descriptionKey: 'tool.nup.d', icon: <Rows3 size={19} />, needsDocument: true },
  { id: 'resize', group: 'pages', titleKey: 'tool.resize', descriptionKey: 'tool.resize.d', icon: <Ruler size={19} />, needsDocument: true },
  { id: 'crop', group: 'pages', titleKey: 'tool.crop', descriptionKey: 'tool.crop.d', icon: <Crop size={19} />, needsDocument: true },

  { id: 'compress', group: 'optimize', titleKey: 'tool.compress', descriptionKey: 'tool.compress.d', icon: <Shrink size={19} />, needsDocument: true },
  { id: 'compressAny', group: 'optimize', titleKey: 'tool.compressAny', descriptionKey: 'tool.compressAny.d', icon: <Minimize2 size={19} />, needsDocument: false },
  { id: 'protect', group: 'optimize', titleKey: 'tool.protect', descriptionKey: 'tool.protect.d', icon: <ShieldCheck size={19} />, needsDocument: true },
  { id: 'unlock', group: 'optimize', titleKey: 'tool.unlock', descriptionKey: 'tool.unlock.d', icon: <ShieldOff size={19} />, needsDocument: false },
  { id: 'optimize', group: 'optimize', titleKey: 'tool.optimize', descriptionKey: 'tool.optimize.d', icon: <Wand2 size={19} />, needsDocument: true },
  { id: 'metadata', group: 'optimize', titleKey: 'tool.metadata', descriptionKey: 'tool.metadata.d', icon: <Info size={19} />, needsDocument: true },

  { id: 'watermark', group: 'content', titleKey: 'tool.watermark', descriptionKey: 'tool.watermark.d', icon: <Droplets size={19} />, needsDocument: true },
  { id: 'pageNumbers', group: 'content', titleKey: 'tool.pageNumbers', descriptionKey: 'tool.pageNumbers.d', icon: <Hash size={19} />, needsDocument: true },
  { id: 'headerFooter', group: 'content', titleKey: 'tool.headerFooter', descriptionKey: 'tool.headerFooter.d', icon: <PanelTop size={19} />, needsDocument: true },
  { id: 'background', group: 'content', titleKey: 'tool.background', descriptionKey: 'tool.background.d', icon: <Paintbrush size={19} />, needsDocument: true },
  { id: 'stamp', group: 'content', titleKey: 'tool.stamp', descriptionKey: 'tool.stamp.d', icon: <Stamp size={19} />, needsDocument: true },
  { id: 'extractImages', group: 'content', titleKey: 'tool.extractImages', descriptionKey: 'tool.extractImages.d', icon: <Images size={19} />, needsDocument: true },
  { id: 'forms', group: 'content', titleKey: 'tool.forms', descriptionKey: 'tool.forms.d', icon: <ClipboardList size={19} />, needsDocument: true },
  { id: 'compare', group: 'content', titleKey: 'tool.compare', descriptionKey: 'tool.compare.d', icon: <GitCompare size={19} />, needsDocument: false },
  { id: 'bookmarks', group: 'content', titleKey: 'tool.bookmarks', descriptionKey: 'tool.bookmarks.d', icon: <ListTree size={19} />, needsDocument: true },
  { id: 'attachments', group: 'content', titleKey: 'tool.attachments', descriptionKey: 'tool.attachments.d', icon: <Paperclip size={19} />, needsDocument: true },
  { id: 'ocr', group: 'content', titleKey: 'tool.ocr', descriptionKey: 'tool.ocr.d', icon: <ScanText size={19} />, needsDocument: true }
]

/** Tools plus the eight converters shown on the Convert screen. */
export const TOOL_COUNT = TOOLS.length + 8

export const TOOL_GROUPS: { id: ToolGroup; labelKey: TranslationKey }[] = [
  { id: 'pages', labelKey: 'tools.group.pages' },
  { id: 'optimize', labelKey: 'tools.group.optimize' },
  { id: 'content', labelKey: 'tools.group.content' }
]
