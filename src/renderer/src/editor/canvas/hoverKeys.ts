// Alt changes what a hover lands on in Dev Mode (any layer instead of the sibling pick). The pointer may not move
// when the key goes down or up, so the hover is evaluated again at the last pointer position.
import { getStore } from '../../model/store'
import { hoverPick, nodeIdFromTarget } from './selection'

export interface KeyLike {
  key: string
  ctrlKey: boolean
  metaKey: boolean
}

/**
 * Re-evaluate the hovered layer after Alt was pressed or released. `alt` is the key's new state; `point` the last
 * pointer position in client coordinates (null: the pointer has not been over the canvas); `elementAt` is
 * `document.elementFromPoint`. Returns true when the hover was re-evaluated (it may still be unchanged).
 */
export function reevaluateHoverOnKey(
  docId: string,
  e: KeyLike,
  alt: boolean,
  point: { x: number; y: number } | null,
  elementAt: (x: number, y: number) => EventTarget | null,
  busy: boolean
): boolean {
  if (e.key !== 'Alt' || busy || !point) return false
  const s = getStore()
  const ed = s.editors[docId]
  const doc = s.docs[docId]
  if (!ed || !doc || !ed.devMode || ed.tool !== 'move') return false
  const deepest = nodeIdFromTarget(elementAt(point.x, point.y))
  const pick = deepest ? hoverPick(doc, deepest, ed.selection, { deep: e.ctrlKey || e.metaKey, alt, devMode: true }) : null
  if (pick !== ed.hovered) s.setHovered(docId, pick)
  return true
}
