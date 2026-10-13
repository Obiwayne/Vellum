// "Export handoff" dialog (docs/factory/T65-design.md; artboards D02 and D05 in T58-screens): pick screens, options,
// review counts and the file tree, then write a folder or a zip. States: form, empty (nothing ready), exporting,
// failed, done.
import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Button, Checkbox, IconButton, Modal } from '../../ui'
import { useStore } from '../../model/store'
import { numericSize } from '../../model/ops'
import type { Doc } from '../../model/types'
import { topLevelFrames } from '../../handoff/collect'
import { readyStatus } from '../../handoff/ready'
import { previewExport, runExport, type ExportOutcome, type ExportRequest, type Preview } from '../../handoff/exportFlow'
import { promptFor } from '../../handoff/exportPrompt'
import { appExportDeps, useExportHandoff } from './exportDialog'
import { treeLines } from './treeLines'
import { queryLocalFamilies } from '../inspector/fonts'
import './export-handoff.css'

/** "1 screen", "2 screens" */
export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`

const WORDS = ['', 'one', 'two', 'three', 'four', 'five']
const list = (names: string[]): string => (names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`)

/** The D02 note under the screens: tagged frames of one screen export together. */
export function groupingNotes(doc: Doc, ids: string[]): string[] {
  const groups = new Map<string, { name: string; frames: Array<{ bp: string; width: number }> }>()
  for (const id of ids) {
    const n = doc.nodes[id]
    const tag = n?.dev?.screen
    if (!tag) continue
    const key = tag.name.trim().toLowerCase()
    const g = groups.get(key) ?? { name: tag.name.trim(), frames: [] }
    g.frames.push({ bp: tag.bp, width: numericSize(n.style.width as string | number | undefined) ?? 0 })
    groups.set(key, g)
  }
  const out: string[] = []
  for (const g of groups.values()) {
    if (g.frames.length < 2) continue
    const frames = [...g.frames].sort((a, b) => b.width - a.width)
    const count = WORDS[frames.length] ?? String(frames.length)
    const widths = frames.map((f) => f.width).filter(Boolean)
    out.push(`${list(frames.map((f) => f.bp))} export as one screen, ${g.name}, with ${count} breakpoints${widths.length ? ` (${widths.join(' / ')})` : ''}.`)
  }
  return out
}

const dateText = (at: number): string => new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

/** A path that may wrap at its separators but never inside a name. */
const wrapPath = (p: string): JSX.Element[] =>
  p.split(/([\\/])/).map((part, i) =>
    part === '/' || part === '\\' ? (
      <span key={i}>
        {part}
        <wbr />
      </span>
    ) : (
      <span key={i}>{part}</span>
    )
  )

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
            <Button onClick={() => void navigator.clipboard?.writeText(promptFor(o.paths))}>Copy prompt</Button>
            <Button variant="primary" onClick={() => void window.canvasApi?.showInFolder(o.path)}>
              {o.kind === 'zip' ? 'Show file' : 'Open folder'}
            </Button>
          </>
        }>
        <div className="eh-state">
          <p className="eh-ok">
            {plural(o.summary.screens, 'screen')}, {plural(o.summary.nodes, 'layer')}, {plural(o.summary.assets, 'asset')}, {mb(o.bytes)}
          </p>
          <p className="eh-path" title={o.path}>{wrapPath(o.path)}</p>
          <p className="eh-muted">
            {o.versionSaved ? `Saved in version history as “Handoff v${o.version}”. ` : ''}Tell Claude Code: {promptFor(o.paths).replace(/^Read/, 'read')}.
          </p>
          {o.warnings.length > 0 && (
            <div className="eh-callout" role="note">
              {o.warnings.slice(0, 5).map((w) => (
                <p key={w}>{w}</p>
              ))}
            </div>
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
  const notes = groupingNotes(doc, frames)
  const subtitle = `A folder (or zip) a developer puts next to their repo. Needs no Vellum.${preview?.previous ? ` Previous handoff: v${preview.previous.version}${preview.previous.at ? `, ${dateText(preview.previous.at)}` : ''}.` : ''}`
  // pulls and hidden layers first, then the writer's own warnings (its "Pulls in" line repeats the first)
  const callout: string[] = []
  for (const p of preview?.pulls ?? []) callout.push(`Pulls in ${plural(p.names.length, 'component')} from page ${p.page}: ${p.names.join(', ')}.`)
  if (preview && preview.hidden > 0) callout.push(`${plural(preview.hidden, 'hidden layer')} ${preview.hidden === 1 ? 'is' : 'are'} left out.`)
  for (const w of preview?.warnings ?? []) if (!/^Pulls in /.test(w) && callout.length < 6) callout.push(w)
  const counts: Array<[number | undefined, string, string]> = [
    [preview?.screens, 'screen', 'screens'],
    [preview?.layers, 'layer', 'layers'],
    [preview?.assets, 'asset', 'assets'],
    [preview?.fonts, 'font', 'fonts']
  ]
  return (
    <Modal open bare onClose={close} width={820}
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
      <div className="eh-head">
        <div>
          <div className="eh-title">{title}</div>
          <div className="eh-sub">{subtitle}</div>
        </div>
        <IconButton icon={<X size={16} />} label="Close" onClick={close} />
      </div>
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
          {notes.map((n) => (
            <p key={n} className="eh-muted" data-testid="eh-grouping">
              {n}
            </p>
          ))}
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
            <p className="eh-error">Could not prepare the preview: {planError}.</p>
          ) : (
            <div className="eh-counts" aria-busy={planning}>
              {counts.map(([n, one, many]) => (
                <div key={one}>
                  <b>{planning || n === undefined ? '…' : String(n)}</b>
                  <span>{n === 1 ? one : many}</span>
                </div>
              ))}
            </div>
          )}
          {callout.length > 0 && (
            <div className="eh-callout" role="note" data-testid="eh-callout">
              {callout.map((c) => (
                <p key={c}>{c}</p>
              ))}
            </div>
          )}
          {preview && <pre className="eh-tree">{treeLines(preview.files, preview.folderName).join('\n')}</pre>}
        </div>
      </div>
    </Modal>
  )
}
