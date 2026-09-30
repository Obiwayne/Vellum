// Fill model: a node's backgrounds as a list of layers (top first).
// Stored as CSS: the bottom solid fill → backgroundColor; everything else → backgroundImage layers
// (solid fills above the bottom become `linear-gradient(c, c)`).
import type { Style, StylePatch } from '../../model/types'
import { splitTop } from './common'

export interface Stop {
  color: string
  pos: number // 0..100
}
export type Fill =
  | { kind: 'solid'; color: string }
  | {
      kind: 'gradient'
      type: 'linear' | 'radial'
      angle: number
      stops: Stop[]
      /** radial only: ending shape + size as written ('' = CSS default ellipse; unset = 'circle') */
      shape?: string
      /** radial only: the text after `at` ('20% 25%', 'center') */
      at?: string
    }
  | { kind: 'image'; url: string; size: string }

function parseStops(parts: string[]): Stop[] {
  const stops = parts.map((p, i) => {
    const toks = splitTop(p, ' ')
    const last = toks[toks.length - 1]
    let pos = parts.length > 1 ? (i / (parts.length - 1)) * 100 : 0
    let color = p
    if (toks.length > 1 && /%$/.test(last)) {
      pos = parseFloat(last)
      color = toks.slice(0, -1).join(' ')
    }
    return { color, pos }
  })
  return stops
}

export function parseLayer(layer: string, size = 'auto'): Fill | null {
  const l = layer.trim()
  const m = /^(repeating-)?(linear|radial)-gradient\((.*)\)$/s.exec(l)
  if (m) {
    const args = splitTop(m[3])
    let angle = 180
    let shape: string | undefined
    let at: string | undefined
    if (m[2] === 'linear' && args.length) {
      const a = args[0]
      const deg = /^(-?\d*\.?\d+)deg$/.exec(a)
      const TO: Record<string, number> = {
        'to top': 0,
        'to right': 90,
        'to bottom': 180,
        'to left': 270,
        'to top right': 45,
        'to bottom right': 135,
        'to bottom left': 225,
        'to top left': 315
      }
      if (deg) {
        angle = parseFloat(deg[1])
        args.shift()
      } else if (a in TO) {
        angle = TO[a]
        args.shift()
      }
    } else if (m[2] === 'radial' && args.length && /(circle|ellipse|(^|\s)at\s|closest|farthest)/.test(args[0])) {
      const a = args.shift() ?? ''
      const i = a.search(/(^|\s)at\s/)
      shape = (i < 0 ? a : a.slice(0, i)).trim()
      if (i >= 0) at = a.slice(i).trim().replace(/^at\s+/, '')
    }
    const stops = parseStops(args)
    // a flat 2-stop gradient of the same colour is a stacked solid fill
    if (m[2] === 'linear' && stops.length === 2 && stops[0].color === stops[1].color)
      return { kind: 'solid', color: stops[0].color }
    const g: Extract<Fill, { kind: 'gradient' }> = { kind: 'gradient', type: m[2] as 'linear' | 'radial', angle, stops }
    if (shape !== undefined) g.shape = shape
    if (at !== undefined) g.at = at
    return g
  }
  const u = /^url\((.*)\)$/s.exec(l)
  if (u) return { kind: 'image', url: u[1].replace(/^["']|["']$/g, ''), size }
  return null
}

export function readFills(style: Style, text = false): Fill[] {
  if (text) {
    const c = style.color
    return c ? [{ kind: 'solid', color: String(c) }] : []
  }
  const fills: Fill[] = []
  let bg = style.backgroundImage
  let bgColor = style.backgroundColor
  // shorthand `background` (from imported HTML): colour or single layer
  if (style.background && !bg && !bgColor) {
    const b = String(style.background)
    if (/gradient\(|url\(/.test(b)) bg = b
    else bgColor = b
  }
  const sizes = style.backgroundSize ? splitTop(String(style.backgroundSize)) : []
  if (bg && bg !== 'none') {
    splitTop(String(bg)).forEach((layer, i) => {
      const f = parseLayer(layer, sizes[i] ?? sizes[0] ?? 'auto')
      if (f) fills.push(f)
    })
  }
  if (bgColor && bgColor !== 'transparent') fills.push({ kind: 'solid', color: String(bgColor) })
  return fills
}

export function gradientCss(f: Extract<Fill, { kind: 'gradient' }>): string {
  const stops = [...f.stops].sort((a, b) => a.pos - b.pos).map((s) => `${s.color} ${Math.round(s.pos * 10) / 10}%`)
  if (f.type === 'linear') return `linear-gradient(${f.angle}deg, ${stops.join(', ')})`
  const head = [f.shape ?? 'circle', f.at ? `at ${f.at}` : ''].filter(Boolean).join(' ')
  return `radial-gradient(${head ? head + ', ' : ''}${stops.join(', ')})`
}

export function layerCss(f: Fill): string {
  if (f.kind === 'solid') return `linear-gradient(${f.color}, ${f.color})`
  if (f.kind === 'gradient') return gradientCss(f)
  return `url("${f.url}")`
}

export function writeFills(fills: Fill[], text = false): StylePatch {
  if (text) {
    const f = fills[0]
    return { color: f && f.kind === 'solid' ? f.color : null }
  }
  const patch: StylePatch = {
    background: null,
    backgroundColor: null,
    backgroundImage: null,
    backgroundSize: null,
    backgroundPosition: null,
    backgroundRepeat: null
  }
  const list = [...fills]
  const last = list[list.length - 1]
  if (last && last.kind === 'solid') {
    patch.backgroundColor = last.color
    list.pop()
  }
  if (list.length) {
    patch.backgroundImage = list.map(layerCss).join(', ')
    if (list.some((f) => f.kind === 'image')) {
      patch.backgroundSize = list.map((f) => (f.kind === 'image' ? f.size || 'cover' : 'auto')).join(', ')
      patch.backgroundPosition = 'center'
      patch.backgroundRepeat = 'no-repeat'
    }
  }
  return patch
}

/** Sample the colour at `pos` between stops (for adding a stop). */
export function midColor(stops: Stop[], pos: number): string {
  const s = [...stops].sort((a, b) => a.pos - b.pos)
  let best = s[0]
  for (const st of s) if (st.pos <= pos) best = st
  return best?.color ?? '#FFFFFF'
}
