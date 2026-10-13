// WCAG contrast of text against what is behind it, per theme mode. Pure: reads the document only.
// Used by the Dev section of the inspector and by the handoff bundle (T58 plan section 7).
import { parseColor, type RGBA } from '../ui/color'
import { effectiveMode, modesOf } from './modes'
import { pageOf } from './ops'
import { substituteVars } from './devSpec'
import type { CNode, Doc } from './types'

/** Relative luminance of an sRGB colour (WCAG 2.x). */
export function relativeLuminance(c: Pick<RGBA, 'r' | 'g' | 'b'>): number {
  const f = (v: number): number => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
}

/** Contrast ratio of two opaque colours, 1 to 21. */
export function contrastRatio(a: Pick<RGBA, 'r' | 'g' | 'b'>, b: Pick<RGBA, 'r' | 'g' | 'b'>): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** `top` painted over `bottom`. The result is opaque when `bottom` is. */
export function composite(top: RGBA, bottom: RGBA): RGBA {
  const a = top.a + bottom.a * (1 - top.a)
  if (a <= 0) return { r: 0, g: 0, b: 0, a: 0 }
  const mix = (t: number, b: number): number => Math.round((t * top.a + b * bottom.a * (1 - top.a)) / a)
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a }
}

/** WCAG "large text": 24px, or 18.66px (14pt) and bold. */
export const isLargeText = (fontSizePx: number, weight: number): boolean => fontSizePx >= 24 || (fontSizePx >= 18.66 && weight >= 700)

/** Pass flags for a ratio: AA 4.5 (3 for large text), AAA 7 (4.5 for large text). */
export const wcag = (ratio: number, large: boolean): { aa: boolean; aaa: boolean } => ({
  aa: ratio >= (large ? 3 : 4.5),
  aaa: ratio >= (large ? 4.5 : 7)
})

export interface ContrastResult {
  /** theme mode the colours were resolved in; `base` when the document has no modes */
  mode: string
  /** 1 to 21, two decimals */
  ratio: number
  /** text colour over the background, `#RRGGBB` */
  fg: string
  /** the background it sits on, `#RRGGBB` */
  bg: string
  large: boolean
  aa: boolean
  aaa: boolean
}

export type ContrastOutcome = { ok: true; results: ContrastResult[] } | { ok: false; reason: string }

const hex = (c: RGBA): string => `#${[c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()}`
const round2 = (v: number): number => Math.round(v * 100) / 100

/** Nearest value of a typography key up the tree (text colour, size and weight inherit). */
function inherited(doc: Doc, id: string, key: string): string | number | undefined {
  for (let cur: string | null = id, i = 0; cur && i < 64; i++) {
    const n: CNode | undefined = doc.nodes[cur]
    if (!n) break
    const v = n.style[key]
    if (v !== undefined && v !== '' && v !== 'inherit') return v
    cur = n.parent
  }
  return undefined
}

const asPx = (v: string | number | undefined, fallback: number): number => {
  if (typeof v === 'number') return v
  const m = typeof v === 'string' ? /^\s*(-?\d*\.?\d+)(px)?\s*$/.exec(v) : null
  return m ? parseFloat(m[1]) : fallback
}

/**
 * Contrast of a text layer in every mode it is shown in (its own `data-mode` or an ancestor's pins one mode).
 * The background is the nearest opaque `background-color` up the tree, with translucent ones composited over
 * it; a gradient or image on the way, or a colour that cannot be read, is `ok: false` with the reason.
 * Ancestor opacity and blend modes are not applied.
 */
export function textContrast(doc: Doc, id: string): ContrastOutcome {
  const n = doc.nodes[id]
  if (!n || n.type !== 'text') return { ok: false, reason: 'not a text layer' }
  if (!n.visible) return { ok: false, reason: 'hidden' }
  const pinned = effectiveMode(doc, id)
  const modes = pinned ? [pinned] : modesOf(doc).length ? modesOf(doc) : [null]
  const size = asPx(inherited(doc, id, 'fontSize'), 16)
  const weightRaw = inherited(doc, id, 'fontWeight')
  const weight = typeof weightRaw === 'number' ? weightRaw : weightRaw === 'bold' ? 700 : Number(weightRaw) || 400
  const large = isLargeText(size, weight)
  const page = pageOf(doc, id)
  const results: ContrastResult[] = []

  for (const mode of modes) {
    const read = (v: string | number | undefined): RGBA | null => (typeof v === 'string' ? parseColor(substituteVars(doc, v.trim(), mode)) : null)
    const fgRaw = inherited(doc, id, 'color')
    const fg = fgRaw === undefined ? { r: 0, g: 0, b: 0, a: 1 } : read(fgRaw)
    if (!fg) return { ok: false, reason: 'text colour cannot be read' }

    // background: ancestors outward until an opaque colour
    const layers: RGBA[] = []
    let base: RGBA | null = null
    for (let cur = n.parent, i = 0; cur && i < 64; i++) {
      const a: CNode | undefined = doc.nodes[cur]
      if (!a) break
      const img = String(a.style.backgroundImage ?? '')
      const bgShort = String(a.style.background ?? '')
      if (/gradient\(|url\(/i.test(img) || /gradient\(|url\(/i.test(bgShort)) return { ok: false, reason: 'the background is a gradient or an image' }
      const raw = a.style.backgroundColor ?? (bgShort && !/\s/.test(bgShort.trim()) ? bgShort : undefined)
      if (raw !== undefined && raw !== '' && raw !== 'transparent' && raw !== 'none') {
        const c = read(raw)
        if (!c) return { ok: false, reason: 'a background colour cannot be read' }
        if (c.a >= 1) {
          base = c
          break
        }
        if (c.a > 0) layers.push(c)
      }
      cur = a.parent
    }
    if (!base) {
      const pageBg = read(page?.background ?? '#FFFFFF')
      base = pageBg && pageBg.a >= 1 ? pageBg : { r: 255, g: 255, b: 255, a: 1 }
    }
    for (const l of layers.reverse()) base = composite(l, base)
    const paint = composite(fg, base)
    // WCAG: the thresholds apply to the exact ratio; only the displayed value is rounded (4.4989 shows as 4.5 and still fails AA)
    const raw = contrastRatio(paint, base)
    results.push({ mode: mode ?? 'base', ratio: round2(raw), fg: hex(paint), bg: hex(base), large, ...wcag(raw, large) })
  }
  return { ok: true, results }
}
