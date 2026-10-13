// The edge of the assets pipeline: resampling images and rendering screens to PNG. Everything that decides what to
// produce is in plan.ts; this file only runs jobs, one at a time, with progress and abort, and turns a failure
// into a warning instead of losing the rest of the bundle.
import type { Doc } from '../../model/types'
import type { AssetRecord, BundleFiles } from '../types'
import type { AssetPlan, ResizeJob } from './plan'

/** What the pipeline needs from the platform. A fake in tests; `canvasEngine` in the app. */
export interface AssetEngine {
  /** the image scaled down to `width` x `height`, same format */
  resize(job: ResizeJob): Promise<Uint8Array>
  /** a PNG of a top-level frame at `scale` */
  renderPng(frameId: string, scale: number): Promise<Uint8Array>
}

export interface PngJob {
  path: string
  frameId: string
  scale: number
}

export interface RunOptions {
  onProgress?: (p: { done: number; total: number; label: string }) => void
  signal?: AbortSignal
}

export interface RunResult {
  files: BundleFiles
  warnings: string[]
  /** paths that could not be produced */
  missing: string[]
}

/**
 * PNG references for the exported breakpoints, from H3's spec.json: `screens[].breakpoints[].png` at 1x and, with
 * `retina`, `name@2x.png` at 2x. (H3 reserves the 1x path; the 2x path is derived from it.)
 */
export function planScreenPngs(specJson: string, retina = false): PngJob[] {
  const spec = JSON.parse(specJson) as { screens?: Array<{ breakpoints?: Array<{ frameId: string; png: string }> }> }
  const jobs: PngJob[] = []
  for (const s of spec.screens ?? []) {
    for (const b of s.breakpoints ?? []) {
      jobs.push({ path: b.png, frameId: b.frameId, scale: 1 })
      if (retina) jobs.push({ path: b.png.replace(/\.png$/, '@2x.png'), frameId: b.frameId, scale: 2 })
    }
  }
  return jobs
}

type Step = { label: string; run: () => Promise<[string, Uint8Array]> }

export async function runAssetJobs(plan: Pick<AssetPlan, 'jobs'>, pngs: PngJob[], engine: AssetEngine, options: RunOptions = {}): Promise<RunResult> {
  const steps: Step[] = [
    ...plan.jobs.map((j): Step => ({ label: j.path, run: async () => [j.path, await engine.resize(j)] })),
    ...pngs.map((j): Step => ({ label: j.path, run: async () => [j.path, await engine.renderPng(j.frameId, j.scale)] }))
  ]
  const files: BundleFiles = {}
  const warnings: string[] = []
  const missing: string[] = []
  let done = 0
  for (const step of steps) {
    if (options.signal?.aborted) {
      warnings.push(`Export cancelled: ${steps.length - done} file${steps.length - done === 1 ? ' was' : 's were'} not produced.`)
      for (const s of steps.slice(done)) missing.push(s.label)
      break
    }
    options.onProgress?.({ done, total: steps.length, label: step.label })
    try {
      const [path, bytes] = await step.run()
      if (!bytes.length) throw new Error('empty result')
      files[path] = bytes
    } catch (e) {
      missing.push(step.label)
      warnings.push(`Could not produce ${step.label}: ${e instanceof Error ? e.message : String(e)}`)
    }
    done++
  }
  options.onProgress?.({ done, total: steps.length, label: '' })
  return { files, warnings, missing }
}

/** Mark records whose files could not be produced. */
export function markMissing(records: AssetRecord[], missing: string[]): AssetRecord[] {
  if (!missing.length) return records
  const bad = new Set(missing)
  return records.map((r) => {
    const variants = r.variants?.filter((v) => !bad.has(v.path))
    const out: AssetRecord = { ...r }
    if (variants && variants.length !== r.variants?.length) out.variants = variants.length ? variants : undefined
    if (bad.has(r.path)) out.missing = true
    return out
  })
}

/** The app's engine: OffscreenCanvas for resampling, the main-process renderer (window.canvasApi.renderHtml) for PNGs. */
export function canvasEngine(doc: Doc, renderNodePng: (doc: Doc, id: string, scale: number) => Promise<Uint8Array | null>): AssetEngine {
  return {
    async resize(job) {
      const bitmap = await createImageBitmap(new Blob([job.from as BlobPart], { type: job.mime }))
      try {
        const canvas = new OffscreenCanvas(job.width, job.height)
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('no 2d context')
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(bitmap, 0, 0, job.width, job.height)
        const blob = await canvas.convertToBlob({ type: job.mime === 'image/jpeg' || job.mime === 'image/webp' ? job.mime : 'image/png', quality: job.quality })
        return new Uint8Array(await blob.arrayBuffer())
      } finally {
        bitmap.close()
      }
    },
    async renderPng(frameId, scale) {
      const bytes = await renderNodePng(doc, frameId, scale)
      if (!bytes) throw new Error('the renderer is not available')
      return bytes
    }
  }
}
