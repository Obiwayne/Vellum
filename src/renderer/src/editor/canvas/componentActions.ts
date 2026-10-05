// Component / instance actions for the UI (shortcuts, menus, inspector, Components list).
// The store enforces the rules and throws on a refused edit; these wrappers turn that into a toast.
import type { MenuEntry } from '../../ui'
import { getStore } from '../../model/store'
import * as ops from '../../model/ops'
import { instanceRootOf, isMain } from '../../model/components'
import type { CNode, Doc, WorldRect } from '../../model/types'
import { visibleWorldRect } from './camera'
import { measure, union } from './geometry'
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
  }
  if (inInstance) {
    out.push({ label: 'Go to main component', onSelect: run(() => goToMainOfSelection(docId)) })
    out.push({ label: 'Reset all overrides', disabled: !hasOverrides, onSelect: run(() => resetOverridesOfSelection(docId)) })
    out.push({ label: 'Detach instance', shortcut: 'Ctrl+Alt+B', onSelect: run(() => detachSelection(docId)) })
  }
  return out
}
