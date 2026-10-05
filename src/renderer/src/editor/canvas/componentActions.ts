// Component / instance actions for the UI (shortcuts, menus, inspector, Components list).
// The store enforces the rules and throws on a refused edit; these wrappers turn that into a toast.
import type { MenuEntry } from '../../ui'
import { getStore } from '../../model/store'
import * as ops from '../../model/ops'
import { instanceRootOf, instancesOf, isMain } from '../../model/components'
import { pickMain, setOf, variantValues, variantsOf } from '../../model/variants'
import type { CNode, Doc, Page, WorldRect } from '../../model/types'
import { visibleWorldRect } from './camera'
import { clientToWorld, measure, union } from './geometry'
import { containerAt } from './selection'
import { toast } from './toast'

const S = getStore
const docOf = (docId: string): Doc | undefined => S().docs[docId]
const selectionOf = (docId: string): string[] => S().editors[docId]?.selection ?? []

/** Run a store edit; a refused one (structure change inside an instance, a component cycle) becomes a toast. */
export function guarded<T>(fn: () => T): T | undefined {
  try {
    return fn()
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e))
    return undefined
  }
}

/** Instance roots of the selection (deduplicated). */
export function selectedInstances(docId: string): string[] {
  const doc = docOf(docId)
  if (!doc) return []
  return [...new Set(selectionOf(docId).map((id) => instanceRootOf(doc, id)).filter((r): r is string => Boolean(r)))]
}

export const selectedMains = (docId: string): string[] => selectionOf(docId).filter((id) => isMain(docOf(docId)?.nodes[id]))

/** Ctrl+Alt+K: make a component from the selection (a lone frame becomes the main, anything else is wrapped in a frame first). */
export function createComponentFromSelection(docId: string): void {
  const doc = docOf(docId)
  if (!doc) return
  const all = ops.sortByTreeOrder(doc, ops.topmostOnly(doc, selectionOf(docId)).filter((id) => doc.nodes[id]?.parent))
  if (!all.length) return
  const parent = doc.nodes[all[0]].parent as string
  const ids = all.filter((id) => doc.nodes[id].parent === parent)
  const rects = new Map<string, WorldRect | null>(ids.map((id) => [id, measure(id, docId) ?? ops.worldRect(doc, id)]))
  const bounds = union([...rects.values()]) ?? { x: 0, y: 0, width: 0, height: 0 }
  const origin = ops.isPageRoot(doc, parent) ? { x: 0, y: 0 } : (() => {
    const r = measure(parent, docId) ?? ops.worldRect(doc, parent)
    return r ? { x: r.x, y: r.y } : { x: 0, y: 0 }
  })()
  const main = guarded(() => S().createComponent(docId, ids, { rects, bounds, origin }))
  if (main) {
    S().select(docId, [main])
    toast('Created component')
  }
}

/** Ctrl+Alt+B: turn the selected instances into plain frames. */
export function detachSelection(docId: string): void {
  const roots = selectedInstances(docId)
  if (!roots.length) return
  guarded(() =>
    S().transact(docId, 'Detach instance', () => {
      for (const r of roots) S().detachInstance(docId, r)
    })
  )
  S().select(docId, roots)
}

/** Select the main component of the selected instance and switch to its page. */
export function goToMainOfSelection(docId: string): void {
  const sel = selectionOf(docId)
  if (!sel.length || !S().goToMain(docId, sel[0])) return
  toast('Went to main component')
}

export function resetOverridesOfSelection(docId: string): void {
  const roots = selectedInstances(docId)
  guarded(() =>
    S().transact(docId, 'Reset overrides', () => {
      for (const r of roots) S().resetOverrides(docId, r)
    })
  )
}

/** Override key of a node inside an instance: its main-side id ('' is not used here: the root maps to the main). */
export function overrideSource(doc: Doc, id: string): { root: string; src: string } | null {
  const root = instanceRootOf(doc, id)
  const inst = root ? doc.nodes[root].instance : undefined
  const src = root === id ? inst?.of : doc.nodes[id]?.srcId
  return root && src ? { root, src } : null
}

/** Is this layer overridden in its instance? */
export function isOverridden(doc: Doc, id: string): boolean {
  const o = overrideSource(doc, id)
  if (!o) return false
  const ov = doc.nodes[o.root].instance?.overrides
  return Boolean(ov && (o.root === id ? ov[''] : ov[o.src]))
}

/** Drop the override of one layer of an instance. */
export function resetLayerOverride(docId: string, id: string): void {
  const doc = docOf(docId)
  const o = doc && overrideSource(doc, id)
  if (o) guarded(() => S().resetOverrides(docId, o.root, o.src))
}

/** Place an instance of `mainId`: into the selected frame (not inside the main itself), else onto the page in view. */
export function insertInstance(docId: string, mainId: string): string | undefined {
  const doc = docOf(docId)
  if (!doc?.nodes[mainId]?.component) return undefined
  const page = ops.pageOf(doc, S().editors[docId]?.pageId ?? '') ?? doc.pages[0]
  const sel = selectionOf(docId)
  const sf = sel.length === 1 ? doc.nodes[sel[0]] : undefined
  const intoFrame = sf && sf.type === 'frame' && !instanceRootOf(doc, sf.id) && sf.id !== mainId
  const parent = intoFrame ? sf.id : (page?.rootId ?? '')
  let at: { x: number; y: number } | undefined
  if (!intoFrame) {
    const vis = visibleWorldRect(docId)
    const r = ops.worldRect(doc, mainId)
    const w = r?.width ?? ops.numericSize(doc.nodes[mainId].style.width) ?? 100
    const h = r?.height ?? ops.numericSize(doc.nodes[mainId].style.height) ?? 100
    if (vis) at = { x: Math.round(vis.x + vis.width / 2 - w / 2), y: Math.round(vis.y + vis.height / 2 - h / 2) }
  }
  const id = guarded(() => S().createInstance(docId, mainId, parent, undefined, at))
  if (id) S().select(docId, [id])
  return id
}

/** Main components of the doc, in doc order. */
export function mainsOf(doc: Doc): CNode[] {
  return Object.values(doc.nodes).filter((n) => n.component)
}

/** Context-menu entries for the component actions, for the given selection. Empty when none apply. */
export function componentMenu(docId: string, ids: string[]): MenuEntry[] {
  const doc = docOf(docId)
  if (!doc || !ids.length) return []
  const inInstance = ids.some((id) => instanceRootOf(doc, id))
  const mains = ids.filter((id) => doc.nodes[id]?.component)
  const roots = [...new Set(ids.map((id) => instanceRootOf(doc, id)).filter((r): r is string => Boolean(r)))]
  const hasOverrides = roots.some((r) => doc.nodes[r].instance?.overrides)
  const run = (fn: () => void): (() => void) => () => {
    if (S().editors[docId]?.selection.join() !== ids.join()) S().select(docId, ids)
    fn()
  }
  const out: MenuEntry[] = [{ type: 'separator' }]
  if (!inInstance) {
    out.push({ label: 'Create component', shortcut: 'Ctrl+Alt+K', disabled: mains.length === ids.length, onSelect: run(() => createComponentFromSelection(docId)) })
  }
  if (mains.length === 1 && ids.length === 1) {
    out.push({ label: 'Create instance', onSelect: () => void insertInstance(docId, mains[0]) })
    out.push({ label: 'Add variant', onSelect: run(() => addVariantToSelection(docId)) })
  }
  if (inInstance) {
    out.push({ label: 'Go to main component', onSelect: run(() => goToMainOfSelection(docId)) })
    out.push({ label: 'Reset all overrides', disabled: !hasOverrides, onSelect: run(() => resetOverridesOfSelection(docId)) })
    out.push({ label: 'Detach instance', shortcut: 'Ctrl+Alt+B', onSelect: run(() => detachSelection(docId)) })
  }
  return out
}

/** "Size=Large, Tone=Loud" for a variant main (its values with the set's defaults), or null for a lone component. */
export function variantLabel(doc: Doc, mainId: string): string | null {
  const setId = setOf(doc, mainId)
  if (!setId) return null
  const have = variantValues(doc, mainId)
  return (doc.nodes[setId].componentSet?.props ?? [])
    .filter((p) => p.type === 'variant')
    .map((p) => `${p.name}=${have[p.id]}`)
    .join(', ')
}

/** The set frame a node belongs to as a variant main, or the node itself when it is a set. */
export const setFrameOf = (doc: Doc, id: string): string | null => (doc.nodes[id]?.componentSet ? id : setOf(doc, id))

/** Add variant: duplicate the selected main as a new variant beside it (a lone main is wrapped in a set first). */
export function addVariantToSelection(docId: string): void {
  const doc = docOf(docId)
  const sel = selectionOf(docId)
  if (!doc || sel.length !== 1 || !doc.nodes[sel[0]]?.component) return
  const id = guarded(() => S().addVariant(docId, sel[0]))
  if (id) {
    S().select(docId, [id])
    toast('Added variant')
  }
}

// ------------------------------------------------------------------------------------------------
// Assets panel: components of every page, search, drag to insert

/** drag-and-drop payload type: the id of the main component to insert */
export const COMPONENT_DRAG_TYPE = 'application/x-vellum-component'

export interface AssetItem {
  /** the main component */
  id: string
  name: string
  /** instances of it in the file (all variants of a set together) */
  instances: number
  /** variant mains in its set (1 for a lone component); a set is listed once, by its default variant */
  variants: number
}

export interface AssetGroup {
  page: Page
  items: AssetItem[]
}

/** Components per page, filtered by a case-insensitive name search; pages without hits are left out. */
export function assetGroups(doc: Doc, query = ''): AssetGroup[] {
  const q = query.trim().toLowerCase()
  const out: AssetGroup[] = []
  for (const page of doc.pages) {
    const seen = new Set<string>()
    const items: AssetItem[] = []
    for (const id of ops.descendants(doc, page.rootId)) {
      const n = doc.nodes[id]
      if (!n?.component) continue
      const setId = setOf(doc, id)
      if (setId) {
        if (seen.has(setId)) continue
        seen.add(setId)
        const mains = variantsOf(doc, setId)
        const name = doc.nodes[setId].componentSet?.name ?? n.component.name
        if (q && !name.toLowerCase().includes(q) && !mains.some((m) => m.name.toLowerCase().includes(q))) continue
        items.push({ id: pickMain(doc, setId) ?? id, name, instances: mains.reduce((t, m) => t + instancesOf(doc, m.id).length, 0), variants: mains.length })
        continue
      }
      if (q && !n.component.name.toLowerCase().includes(q)) continue
      items.push({ id, name: n.component.name, instances: instancesOf(doc, id).length, variants: 1 })
    }
    if (items.length) out.push({ page, items })
  }
  return out
}

/** Show a main component: switch to its page and select it. */
export function goToComponent(docId: string, mainId: string): boolean {
  const doc = docOf(docId)
  const page = doc?.nodes[mainId]?.component && ops.pageOf(doc, mainId)
  if (!page) return false
  S().setActivePage(docId, page.id)
  S().select(docId, [mainId])
  return true
}

/** Rename a component: its name in the Assets panel and (when it was the same) the main's layer name. */
export function renameComponent(docId: string, mainId: string, name: string): void {
  const next = name.trim()
  if (!next || !docOf(docId)?.nodes[mainId]?.component) return
  S().mutate(docId, 'Rename component', (d) => {
    const n = d.nodes[mainId]
    if (!n.component) return
    if (n.name === n.component.name) n.name = next
    n.component.name = next
  })
}

/** Drop of a component from the Assets panel: an instance in the frame under the pointer (never inside an instance), centred on it. */
export function dropComponent(docId: string, mainId: string, clientX: number, clientY: number): string | undefined {
  const doc = docOf(docId)
  const main = doc?.nodes[mainId]
  if (!doc || !main?.component) return undefined
  let parent = containerAt(docId, clientX, clientY, new Set([mainId]))
  const inside = instanceRootOf(doc, parent)
  if (inside) parent = doc.nodes[inside].parent as string // an instance's structure is fixed: drop beside it
  const frame = doc.nodes[parent]
  let at: { x: number; y: number } | undefined
  if (!(frame?.type === 'frame' && ops.isFlex(frame))) {
    const p = clientToWorld(clientX, clientY, docId)
    const origin = frame?.type === 'frame' && !ops.isPageRoot(doc, parent) ? measure(parent, docId) : null
    const w = ops.numericSize(main.style.width) ?? 100
    const h = ops.numericSize(main.style.height) ?? 100
    at = { x: Math.round(p.x - (origin?.x ?? 0) - w / 2), y: Math.round(p.y - (origin?.y ?? 0) - h / 2) }
  }
  const id = guarded(() => S().createInstance(docId, mainId, parent, undefined, at))
  if (id) S().select(docId, [id])
  return id
}
