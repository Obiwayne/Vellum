// The whitelist (T58 plan section 11): which frames, components, tokens and text styles a bundle may contain.
// Everything else in the file is unreachable from here: only chosen top-level visible frames are walked, hidden
// layers are dropped at this gate, comments and other pages are never read.
import type { CNode, Doc } from '../types'
import { numericSize } from '../ops'
import { isTopLevelFrame } from '../dev'
import { propDefsOf } from '../components'
import { varsIn } from '../devSpec'
import type { HandoffOptions } from './types'

export interface FrameRef {
  id: string
  /** breakpoint name from dev.screen, null for an untagged frame */
  bp: string | null
  width: number
  height: number
}

export interface ScreenGroup {
  name: string
  frames: FrameRef[]
}

export interface Scope {
  screens: ScreenGroup[]
  /** chosen frames in document order */
  frameIds: string[]
  /** component mains reachable from the frames (set siblings and nested instances included), sorted by id */
  mains: string[]
  /** every visible node id in the bundle (frames and mains), in a stable order */
  nodeIds: string[]
  /** tokens used directly, plus the ones those reference, by name */
  tokens: Set<string>
  /** token name -> number of nodes and text styles referencing it directly */
  tokenUsage: Map<string, number>
  textStyleIds: string[]
  skippedHidden: number
  warnings: string[]
}

const TOKEN_NAME = /^--[\w-]+$/

/** Document order of top-level nodes: page order, then position in the page. */
function topLevelOrder(doc: Doc): Map<string, number> {
  const order = new Map<string, number>()
  let i = 0
  for (const p of doc.pages) for (const c of doc.nodes[p.rootId]?.children ?? []) order.set(c, i++)
  return order
}

/** Visible descendants (and the node itself); hidden subtrees are dropped and counted. */
function walkVisible(doc: Doc, id: string, out: string[], hidden: { n: number }, seen: Set<string>): void {
  const n: CNode | undefined = doc.nodes[id]
  if (!n || seen.has(id)) return
  if (!n.visible) {
    // copies materialised inside an instance mirror a layer of the main: count the layer once, there
    if (n.srcId === undefined) hidden.n++
    return
  }
  seen.add(id)
  out.push(id)
  for (const c of n.children) walkVisible(doc, c, out, hidden, seen)
}

function frameRef(doc: Doc, id: string, opts: HandoffOptions): FrameRef {
  const n = doc.nodes[id]
  const r = opts.measure?.(id) ?? null
  return {
    id,
    bp: n.dev?.screen?.bp ?? null,
    width: r ? r.width : numericSize(n.style.width as string | number | undefined) ?? 0,
    height: r ? r.height : numericSize(n.style.height as string | number | undefined) ?? 0
  }
}

/** Resolve the chosen frames, their components, tokens and text styles. Pure; reads only reachable nodes. */
export function resolveScope(doc: Doc, opts: HandoffOptions): Scope {
  const warnings: string[] = []
  const order = topLevelOrder(doc)
  const chosen = new Set<string>()
  for (const id of opts.frames) {
    const n = doc.nodes[id]
    if (!n) warnings.push(`Frame ${id} was not found and was skipped.`)
    else if (!isTopLevelFrame(doc, id)) warnings.push(`"${n.name}" is not a top-level frame and was skipped.`)
    else if (!n.visible) warnings.push(`"${n.name}" is hidden and was skipped.`)
    else chosen.add(id)
  }
  const frameIds = [...chosen].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
  if (!frameIds.length) warnings.push('No frames were chosen: the bundle is empty.')

  // ---- screens: frames sharing dev.screen.name form one screen, widest breakpoint first
  const groups = new Map<string, ScreenGroup>()
  const keyOrder: string[] = []
  for (const id of frameIds) {
    const n = doc.nodes[id]
    const tagged = n.dev?.screen?.name
    const key = tagged ? `s:${tagged}` : `f:${id}`
    let g = groups.get(key)
    if (!g) {
      g = { name: tagged ?? n.name, frames: [] }
      groups.set(key, g)
      keyOrder.push(key)
    }
    g.frames.push(frameRef(doc, id, opts))
  }
  const screens = keyOrder.map((k) => {
    const g = groups.get(k)!
    g.frames.sort((a, b) => b.width - a.width || (a.bp ?? '').localeCompare(b.bp ?? '') || a.id.localeCompare(b.id))
    return g
  })

  // ---- nodes of the frames
  const hidden = { n: 0 }
  const seen = new Set<string>()
  const nodeIds: string[] = []
  for (const id of frameIds) walkVisible(doc, id, nodeIds, hidden, seen)

  // ---- components: instance mains, their set siblings, nested instances and swap defaults, to a fixed point
  const mains: string[] = []
  const mainSet = new Set<string>()
  const queue: string[] = []
  const addMain = (id: string | undefined): void => {
    if (!id || mainSet.has(id) || !doc.nodes[id]?.component) return
    mainSet.add(id)
    queue.push(id)
  }
  const scan = (ids: string[]): void => {
    for (const id of ids) addMain(doc.nodes[id]?.instance?.of)
  }
  scan(nodeIds)
  while (queue.length) {
    const id = queue.shift()!
    mains.push(id)
    const main = doc.nodes[id]
    const set = main.component?.set
    if (set && doc.nodes[set]?.componentSet) for (const c of doc.nodes[set].children) addMain(c)
    for (const p of propDefsOf(doc, id)) if (p.type === 'swap' && typeof p.default === 'string') addMain(p.default)
    const sub: string[] = []
    walkVisible(doc, id, sub, hidden, seen)
    for (const s of sub) nodeIds.push(s)
    scan(sub)
  }
  mains.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))

  // mains outside the chosen frames are pulled in: say so
  const frameSet = new Set(frameIds)
  const pulled: Record<string, string[]> = {}
  for (const id of mains) {
    const chain = [id]
    for (let cur = doc.nodes[id]?.parent; cur; cur = doc.nodes[cur]?.parent ?? null) chain.push(cur)
    if (chain.some((c) => frameSet.has(c))) continue
    const page = doc.pages.find((p) => chain.includes(p.rootId))
    const label = page?.name ?? 'another page'
    ;(pulled[label] ??= []).push(doc.nodes[id].component?.name ?? doc.nodes[id].name)
  }
  for (const page of Object.keys(pulled).sort()) {
    const names = [...new Set(pulled[page])].sort()
    warnings.push(`Pulls in ${names.join(', ')} from page "${page}" (components used by the chosen frames).`)
  }

  // ---- tokens and text styles
  const tokenUsage = new Map<string, number>()
  const bump = (name: string): void => void tokenUsage.set(name, (tokenUsage.get(name) ?? 0) + 1)
  const styleIds = new Set<string>()
  for (const id of nodeIds) {
    const n = doc.nodes[id]
    const names = new Set<string>()
    for (const v of Object.values(n.style)) for (const t of varsIn(v as string | number)) names.add(t)
    for (const t of varsIn(n.attrs?.fill)) names.add(t)
    names.forEach(bump)
    if (n.textStyle && doc.textStyles?.some((s) => s.id === n.textStyle)) styleIds.add(n.textStyle)
  }
  const textStyleIds = [...styleIds].sort()
  for (const sid of textStyleIds) {
    const names = new Set<string>()
    for (const v of Object.values(doc.textStyles!.find((s) => s.id === sid)!.style)) for (const t of varsIn(v as string | number)) names.add(t)
    names.forEach(bump)
  }
  // transitive closure through token values (every mode)
  const byName = new Map(doc.tokens.map((t) => [t.name, t]))
  const tokens = new Set<string>()
  const todo = [...tokenUsage.keys()]
  while (todo.length) {
    const name = todo.pop()!
    if (tokens.has(name)) continue
    const t = byName.get(name)
    if (!t) continue
    if (!TOKEN_NAME.test(name)) {
      warnings.push(`Token "${name}" has a name that is not a valid CSS custom property and was skipped.`)
      continue
    }
    tokens.add(name)
    for (const v of [t.value, ...Object.values(t.modes ?? {})]) for (const r of varsIn(v)) todo.push(r)
  }

  return { screens, frameIds, mains, nodeIds, tokens, tokenUsage, textStyleIds, skippedHidden: hidden.n, warnings }
}
