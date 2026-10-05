// Components and instances (docs/COMPONENTS.md). Pure helpers meant for an immer draft, like ops.ts.
// A main component is a frame with `component`; an instance is a frame with `instance` whose subtree
// is materialised from the main by syncInstances (each copy carries `srcId`). Policy (undo steps,
// toasts, which edits become overrides) belongs to the store; this file only knows the mechanics.
import { ancestors, applyStylePatch, descendants, insertNode, isPageRoot, newId, removeNode } from './ops'
import type { CNode, Doc, NodeOverride } from './types'

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

/** True when `from`'s subtree (through nested instances) contains an instance of `target`. */
function reaches(doc: Doc, from: string, target: string, seen = new Set<string>()): boolean {
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

/** Place a new instance of `mainId` under `parentId`. Returns its id. Throws on cycles and bad targets. */
export function createInstance(doc: Doc, mainId: string, parentId: string, index?: number, at?: { x: number; y: number }): string {
  const main = doc.nodes[mainId]
  if (!main?.component) throw new Error(`${mainId} is not a component`)
  if (!doc.nodes[parentId]) throw new Error(`Parent ${parentId} not found`)
  if (instanceRootOf(doc, parentId)) throw new Error('Detach the instance to change its structure')
  const host = mainOf(doc, parentId)
  if (host && reaches(doc, mainId, host)) throw new Error('A component cannot contain an instance of itself')

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
  const keep = keepRootBox ? { width: dst.style.width, height: dst.style.height } : null
  dst.type = src.type
  dst.style = { ...src.style }
  if (keep) {
    if (keep.width !== undefined) dst.style.width = keep.width
    if (keep.height !== undefined) dst.style.height = keep.height
  }
  if (!keepRootBox) {
    dst.name = src.name
    dst.x = src.x
    dst.y = src.y
    dst.visible = src.visible
    dst.locked = src.locked
  }
  for (const k of ['text', 'svg'] as const) {
    if (src[k] === undefined) delete dst[k]
    else dst[k] = src[k]
  }
  if (src.attrs) dst.attrs = { ...src.attrs }
  else delete dst.attrs
}

function applyOverride(dst: CNode, o: NodeOverride | undefined): void {
  if (!o) return
  if (o.style) applyStylePatch(dst.style, o.style)
  if (o.text !== undefined) dst.text = o.text
  if (o.svg !== undefined) dst.svg = o.svg
  if (o.attrs) dst.attrs = { ...dst.attrs, ...o.attrs }
  if (o.name !== undefined) dst.name = o.name
  if (o.visible !== undefined) dst.visible = o.visible
}

/** Make `dst`'s children mirror `src`'s (by srcId), recursively. */
function reconcile(doc: Doc, src: CNode, dst: CNode, overrides: Record<string, NodeOverride> | undefined): void {
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
    applyOverride(twin, overrides?.[sid])
    next.push(twin.id)
    reconcile(doc, s, twin, overrides)
  }
  for (const cid of existing.values()) removeNode(doc, cid) // source is gone
  dst.children = next
}

/** Rebuild one instance's subtree from its main + overrides. A missing main leaves the instance as is. */
export function syncInstance(doc: Doc, instId: string): void {
  const inst = doc.nodes[instId]
  const main = inst?.instance && doc.nodes[inst.instance.of]
  if (!inst?.instance || !main?.component) return
  const ov = inst.instance.overrides
  if (ov) {
    // drop overrides whose main-side node is gone
    const live = new Set(['', ...descendants(doc, main.id)])
    for (const k of Object.keys(ov)) if (!live.has(k)) delete ov[k]
    if (!Object.keys(ov).length) delete inst.instance.overrides
  }
  copyFields(main, inst, true)
  applyOverride(inst, ov?.[''])
  reconcile(doc, main, inst, inst.instance.overrides)
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
