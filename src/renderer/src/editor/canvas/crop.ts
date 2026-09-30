// Image crop: Ctrl+drag a resize handle of an image. The node box changes while the picture stays
// where it is. Plain CSS model on the <img>:
//   objectViewBox: 'inset(t% r% b% l%)'  the visible part, in % of the image's natural size
//   objectFit: 'cover' (or 'fill')       the view box always has the box's aspect, so it maps 1:1
//   objectPosition: 'X% Y%'              the crop's place in the image: a fallback for browsers
//                                        without object-view-box (they show the image cover-fitted
//                                        around the same spot)
// A later normal resize scales the cropped picture with the box. "Reset crop" removes the view box.
import type { CNode, Style, WorldRect } from '../../model/types'
import { nodeEl } from './geometry'

interface Region {
  x: number
  y: number
  w: number
  h: number
}

export interface CropStart {
  /** node box at drag start (world) */
  rect: WorldRect
  /** world px per natural image px */
  sx: number
  sy: number
  /** part of the image visible at drag start (natural px) */
  view: Region
  nw: number
  nh: number
  fit: 'cover' | 'fill'
  /** style keys the crop writes, as they were (restored when Ctrl is released mid-drag) */
  orig: Style
}

export const CROP_KEYS = ['objectViewBox', 'objectPosition', 'objectFit'] as const

/** Natural size of a rendered image node, or null (not loaded / not an image). */
export function naturalSize(id: string): { nw: number; nh: number } | null {
  const el = nodeEl(id)
  if (!(el instanceof HTMLImageElement) || !el.naturalWidth || !el.naturalHeight) return null
  return { nw: el.naturalWidth, nh: el.naturalHeight }
}

/** 'inset(t r b l)' in % or px of the natural size → region (natural px). */
export function parseViewBox(v: unknown, nw: number, nh: number): Region {
  const m = /^inset\((.*)\)$/.exec(String(v ?? '').trim())
  if (!m) return { x: 0, y: 0, w: nw, h: nh }
  const parts = m[1].trim().split(/\s+/)
  const [t, r = t, b = t, l = r] = parts
  const len = (s: string, total: number): number => (s.endsWith('%') ? (parseFloat(s) / 100) * total : parseFloat(s)) || 0
  const top = len(t, nh)
  const left = len(l, nw)
  return { x: left, y: top, w: Math.max(1, nw - left - len(r, nw)), h: Math.max(1, nh - top - len(b, nh)) }
}

/** One object-position component → fraction of the free space (px values → -px / scale). */
function posFraction(tok: string | undefined, free: number, scale: number): number {
  if (!tok || tok === 'center') return 0.5
  if (tok === 'left' || tok === 'top') return 0
  if (tok === 'right' || tok === 'bottom') return 1
  if (tok.endsWith('%')) return parseFloat(tok) / 100 || 0
  const px = parseFloat(tok)
  return Number.isFinite(px) && free ? -px / scale / free : 0.5
}

/** Crop state at drag start from the node's style and its measured box. */
export function cropStart(n: CNode, rect: WorldRect): CropStart | null {
  const nat = naturalSize(n.id)
  if (!nat || rect.width <= 0 || rect.height <= 0) return null
  const { nw, nh } = nat
  const vb = parseViewBox(n.style.objectViewBox, nw, nh)
  const orig: Style = {}
  for (const k of CROP_KEYS) if (n.style[k] !== undefined) orig[k] = n.style[k]
  // 'fill' stretches the view box to the box; anything else is handled as 'cover' (contain /
  // none / scale-down switch to cover when the crop starts)
  // an undistorted 'fill' (the usual <img> default) crops as 'cover', which degrades better
  if (String(n.style.objectFit ?? 'fill') === 'fill') {
    const sx = rect.width / vb.w
    const sy = rect.height / vb.h
    if (Math.abs(sx - sy) > 0.01 * sx) return { rect, sx, sy, view: vb, nw, nh, fit: 'fill', orig }
  }
  const s = Math.max(rect.width / vb.w, rect.height / vb.h)
  const dw = rect.width / s
  const dh = rect.height / s
  const [px, py] = String(n.style.objectPosition ?? '50% 50%').trim().split(/\s+/)
  const fx = Math.min(1, Math.max(0, posFraction(px, vb.w - dw, s)))
  const fy = Math.min(1, Math.max(0, posFraction(py ?? px, vb.h - dh, s)))
  const view = { x: vb.x + (vb.w - dw) * fx, y: vb.y + (vb.h - dh) * fy, w: dw, h: dh }
  return { rect, sx: s, sy: s, view, nw, nh, fit: 'cover', orig }
}

/** Keeps a new box inside the image (world coords). */
export function clampToImage(c: CropStart, x1: number, y1: number, x2: number, y2: number): [number, number, number, number] {
  const left = c.rect.x - c.view.x * c.sx
  const top = c.rect.y - c.view.y * c.sy
  const right = left + c.nw * c.sx
  const bottom = top + c.nh * c.sy
  x1 = Math.max(left, Math.min(x1, right - 1))
  y1 = Math.max(top, Math.min(y1, bottom - 1))
  x2 = Math.min(right, Math.max(x2, x1 + 1))
  y2 = Math.min(bottom, Math.max(y2, y1 + 1))
  return [x1, y1, x2, y2]
}

const pct = (v: number): string => `${Math.round(Math.max(0, v) * 10000) / 100}%`

/** Style patch that shows the image part under the world box (x1, y1)–(x2, y2). */
export function cropStyle(c: CropStart, x1: number, y1: number, x2: number, y2: number): Style {
  const x = c.view.x + (x1 - c.rect.x) / c.sx
  const y = c.view.y + (y1 - c.rect.y) / c.sy
  const w = (x2 - x1) / c.sx
  const h = (y2 - y1) / c.sy
  const t = y / c.nh
  const r = (c.nw - x - w) / c.nw
  const b = (c.nh - y - h) / c.nh
  const l = x / c.nw
  const out: Style = { objectFit: c.fit }
  if (Math.max(t, r, b, l) > 0.00005) {
    out.objectViewBox = `inset(${pct(t)} ${pct(r)} ${pct(b)} ${pct(l)})`
    const fx = c.nw - w > 0.5 ? x / (c.nw - w) : 0.5
    const fy = c.nh - h > 0.5 ? y / (c.nh - h) : 0.5
    out.objectPosition = `${pct(fx)} ${pct(fy)}`
  }
  return out
}

/** Writes crop keys: `patch` values, and removes the ones it doesn't have. */
export function applyCropKeys(style: Style, patch: Style): void {
  for (const k of CROP_KEYS) {
    if (patch[k] !== undefined) style[k] = patch[k]
    else delete style[k]
  }
}
