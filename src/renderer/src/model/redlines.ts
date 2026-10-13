// Redlines (T67 / H10): the distances Dev Mode draws between the selected layer, the layer under the pointer and
// the selection's parent. Pure geometry on world rects, no DOM and no React; the canvas overlay draws the result.
// docs/factory/T58-plan.md section 12: distances selected -> hovered and selected -> parent edges; a rotated layer
// says "rotated" and gets no distances (a rotated bounding box is not what a developer would measure).
import type { WorldRect } from './types'

export interface RedRect extends WorldRect {
  /** rotated, scaled or skewed: its rect is a bounding box, not the layer's own edges */
  rotated?: boolean
}

export type Relation = 'separate' | 'touching' | 'overlap' | 'contains' | 'contained'

export interface Redline {
  /** `gap`: empty space between two layers; `offset`: edge to edge when they overlap or nest; `inset`: to the parent */
  kind: 'gap' | 'offset' | 'inset'
  axis: 'x' | 'y'
  /** world coordinates of the measuring line */
  from: { x: number; y: number }
  to: { x: number; y: number }
  /** distance in px, rounded to `precision` decimals (zero distances are not drawn) */
  value: number
  /** text of the label: the value, trailing zeros trimmed */
  label: string
}

export interface RedlineResult {
  relation: Relation | null
  lines: Redline[]
  /** why nothing was measured, e.g. `rotated` */
  skipped?: 'rotated'
}

const EPS = 0.005

const round = (v: number, p: number): number => {
  const f = 10 ** p
  return Math.round(v * f) / f
}
const text = (v: number): string => String(v)

const right = (r: WorldRect): number => r.x + r.width
const bottom = (r: WorldRect): number => r.y + r.height

/** How `b` sits against `a`, for the rects as boxes. */
export function relationOf(a: WorldRect, b: WorldRect): Relation {
  const sepX = Math.max(b.x - right(a), a.x - right(b))
  const sepY = Math.max(b.y - bottom(a), a.y - bottom(b))
  if (sepX > EPS || sepY > EPS) return 'separate'
  if (Math.abs(sepX) <= EPS || Math.abs(sepY) <= EPS) return 'touching'
  const within = (inner: WorldRect, outer: WorldRect): boolean =>
    inner.x >= outer.x - EPS && inner.y >= outer.y - EPS && right(inner) <= right(outer) + EPS && bottom(inner) <= bottom(outer) + EPS
  if (within(b, a)) return 'contains'
  if (within(a, b)) return 'contained'
  return 'overlap'
}

function line(kind: Redline['kind'], axis: 'x' | 'y', from: { x: number; y: number }, to: { x: number; y: number }, raw: number, precision: number): Redline | null {
  const value = round(Math.abs(raw), precision)
  if (value <= 0) return null
  return { kind, axis, from, to, value, label: text(value) }
}

/** The four edge-to-edge distances between `inner` and the `outer` rect around it, or around where it overlaps. */
function edgeLines(kind: 'inset' | 'offset', a: WorldRect, b: WorldRect, precision: number): Redline[] {
  const out: Array<Redline | null> = []
  const cx = (r: WorldRect): number => r.x + r.width / 2
  const cy = (r: WorldRect): number => r.y + r.height / 2
  // draw each distance at the centre of `a` (the selection), along the axis it measures
  const x = cx(a)
  const y = cy(a)
  out.push(line(kind, 'x', { x: Math.min(a.x, b.x), y }, { x: Math.max(a.x, b.x), y }, a.x - b.x, precision))
  out.push(line(kind, 'x', { x: Math.min(right(a), right(b)), y }, { x: Math.max(right(a), right(b)), y }, right(a) - right(b), precision))
  out.push(line(kind, 'y', { x, y: Math.min(a.y, b.y) }, { x, y: Math.max(a.y, b.y) }, a.y - b.y, precision))
  out.push(line(kind, 'y', { x, y: Math.min(bottom(a), bottom(b)) }, { x, y: Math.max(bottom(a), bottom(b)) }, bottom(a) - bottom(b), precision))
  return out.filter((l): l is Redline => l !== null)
}

/** The empty space between two separate rects, one line per axis that is separated. */
function gapLines(a: WorldRect, b: WorldRect, precision: number): Redline[] {
  const out: Array<Redline | null> = []
  const overlapMid = (a1: number, a2: number, b1: number, b2: number, fallback: number): number => {
    const lo = Math.max(a1, b1)
    const hi = Math.min(a2, b2)
    return hi > lo ? (lo + hi) / 2 : fallback
  }
  const gx = b.x >= right(a) ? b.x - right(a) : a.x >= right(b) ? a.x - right(b) : 0
  const gy = b.y >= bottom(a) ? b.y - bottom(a) : a.y >= bottom(b) ? a.y - bottom(b) : 0
  if (gx > EPS) {
    const y = overlapMid(a.y, bottom(a), b.y, bottom(b), a.y + a.height / 2)
    const x1 = b.x >= right(a) ? right(a) : right(b)
    out.push(line('gap', 'x', { x: x1, y }, { x: x1 + gx, y }, gx, precision))
  }
  if (gy > EPS) {
    const x = overlapMid(a.x, right(a), b.x, right(b), a.x + a.width / 2)
    const y1 = b.y >= bottom(a) ? bottom(a) : bottom(b)
    out.push(line('gap', 'y', { x, y: y1 }, { x, y: y1 + gy }, gy, precision))
  }
  return out.filter((l): l is Redline => l !== null)
}

/**
 * Distances from the selection `sel` to `other` (the hovered layer) and to `parent` (the selection's parent).
 * Either may be null. A rotated selection or hovered layer skips its distances and reports `skipped: 'rotated'`.
 */
export function redlines(sel: RedRect | null, other: RedRect | null, parent: RedRect | null = null, precision = 2): RedlineResult {
  if (!sel) return { relation: null, lines: [] }
  if (sel.rotated || other?.rotated) return { relation: null, lines: [], skipped: 'rotated' }
  const lines: Redline[] = []
  let relation: Relation | null = null
  if (other) {
    relation = relationOf(sel, other)
    if (relation === 'separate') lines.push(...gapLines(sel, other, precision))
    else if (relation === 'touching') {
      // side by side (sharing a vertical edge): only the vertical offsets mean something; stacked: the horizontal ones
      const sideBySide = Math.abs(other.x - right(sel)) <= EPS || Math.abs(sel.x - right(other)) <= EPS
      lines.push(...edgeLines('offset', sel, other, precision).filter((l) => l.axis === (sideBySide ? 'y' : 'x')))
    } else lines.push(...edgeLines('offset', sel, other, precision))
  }
  if (parent && !parent.rotated && relationOf(sel, parent) !== 'separate') lines.push(...edgeLines('inset', sel, parent, precision))
  return { relation, lines }
}
