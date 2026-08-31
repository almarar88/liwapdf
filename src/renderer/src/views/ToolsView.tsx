import { motion } from 'framer-motion'
import { useState } from 'react'
import { useApp } from '../store/app'
import { Modal, useSpotlight } from '../components/ui'
import { TOOLS, TOOL_GROUPS, type ToolId } from './toolRegistry'
import {
  MergePanel,
  SplitPanel,
  SplitBySizePanel,
  ExtractPanel,
  DeletePagesPanel,
  RotatePanel,
  NUpPanel,
  ResizePanel,
  CropPanel
} from './tools/pageTools'
import { CompressAnyPanel } from './tools/compressTool'
import {
  CompressPanel,
  ProtectPanel,
  UnlockPanel,
  OptimizePanel,
  MetadataPanel
} from './tools/optimizeTools'
import {
  WatermarkPanel,
  PageNumbersPanel,
  HeaderFooterPanel,
  BackgroundPanel,
  StampPanel,
  ExtractImagesPanel,
  FormsPanel,
  ComparePanel,
  BookmarksPanel,
  AttachmentsPanel
} from './tools/contentTools'
import { OcrPanel } from './tools/ocrTools'

const PANELS: Record<ToolId, (props: { onClose: () => void }) => React.JSX.Element> = {
  merge: MergePanel,
  split: SplitPanel,
  splitSize: SplitBySizePanel,
  extract: ExtractPanel,
  deletePages: DeletePagesPanel,
  rotate: RotatePanel,
  nup: NUpPanel,
  resize: ResizePanel,
  crop: CropPanel,
  compress: CompressPanel,
  compressAny: CompressAnyPanel,
  protect: ProtectPanel,
  unlock: UnlockPanel,
  optimize: OptimizePanel,
  metadata: MetadataPanel,
  watermark: WatermarkPanel,
  pageNumbers: PageNumbersPanel,
  headerFooter: HeaderFooterPanel,
  background: BackgroundPanel,
  stamp: StampPanel,
  extractImages: ExtractImagesPanel,
  forms: FormsPanel,
  compare: ComparePanel,
  bookmarks: BookmarksPanel,
  attachments: AttachmentsPanel,
  ocr: OcrPanel
}

export function ToolsView(): React.JSX.Element {
  const t = useApp((state) => state.t)
  const doc = useApp((state) => state.doc)
  const notify = useApp((state) => state.notify)
  const [openTool, setOpenTool] = useState<ToolId | null>(null)
  const spotlight = useSpotlight()

  const descriptor = openTool ? TOOLS.find((tool) => tool.id === openTool) : null
  const Panel = openTool ? PANELS[openTool] : null

  return (
    <div className="view">
      <div className="page-head">
        <div>
          <h1>{t('tools.title')}</h1>
          <p>{t('tools.sub')}</p>
        </div>
      </div>

      {TOOL_GROUPS.map((group) => (
        <section key={group.id}>
          <h2 className="section-title">{t(group.labelKey)}</h2>
          <div className="grid cols-3">
            {TOOLS.filter((tool) => tool.group === group.id).map((tool, index) => (
              <motion.button
                key={tool.id}
                className="tool"
                {...spotlight}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.02, duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                onClick={() => {
                  if (tool.needsDocument && !doc) {
                    notify({ kind: 'info', title: t('msg.noDocument') })
                    return
                  }
                  setOpenTool(tool.id)
                }}
              >
                <span className="icon">{tool.icon}</span>
                <h3>{t(tool.titleKey)}</h3>
                <p>{t(tool.descriptionKey)}</p>
              </motion.button>
            ))}
          </div>
        </section>
      ))}

      <Modal
        open={Boolean(openTool)}
        onClose={() => setOpenTool(null)}
        title={descriptor ? t(descriptor.titleKey) : ''}
        wide={openTool === 'compare'}
      >
        {Panel ? <Panel onClose={() => setOpenTool(null)} /> : null}
      </Modal>
    </div>
  )
}
