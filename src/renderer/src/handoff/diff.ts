// What changed between two hand-offs (T72 / H6): `diffSpecs(previous, next)` compares two bundles' specs and returns, per
// screen and component, whether it was added, removed, changed or unchanged; for changed ones the layers that differ
// (`node path, property, old → new`), plus token and asset changes. Layers are matched by id (a node id never changes
// and is what spec.json carries), so renames and moves are not mistaken for remove + add. Pure; both specs should be
// built the same way (no measurement), so that layout rounding cannot look like a change.
import { formatNumber } from '../model/devSpec'
import { facts, type PropChange } from './deltas'
import type { AssetRecord, ComponentSpec, DevNodeSpec, HandoffSpec, ScreenSpec } from './types'

export type { PropChange } from './deltas'

export type Status = 'added' | 'removed' | 'changed' | 'unchanged'

export interface NodeChange {
  id: string
  /** layer names from the frame, `Checkout › Card › Title` */
  path: string
  kind: 'added' | 'removed' | 'changed'
  /** `changed`: what differs, intent first */
  changes: PropChange[]
  /** `added` / `removed`: layers below it that came or went with it */
  descendants?: number
}

export interface ScreenChange {
  id: string
  name: string
  status: Status
  nodes: NodeChange[]
}

export interface ComponentChange {
  ref: string
  name: string
  status: Status
  nodes: NodeChange[]
}

export interface TokenChange {
  name: string
  status: 'added' | 'removed' | 'changed'
  /** `--color-primary: #2563EB → #1D4ED8` (modes: `Dark: #60A5FA → #93C5FD`) */
  text: string
}

export interface AssetChange {
  path: string
  status: 'added' | 'removed' | 'changed'
}

export interface ChangeSet {
  /** the handoff number compared against */
  previous: number
  screens: ScreenChange[]
  components: ComponentChange[]
  tokens: TokenChange[]
  assets: AssetChange[]
  /** screens and components to rebuild: added and changed ones */
  rebuild: string[]
  counts: { added: number; removed: number; changed: number; unchanged: number }
}

const SEP = ' › '

interface Located {
  node: DevNodeSpec
  path: string
  parent: string | null
}

/** id -> layer with its name path, for every layer under the given roots (breakpoints of a screen, variants of a component). */
function locate(roots: Array<{ prefix: string; root: DevNodeSpec }>): Map<string, Located> {
  const out = new Map<string, Located>()
  const walk = (n: DevNodeSpec, path: string, parent: string | null): void => {
    out.set(n.id, { node: n, path, parent })
    for (const c of n.children) walk(c, `${path}${SEP}${c.name}`, n.id)
  }
  for (const r of roots) walk(r.root, r.prefix ? `${r.prefix}${SEP}${r.root.name}` : r.root.name, null)
  return out
}

const sizeText = (n: DevNodeSpec): string => {
  const w = n.box.width === undefined ? 'fit' : formatNumber(n.box.width)
  const h = n.box.height === undefined ? 'fit' : formatNumber(n.box.height)
  return `${w} × ${h}`
}

/** Everything about a layer that can differ between two hand-offs, as printable strings (deltas.ts facts + the rest). */
type Fact = [property: string, text: string, key?: string]

function allFacts(n: DevNodeSpec, siblings: { names: string; ids: string }): Fact[] {
  const out: Fact[] = [['name', n.name], ...facts(n), ['size', sizeText(n)]]
  if (n.box.x !== undefined && n.box.y !== undefined) out.push(['position', `${formatNumber(n.box.x)}, ${formatNumber(n.box.y)}`])
  out.push(['dev notes', (n.notes ?? []).join(' / ') || 'none'])
  out.push(['needs decision', n.needsDecision ?? 'none'])
  if (n.a11y) out.push(['accessibility', Object.entries(n.a11y).map(([k, v]) => `${k} ${String(v)}`).join(', ')])
  else out.push(['accessibility', 'none'])
  for (const [state, patch] of Object.entries(n.states ?? {})) out.push([`state ${state}`, Object.entries(patch).map(([k, v]) => `${k}: ${String(v)}`).join('; ')])
  out.push(['tokens', n.tokens.join(', ') || 'none'])
  if (n.image) out.push(['image alt', n.image.alt ?? 'none'])
  // compared by layer id, shown by name: renaming a child is not a change of its parent
  out.push(['layer order', siblings.names, siblings.ids])
  return out
}

function diffFacts(a: Fact[], b: Fact[]): PropChange[] {
  const left = new Map(a.map((f) => [f[0], f]))
  const right = new Map(b.map((f) => [f[0], f]))
  const out: PropChange[] = []
  // the new side's order first (intent before look), then what only the old side had (a removed state rule)
  for (const [property, to, toKey] of b) {
    const was = left.get(property)
    if (!was) out.push({ property, from: 'none', to })
    else if ((was[2] ?? was[1]) !== (toKey ?? to)) out.push({ property, from: was[1], to })
  }
  for (const [property, from] of a) if (!right.has(property)) out.push({ property, from, to: 'none' })
  return out
}

/** Layers below `id` in the located map (children count). */
function below(map: Map<string, Located>, id: string): number {
  const stack = [...(map.get(id)?.node.children ?? [])]
  let n = 0
  while (stack.length) {
    const c = stack.pop() as DevNodeSpec
    n++
    stack.push(...c.children)
  }
  return n
}

function diffTrees(prev: Map<string, Located>, next: Map<string, Located>): NodeChange[] {
  const out: NodeChange[] = []
  // order of layers inside a parent only matters among the layers both versions have
  const order = (m: Map<string, Located>, other: Map<string, Located>, id: string): { names: string; ids: string } => {
    const kids = (m.get(id)?.node.children ?? []).filter((c) => other.has(c.id))
    return { names: kids.map((c) => c.name).join(' / '), ids: kids.map((c) => c.id).join(',') }
  }
  for (const [id, b] of next) {
    const a = prev.get(id)
    if (!a) {
      if (b.parent && !prev.has(b.parent) && next.has(b.parent)) continue // its parent is new too: listed once, at the top
      out.push({ id, path: b.path, kind: 'added', changes: [], descendants: below(next, id) })
      continue
    }
    const changes = diffFacts(allFacts(a.node, order(prev, next, id)), allFacts(b.node, order(next, prev, id)))
    if (changes.length) out.push({ id, path: b.path, kind: 'changed', changes })
  }
  for (const [id, a] of prev) {
    if (next.has(id)) continue
    if (a.parent && !next.has(a.parent) && prev.has(a.parent)) continue
    out.push({ id, path: a.path, kind: 'removed', changes: [], descendants: below(prev, id) })
  }
  return out
}

const screenRoots = (s: ScreenSpec): Array<{ prefix: string; root: DevNodeSpec }> =>
  s.breakpoints.map((b) => ({ prefix: b.bp === 'default' ? '' : b.bp, root: b.root }))

const componentRoots = (c: ComponentSpec): Array<{ prefix: string; root: DevNodeSpec }> =>
  c.variants.map((v) => ({ prefix: c.variants.length > 1 ? v.name : '', root: v.root }))

const statusOf = (nodes: NodeChange[]): Status => (nodes.length ? 'changed' : 'unchanged')

const modeText = (values: Record<string, { value: string }>): string => Object.entries(values).map(([m, v]) => `${m}: ${v.value}`).join(', ')

function diffTokens(prev: HandoffSpec, next: HandoffSpec): TokenChange[] {
  const a = new Map(prev.tokens.map((t) => [t.name, t]))
  const b = new Map(next.tokens.map((t) => [t.name, t]))
  const out: TokenChange[] = []
  for (const [name, t] of b) {
    const old = a.get(name)
    if (!old) out.push({ name, status: 'added', text: `${name}: ${modeText(t.values)}` })
    else {
      const was: string[] = []
      for (const mode of new Set([...Object.keys(old.values), ...Object.keys(t.values)])) {
        const from = old.values[mode]?.value
        const to = t.values[mode]?.value
        if (from !== to) was.push(`${Object.keys(t.values).length > 1 || mode !== 'base' ? `${mode}: ` : ''}${from ?? 'none'} → ${to ?? 'none'}`)
      }
      if (was.length) out.push({ name, status: 'changed', text: `${name}: ${was.join(', ')}` })
    }
  }
  for (const [name, t] of a) if (!b.has(name)) out.push({ name, status: 'removed', text: `${name}: ${modeText(t.values)}` })
  return out.sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0))
}

const assetKey = (a: AssetRecord): string => a.sha256 ?? `${a.bytes ?? ''}:${a.width ?? ''}x${a.height ?? ''}:${a.missing ? 'missing' : ''}`

function diffAssets(prev: HandoffSpec, next: HandoffSpec): AssetChange[] {
  const a = new Map(prev.assets.map((x) => [x.path, x]))
  const b = new Map(next.assets.map((x) => [x.path, x]))
  const out: AssetChange[] = []
  for (const [path, x] of b) {
    const old = a.get(path)
    if (!old) out.push({ path, status: 'added' })
    else if (assetKey(old) !== assetKey(x)) out.push({ path, status: 'changed' })
  }
  for (const path of a.keys()) if (!b.has(path)) out.push({ path, status: 'removed' })
  // the same bytes under a new path (a renamed layer) is nothing to download again: drop the add + remove pair
  const bySha = (st: 'added' | 'removed', specs: Map<string, AssetRecord>): Map<string, string[]> => {
    const m = new Map<string, string[]>()
    for (const c of out) if (c.status === st && specs.get(c.path)?.sha256) m.set(specs.get(c.path)!.sha256 as string, [...(m.get(specs.get(c.path)!.sha256 as string) ?? []), c.path])
    return m
  }
  const gone = bySha('removed', a)
  const came = bySha('added', b)
  const drop = new Set<string>()
  for (const [sha, removedPaths] of gone) {
    const addedPaths = came.get(sha)
    if (!addedPaths) continue
    const n = Math.min(removedPaths.length, addedPaths.length)
    for (let i = 0; i < n; i++) {
      drop.add(removedPaths[i])
      drop.add(addedPaths[i])
    }
  }
  return out.filter((c) => !drop.has(c.path)).sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0))
}

export function diffSpecs(prev: HandoffSpec, next: HandoffSpec, previousVersion: number = prev.handoff.version): ChangeSet {
  // ---- screens: matched when they share a frame (a screen keeps its frames; breakpoints can be added or dropped)
  const prevByFrame = new Map<string, ScreenSpec>()
  for (const s of prev.screens) for (const b of s.breakpoints) prevByFrame.set(b.frameId, s)
  const matched = new Set<ScreenSpec>()
  const screens: ScreenChange[] = []
  for (const s of next.screens) {
    const old = s.breakpoints.map((b) => prevByFrame.get(b.frameId)).find(Boolean)
    if (!old) {
      screens.push({ id: s.id, name: s.name, status: 'added', nodes: [] })
      continue
    }
    matched.add(old)
    const nodes = diffTrees(locate(screenRoots(old)), locate(screenRoots(s)))
    screens.push({ id: s.id, name: s.name, status: statusOf(nodes), nodes })
  }
  for (const s of prev.screens) if (!matched.has(s)) screens.push({ id: s.id, name: s.name, status: 'removed', nodes: [] })

  // ---- components: by main (or set) reference
  const prevComps = new Map(prev.components.map((c) => [c.ref, c]))
  const components: ComponentChange[] = []
  for (const c of next.components) {
    const old = prevComps.get(c.ref)
    if (!old) {
      components.push({ ref: c.ref, name: c.name, status: 'added', nodes: [] })
      continue
    }
    prevComps.delete(c.ref)
    const nodes = diffTrees(locate(componentRoots(old)), locate(componentRoots(c)))
    // a component's own properties and state table are part of "changed" too
    const own: PropChange[] = []
    const was = JSON.stringify([old.props, old.states, old.notes])
    const now = JSON.stringify([c.props, c.states, c.notes])
    if (was !== now) {
      if (JSON.stringify(old.props) !== JSON.stringify(c.props)) own.push({ property: 'properties', from: old.props.map((p) => p.name).join(', ') || 'none', to: c.props.map((p) => p.name).join(', ') || 'none' })
      if (JSON.stringify(old.states) !== JSON.stringify(c.states)) own.push({ property: 'states', from: old.states.map((s) => `${s.state} (${s.badge})`).join(', ') || 'none', to: c.states.map((s) => `${s.state} (${s.badge})`).join(', ') || 'none' })
      if (JSON.stringify(old.notes) !== JSON.stringify(c.notes)) own.push({ property: 'dev notes', from: old.notes.join(' / ') || 'none', to: c.notes.join(' / ') || 'none' })
    }
    if (own.length) nodes.unshift({ id: c.ref, path: c.name, kind: 'changed', changes: own })
    components.push({ ref: c.ref, name: c.name, status: statusOf(nodes), nodes })
  }
  for (const c of prevComps.values()) components.push({ ref: c.ref, name: c.name, status: 'removed', nodes: [] })

  const tally = (list: Array<{ status: Status }>): void => {
    for (const x of list) counts[x.status]++
  }
  const counts = { added: 0, removed: 0, changed: 0, unchanged: 0 }
  tally(screens)
  tally(components)
  const rebuild = [
    ...screens.filter((s) => s.status === 'added' || s.status === 'changed').map((s) => s.name),
    ...components.filter((c) => c.status === 'added' || c.status === 'changed').map((c) => `${c.name} (component)`)
  ]
  return { previous: previousVersion, screens, components, tokens: diffTokens(prev, next), assets: diffAssets(prev, next), rebuild, counts }
}

/** True when the hand-off is identical to the previous one in everything the bundle describes. */
export const isUnchanged = (c: ChangeSet): boolean =>
  !c.counts.added && !c.counts.removed && !c.counts.changed && !c.tokens.length && !c.assets.length
