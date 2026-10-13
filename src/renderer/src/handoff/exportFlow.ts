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
import { selectFrames, topLevelFrames } from './collect'
import { handoffVersionName, nextHandoffNumber, previousHandoff, previousHandoffBefore } from './ready'
import { diffSpecs, type ChangeSet } from './diff'
import { slug } from './paths'
import type { BundleFiles, FontSource, HandoffResult, HandoffSpec } from './types'

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
  /** record the named version; `record` is what this export carried, to be stored in the document first */
  saveVersion: (name: string, record: { version: number; frames: string[] }) => Promise<unknown>
  listVersions: () => Promise<ReadonlyArray<{ id?: string; name?: string | null; createdAt?: number }>>
  /** the document as it was in a history version, for the diff against the previous hand-off */
  loadVersion?: (versionId: string) => Promise<Doc | null>
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
  /** the newest earlier export recorded in version history */
  previous?: { version: number; at: number }
  /** what changed since it: the same numbers CHANGES.md carries (absent on a first export) */
  changes?: { previous: number; counts: ChangeSet['counts']; rebuild: string[]; tokens: number; assets: number }
}

export type ExportOutcome =
  | {
      ok: true
      path: string
      files: number
      bytes: number
      version: number
      kind: 'folder' | 'zip'
      warnings: string[]
      summary: HandoffResult['summary']
      /** every file the bundle contains (bundle-relative paths) */
      paths: string[]
      /** false when the named version could not be recorded: the files are on disk, the number is not taken */
      versionSaved: boolean
    }
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

/** The comparison with the previous export: the change set, or why there is none (a first export has neither). */
interface Compared {
  changes: ChangeSet | null
  warning?: string
}

// The earlier side is the expensive one (a whole document planned and built); the dialog asks again on every option
// change, so the last few earlier specs are kept by what they depend on.
const earlier = new Map<string, HandoffSpec>()
const EARLIER_KEPT = 4

/**
 * What changed since the previous "Handoff vN" in version history. Both sides are built from documents (the earlier one
 * from its saved version) without measurement, so rounding in a layout pass can never look like an edit. Only frames
 * this export is about are compared: frames the earlier export carried that are chosen now, plus frames it carried that
 * are gone now (removed). A frame it did not carry is new now (added); a frame it carried that is not chosen this time is
 * left alone: leaving a screen out of an export is not removing it.
 */
async function changesSince(source: Doc, req: ExportRequest, deps: ExportDeps, versions: Awaited<ReturnType<ExportDeps['listVersions']>>, version: number, frames: string[]): Promise<Compared> {
  const prev = previousHandoffBefore(versions, version)
  if (!prev || !deps.loadVersion) return { changes: null }
  const label = handoffVersionName(prev.version)
  try {
    const loaded = await deps.loadVersion(prev.id)
    if (!loaded) return { changes: null, warning: `CHANGES.md was not written: ${label} could not be read from version history.` }
    const prevDoc = req.devNotes ? loaded : withoutNotes(loaded)
    const then = new Set(topLevelFrames(prevDoc))
    // what that export carried: recorded with the version; older versions have no record, their ready frames are the guess
    const carried = prevDoc.handoff?.frames ?? selectFrames(prevDoc).ids
    const prevFrames = carried.filter((f) => (frames.includes(f) && then.has(f)) || !source.nodes[f])
    const spec = async (d: Doc, f: string[], v: number): Promise<HandoffSpec> => {
      const assets = (await planAssets(d, { frames: f })).records
      const out = buildHandoff(d, { frames: f, version: v, exportedAt: 'diff', vellum: deps.vellum, assets, ...(deps.fontSource ? { fontSource: deps.fontSource } : {}) })
      return JSON.parse(out.files['spec.json']) as HandoffSpec
    }
    const key = `${source.id}|${prev.id}|${req.devNotes}|${prevFrames.join(',')}`
    let before = earlier.get(key)
    if (!before) {
      before = await spec(prevDoc, prevFrames, prev.version)
      earlier.set(key, before)
      while (earlier.size > EARLIER_KEPT) earlier.delete(earlier.keys().next().value as string)
    }
    return { changes: diffSpecs(before, await spec(source, frames, version), prev.version) }
  } catch (e) {
    return { changes: null, warning: `CHANGES.md was not written: could not compare with ${label} (${e instanceof Error ? e.message : String(e)}).` }
  }
}

async function assemble(doc: Doc, req: ExportRequest, deps: ExportDeps, version: number, versions: Awaited<ReturnType<ExportDeps['listVersions']>>) {
  const source = req.devNotes ? doc : withoutNotes(doc)
  const plan = await planAssets(source, { frames: req.frames, ...(deps.measure ? { measure: deps.measure } : {}) })
  const { changes, warning } = await changesSince(source, req, deps, versions, version, req.frames)
  const built = buildHandoff(source, {
    ...(changes ? { changes } : {}),
    frames: req.frames,
    version,
    exportedAt: deps.now(),
    vellum: deps.vellum,
    rem: req.rem,
    ...(deps.measure ? { measure: deps.measure } : {}),
    ...(deps.fontSource ? { fontSource: deps.fontSource } : {}),
    assets: plan.records,
    warnings: [...plan.warnings, ...(warning ? [warning] : [])]
  })
  return { source, plan, built, changes }
}

/** Everything the dialog shows before anything is written. Cheap enough to run on every change of the options. */
export async function previewExport(doc: Doc, req: ExportRequest, deps: ExportDeps): Promise<Preview> {
  const versions = await deps.listVersions()
  const version = nextHandoffNumber(versions)
  const { plan, built, changes } = await assemble(doc, req, deps, version, versions)
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
    files,
    ...(previousHandoff(versions) ? { previous: previousHandoff(versions) } : {}),
    ...(changes ? { changes: { previous: changes.previous, counts: changes.counts, rebuild: changes.rebuild, tokens: changes.tokens.length, assets: changes.assets.length } } : {})
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
    const versions = await deps.listVersions()
    const version = nextHandoffNumber(versions)
    const { source, plan, built } = await assemble(doc, { ...req, frames }, deps, version, versions)
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
    // only a bundle that is on disk becomes a version; when that fails the files stay and the user is told
    let versionSaved = true
    try {
      await deps.saveVersion(handoffVersionName(version), { version, frames })
    } catch (e) {
      versionSaved = false
      warnings.unshift(`The files were written, but "${handoffVersionName(version)}" could not be saved in version history (${e instanceof Error ? e.message : String(e)}). The next export may reuse this number.`)
    }
    return {
      ok: true,
      path: written.path,
      files: written.files,
      bytes: written.bytes,
      version,
      kind: written.kind,
      warnings,
      summary: built.summary,
      paths: Object.keys(files).sort(),
      versionSaved
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
