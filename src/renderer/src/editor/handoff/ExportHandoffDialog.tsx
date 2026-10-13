// "Export handoff" dialog (docs/factory/T65-design.md; artboards D02 and D05 in T58-screens): pick screens, options,
// review counts and the file tree, then write a folder or a zip. States: form, empty (nothing ready), exporting,
// failed, done.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Checkbox, Modal } from '../../ui'
import { useStore } from '../../model/store'
import type { Doc } from '../../model/types'
import { topLevelFrames } from '../../handoff/collect'
import { readyStatus } from '../../handoff/ready'
import { previewExport, runExport, type ExportOutcome, type ExportRequest, type Preview } from '../../handoff/exportFlow'
import { appExportDeps, useExportHandoff } from './exportDialog'
import { treeLines } from './treeLines'
import { queryLocalFamilies } from '../inspector/fonts'
import './export-handoff.css'

export const PROMPT = 'Read HANDOFF.md first, then CHANGES.md; build and verify against screens/*.png'

type Phase = 'form' | 'exporting' | 'done' | 'failed'

interface Row {
  id: string
  name: string
  screen?: string
  status: 'ready' | 'changed' | null
}

const rowsOf = (doc: Doc): Row[] =>
  topLevelFrames(doc).map((id) => {
    const n = doc.nodes[id]
    return { id, name: n.name, screen: n.dev?.screen ? `${n.dev.screen.name} · ${n.dev.screen.bp}` : undefined, status: readyStatus(doc, id) }
  })

const mb = (bytes: number): string => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)

export function ExportHandoffDialog(): JSX.Element | null {
  const docId = useExportHandoff((s) => s.docId)
  const close = useExportHandoff((s) => s.close)
  const doc = useStore((s) => (docId ? s.docs[docId] : undefined))
  const [phase, setPhase] = useState<Phase>('form')
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [showAll, setShowAll] = useState(false)
  const [retina, setRetina] = useState(true)
  const [rem, setRem] = useState(false)
  const [devNotes, setDevNotes] = useState(true)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [planning, setPlanning] = useState(false)
  const [planError, setPlanError] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null)
  const [outcome, setOutcome] = useState<ExportOutcome | null>(null)
  const abort = useRef<AbortController | null>(null)
  const localFonts = useRef<string[] | undefined>(undefined)

  const rows = useMemo(() => (doc ? rowsOf(doc) : []), [doc])
  const readyRows = rows.filter((r) => r.status)
  const visible = showAll || readyRows.length === 0 ? rows : readyRows
  const empty = Boolean(doc) && readyRows.length === 0 && !showAll

  // reset when the dialog opens: ready frames (changed ones included) are ticked
  useEffect(() => {
    if (!docId || !doc) return
    setPhase('form')
    setOutcome(null)
    setProgress(null)
    setShowAll(false)
    setChosen(new Set(rowsOf(doc).filter((r) => r.status).map((r) => r.id)))
    void queryLocalFamilies().then((f) => (localFonts.current = f ?? undefined))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId])

  const request = (kind: 'folder' | 'zip'): ExportRequest => ({
    frames: rows.filter((r) => chosen.has(r.id)).map((r) => r.id),
    retina,
    rem,
    devNotes,
    kind
  })
  const frames = request('folder').frames

  // the review panel: counts, notices and the file tree for the current choice
  useEffect(() => {
    if (!docId || !doc || phase !== 'form') return
    if (!frames.length) {
      setPreview(null)
      setPlanError(null)
      return
    }
    let stale = false
    setPlanning(true)
    const t = setTimeout(() => {
      previewExport(doc, request('folder'), appExportDeps(docId, localFonts.current))
        .then((p) => !stale && (setPreview(p), setPlanError(null)))
        .catch((e) => !stale && (setPreview(null), setPlanError(e instanceof Error ? e.message : String(e))))
        .finally(() => !stale && setPlanning(false))
    }, 200)
    return () => {
      stale = true
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, doc, phase, frames.join(','), retina, rem, devNotes])

  if (!docId || !doc) return null

  const start = async (kind: 'folder' | 'zip'): Promise<void> => {
    if (!frames.length) return
    const ctl = new AbortController()
    abort.current = ctl
    setPhase('exporting')
    setProgress({ done: 0, total: 0, label: '' })
    const out = await runExport(doc, request(kind), appExportDeps(docId, localFonts.current), { onProgress: setProgress, signal: ctl.signal })
    abort.current = null
    if (!out.ok && out.canceled) {
      setPhase('form') // nothing was written
      return
    }
    setOutcome(out)
    setPhase(out.ok ? 'done' : 'failed')
  }

  const toggle = (id: string): void =>
    setChosen((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  // ---- exporting
  if (phase === 'exporting') {
    const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0
    return (
      <Modal open onClose={() => abort.current?.abort()} title={`Exporting handoff v${preview?.version ?? ''}…`} width={460}
        footer={<Button onClick={() => abort.current?.abort()}>Cancel</Button>}>
        <div className="eh-state">
          <div className="eh-progress" role="progressbar" aria-valuenow={pct}>
            <div className="eh-progress__bar" style={{ width: `${progress?.total ? pct : 8}%` }} />
          </div>
          <p className="eh-muted">{progress?.label ? `Producing ${progress.label}` : 'Measuring layout, planning assets, writing files.'}</p>
        </div>
      </Modal>
    )
  }

  // ---- done
  if (phase === 'done' && outcome?.ok) {
    const o = outcome
    return (
      <Modal open onClose={close} title={`Handoff v${o.version} exported`} width={520}
        footer={
          <>
            <Button onClick={() => void navigator.clipboard?.writeText(PROMPT)}>Copy prompt</Button>
            <Button variant="primary" onClick={() => void window.canvasApi?.showInFolder(o.path)}>
              {o.kind === 'zip' ? 'Show file' : 'Open folder'}
            </Button>
          </>
        }>
        <div className="eh-state">
          <p className="eh-ok">
            {o.summary.screens} screen{o.summary.screens === 1 ? '' : 's'}, {o.summary.nodes} layers, {o.files} files, {mb(o.bytes)}
          </p>
          <p className="eh-path">{o.path}</p>
          <p className="eh-muted">Saved in version history as “Handoff v{o.version}”. Tell Claude Code: read HANDOFF.md first.</p>
          {o.warnings.length > 0 && (
            <ul className="eh-warn">
              {o.warnings.slice(0, 5).map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      </Modal>
    )
  }

  // ---- failed
  if (phase === 'failed' && outcome && !outcome.ok && !outcome.canceled) {
    return (
      <Modal open onClose={close} title="Could not export" width={500}
        footer={
          <>
            <Button onClick={close}>Close</Button>
            <Button variant="primary" onClick={() => setPhase('form')}>
              Choose another folder…
            </Button>
          </>
        }>
        <div className="eh-state">
          <p className="eh-error">{outcome.error}</p>
          <p className="eh-muted">Nothing was written: the bundle is built in a temporary folder and moved into place when it is complete.</p>
        </div>
      </Modal>
    )
  }

  // ---- empty: nothing is ready yet
  if (empty) {
    return (
      <Modal open onClose={close} title="Export handoff" width={460}
        footer={
          <>
            <Button onClick={() => setShowAll(true)} disabled={!rows.length}>
              Choose frames anyway
            </Button>
            <Button onClick={close}>Close</Button>
          </>
        }>
        <div className="eh-state">
          {rows.length ? (
            <>
              <h3 className="eh-h">No screens are ready for dev</h3>
              <p className="eh-muted">
                Mark a top-level frame as Ready for dev in the Layers menu or the inspector. Only ready frames are exported by default.
              </p>
            </>
          ) : (
            <>
              <h3 className="eh-h">Nothing to export</h3>
              <p className="eh-muted">Add a frame first.</p>
            </>
          )}
        </div>
      </Modal>
    )
  }

  // ---- the form
  const title = `Export handoff · v${preview?.version ?? '…'}`
  const canExport = frames.length > 0 && !planning
  return (
    <Modal open onClose={close} title={title} width={820}
      footer={
        <>
          <span className="eh-foot">Writes a decrypted copy to a folder you choose. Nothing is uploaded.</span>
          <Button onClick={close}>Cancel</Button>
          <Button disabled={!canExport} onClick={() => void start('zip')}>
            Save as zip…
          </Button>
          <Button variant="primary" disabled={!canExport} onClick={() => void start('folder')}>
            Export folder…
          </Button>
        </>
      }>
      <div className="eh-grid">
        <div className="eh-col">
          <div className="eh-label">Screens</div>
          {showAll && <div className="eh-banner">These frames are not all marked ready.</div>}
          <div className="eh-rows">
            {visible.map((r) => (
              <div key={r.id} className="eh-row">
                <Checkbox checked={chosen.has(r.id)} onChange={() => toggle(r.id)} label={<span className="eh-name">{r.screen ?? r.name}</span>} />
                <span className={'eh-badge' + (r.status === 'ready' ? ' eh-badge--ready' : r.status === 'changed' ? ' eh-badge--changed' : '')}>
                  {r.status === 'ready' ? 'Ready' : r.status === 'changed' ? 'Changed since ready' : 'Not ready'}
                </span>
              </div>
            ))}
          </div>
          {!frames.length && <p className="eh-muted">Tick at least one screen.</p>}
          <div className="eh-label">Options</div>
          <Checkbox checked={retina} onChange={setRetina} label="PNG reference renders (1x, 2x)" />
          <Checkbox checked={rem} onChange={setRem} label="Show rem next to px (base 16)" />
          <Checkbox checked={devNotes} onChange={setDevNotes} label="Dev notes" />
          <Checkbox checked={false} onChange={() => undefined} disabled label="Comments (not available yet)" />
          <Checkbox checked={false} onChange={() => undefined} disabled label="Include Google font files (not available yet)" />
        </div>
        <div className="eh-col eh-col--review">
          <div className="eh-label">Review before writing</div>
          {planError ? (
            <p className="eh-error">Could not prepare the preview: {planError}. You can still export without images.</p>
          ) : (
            <div className="eh-counts" aria-busy={planning}>
              {[
                [preview?.screens, 'screens'],
                [preview?.layers, 'layers'],
                [preview?.assets, 'assets'],
                [preview?.fonts, 'fonts']
              ].map(([n, l]) => (
                <div key={String(l)}>
                  <b>{planning || n === undefined ? '…' : String(n)}</b>
                  <span>{String(l)}</span>
                </div>
              ))}
            </div>
          )}
          {preview && (preview.pulls.length > 0 || preview.hidden > 0) && (
            <div className="eh-notice">
              {preview.pulls.map((p) => (
                <span key={p.page}>
                  Pulls in {p.names.length} component{p.names.length === 1 ? '' : 's'} from page {p.page}: {p.names.join(', ')}.{' '}
                </span>
              ))}
              {preview.hidden > 0 && <span>{preview.hidden} hidden layer{preview.hidden === 1 ? ' is' : 's are'} left out.</span>}
            </div>
          )}
          {preview && <pre className="eh-tree">{treeLines(preview.files, preview.folderName).join('\n')}</pre>}
          {preview && preview.warnings.length > 0 && (
            <ul className="eh-warn">
              {preview.warnings.slice(0, 4).map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  )
}
