// Components and instances (docs/COMPONENTS.md). Pure helpers meant for an immer draft, like ops.ts.
// A main component is a frame with `component`; an instance is a frame with `instance` whose subtree
// is materialised from the main by syncInstances (each copy carries `srcId`). Policy (undo steps,
// toasts, which edits become overrides) belongs to the store; this file only knows the mechanics.
import { ancestors, applyStylePatch, descendants, insertNode, isPageRoot, newId, removeNode, textPreview, wrapNodes } from './ops'
import type { CNode, Doc, NodeOverride, PropDef, StylePatch, WorldRect } from './types'

export const isMain = (n: CNode | undefined): boolean => Boolean(n?.component)
export const isInstance = (n: CNode | undefined): boolean => Boolean(n?.instance)

/** Nearest instance root at or above `id` (the node itself counts), or null. */
export function instanceRootOf(doc: Doc, id: string): string | null {
  for (const a of [id, ...ancestors(doc, id)]) if (doc.nodes[a]?.instance) return a
  return null
}

/** Nearest main component at or above `id` (the node itself counts), or null. */
export function mainOf(doc: Doc, id: string): string | null {
  for (const a of [id, ...ancestors(doc, id)]) if (doc.nodes[a]?.component) return a
  return null
}

/** Instance roots of `mainId` (all instances when omitted), in doc order. */
export function instancesOf(doc: Doc, mainId?: string): string[] {
  return Object.values(doc.nodes)
    .filter((n) => n.instance && (mainId === undefined || n.instance.of === mainId))
    .map((n) => n.id)
}

/** Property definitions that apply to a main: its set's (shared by every variant) or its own when it is a lone main. */
export function propDefsOf(doc: Doc, mainId: string): PropDef[] {
  const main = doc.nodes[mainId]
  const set = main?.component?.set ? doc.nodes[main.component.set] : undefined
  return set?.componentSet?.props ?? main?.component?.props ?? []
}

export const CYCLE_MSG = 'A component cannot contain an instance of itself'

/** True when `from`'s subtree (through nested instances) contains an instance of `target`. */
export function reaches(doc: Doc, from: string, target: string, seen = new Set<string>()): boolean {
  if (from === target) return true
  if (seen.has(from)) return false
  seen.add(from)
  return descendants(doc, from).some((d) => {
    const of = doc.nodes[d]?.instance?.of
    return of !== undefined && reaches(doc, of, target, seen)
  })
}

// ---------------------------------------------------------------------------------------------
// create / detach

/** Mark a frame as a main component. Throws when it cannot be one. */
export function createComponent(doc: Doc, id: string, name?: string): void {
  const n = doc.nodes[id]
  if (!n) throw new Error(`Node ${id} not found`)
  if (n.type !== 'frame' || !n.parent || isPageRoot(doc, id)) throw new Error('Only a frame can become a component')
  if (n.component) throw new Error('Already a component')
  if (instanceRootOf(doc, id)) throw new Error('Cannot make a component from an instance or inside one')
  n.component = { name: name?.trim() || n.name }
}

/**
 * Make a component from a selection: a single frame becomes the main itself; anything else (other
 * node types, several nodes) is wrapped in a Frame first (see wrapNodes for rects/bounds/origin).
 * Returns the main's id.
 */
export function createComponentFrom(
  doc: Doc,
  ids: string[],
  rects: Map<string, WorldRect | null>,
  bounds: WorldRect,
  origin: { x: number; y: number },
  name?: string
): string {
  const single = ids.length === 1 ? doc.nodes[ids[0]] : undefined
  if (single?.type === 'frame' && single.parent && !isPageRoot(doc, single.id)) {
    createComponent(doc, single.id, name)
    return single.id
  }
  if (!ids.length || ids.some((id) => !doc.nodes[id]?.parent || instanceRootOf(doc, id))) throw new Error('Nothing to make a component from')
  const parent = doc.nodes[ids[0]].parent
  if (ids.some((id) => doc.nodes[id].parent !== parent)) throw new Error('Select nodes with the same parent')
  const wrapper = wrapNodes(doc, ids, 'Frame', rects, bounds, origin)
  if (!wrapper) throw new Error('Nothing to make a component from')
  createComponent(doc, wrapper, name)
  return wrapper
}

/** Place a new instance of `mainId` under `parentId`. Returns its id. Throws on cycles and bad targets. */
export function createInstance(doc: Doc, mainId: string, parentId: string, index?: number, at?: { x: number; y: number }): string {
  const main = doc.nodes[mainId]
  if (!main?.component) throw new Error(`${mainId} is not a component`)
  if (!doc.nodes[parentId]) throw new Error(`Parent ${parentId} not found`)
  if (instanceRootOf(doc, parentId)) throw new Error(STRUCTURE_MSG)
  const host = mainOf(doc, parentId)
  if (host && reaches(doc, mainId, host)) throw new Error(CYCLE_MSG)

  const inst: CNode = {
    id: newId(doc),
    type: 'frame',
    name: main.name,
    parent: null,
    children: [],
    style: {},
    x: at?.x ?? main.x,
    y: at?.y ?? main.y,
    visible: true,
    locked: false,
    instance: { of: mainId },
    srcId: mainId
  }
  inst.style = { width: main.style.width ?? '', height: main.style.height ?? '' }
  if (inst.style.width === '') delete inst.style.width
  if (inst.style.height === '') delete inst.style.height
  insertNode(doc, inst, parentId, index)
  syncInstance(doc, inst.id)
  return inst.id
}

/** Turn an instance into plain nodes (keeps everything it currently shows). */
export function detachInstance(doc: Doc, id: string): void {
  const n = doc.nodes[id]
  if (!n?.instance) throw new Error(`${id} is not an instance`)
  for (const d of [id, ...descendants(doc, id)]) {
    delete doc.nodes[d].instance
    delete doc.nodes[d].srcId
  }
}

/** Detach every instance of a main (used before deleting it). */
export function detachInstancesOf(doc: Doc, mainId: string): void {
  for (const id of instancesOf(doc, mainId)) detachInstance(doc, id)
}

// ---------------------------------------------------------------------------------------------
// overrides

const overrideKey = (inst: CNode, srcId: string): string => (srcId === inst.instance?.of ? '' : srcId)

/** Merge `patch` into the instance's override for a main-side node ('' or the main id = the root), then re-sync. */
export function setOverride(doc: Doc, instId: string, srcId: string, patch: NodeOverride): void {
  const inst = doc.nodes[instId]
  if (!inst?.instance) throw new Error(`${instId} is not an instance`)
  const overrides = (inst.instance.overrides ??= {})
  const key = overrideKey(inst, srcId)
  const cur = (overrides[key] ??= {})
  const { style, attrs, ...rest } = patch
  Object.assign(cur, rest)
  if (style) cur.style = { ...cur.style, ...style }
  if (attrs) cur.attrs = { ...cur.attrs, ...attrs }
  syncInstance(doc, instId)
}

/** Drop one node's override (or all of the instance's when `srcId` is omitted), then re-sync. */
export function resetOverrides(doc: Doc, instId: string, srcId?: string): void {
  const inst = doc.nodes[instId]
  if (!inst?.instance) throw new Error(`${instId} is not an instance`)
  if (srcId === undefined) delete inst.instance.overrides
  else if (inst.instance.overrides) {
    delete inst.instance.overrides[overrideKey(inst, srcId)]
    if (!Object.keys(inst.instance.overrides).length) delete inst.instance.overrides
  }
  syncInstance(doc, instId)
}

// ---------------------------------------------------------------------------------------------
// sync

/** Copy what a main-side node looks like onto its materialised twin (structure is handled by the caller). */
function copyFields(src: CNode, dst: CNode, keepRootBox: boolean): void {
  const style = { ...src.style }
  if (keepRootBox) {
    if (dst.style.width !== undefined) style.width = dst.style.width
    if (dst.style.height !== undefined) style.height = dst.style.height
  }
  // assign only what differs: an immer draft records a patch for every assignment, equal or not
  if (dst.type !== src.type) dst.type = src.type
  if (!sameRecord(dst.style, style)) dst.style = style
  if (!keepRootBox) {
    if (dst.name !== src.name) dst.name = src.name
    if (dst.x !== src.x) dst.x = src.x
    if (dst.y !== src.y) dst.y = src.y
    if (dst.visible !== src.visible) dst.visible = src.visible
    if (dst.locked !== src.locked) dst.locked = src.locked
  }
  for (const k of ['text', 'svg'] as const) {
    if (src[k] === undefined) {
      if (dst[k] !== undefined) delete dst[k]
    } else if (dst[k] !== src[k]) dst[k] = src[k]
  }
  if (src.attrs) {
    if (!sameRecord(dst.attrs, src.attrs)) dst.attrs = { ...src.attrs }
  } else if (dst.attrs) delete dst.attrs
}

function sameRecord(a: Record<string, unknown> | undefined, b: Record<string, unknown> | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  const ka = Object.keys(a)
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k])
}

const sameList = (a: string[], b: string[]): boolean => a.length === b.length && a.every((v, i) => v === b[i])

const isAutoName = (n: CNode): boolean => n.type === 'text' && (n.name === textPreview(n.text ?? '') || n.name === 'Text')

function applyOverride(dst: CNode, o: NodeOverride | undefined, src?: CNode): void {
  if (!o) return
  if (o.style) applyStylePatch(dst.style, o.style)
  if (o.text !== undefined) dst.text = o.text
  if (o.svg !== undefined) dst.svg = o.svg
  if (o.attrs) dst.attrs = { ...dst.attrs, ...o.attrs }
  if (o.name !== undefined) dst.name = o.name
  else if (o.text !== undefined && src && isAutoName(src)) dst.name = textPreview(o.text) || 'Text' // an auto-named layer keeps following its text
  if (o.visible !== undefined) dst.visible = o.visible
  if (o.locked !== undefined) dst.locked = o.locked
  if (o.x !== undefined) dst.x = o.x
  if (o.y !== undefined) dst.y = o.y
}

/** Property definitions and the instance's values, for applying `bind`s while syncing. */
interface PropCtx {
  defs: PropDef[]
  values: Record<string, string | boolean> | undefined
}

/** A bound prop's current value (instance value, else the default), checked against the aspect's type. */
function boundValue(ctx: PropCtx | undefined, id: string | undefined, type: PropDef['type']): string | boolean | undefined {
  const def = id !== undefined ? ctx?.defs.find((d) => d.id === id && d.type === type) : undefined
  return def ? ctx?.values?.[def.id] ?? def.default : undefined
}

/**
 * Apply the property bindings of main-side node `s` to its twin: boolean → visible, text → text.
 * Returns the main a swap prop wants this nested instance to show (else undefined).
 */
function applyBindings(doc: Doc, s: CNode, twin: CNode, ctx: PropCtx | undefined): string | undefined {
  if (!s.bind || !ctx) return undefined
  const vis = boundValue(ctx, s.bind.visible, 'boolean')
  if (vis !== undefined && twin.visible !== Boolean(vis)) twin.visible = Boolean(vis)
  const text = s.type === 'text' ? boundValue(ctx, s.bind.text, 'text') : undefined
  if (text !== undefined) {
    if (twin.text !== String(text)) twin.text = String(text)
    if (isAutoName(s)) twin.name = textPreview(String(text)) || 'Text'
  }
  return swapTarget(doc, s, ctx)
}

/** The main a swap prop wants nested instance `s` to show (undefined = keep its own). */
function swapTarget(doc: Doc, s: CNode, ctx: PropCtx | undefined): string | undefined {
  const swap = s.instance && s.bind ? boundValue(ctx, s.bind.swap, 'swap') : undefined
  return typeof swap === 'string' && swap !== s.instance?.of && doc.nodes[swap]?.component ? swap : undefined
}

/** Make `dst`'s children mirror `src`'s (by srcId), recursively. */
function reconcile(doc: Doc, src: CNode, dst: CNode, overrides: Record<string, NodeOverride> | undefined, props?: PropCtx): void {
  const existing = new Map<string, string>()
  for (const cid of dst.children) {
    const s = doc.nodes[cid]?.srcId
    if (s !== undefined && !existing.has(s)) existing.set(s, cid)
    else removeNode(doc, cid) // unmatched or duplicate twin
  }
  const next: string[] = []
  for (const sid of src.children) {
    const s = doc.nodes[sid]
    if (!s) continue
    let twinId = existing.get(sid)
    existing.delete(sid)
    let twin = twinId ? doc.nodes[twinId] : undefined
    if (!twin) {
      twinId = newId(doc)
      twin = { id: twinId, type: s.type, name: s.name, parent: dst.id, children: [], style: {}, x: s.x, y: s.y, visible: s.visible, locked: s.locked, srcId: sid }
      doc.nodes[twinId] = twin
    }
    twin.parent = dst.id
    copyFields(s, twin, false)
    const swapTo = applyBindings(doc, s, twin, props)
    applyOverride(twin, overrides?.[sid], s)
    next.push(twin.id)
    if (swapTo) {
      // swap prop: this nested instance shows another main (its own box stays), overrides then key on that main's nodes
      copyFields(doc.nodes[swapTo], twin, true)
      reconcile(doc, doc.nodes[swapTo], twin, overrides)
    } else reconcile(doc, s, twin, overrides, props)
  }
  for (const cid of existing.values()) removeNode(doc, cid) // source is gone
  if (!sameList(dst.children, next)) dst.children = next
}

/** Rebuild one instance's subtree from its main + overrides. A missing main leaves the instance as is. */
export function syncInstance(doc: Doc, instId: string): void {
  const inst = doc.nodes[instId]
  const main = inst?.instance && doc.nodes[inst.instance.of]
  if (!inst?.instance || !main?.component) return
  const defs = propDefsOf(doc, main.id)
  const vals = inst.instance.props
  if (vals) {
    // drop values whose definition is gone or changed type
    for (const k of Object.keys(vals)) if (!defs.some((d) => d.id === k && d.type !== 'variant' && typeof vals[k] === (d.type === 'boolean' ? 'boolean' : 'string'))) delete vals[k]
    if (!Object.keys(vals).length) delete inst.instance.props
  }
  const ctx: PropCtx = { defs, values: inst.instance.props }
  const ov = inst.instance.overrides
  if (ov) {
    // drop overrides whose node is gone: main-side nodes, and the nodes of a main a swap prop currently shows
    const live = new Set(['', ...descendants(doc, main.id)])
    for (const d of descendants(doc, main.id)) {
      const to = swapTarget(doc, doc.nodes[d], ctx)
      if (to) for (const x of [to, ...descendants(doc, to)]) live.add(x)
    }
    for (const k of Object.keys(ov)) if (!live.has(k)) delete ov[k]
    if (!Object.keys(ov).length) delete inst.instance.overrides
  }
  copyFields(main, inst, true)
  applyOverride(inst, ov?.[''], main)
  reconcile(doc, main, inst, inst.instance.overrides, ctx)
}

/**
 * Re-sync the instances of `mainId` (every instance when omitted). Mains that contain instances are
 * brought up to date first, and an instance living inside another main re-syncs that main's instances too.
 */
export function syncInstances(doc: Doc, mainId?: string): void {
  const done = new Set<string>()
  const syncMain = (m: string, trail: string[]): void => {
    if (trail.includes(m)) return // cycles are refused at creation; never loop on hand-edited docs
    for (const inst of instancesOf(doc, m)) {
      if (done.has(inst)) continue
      // instances inside this main's subtree are derived from other mains: settle those first
      for (const d of descendants(doc, m)) {
        const of = doc.nodes[d]?.instance?.of
        if (of !== undefined) syncMain(of, [...trail, m])
      }
      if (done.has(inst)) continue
      done.add(inst)
      syncInstance(doc, inst)
      const host = mainOf(doc, doc.nodes[inst]?.parent ?? '')
      if (host && host !== m) syncMain(host, [...trail, m])
    }
  }
  const mains = mainId !== undefined ? [mainId] : Object.values(doc.nodes).filter((n) => n.component).map((n) => n.id)
  for (const m of mains) syncMain(m, [])
}

// ---------------------------------------------------------------------------------------------
// store hooks: run around every undoable edit (see store.mutate)

const memo = new WeakMap<Doc, boolean>()
/** True when the doc has any main or instance (cached per immutable doc). */
export function usesComponents(doc: Doc): boolean {
  let v = memo.get(doc)
  if (v === undefined) {
    v = Object.values(doc.nodes).some((n) => n.component || n.instance)
    memo.set(doc, v)
  }
  return v
}

export const STRUCTURE_MSG = 'Detach instance to change structure'

/** What an edit changed on a materialised node, as an override (null when nothing). The root keeps its own box and placement. */
function diffNode(before: CNode, after: CNode, root: boolean): NodeOverride | null {
  const o: NodeOverride = {}
  const style: StylePatch = {}
  for (const k of new Set([...Object.keys(before.style), ...Object.keys(after.style)])) {
    if (root && (k === 'width' || k === 'height')) continue
    if (before.style[k] !== after.style[k]) style[k] = after.style[k] ?? null
  }
  if (Object.keys(style).length) o.style = style
  if (before.text !== after.text && after.text !== undefined) o.text = after.text
  if (before.svg !== after.svg && after.svg !== undefined) o.svg = after.svg
  const attrs: Record<string, string> = {}
  for (const [k, v] of Object.entries(after.attrs ?? {})) if (before.attrs?.[k] !== v) attrs[k] = v
  if (Object.keys(attrs).length) o.attrs = attrs
  if (!root) {
    const autoRename = before.text !== after.text && isAutoName(before) // setText renames an auto-named layer: not a user rename
    if (before.name !== after.name && !autoRename) o.name = after.name
    if (before.visible !== after.visible) o.visible = after.visible
    if (before.locked !== after.locked) o.locked = after.locked
    if (before.x !== after.x) o.x = after.x
    if (before.y !== after.y) o.y = after.y
  }
  return Object.keys(o).length ? o : null
}

/**
 * Run on the draft after an edit recipe, with `base` = the doc before it:
 *  - structural edits inside an instance (children added, removed, moved, reordered) throw;
 *  - other edits to an instance's nodes become overrides on that instance;
 *  - instances whose main is gone are detached.
 * Then bring everything up to date with staleAfter + syncStale on the result.
 */
export function settleEdits(doc: Doc, base: Doc): void {
  const edits: [string, string, NodeOverride][] = []
  for (const b of Object.values(base.nodes)) {
    if (b.srcId === undefined && !b.instance) continue
    const n = doc.nodes[b.id]
    if (!n) continue
    const root = instanceRootOf(base, b.id)
    if (!root) continue
    if (!sameList(b.children, n.children)) throw new Error(STRUCTURE_MSG)
    const o = diffNode(b, n, root === b.id)
    if (o) edits.push([root, root === b.id ? (base.nodes[root].instance as { of: string }).of : (b.srcId as string), o])
  }
  for (const [root, src, o] of edits) if (doc.nodes[root]?.instance) setOverride(doc, root, src, o)
  const insts = instancesOf(doc)
  for (const id of insts) if (!doc.nodes[doc.nodes[id].instance?.of ?? '']?.component) detachInstance(doc, id)
  // a move must not put an instance inside its own main (directly or through nested instances)
  for (const id of insts) {
    if (!doc.nodes[id]?.instance) continue
    const host = mainOf(doc, doc.nodes[id].parent ?? '')
    if (host && reaches(doc, doc.nodes[id].instance?.of ?? '', host)) throw new Error(CYCLE_MSG)
  }
}

/** Mains and instance roots whose derived nodes are stale after `changed` node ids were touched (`prev` = doc before). */
export function staleAfter(prev: Doc, next: Doc, changed: Iterable<string>): { mains: Set<string>; roots: Set<string> } {
  const mains = new Set<string>()
  const roots = new Set<string>()
  for (const id of changed) {
    if (next.nodes[id]) {
      const m = mainOf(next, id)
      if (m) mains.add(m)
      const r = instanceRootOf(next, id)
      if (r) roots.add(r)
    } else {
      const m = mainOf(prev, id)
      if (m && next.nodes[m]?.component) mains.add(m)
    }
  }
  return { mains, roots }
}

/** Re-sync what staleAfter found, cascading into mains that host the synced instances. */
export function syncStale(doc: Doc, stale: { mains: Set<string>; roots: Set<string> }): void {
  for (const m of stale.mains) syncInstances(doc, m)
  for (const r of stale.roots) {
    if (!doc.nodes[r]?.instance) continue
    syncInstance(doc, r)
    const host = mainOf(doc, doc.nodes[r].parent ?? '')
    if (host) syncInstances(doc, host)
  }
}
