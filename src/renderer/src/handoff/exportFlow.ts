// The Export handoff flow (T65 / H5) without any UI: what the dialog shows before writing (`previewExport`) and what
// the Export button does (`runExport`): number the hand-off, plan the assets, build the bundle (H3), produce the
// images and PNG references (H4), hand the finished file map to the main process to write, and only then record the
// named version. Everything platform-specific is injected, so the same code runs in the app and in tests.
import type { HandoffExportArgs, HandoffExportResult } from '@shared/api'
import type { Doc } from '../model/types'
import type { Measure } from '../model/devSpec'
import { topLevelOf } from '../model/ops'
import { buildHandoff } from './index'
import { planAssets, planScreenPngs, runAssetJobs, type AssetEngine } from './assets'
import { selectFrames } from './collect'
import { handoffVersionName, nextHandoffNumber } from './ready'
import { slug } from './paths'
import type { BundleFiles, FontSource, HandoffResult } from './types'

export interface ExportRequest {
  /** top-level frame ids to export */
  frames: string[]
  /** PNG reference renders at 2x as well as 1x */
  retina: boolean
  /** print rem next to px in the markdown */
  rem: boolean
  /** include dev notes (default on); off strips them before building */
  devNotes: boolean
  kind: 'folder' | 'zip'
}

export interface ExportDeps {
  measure?: Measure
  engine: AssetEngine
  write: (args: HandoffExportArgs) => Promise<HandoffExportResult>
  saveVersion: (name: string) => Promise<unknown>
  listVersions: () => Promise<ReadonlyArray<{ name?: string | null }>>
  now: () => string
  vellum: string
  fontSource?: (family: string) => FontSource
}

export interface Preview {
  /** the number this export will carry */
  version: number
  folderName: string
  screens: number
  breakpoints: number
  layers: number
  assets: number
  fonts: number
  components: number
  hidden: number
  /** components used by the chosen frames that live on another page: "Button, Input from page Library" */
  pulls: Array<{ page: string; names: string[] }>
  warnings: string[]
  /** every path the bundle will contain, PNG references and image variants included */
  files: string[]
}

export type ExportOutcome =
  | { ok: true; path: string; files: number; bytes: number; version: number; kind: 'folder' | 'zip'; warnings: string[]; summary: HandoffResult['summary'] }
  | { ok: false; canceled: true; stage: 'save-dialog' | 'building' }
  | { ok: false; error: string; canceled?: undefined }

/** `doc` without dev notes (the "Dev notes" option off). Nothing else changes. */
function withoutNotes(doc: Doc): Doc {
  let nodes: Doc['nodes'] | null = null
  for (const [id, n] of Object.entries(doc.nodes)) {
    if (!n.dev?.notes) continue
    nodes ??= { ...doc.nodes }
    const { notes: _notes, ...rest } = n.dev
    void _notes
    nodes[id] = { ...n, dev: Object.keys(rest).length ? rest : undefined }
  }
  return nodes ? { ...doc, nodes } : doc
}

const pageOf = (doc: Doc, id: string): string | null => {
  const top = topLevelOf(doc, id)
  const parent = top ? doc.nodes[top]?.parent : null
  return doc.pages.find((p) => p.rootId === parent)?.name ?? null
}

export const folderNameFor = (doc: Doc, version: number): string => `${slug(doc.name, 'handoff')}-handoff-v${version}`

async function assemble(doc: Doc, req: ExportRequest, deps: ExportDeps, version: number) {
  const source = req.devNotes ? doc : withoutNotes(doc)
  const plan = await planAssets(source, { frames: req.frames, ...(deps.measure ? { measure: deps.measure } : {}) })
  const built = buildHandoff(source, {
    frames: req.frames,
    version,
    exportedAt: deps.now(),
    vellum: deps.vellum,
    rem: req.rem,
    ...(deps.measure ? { measure: deps.measure } : {}),
    ...(deps.fontSource ? { fontSource: deps.fontSource } : {}),
    assets: plan.records,
    warnings: plan.warnings
  })
  return { source, plan, built }
}

/** Everything the dialog shows before anything is written. Cheap enough to run on every change of the options. */
export async function previewExport(doc: Doc, req: ExportRequest, deps: ExportDeps): Promise<Preview> {
  const version = nextHandoffNumber(await deps.listVersions())
  const { plan, built } = await assemble(doc, req, deps, version)
  const spec = JSON.parse(built.files['spec.json'] ?? '{}') as {
    screens?: Array<{ breakpoints?: Array<{ png?: string; frameId: string }> }>
    components?: Array<{ ref: string; name: string; variants: Array<{ ref: string }> }>
  }
  const pngs = (spec.screens ?? []).flatMap((s) => (s.breakpoints ?? []).flatMap((b) => (b.png ? (req.retina ? [b.png, b.png.replace(/\.png$/, '@2x.png')] : [b.png]) : [])))
  const assetPaths = plan.records.flatMap((r) => [r.path, ...(r.variants?.map((v) => v.path) ?? [])]).filter((p) => !/^https?:/i.test(p))
  const files = [...new Set([...Object.keys(built.files), ...pngs, ...assetPaths])].sort()

  const chosenPages = new Set(req.frames.map((id) => pageOf(doc, id)).filter((x): x is string => Boolean(x)))
  const byPage = new Map<string, string[]>()
  for (const c of spec.components ?? []) {
    const page = pageOf(doc, c.variants[0]?.ref ?? c.ref)
    if (page && !chosenPages.has(page)) byPage.set(page, [...(byPage.get(page) ?? []), c.name])
  }
  return {
    version,
    folderName: folderNameFor(doc, version),
    screens: built.summary.screens,
    breakpoints: built.summary.breakpoints,
    layers: built.summary.nodes,
    assets: plan.records.length,
    fonts: built.summary.fonts,
    components: built.summary.components,
    hidden: built.summary.skippedHidden,
    pulls: [...byPage.entries()].map(([page, names]) => ({ page, names: [...new Set(names)].sort() })),
    warnings: built.warnings,
    files
  }
}

export interface RunOptions {
  onProgress?: (p: { done: number; total: number; label: string }) => void
  signal?: AbortSignal
}

/** Build, render, write, record. Nothing is recorded when anything fails or is cancelled. */
export async function runExport(doc: Doc, req: ExportRequest, deps: ExportDeps, options: RunOptions = {}): Promise<ExportOutcome> {
  try {
    const frames = selectFrames(doc, req.frames).ids
    if (!frames.length) return { ok: false, error: 'No screens are chosen.' }
    const version = nextHandoffNumber(await deps.listVersions())
    const { source, plan, built } = await assemble(doc, { ...req, frames }, deps, version)
    if (options.signal?.aborted) return { ok: false, canceled: true, stage: 'building' }

    const pngs = planScreenPngs(built.files['spec.json'], req.retina)
    const ran = await runAssetJobs(plan, pngs, { ...deps.engine }, { onProgress: options.onProgress, signal: options.signal })
    if (options.signal?.aborted) return { ok: false, canceled: true, stage: 'building' }

    const files: BundleFiles = { ...plan.files, ...ran.files, ...built.files }
    const warnings = [...built.warnings, ...ran.warnings]
    if (ran.missing.length) {
      warnings.push(`${ran.missing.length} file${ran.missing.length === 1 ? '' : 's'} could not be produced and ${ran.missing.length === 1 ? 'is' : 'are'} not in the bundle.`)
    }
    const written = await deps.write({ files, name: folderNameFor(source, version), kind: req.kind })
    if (!written.ok) return written.canceled ? { ok: false, canceled: true, stage: 'save-dialog' } : { ok: false, error: written.error }
    // only a bundle that is on disk becomes a version
    await deps.saveVersion(handoffVersionName(version)).catch(() => undefined)
    return { ok: true, path: written.path, files: written.files, bytes: written.bytes, version, kind: written.kind, warnings, summary: built.summary }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
