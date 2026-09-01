import { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { useApp } from '../../store/app'
import { Button, Bytes, Card, Checkbox, Field, Segmented, Select, Switch, TextInput } from '../../components/ui'
import { FILTERS, pickOneFile, saveBytes } from '../../lib/files'
import { formatBytes, ltr, stripExtension } from '../../lib/format'
import * as ops from '../../lib/pdf/ops'
import { compressPdf, type CompressionLevel } from '../../lib/pdf/compress'
import { useApplied,
  useRunner, type ToolPanelProps } from './shared'

/* --------------------------------------------------------------- compress */

export function CompressPanel({ onClose }: ToolPanelProps): React.JSX.Element {
  const t = useApp((state) => state.t)
  const doc = useApp((state) => state.doc)
  const applyPdfBytes = useApp((state) => state.applyPdfBytes)
  const notify = useApp((state) => state.notify)
  const run = useRunner()
  const [level, setLevel] = useState<CompressionLevel>('balanced')
  const [grayscale, setGrayscale] = useState(false)
  // Pictures-only by default: it keeps the text as text. Re-rendering pages
  // is offered, not assumed.
  const [rasterize, setRasterize] = useState(false)

  if (!doc) return <p className="muted">{t('msg.noDocument')}</p>

  return (
    <div className="stack">
      <Field label={t('opt.level')}>
        <Select
          value={level}
          onChange={setLevel}
          options={[
            { value: 'light', label: t('opt.level.light') },
            { value: 'balanced', label: t('opt.level.balanced') },
            { value: 'strong', label: t('opt.level.strong') },
            { value: 'extreme', label: t('opt.level.extreme') }
          ]}
        />
      </Field>

      <Field label={t('opt.compressMode')} hint={rasterize ? t('opt.compressMode.rasterHint') : t('opt.compressMode.smartHint')}>
        <Segmented
          value={rasterize ? 'raster' : 'smart'}
          onChange={(value) => setRasterize(value === 'raster')}
          options={[
            { value: 'smart', label: t('opt.compressMode.smart') },
            { value: 'raster', label: t('opt.compressMode.raster') }
          ]}
        />
      </Field>
      <Checkbox checked={grayscale} onChange={setGrayscale} label={t('opt.grayscale')} />

      <Card style={{ background: 'var(--surface-2)' }}>
        <div className="row between">
          <span className="muted">{t('msg.sizeBefore')}</span>
          <strong className="mono"><Bytes value={doc.bytes.byteLength} /></strong>
        </div>
      </Card>

      <Button
        variant="primary"
        onClick={() =>
          void run(
            t('msg.working'),
            async (report, signal) => {
              const result = await compressPdf(
                doc.bytes,
                { level, grayscale, rasterize, onProgress: report, signal },
                doc.password
              )
              if (signal.aborted) return
              await applyPdfBytes(result.bytes)
              const saved = Math.max(0, result.before - result.after)
              const percent = result.before > 0 ? Math.round((saved / result.before) * 100) : 0
              notify({
                kind: 'success',
                title: `${t('msg.sizeAfter')}: ${ltr(formatBytes(result.after))}`,
                message:
                  `${t('msg.reduction')}: ${ltr(formatBytes(saved))} (${percent}%)` +
                  (result.imagesRecompressed > 0
                    ? ` · ${t('msg.imagesRecompressed', { n: result.imagesRecompressed })}`
                    : '')
              })
              onClose()
            },
            // Only the rasterising path is long enough to be worth stopping.
            { cancellable: rasterize }
          )
        }
      >
        {t('tool.compress')}
      </Button>
    </div>
  )
}

/* --------------------------------------------------------------- security */

const PERMISSION_KEYS = [
  'printing',
  'modifying',
  'copying',
  'annotating',
  'fillingForms',
  'contentAccessibility',
  'documentAssembly'
] as const

export function ProtectPanel({ onClose }: ToolPanelProps): React.JSX.Element {
  const t = useApp((state) => state.t)
  const doc = useApp((state) => state.doc)
  const run = useRunner()
  const [userPassword, setUserPassword] = useState('')
  const [ownerPassword, setOwnerPassword] = useState('')
  const [permissions, setPermissions] = useState<ops.PermissionSet>({
    printing: true,
    modifying: false,
    copying: false,
    annotating: true,
    fillingForms: true,
    contentAccessibility: true,
    documentAssembly: false
  })

  if (!doc) return <p className="muted">{t('msg.noDocument')}</p>

  return (
    <div className="stack">
      <Field label={t('opt.userPassword')}>
        <TextInput type="password" value={userPassword} onChange={setUserPassword} />
      </Field>
      <Field label={t('opt.ownerPassword')}>
        <TextInput type="password" value={ownerPassword} onChange={setOwnerPassword} />
      </Field>

      <Field label={t('opt.permissions')}>
        <div className="stack tight">
          {PERMISSION_KEYS.map((key) => (
            <Checkbox
              key={key}
              checked={permissions[key]}
              onChange={(checked) => setPermissions({ ...permissions, [key]: checked })}
              label={t(`opt.perm.${key}` as never)}
            />
          ))}
        </div>
      </Field>

      <Button
        variant="primary"
        disabled={!userPassword && !ownerPassword}
        onClick={() =>
          void run(t('msg.working'), async () => {
            const protectedBytes = await ops.encryptDocument(
              doc.bytes,
              userPassword,
              ownerPassword,
              permissions,
              doc.password
            )
            const outcome = await saveBytes(
              protectedBytes,
              `${stripExtension(doc.name)}-protected.pdf`,
              FILTERS.pdf
            )
            if (!outcome.saved) return
            onClose()
            return outcome.path
          })
        }
      >
        <ShieldCheck size={15} />
        {t('tool.protect')}
      </Button>
    </div>
  )
}

export function UnlockPanel({ onClose }: ToolPanelProps): React.JSX.Element {
  const t = useApp((state) => state.t)
  const run = useRunner()
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array } | null>(null)
  const [password, setPassword] = useState('')

  return (
    <div className="stack">
      <Button
        onClick={async () => {
          const picked = await pickOneFile(FILTERS.pdf)
          if (picked) setFile({ name: picked.name, bytes: picked.data })
        }}
      >
        {file ? file.name : t('action.browse')}
      </Button>
      <Field label={t('opt.currentPassword')}>
        <TextInput type="password" value={password} onChange={setPassword} />
      </Field>
      <Button
        variant="primary"
        disabled={!file}
        onClick={() =>
          void run(t('msg.working'), async () => {
            const opened = await ops.decryptDocument(file!.bytes, password)
            const outcome = await saveBytes(
              opened,
              `${stripExtension(file!.name)}-unlocked.pdf`,
              FILTERS.pdf
            )
            if (!outcome.saved) return
            onClose()
            return outcome.path
          })
        }
      >
        {t('tool.unlock')}
      </Button>
    </div>
  )
}

/* --------------------------------------------------------------- optimize */

export function OptimizePanel({ onClose }: ToolPanelProps): React.JSX.Element {
  const t = useApp((state) => state.t)
  const applied = useApplied()
  const doc = useApp((state) => state.doc)
  const notify = useApp((state) => state.notify)
  const run = useRunner()

  if (!doc) return <p className="muted">{t('msg.noDocument')}</p>

  return (
    <div className="stack">
      <p className="muted">{t('tool.optimize.d')}</p>
      <Button
        variant="primary"
        onClick={() =>
          void run(t('msg.working'), async () => {
            const before = doc.bytes.byteLength
            const next = await ops.optimizeDocument(doc.bytes, doc.password)
            await applied(next, 'tool.optimize')
            notify({
              kind: 'success',
              title: `${t('msg.sizeAfter')}: ${ltr(formatBytes(next.byteLength))}`,
              message: `${t('msg.sizeBefore')}: ${ltr(formatBytes(before))}`
            })
            onClose()
          })
        }
      >
        {t('action.run')}
      </Button>
    </div>
  )
}

/* --------------------------------------------------------------- metadata */

export function MetadataPanel({ onClose }: ToolPanelProps): React.JSX.Element {
  const t = useApp((state) => state.t)
  const applied = useApplied()
  const doc = useApp((state) => state.doc)
  const reportError = useApp((state) => state.reportError)
  const run = useRunner()
  const [meta, setMeta] = useState<ops.DocumentMetadata | null>(null)

  useEffect(() => {
    if (!doc) return
    ops
      .readMetadata(doc.bytes, doc.password)
      .then(setMeta)
      .catch((error) => reportError(error))
  }, [doc, reportError])

  if (!doc) return <p className="muted">{t('msg.noDocument')}</p>
  if (!meta) return <p className="muted">{t('msg.loading')}</p>

  const fields: [keyof ops.DocumentMetadata, string][] = [
    ['title', t('opt.title')],
    ['author', t('opt.author')],
    ['subject', t('opt.subject')],
    ['keywords', t('opt.keywords')],
    ['creator', t('opt.creator')],
    ['producer', t('opt.producer')]
  ]

  return (
    <div className="stack">
      {fields.map(([key, label]) => (
        <Field key={key} label={label}>
          <TextInput
            value={String(meta[key] ?? '')}
            onChange={(value) => setMeta({ ...meta, [key]: value })}
          />
        </Field>
      ))}

      <Card style={{ background: 'var(--surface-2)' }}>
        <div className="row between">
          <span className="muted">{t('msg.pages')}</span>
          <strong>{meta.pageCount}</strong>
        </div>
        {meta.creationDate ? (
          <div className="row between" style={{ marginTop: 6 }}>
            <span className="muted">{t('opt.title')}</span>
            <span className="mono">{meta.creationDate.toLocaleDateString()}</span>
          </div>
        ) : null}
        {meta.encrypted ? (
          <div style={{ marginTop: 8 }}>
            <span className="badge red">{t('msg.encrypted')}</span>
          </div>
        ) : null}
      </Card>

      <Button
        variant="primary"
        onClick={() =>
          void run(t('msg.working'), async () => {
            const next = await ops.writeMetadata(doc.bytes, meta, doc.password)
            await applied(next, 'tool.metadata')
            onClose()
          })
        }
      >
        {t('action.apply')}
      </Button>
    </div>
  )
}
