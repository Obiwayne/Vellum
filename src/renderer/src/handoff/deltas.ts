// What changes between the breakpoints of one screen (T58 plan section 6.2). Layers are matched by their layer-name
// path from the frame (same names next to each other are matched in order and listed as ambiguous); only what
// differs is reported, as intent first (layout rule, size rule) and look second. Pure: spec trees plus the document
// to tell a layer that is hidden at a breakpoint from one that is not there.
import type { CNode, Doc } from '../model/types'
import { formatNumber, sizingText } from '../model/devSpec'
import type { DevNodeSpec } from './types'

export interface PropChange {
  property: string
  from: string
  to: string
}

export interface LayerChange {
  /** layer names from the frame, `Header › Nav › Link`; `''` is the frame itself */
  path: string
  changes: PropChange[]
}

export interface BreakpointDelta {
  /** the breakpoint this one is compared with (the widest) */
  base: string
  /** matched layers that differ */
  changes: LayerChange[]
  /** here, not at the base */
  onlyHere: string[]
  /** at the base, nowhere here */
  notHere: string[]
  /** at the base, present here but hidden */
  hiddenHere: string[]
  /** sibling layers that share a name; matched in order, so check them by eye */
  ambiguous: string[]
}

const SEP = ' › '

interface Indexed {
  node: DevNodeSpec
}

/** path -> layer, siblings with the same name numbered `Item`, `Item (2)`, ... */
function index(root: DevNodeSpec): { map: Map<string, Indexed>; ambiguous: Set<string> } {
  const map = new Map<string, Indexed>()
  const ambiguous = new Set<string>()
  const walk = (n: DevNodeSpec, path: string): void => {
    map.set(path, { node: n })
    const seen = new Map<string, number>()
    const counts = new Map<string, number>()
    for (const c of n.children) counts.set(c.name, (counts.get(c.name) ?? 0) + 1)
    for (const c of n.children) {
      const k = (seen.get(c.name) ?? 0) + 1
      seen.set(c.name, k)
      const label = k === 1 ? c.name : `${c.name} (${k})`
      const here = path ? `${path}${SEP}${label}` : label
      if ((counts.get(c.name) ?? 0) > 1) ambiguous.add(path ? `${path}${SEP}${c.name}` : c.name)
      walk(c, here)
    }
  }
  walk(root, '')
  return { map, ambiguous }
}

/** The same naming over the document, hidden layers included. */
function docPaths(doc: Doc, frameId: string): Map<string, CNode> {
  const out = new Map<string, CNode>()
  const walk = (n: CNode, path: string): void => {
    out.set(path, n)
    const seen = new Map<string, number>()
    for (const cid of n.children) {
      const c = doc.nodes[cid]
      if (!c) continue
      const k = (seen.get(c.name) ?? 0) + 1
      seen.set(c.name, k)
      const label = k === 1 ? c.name : `${c.name} (${k})`
      walk(c, path ? `${path}${SEP}${label}` : label)
    }
  }
  const root = doc.nodes[frameId]
  if (root) walk(root, '')
  return out
}

const num = (v: number | null | undefined): string => (v === null || v === undefined ? 'unset' : formatNumber(v))

function paints(n: DevNodeSpec): string {
  return (
    n.paints
      .map((p) => {
        const c = p.color
        const col = c ? c.oklch ?? c.hex8 ?? c.value : (p.value ?? '')
        return `${p.kind} ${col}${p.kind === 'stroke' ? ` ${Array.isArray(p.width) ? p.width.join(' ') : (p.width ?? '')}px` : ''}`.trim()
      })
      .join(', ') || 'none'
  )
}

/** The properties of a layer worth comparing, as printable strings. Intent first. */
function facts(n: DevNodeSpec): Array<[string, string]> {
  const out: Array<[string, string]> = [
    ['layout', n.layout.summary],
    ['size rule', sizingText(n.sizing.w, n.sizing.h)],
    ['fill and stroke', paints(n)]
  ]
  if (n.text) {
    out.push(
      ['text', JSON.stringify(n.text.content)],
      ['font size', `${num(n.text.fontSize)}px`],
      ['font weight', String(n.text.fontWeight)],
      ['line height', n.text.lineHeightPx === null ? 'unknown' : `${num(n.text.lineHeightPx)}px`],
      ['letter spacing', `${num(n.text.letterSpacingPx)}px`],
      ['text align', n.text.textAlign ?? 'start']
    )
  }
  out.push(
    ['radius', n.radius === undefined ? '0' : Array.isArray(n.radius) ? n.radius.join(' ') : String(n.radius)],
    ['opacity', n.opacity === undefined ? '1' : formatNumber(n.opacity)],
    ['rotation', n.rotation === undefined ? '0' : `${formatNumber(n.rotation)}°`],
    ['effects', n.effects.map((e) => `${e.kind} ${num(e.x)} ${num(e.y)} ${num(e.blur)}`).join(', ') || 'none']
  )
  if (n.component) {
    const c = n.component
    out.push(['component', `${c.name ?? c.ref}${c.variant ? ` (${Object.entries(c.variant).map(([k, v]) => `${k}=${v}`).join(', ')})` : ''}${c.props ? ` ${JSON.stringify(c.props)}` : ''}`])
  }
  if (n.image) out.push(['image fit', n.image.objectFit ?? 'fill'])
  return out
}

export function diffLayer(base: DevNodeSpec, other: DevNodeSpec): PropChange[] {
  const a = new Map(facts(base))
  const out: PropChange[] = []
  for (const [property, to] of facts(other)) {
    const from = a.get(property)
    if (from !== undefined && from !== to) out.push({ property, from, to })
    else if (from === undefined) out.push({ property, from: 'none', to })
  }
  for (const [property, from] of a) if (!facts(other).some(([p]) => p === property)) out.push({ property, from, to: 'none' })
  return out
}

/** Only the topmost paths of a set: a missing layer's children are not listed again. */
function topmost(paths: string[]): string[] {
  const set = new Set(paths)
  return paths.filter((p) => {
    let cur = p
    for (;;) {
      const i = cur.lastIndexOf(SEP)
      if (i < 0) return true
      cur = cur.slice(0, i)
      if (set.has(cur)) return false
    }
  })
}

/**
 * Compare one breakpoint with the base (the widest). `doc` and the two frame ids are only used to tell "hidden at
 * this breakpoint" from "not there".
 */
export function breakpointDelta(
  doc: Doc,
  base: { name: string; frameId: string; root: DevNodeSpec },
  other: { name: string; frameId: string; root: DevNodeSpec }
): BreakpointDelta {
  const a = index(base.root)
  const b = index(other.root)
  const hiddenIn = docPaths(doc, other.frameId)
  const changes: LayerChange[] = []
  const missing: string[] = []
  for (const [path, item] of a.map) {
    const o = b.map.get(path)
    if (!o) {
      missing.push(path)
      continue
    }
    // the frame width and height are what makes breakpoints different: not a change worth listing
    const diff = diffLayer(item.node, o.node).filter((c) => path !== '' || c.property !== 'size rule')
    if (diff.length) changes.push({ path, changes: diff })
  }
  const added = [...b.map.keys()].filter((p) => !a.map.has(p))
  const gone = topmost(missing)
  const hiddenHere: string[] = []
  const notHere: string[] = []
  for (const p of gone) {
    const d = hiddenIn.get(p)
    if (d && !d.visible) hiddenHere.push(p)
    else notHere.push(p)
  }
  return {
    base: base.name,
    changes,
    onlyHere: topmost(added),
    notHere,
    hiddenHere,
    ambiguous: [...new Set([...a.ambiguous, ...b.ambiguous])].sort()
  }
}

/** True when nothing differs. */
export const isEmptyDelta = (d: BreakpointDelta): boolean => !d.changes.length && !d.onlyHere.length && !d.notHere.length && !d.hiddenHere.length
