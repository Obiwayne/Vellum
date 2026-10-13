// What assets a set of exported frames needs and what files that makes. Pure and async only for hashing.
//   images (img layers and background-image fills): original bytes, @2x / @3x only when the pixels exist
//   icons (svg layers): sanitised, optimised, single colour -> currentColor
// Same visibility and whitelist rules as H3: only the chosen frames are walked and hidden layers are skipped
// with their children, so nothing outside the bundle's scope can leak through an asset name or byte.
import type { CNode, Doc } from '../../model/types'
import { numericSize } from '../../model/ops'
import type { Measure } from '../../model/devSpec'
import { selectFrames } from '../collect'
import { PathRegistry, slug } from '../paths'
import type { AssetRecord, BundleFiles } from '../types'
import { dataUrlToBytes, sha256Hex, sniff, type Sniffed } from './bytes'
import { densities, targetSize } from './density'
import { iconDocument, optimiseSvg } from './svgIcon'

export interface ResizeJob {
  /** bundle path to write */
  path: string
  from: Uint8Array
  mime: string
  width: number
  height: number
  /** JPEG / WebP quality 0-1 */
  quality: number
}

export interface PlanOptions {
  /** top-level frames to export (default: H3's default, the ready ones) */
  frames?: string[]
  measure?: Measure
  /** warn (and stop adding) above these totals */
  limits?: { totalBytes: number; files: number }
}

export interface AssetPlan {
  records: AssetRecord[]
  /** files that need no engine: original image bytes and optimised SVG text */
  files: BundleFiles
  /** files that need a resample */
  jobs: ResizeJob[]
  /** for the bundle's own warnings list */
  warnings: string[]
}

export const DEFAULT_LIMITS = { totalBytes: 200 * 1024 * 1024, files: 500 }
export const JPEG_QUALITY = 0.9

interface Use {
  node: CNode
  frameSlug: string
  width: number
  height: number
}

interface Pending {
  hash: string
  kind: 'image' | 'icon'
  sniffed?: Sniffed
  bytes?: Uint8Array
  text?: string
  icon?: { recoloured: boolean; was?: string; multiColour: boolean }
  uses: Use[]
}

const FILL_URL = /url\(\s*(['"]?)([\s\S]*?)\1\s*\)/i

/** The layer's drawn size: measured when a rect is given, else its authored px size, else 0. */
function sizeOf(n: CNode, measure?: Measure): { width: number; height: number } {
  const r = measure?.(n.id)
  if (r && r.width > 0 && r.height > 0) return { width: r.width, height: r.height }
  return { width: numericSize(n.style.width as string | number | undefined) ?? 0, height: numericSize(n.style.height as string | number | undefined) ?? 0 }
}

const layerSlug = (n: CNode): string => slug(n.name, n.type === 'svg' ? 'icon' : 'image')

export async function planAssets(doc: Doc, options: PlanOptions = {}): Promise<AssetPlan> {
  const warnings: string[] = []
  const limits = options.limits ?? DEFAULT_LIMITS
  const { ids: frames, warnings: selWarnings } = selectFrames(doc, options.frames)
  void selWarnings // H3 reports frame selection problems itself
  const pending = new Map<string, Pending>()
  const order: string[] = []

  const addImage = async (src: string, n: CNode, frameSlug: string): Promise<void> => {
    const size = sizeOf(n, options.measure)
    if (/^(https?:)?\/\//i.test(src.trim())) {
      warnings.push(`Image "${n.name}" is a link (${src.trim().slice(0, 120)}), not bundled: ask for the file.`)
      return
    }
    const parsed = dataUrlToBytes(src)
    if (!parsed) {
      warnings.push(`Image "${n.name}" has a source that is not an embedded image and was skipped.`)
      return
    }
    const s = sniff(parsed.bytes)
    if (!s) {
      warnings.push(`Image "${n.name}" is not a PNG, JPEG, GIF, WebP or SVG file and was skipped.`)
      return
    }
    if (parsed.mime && parsed.mime !== s.mime && parsed.mime !== 'image/jpg') warnings.push(`Image "${n.name}" says ${parsed.mime} but is ${s.mime}; the real type is used.`)
    const hash = await sha256Hex(parsed.bytes)
    const key = `image:${hash}`
    let p = pending.get(key)
    if (!p) {
      p = { hash, kind: 'image', sniffed: s, bytes: parsed.bytes, uses: [] }
      pending.set(key, p)
      order.push(key)
    }
    p.uses.push({ node: n, frameSlug, ...size })
  }

  const addIcon = async (n: CNode, frameSlug: string): Promise<void> => {
    const size = sizeOf(n, options.measure)
    const doc2 = iconDocument(n.svg ?? '', n.attrs, size)
    const r = optimiseSvg(doc2)
    if (!r) {
      warnings.push(`Icon "${n.name}" could not be made safe and was skipped.`)
      return
    }
    const hash = await sha256Hex(r.svg)
    const key = `icon:${hash}`
    let p = pending.get(key)
    if (!p) {
      p = { hash, kind: 'icon', text: r.svg, icon: { recoloured: r.recoloured, was: r.was, multiColour: r.multiColour }, uses: [] }
      pending.set(key, p)
      order.push(key)
    }
    p.uses.push({ node: n, frameSlug, ...size })
  }

  const walk = async (id: string, frameSlug: string): Promise<void> => {
    const n = doc.nodes[id]
    if (!n || !n.visible) return
    if (n.type === 'image' && n.attrs?.src) await addImage(n.attrs.src, n, frameSlug)
    else if (n.type === 'svg' && n.svg) await addIcon(n, frameSlug)
    const bg = String(n.style.backgroundImage ?? n.style.background ?? '')
    if (n.type !== 'image' && /url\(/i.test(bg) && !/gradient\(/i.test(bg)) {
      const m = FILL_URL.exec(bg)
      if (m) await addImage(m[2], n, frameSlug)
    }
    for (const c of n.children) await walk(c, frameSlug)
  }

  for (const f of frames) await walk(f, slug(doc.nodes[f]?.dev?.screen?.name ?? doc.nodes[f]?.name ?? 'screen', 'screen'))

  // ---- names, files, records (in discovery order, so output is deterministic)
  const reg = new PathRegistry()
  const records: AssetRecord[] = []
  const files: BundleFiles = {}
  const jobs: ResizeJob[] = []
  let totalBytes = 0
  let fileCount = 0
  const over = (add: number): boolean => totalBytes + add > limits.totalBytes || fileCount + 1 > limits.files

  for (const key of order) {
    const p = pending.get(key) as Pending
    const first = p.uses[0]
    const names = [...new Set(p.uses.map((u) => u.node.name))]
    if (p.kind === 'icon') {
      const picker = first.node.attrs?.['data-name']
      const base = `icon-${slug(picker ?? first.node.name, 'icon')}`
      const text = p.text as string
      const bytes = new TextEncoder().encode(text).length
      if (over(bytes)) {
        warnings.push(`Asset limit reached: icon "${first.node.name}" was not added.`)
        continue
      }
      const path = reg.take('assets/icons', base, '.svg')
      files[path] = text
      totalBytes += bytes
      fileCount++
      records.push({
        id: `icon-${p.hash.slice(0, 12)}`,
        path,
        kind: 'icon',
        nodeIds: p.uses.map((u) => u.node.id),
        layerName: names[0],
        mime: 'image/svg+xml',
        bytes,
        source: 'data',
        sha256: p.hash,
        recoloured: p.icon?.recoloured || undefined,
        was: p.icon?.was,
        multiColour: p.icon?.multiColour || undefined
      })
      continue
    }

    const s = p.sniffed as Sniffed
    const bytes = p.bytes as Uint8Array
    if (over(bytes.length)) {
      warnings.push(`Asset limit reached: image "${first.node.name}" was not added.`)
      continue
    }
    const base = `${first.frameSlug}-${layerSlug(first.node)}`
    const path = reg.take('assets/images', base, `.${s.ext}`)
    files[path] = bytes
    totalBytes += bytes.length
    fileCount++
    // the largest use decides what densities are worth having
    const lw = Math.max(...p.uses.map((u) => u.width))
    const lh = Math.max(...p.uses.map((u) => u.height))
    const rec: AssetRecord = {
      id: `image-${p.hash.slice(0, 12)}`,
      path,
      kind: 'image',
      nodeIds: p.uses.map((u) => u.node.id),
      layerName: names[0],
      mime: s.mime,
      bytes: bytes.length,
      width: s.width || undefined,
      height: s.height || undefined,
      source: 'data',
      sha256: p.hash,
      animated: s.animated || undefined
    }
    if (s.animated) warnings.push(`Image "${first.node.name}" is animated and is exported as is.`)
    // SVG files scale: no densities. Animated files are never resampled.
    if (s.ext !== 'svg' && !s.animated && s.width && s.height) {
      const d = densities(lw, lh, s.width, s.height)
      rec.maxDensity = d.maxDensity
      const variants: NonNullable<AssetRecord['variants']> = []
      for (const density of d.list) {
        if (density === 1) continue
        const t = targetSize(lw, lh, density)
        // within a pixel of the original: the original already is that density
        if (Math.abs(t.width - s.width) <= 1 && Math.abs(t.height - s.height) <= 1) {
          variants.push({ path, density, width: s.width, height: s.height })
          continue
        }
        const vbase = `${base}@${density}x`
        const vpath = reg.take('assets/images', vbase, `.${s.ext}`)
        if (over(0)) {
          warnings.push(`Asset limit reached: ${vpath} was not added.`)
          break
        }
        jobs.push({ path: vpath, from: bytes, mime: s.mime, width: t.width, height: t.height, quality: JPEG_QUALITY })
        fileCount++
        variants.push({ path: vpath, density, width: t.width, height: t.height })
      }
      if (variants.length) rec.variants = variants
      if (d.maxDensity < 1) warnings.push(`Image "${first.node.name}" has only ${d.maxDensity}x of the pixels its box needs; do not scale it up.`)
    }
    records.push(rec)
  }
  return { records, files, jobs, warnings }
}
