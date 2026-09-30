// Padding and gap handles for a selected flex/grid frame: the padding bands (hatched) and the gaps
// between children (tinted) show while the pointer is over the frame, each with a drag handle.
// Geometry is read from the rendered DOM (computed padding/gaps/tracks), so tokens and fit sizes work.
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import * as ops from '../../model/ops'
import type { Camera, Doc, StylePatch, WorldRect } from '../../model/types'
import { writeBox } from '../inspector/common'
import { measure, nodeEl, toScreen } from './geometry'

export type SpacingTarget = { kind: 'pad'; side: number } | { kind: 'gap'; axis: 'x' | 'y'; index: number }

export interface SpacingGeo {
  grid: boolean
  /** flex: main axis is horizontal */
  row: boolean
  /** flex: +1, or -1 for row-reverse / column-reverse */
  sign: number
  /** justify-content: space-between ("Auto" gap) */
  spaced: boolean
  /** computed padding [top, right, bottom, left] */
  pad: [number, number, number, number]
  colGap: number
  rowGap: number
  /** padding bands, top/right/bottom/left (world) */
  bands: WorldRect[]
  /** axis 'x': a gap between columns (dragged horizontally); 'y': between rows */
  gaps: Array<{ axis: 'x' | 'y'; rect: WorldRect }>
}

const num = (v: string): number => parseFloat(v) || 0

/** Resolved grid tracks ("120px 80px") → sizes, or null when not all px. */
function tracks(v: string): number[] | null {
  const toks = v.replace(/\[[^\]]*\]/g, ' ').trim().split(/\s+/).filter(Boolean)
  if (!toks.length || toks.some((t) => !/^-?\d*\.?\d+px$/.test(t))) return null
  return toks.map(num)
}

export function spacingGeometry(doc: Doc, docId: string, id: string): SpacingGeo | null {
  const n = doc.nodes[id]
  const el = nodeEl(id)
  const r = measure(id, docId)
  if (!n || !el || !r || !ops.isFlowLayout(n.style)) return null
  const cs = getComputedStyle(el)
  const grid = cs.display === 'grid' || cs.display === 'inline-grid'
  const bw = [num(cs.borderTopWidth), num(cs.borderRightWidth), num(cs.borderBottomWidth), num(cs.borderLeftWidth)]
  const pad: [number, number, number, number] = [num(cs.paddingTop), num(cs.paddingRight), num(cs.paddingBottom), num(cs.paddingLeft)]
  const inner = { x: r.x + bw[3], y: r.y + bw[0], width: Math.max(0, r.width - bw[1] - bw[3]), height: Math.max(0, r.height - bw[0] - bw[2]) }
  const content = {
    x: inner.x + pad[3],
    y: inner.y + pad[0],
    width: Math.max(0, inner.width - pad[1] - pad[3]),
    height: Math.max(0, inner.height - pad[0] - pad[2])
  }
  const bands: WorldRect[] = [
    { x: inner.x, y: inner.y, width: inner.width, height: pad[0] },
    { x: inner.x + inner.width - pad[1], y: content.y, width: pad[1], height: content.height },
    { x: inner.x, y: inner.y + inner.height - pad[2], width: inner.width, height: pad[2] },
    { x: inner.x, y: content.y, width: pad[3], height: content.height }
  ]
  const colGap = cs.columnGap === 'normal' ? 0 : num(cs.columnGap)
  const rowGap = cs.rowGap === 'normal' ? 0 : num(cs.rowGap)
  const dir = cs.flexDirection
  const row = !dir.startsWith('column')
  const sign = dir.endsWith('reverse') ? -1 : 1
  const gaps: SpacingGeo['gaps'] = []
  if (grid) {
    const cols = tracks(cs.gridTemplateColumns)
    const rows = tracks(cs.gridTemplateRows)
    let x = content.x
    cols?.slice(0, -1).forEach((w) => {
      x += w
      gaps.push({ axis: 'x', rect: { x, y: content.y, width: colGap, height: content.height } })
      x += colGap
    })
    let y = content.y
    rows?.slice(0, -1).forEach((h) => {
      y += h
      gaps.push({ axis: 'y', rect: { x: content.x, y, width: content.width, height: rowGap } })
      y += rowGap
    })
  } else {
    const wrap = cs.flexWrap !== 'nowrap'
    const kids = n.children
      .filter((c) => doc.nodes[c]?.visible !== false && ops.isFlowChild(doc, c))
      .map((c) => measure(c, docId))
      .filter((k): k is WorldRect => Boolean(k))
    for (let i = 0; i + 1 < kids.length; i++) {
      // in visual order along the main axis
      const [a, b] = sign > 0 ? [kids[i], kids[i + 1]] : [kids[i + 1], kids[i]]
      if (row) {
        const x1 = a.x + a.width
        if (b.x < x1 - 0.5) continue // wrapped onto the next line
        const y1 = wrap ? Math.min(a.y, b.y) : content.y
        const y2 = wrap ? Math.max(a.y + a.height, b.y + b.height) : content.y + content.height
        gaps.push({ axis: 'x', rect: { x: x1, y: y1, width: Math.max(0, b.x - x1), height: y2 - y1 } })
      } else {
        const y1 = a.y + a.height
        if (b.y < y1 - 0.5) continue
        const x1 = wrap ? Math.min(a.x, b.x) : content.x
        const x2 = wrap ? Math.max(a.x + a.width, b.x + b.width) : content.x + content.width
        gaps.push({ axis: 'y', rect: { x: x1, y: y1, width: x2 - x1, height: Math.max(0, b.y - y1) } })
      }
    }
  }
  const spaced = !grid && cs.justifyContent === 'space-between'
  return { grid, row, sign, spaced, pad, colGap, rowGap, bands, gaps }
}

export const spacingKey = (t: SpacingTarget): string => (t.kind === 'pad' ? `pad:${t.side}` : `gap:${t.axis}:${t.index}`)

/**
 * Style patch for dragging a spacing handle by `d` (world px) from the geometry at drag start.
 * Padding: Shift = all sides, Alt = the opposite side too. Grid gaps: Shift = both gaps.
 */
export function spacingPatch(
  geo: SpacingGeo,
  t: SpacingTarget,
  d: { x: number; y: number },
  mods: { shift: boolean; alt: boolean },
  style: Record<string, unknown>
): { patch: StylePatch; value: number } {
  if (t.kind === 'pad') {
    const s = t.side
    const delta = s === 0 ? d.y : s === 1 ? -d.x : s === 2 ? -d.y : d.x
    const v = Math.max(0, Math.round(geo.pad[s] + delta))
    const next = geo.pad.map((p) => Math.round(p))
    if (mods.shift) next.fill(v)
    else {
      next[s] = v
      if (mods.alt) next[(s + 2) % 4] = v
    }
    return { patch: writeBox('padding', next), value: v }
  }
  const delta = t.axis === 'x' ? d.x : d.y
  if (geo.grid) {
    let c = geo.colGap
    let r = geo.rowGap
    if (t.axis === 'x') c = Math.max(0, Math.round(c + delta))
    else r = Math.max(0, Math.round(r + delta))
    if (mods.shift) {
      if (t.axis === 'x') r = c
      else c = r
    }
    c = Math.round(c)
    r = Math.round(r)
    // keep `gap` when both gaps match, else write the two longhands (as the Grid section does)
    const patch: StylePatch = c === r ? { gap: c, rowGap: null, columnGap: null } : { gap: null, rowGap: r, columnGap: c }
    return { patch, value: t.axis === 'x' ? c : r }
  }
  // flex: the main-axis gap; an "Auto" (space-between) gap starts from its measured size
  const start = geo.spaced ? (t.axis === 'x' ? geo.gaps[t.index]?.rect.width : geo.gaps[t.index]?.rect.height) ?? 0 : geo.row ? geo.colGap : geo.rowGap
  const v = Math.max(0, Math.round(start + delta * geo.sign))
  const long = geo.row ? 'columnGap' : 'rowGap'
  const patch: StylePatch = style[long] !== undefined ? { [long]: v } : { gap: v }
  if (geo.spaced) patch.justifyContent = 'start'
  return { patch, value: v }
}

/** Screen size below which a frame gets no spacing / gradient handles. */
export const MIN_HANDLE_FRAME = 24

interface Props {
  doc: Doc
  docId: string
  id: string
  cam: Camera
  root: HTMLElement | null
  /** key of the handle being dragged (spacingKey), if any */
  active?: string
  onDown: (e: React.PointerEvent, target: SpacingTarget) => void
  onDouble: (target: SpacingTarget) => void
}

const HOVER_MIN = 8

export function SpacingHandles({ doc, docId, id, cam, root, active, onDown, onDouble }: Props): JSX.Element | null {
  const geo = spacingGeometry(doc, docId, id)
  const frame = measure(id, docId)
  const [hover, setHover] = useState<string | null>(null)
  const live = useRef({ geo, frame, cam })
  live.current = { geo, frame, cam }

  useEffect(() => {
    const on = (e: PointerEvent): void => {
      const { geo: g, frame: f, cam: c } = live.current
      const vp = root?.parentElement
      let next: string | null = null
      if (g && f && vp && e.target instanceof Node && vp.contains(e.target)) {
        const b = vp.getBoundingClientRect()
        const p = { x: e.clientX - b.left, y: e.clientY - b.top }
        const fr = toScreen(f, c)
        if (p.x >= fr.x && p.x <= fr.x + fr.width && p.y >= fr.y && p.y <= fr.y + fr.height) {
          next = 'in'
          const hit = (r: WorldRect, axis: 'x' | 'y' | null): boolean => {
            const s = toScreen(r, c)
            const gx = axis !== 'y' ? Math.max(0, (HOVER_MIN - s.width) / 2) : 0
            const gy = axis !== 'x' ? Math.max(0, (HOVER_MIN - s.height) / 2) : 0
            return p.x >= s.x - gx && p.x <= s.x + s.width + gx && p.y >= s.y - gy && p.y <= s.y + s.height + gy
          }
          const gi = g.gaps.findIndex((gp) => hit(gp.rect, gp.axis))
          if (gi >= 0) next = `gap:${g.gaps[gi].axis}:${gi}`
          const pi = g.bands.findIndex((band, i) => {
            // at least HOVER_MIN screen px inside the edge, so zero padding can still be grabbed
            const s = toScreen(band, c)
            const t = HOVER_MIN
            if (i === 0) return p.y <= s.y + Math.max(s.height, t)
            if (i === 2) return p.y >= s.y + s.height - Math.max(s.height, t)
            if (i === 1) return p.x >= s.x + s.width - Math.max(s.width, t)
            return p.x <= s.x + Math.max(s.width, t)
          })
          if (pi >= 0) next = `pad:${pi}`
        }
      }
      setHover((h) => (h === next ? h : next))
    }
    window.addEventListener('pointermove', on)
    return () => window.removeEventListener('pointermove', on)
  }, [root])

  if (!geo || !frame) return null
  const fr = toScreen(frame, cam)
  if (fr.width < MIN_HANDLE_FRAME || fr.height < MIN_HANDLE_FRAME) return null
  if (!hover && !active) return null
  const focus = active ?? hover ?? ''
  const showPad = focus.startsWith('pad')
  const showGap = focus.startsWith('gap')

  const handle = (t: SpacingTarget, cx: number, cy: number, vertical: boolean): JSX.Element => {
    const key = spacingKey(t)
    const style: CSSProperties = {
      left: cx - (vertical ? 2.5 : 8),
      top: cy - (vertical ? 8 : 2.5),
      width: vertical ? 5 : 16,
      height: vertical ? 16 : 5,
      cursor: vertical ? 'ew-resize' : 'ns-resize'
    }
    return (
      <div
        key={key}
        className={'cv-sp-handle' + (focus === key ? ' cv-sp-handle--on' : '')}
        style={style}
        onPointerDown={(e) => onDown(e, t)}
        onDoubleClick={(e) => {
          e.stopPropagation()
          onDouble(t)
        }}
      />
    )
  }

  return (
    <>
      {showPad &&
        geo.bands.map((b, i) => {
          const s = toScreen(b, cam)
          if (s.width <= 0 || s.height <= 0) return null
          return (
            <div
              key={'pb' + i}
              className={'cv-sp-pad' + (focus === `pad:${i}` ? ' cv-sp-pad--on' : '')}
              style={{ left: s.x, top: s.y, width: s.width, height: s.height }}
            />
          )
        })}
      {showGap &&
        geo.gaps.map((g, i) => {
          const s = toScreen(g.rect, cam)
          return (
            <div
              key={'gb' + i}
              className={'cv-sp-gap' + (focus === `gap:${g.axis}:${i}` ? ' cv-sp-gap--on' : '')}
              style={{ left: s.x, top: s.y, width: s.width, height: s.height }}
            />
          )
        })}
      {geo.bands.map((b, i) => {
        const s = toScreen(b, cam)
        // centred in the band, but never closer than 6px to the frame edge
        const off = (w: number): number => Math.max(w / 2, 6)
        if (i === 0) return handle({ kind: 'pad', side: 0 }, s.x + s.width / 2, s.y + off(s.height), false)
        if (i === 2) return handle({ kind: 'pad', side: 2 }, s.x + s.width / 2, s.y + s.height - off(s.height), false)
        if (i === 1) return handle({ kind: 'pad', side: 1 }, s.x + s.width - off(s.width), s.y + s.height / 2, true)
        return handle({ kind: 'pad', side: 3 }, s.x + off(s.width), s.y + s.height / 2, true)
      })}
      {geo.gaps.map((g, i) => {
        const s = toScreen(g.rect, cam)
        return handle({ kind: 'gap', axis: g.axis, index: i }, s.x + s.width / 2, s.y + s.height / 2, g.axis === 'x')
      })}
    </>
  )
}
