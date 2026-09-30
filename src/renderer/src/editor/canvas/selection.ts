// Hit testing and selection picking.
import { getStore } from '../../model/store'
import { ancestors, isPageRoot, isTopLevel } from '../../model/ops'
import type { Doc } from '../../model/types'
import { getWorldEl } from './geometry'

/** Deepest rendered node id under the DOM target (or null). */
export function nodeIdFromTarget(target: EventTarget | null): string | null {
  const world = getWorldEl()
  let el = target instanceof Element ? target : null
  while (el && el !== world) {
    const id = el.getAttribute('data-node-id')
    if (id) return id
    el = el.parentElement
  }
  return null
}

/** Chain from the top-level node down to `id` (excludes the page root). */
export function chainTopDown(doc: Doc, id: string): string[] {
  const up = [id, ...ancestors(doc, id)].filter((n) => !isPageRoot(doc, n))
  return up.reverse()
}

const lockedInChain = (doc: Doc, chain: string[], upto: number): boolean =>
  chain.slice(0, upto + 1).some((c) => doc.nodes[c]?.locked)

/**
 * Pick the node a click on `deepest` should select.
 * - deep (Ctrl/Meta): the deepest node.
 * - otherwise: walk down from the artboard while the node's parent is "in context" (page root,
 *   top-level nodes, and ancestors of the current selection) and take the last one. So the first
 *   click on an artboard child selects the child directly under the artboard; once a sibling is
 *   selected, clicks resolve at that level.
 * Returns null when the pick is locked (or inside a locked node).
 */
export function pickNode(doc: Doc, deepest: string, selection: string[], deep = false): string | null {
  const chain = chainTopDown(doc, deepest)
  if (!chain.length) return null
  let idx = chain.length - 1
  if (!deep) {
    const ctx = new Set<string>()
    for (const s of selection) for (const a of ancestors(doc, s)) ctx.add(a)
    idx = 0
    for (let i = 1; i < chain.length; i++) {
      const parent = doc.nodes[chain[i]]?.parent
      if (!parent) break
      if (ctx.has(parent) || isTopLevel(doc, parent)) idx = i
      else break
    }
  }
  if (lockedInChain(doc, chain, idx)) return null
  return chain[idx]
}

/** Double-click drill: the node one level below the selected ancestor of `deepest`. */
export function drillNode(doc: Doc, deepest: string, selection: string[]): string | null {
  const chain = chainTopDown(doc, deepest)
  for (let i = chain.length - 1; i >= 0; i--) {
    if (selection.includes(chain[i])) {
      const next = chain[i + 1]
      if (next && !lockedInChain(doc, chain, i + 1)) return next
      return null
    }
  }
  return null
}

/** Container (frame) the pointer is over, ignoring `exclude` subtrees. Returns page root when none. */
export function containerAt(docId: string, clientX: number, clientY: number, exclude: Set<string> = new Set()): string {
  const s = getStore()
  const doc = s.docs[docId]
  const pageId = s.editors[docId]?.pageId
  const page = doc?.pages.find((p) => p.id === pageId) ?? doc?.pages[0]
  const root = page?.rootId ?? ''
  if (!doc) return root
  const world = getWorldEl()
  for (const el of document.elementsFromPoint(clientX, clientY)) {
    if (world && !world.contains(el)) continue
    const id = el.getAttribute('data-node-id')
    if (!id) continue
    const n = doc.nodes[id]
    if (!n || n.type !== 'frame' || n.locked) continue
    if (exclude.has(id) || ancestors(doc, id).some((a) => exclude.has(a))) continue
    if (ancestors(doc, id).some((a) => doc.nodes[a]?.locked)) continue
    return id
  }
  return root
}
