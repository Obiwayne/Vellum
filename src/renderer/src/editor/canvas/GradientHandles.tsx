// On-canvas gradient handles for the fill layer picked in the Fill section (gradientEdit.ts).
// Linear: the CSS gradient line (start/end rotate the angle) with a dot per stop; clicking the line
// adds a stop. Radial: centre (`at X% Y%`), radius handle(s) (`circle Rpx` / `ellipse RXpx RYpx`)
// and stop dots along the horizontal radius. Everything is read and written through fills.ts.
import type { Camera, WorldRect } from '../../model/types'
import { midColor, type Fill } from '../inspector/fills'
import { measure, nodeEl } from './geometry'

export type Grad = Extract<Fill, { kind: 'gradient' }>
export type GradPart =
  | { kind: 'start' }
  | { kind: 'end' }
  | { kind: 'center' }
  | { kind: 'rx' }
  | { kind: 'ry' }
  | { kind: 'stop'; i: number }
  | { kind: 'line' }

type Pt = { x: number; y: number }

const num = (v: string): number => parseFloat(v) || 0
const r1 = (v: number): number => Math.round(v * 10) / 10

/** The box gradients are painted in (the padding box), in world coords. */
export function gradientBox(docId: string, id: string): WorldRect | null {
  const r = measure(id, docId)
  const el = nodeEl(id)
  if (!r || !el) return null
  const cs = getComputedStyle(el)
  const t = num(cs.borderTopWidth)
  const l = num(cs.borderLeftWidth)
  return {
    x: r.x + l,
    y: r.y + t,
    width: Math.max(0, r.width - l - num(cs.borderRightWidth)),
    height: Math.max(0, r.height - t - num(cs.borderBottomWidth))
  }
}

/** CSS gradient line for a linear gradient: runs through the centre, long enough to reach the corners. */
export function linearLine(f: Grad, b: WorldRect): { start: Pt; end: Pt; dir: Pt; len: number } {
  const a = (f.angle * Math.PI) / 180
  const dir = { x: Math.sin(a), y: -Math.cos(a) }
  const len = Math.abs(b.width * dir.x) + Math.abs(b.height * dir.y)
  const c = { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  return {
    start: { x: c.x - (dir.x * len) / 2, y: c.y - (dir.y * len) / 2 },
    end: { x: c.x + (dir.x * len) / 2, y: c.y + (dir.y * len) / 2 },
    dir,
    len
  }
}

/** `at` position → percentages of the box, or null when it isn't a simple 1–2 value position. */
export function parseAt(at: string | undefined, b: WorldRect): Pt | null {
  if (!at) return { x: 50, y: 50 }
  const toks = at.trim().split(/\s+/)
  if (toks.length > 2) return null
  const KW: Record<string, [axis: 'x' | 'y' | null, v: number]> = {
    left: ['x', 0],
    right: ['x', 100],
    top: ['y', 0],
    bottom: ['y', 100],
    center: [null, 50]
  }
  const val = (t: string, size: number): number | null => {
    if (/^-?\d*\.?\d+%$/.test(t)) return parseFloat(t)
    if (/^-?\d*\.?\d+(px)?$/.test(t)) return size ? (parseFloat(t) / size) * 100 : 0
    return null
  }
  let [a, c = 'center'] = toks
  // "top left" → "left top"
  if (KW[a]?.[0] === 'y' || KW[c]?.[0] === 'x') [a, c] = [c, a]
  const x = a in KW ? KW[a][1] : val(a, b.width)
  const y = c in KW ? KW[c][1] : val(c, b.height)
  return x === null || y === null ? null : { x, y }
}

/** Radii of a radial gradient's ending shape (world px). */
export function radialRadii(f: Grad, b: WorldRect, cPct: Pt): { rx: number; ry: number; circle: boolean } {
  const toks = (f.shape ?? 'circle').split(/\s+/).filter(Boolean)
  const lens = toks.filter((t) => /^-?\d*\.?\d+(px|%)?$/.test(t))
  const circle = toks.includes('circle') || (!toks.includes('ellipse') && lens.length === 1)
  const cx = (cPct.x / 100) * b.width
  const cy = (cPct.y / 100) * b.height
  const dx = [Math.abs(cx), Math.abs(b.width - cx)]
  const dy = [Math.abs(cy), Math.abs(b.height - cy)]
  const len = (t: string, size: number): number => (t.endsWith('%') ? (parseFloat(t) / 100) * size : parseFloat(t))
  if (lens.length) {
    const rx = len(lens[0], b.width)
    return { rx, ry: circle ? rx : len(lens[1] ?? lens[0], b.height), circle }
  }
  const kw = toks.find((t) => /^(closest|farthest)-(side|corner)$/.test(t)) ?? 'farthest-corner'
  const pick = kw.startsWith('closest') ? Math.min : Math.max
  const sx = pick(...dx)
  const sy = pick(...dy)
  if (circle) {
    const r = kw.endsWith('side') ? pick(sx, sy) : Math.hypot(sx, sy)
    return { rx: r, ry: r, circle }
  }
  if (kw.endsWith('side')) return { rx: sx, ry: sy, circle }
  // corners: the closest-side aspect ratio, scaled to pass through the corner
  const ax = Math.min(...dx)
  const ay = Math.min(...dy)
  if (!ax || !ay) {
    const r = Math.hypot(sx, sy)
    return { rx: r, ry: r, circle }
  }
  const k = Math.hypot(sx / ax, sy / ay)
  return { rx: ax * k, ry: ay * k, circle }
}

/** World-space handle geometry for a gradient over box `b` (null when not representable). */
export function gradientGeometry(
  f: Grad,
  b: WorldRect
): { from: Pt; to: Pt; center?: Pt; rx?: number; ry?: number; circle?: boolean } | null {
  if (f.type === 'linear') {
    const l = linearLine(f, b)
    return { from: l.start, to: l.end }
  }
  const at = parseAt(f.at, b)
  if (!at) return null
  const c = { x: b.x + (at.x / 100) * b.width, y: b.y + (at.y / 100) * b.height }
  const { rx, ry, circle } = radialRadii(f, b, at)
  return { from: c, to: { x: c.x + rx, y: c.y }, center: c, rx, ry, circle }
}

/** Stop position (0..100) of point p projected onto the from→to line. */
function projectPos(from: Pt, to: Pt, p: Pt): number {
  const vx = to.x - from.x
  const vy = to.y - from.y
  const l2 = vx * vx + vy * vy
  if (!l2) return 0
  const t = ((p.x - from.x) * vx + (p.y - from.y) * vy) / l2
  return Math.round(Math.min(100, Math.max(0, t * 100)))
}

/** A stop added where the line was clicked; returns the new fill + the stop's index. */
export function addStopAt(f: Grad, b: WorldRect, p: Pt): { fill: Grad; i: number } | null {
  const g = gradientGeometry(f, b)
  if (!g) return null
  const pos = projectPos(g.from, g.to, p)
  const stops = [...f.stops, { color: midColor(f.stops, pos), pos }]
  return { fill: { ...f, stops }, i: stops.length - 1 }
}

/** New fill for dragging `part` to world point p (geometry from the fill at drag start). */
export function dragGradient(
  f: Grad,
  part: GradPart,
  b: WorldRect,
  p: Pt,
  start: Pt,
  shift: boolean
): { fill: Grad; label: string } {
  const g = gradientGeometry(f, b)
  if (!g) return { fill: f, label: '' }
  switch (part.kind) {
    case 'start':
    case 'end': {
      const c = { x: b.x + b.width / 2, y: b.y + b.height / 2 }
      let a = (Math.atan2(p.x - c.x, -(p.y - c.y)) * 180) / Math.PI
      if (part.kind === 'start') a += 180
      a = shift ? Math.round(a / 15) * 15 : Math.round(a)
      a = ((a % 360) + 360) % 360
      return { fill: { ...f, angle: a }, label: `${a}°` }
    }
    case 'stop': {
      const pos = projectPos(g.from, g.to, p)
      return { fill: { ...f, stops: f.stops.map((s, j) => (j === part.i ? { ...s, pos } : s)) }, label: `${pos}%` }
    }
    case 'center': {
      const c = g.center ?? g.from
      let x = b.width ? ((c.x + p.x - start.x - b.x) / b.width) * 100 : 50
      let y = b.height ? ((c.y + p.y - start.y - b.y) / b.height) * 100 : 50
      // Shift snaps to 5% steps
      x = shift ? Math.round(x / 5) * 5 : r1(x)
      y = shift ? Math.round(y / 5) * 5 : r1(y)
      return { fill: { ...f, at: `${x}% ${y}%` }, label: `${x}%, ${y}%` }
    }
    case 'rx':
    case 'ry': {
      let rx = Math.max(1, Math.round(g.rx ?? 1))
      let ry = Math.max(1, Math.round(g.ry ?? 1))
      if (part.kind === 'rx') rx = Math.max(1, Math.round((g.rx ?? 1) + p.x - start.x))
      else ry = Math.max(1, Math.round((g.ry ?? 1) + p.y - start.y))
      if (g.circle || shift) {
        const r = part.kind === 'rx' ? rx : ry
        return { fill: { ...f, shape: `circle ${r}px` }, label: `${r}` }
      }
      return { fill: { ...f, shape: `ellipse ${rx}px ${ry}px` }, label: `${rx} × ${ry}` }
    }
    default:
      return { fill: f, label: '' }
  }
}

const KNOB = 14

interface Props {
  fill: Grad
  box: WorldRect
  cam: Camera
  onDown: (e: React.PointerEvent, part: GradPart) => void
}

export function GradientHandles({ fill, box, cam, onDown }: Props): JSX.Element | null {
  const g = gradientGeometry(fill, box)
  if (!g) return null
  const s = (p: Pt): Pt => ({ x: p.x * cam.zoom + cam.x, y: p.y * cam.zoom + cam.y })
  const from = s(g.from)
  const to = s(g.to)
  const down = (part: GradPart) => (e: React.PointerEvent) => onDown(e, part)
  const at = (pos: number): Pt => ({ x: from.x + ((to.x - from.x) * pos) / 100, y: from.y + ((to.y - from.y) * pos) / 100 })
  // knobs sit KNOB px beyond the line ends, so they never cover the 0% / 100% stops
  const linear = fill.type === 'linear'
  const len = Math.hypot(to.x - from.x, to.y - from.y) || 1
  const u = linear ? { x: (to.x - from.x) / len, y: (to.y - from.y) / len } : { x: 1, y: 0 }
  const k0 = linear ? { x: from.x - u.x * KNOB, y: from.y - u.y * KNOB } : from
  const k1 = { x: to.x + u.x * KNOB, y: to.y + u.y * KNOB }
  const stops = fill.stops.map((st, i) => {
    const p = at(Math.min(100, Math.max(0, st.pos)))
    return (
      <circle
        key={i}
        className="cv-grad__stop"
        cx={p.x}
        cy={p.y}
        r={6}
        style={{ fill: st.color }}
        onPointerDown={down({ kind: 'stop', i })}
      />
    )
  })
  return (
    <svg className="cv-grad" width="100%" height="100%">
      {g.center && g.rx !== undefined && g.ry !== undefined && (
        <ellipse
          className="cv-grad__shape"
          cx={from.x}
          cy={from.y}
          rx={Math.max(0, g.rx * cam.zoom)}
          ry={Math.max(0, g.ry * cam.zoom)}
        />
      )}
      <line className="cv-grad__line cv-grad__line--shadow" x1={k0.x} y1={k0.y} x2={k1.x} y2={k1.y} />
      <line className="cv-grad__line" x1={k0.x} y1={k0.y} x2={k1.x} y2={k1.y} />
      <line className="cv-grad__hit" x1={from.x} y1={from.y} x2={to.x} y2={to.y} onPointerDown={down({ kind: 'line' })} />
      {stops}
      {linear ? (
        <>
          <circle className="cv-grad__end" cx={k0.x} cy={k0.y} r={4.5} onPointerDown={down({ kind: 'start' })} />
          <circle className="cv-grad__end" cx={k1.x} cy={k1.y} r={4.5} onPointerDown={down({ kind: 'end' })} />
        </>
      ) : (
        <>
          {!g.circle && g.ry !== undefined && (
            <rect
              className="cv-grad__end cv-grad__end--ns"
              x={from.x - 4}
              y={from.y + g.ry * cam.zoom - 4}
              width={8}
              height={8}
              onPointerDown={down({ kind: 'ry' })}
            />
          )}
          <rect className="cv-grad__end cv-grad__end--ew" x={k1.x - 4} y={k1.y - 4} width={8} height={8} onPointerDown={down({ kind: 'rx' })} />
          <circle className="cv-grad__end cv-grad__end--move" cx={from.x} cy={from.y} r={5} onPointerDown={down({ kind: 'center' })} />
        </>
      )}
    </svg>
  )
}
