import { motion } from 'framer-motion'
import { FileText, FilePlus2, FolderOpen } from 'lucide-react'
import { useApp } from '../store/app'
import { Button, Modal, useSpotlight } from '../components/ui'
import { useDocumentActions } from '../hooks/useDocumentActions'
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
import { RedactPanel } from './tools/redactTools'

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
  ocr: OcrPanel,
  redact: RedactPanel
}

export function ToolsView(): React.JSX.Element {
  const t = useApp((state) => state.t)
  const openTool = useApp((state) => state.activeTool) as ToolId | null
  const requestTool = useApp((state) => state.openTool)
  const closeTool = useApp((state) => state.closeTool)
  const doc = useApp((state) => state.doc)
  const editorDoc = useApp((state) => state.editorDoc)
  const navigate = useApp((state) => state.navigate)
  const { openDialog, bridgeEditorToPdf } = useDocumentActions()
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

      <WorkspaceBar
        pdfName={doc?.name ?? null}
        editorName={editorDoc?.source.name ?? null}
        onOpen={() => void openDialog()}
        onConvert={() => void bridgeEditorToPdf()}
        onGoToEditor={() => navigate('editor')}
        onGoToViewer={() => navigate('viewer')}
      />

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
                onClick={() => requestTool(tool.id, Boolean(tool.needsDocument))}
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
        onClose={closeTool}
        title={descriptor ? t(descriptor.titleKey) : ''}
        wide={openTool === 'compare'}
      >
        {Panel ? <Panel onClose={closeTool} /> : null}
      </Modal>
    </div>
  )
}

/**
 * What the tools will act on, and how to give them something if they cannot.
 *
 * The app holds two document slots — the PDF one the tools use, and the editor
 * one every other format lives in — and nothing on screen said so. A Word file
 * open in the editor left every tool answering "open a document first", with
 * no hint that the answer was to convert it. This states which document is
 * loaded, and offers the conversion in place of the dead end.
 */
function WorkspaceBar({
  pdfName,
  editorName,
  onOpen,
  onConvert,
  onGoToEditor,
  onGoToViewer
}: {
  pdfName: string | null
  editorName: string | null
  onOpen: () => void
  onConvert: () => void
  onGoToEditor: () => void
  onGoToViewer: () => void
}): React.JSX.Element {
  const t = useApp((state) => state.t)

  return (
    <div className="workspace-bar">
      <span className="muted" style={{ fontWeight: 650 }}>
        {t('workspace.title')}
      </span>

      {pdfName ? (
        <button className="ws-doc active" onClick={onGoToViewer} title={t('workspace.switch')}>
          <FileText size={14} />
          <span className="ws-kind">{t('workspace.pdfSlot')}</span>
          <bdi className="ws-name">{pdfName}</bdi>
        </button>
      ) : null}

      {editorName ? (
        <button className="ws-doc" onClick={onGoToEditor} title={t('workspace.switch')}>
          <FilePlus2 size={14} />
          <span className="ws-kind">{t('workspace.editorSlot')}</span>
          <bdi className="ws-name">{editorName}</bdi>
        </button>
      ) : null}

      {!pdfName && !editorName ? <span className="muted">{t('workspace.empty')}</span> : null}

      <span className="spacer" />

      {!pdfName && editorName ? (
        <Button size="sm" variant="primary" onClick={onConvert}>
          {t('workspace.convert')}
        </Button>
      ) : null}
      <Button size="sm" variant="ghost" onClick={onOpen}>
        <FolderOpen size={15} />
        {t('workspace.open')}
      </Button>
    </div>
  )
}
