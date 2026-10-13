// What the redline overlay draws, from the editor state: the selected layer(s), the layer under the pointer and
// the selection's parent. Only in Dev Mode. The geometry itself is model/redlines.ts (pure); this file decides
// which rects take part and which are "rotated", so it can be tested without a canvas.
import type { CNode, Doc, WorldRect } from '../../model/types'
import { isPageRoot } from '../../model/ops'
import { redlines, type RedRect, type RedlineResult } from '../../model/redlines'

export interface RedlineScene extends RedlineResult {
  /** world rect of the layer the "rotated" note is drawn at, when something was skipped */
  noteAt?: WorldRect
}

export interface SceneInput {
  doc: Doc
  selection: string[]
  hovered: string | null
  devMode: boolean
  /** measured world rects by node id (the overlay's `rects`) */
  rects: Map<string, WorldRect>
  /** the layer has rotation, scale or skew in effect */
  isRotated: (n: CNode) => boolean
  /** a gesture (drag, resize...) is in progress: draw nothing */
  gesturing?: boolean
}

/** Ids whose rect the scene needs besides the selection and the hovered layer: the selection's parent. */
export function sceneExtraIds(doc: Doc, selection: string[], devMode: boolean): string[] {
  if (!devMode || selection.length !== 1) return []
  const parent = doc.nodes[selection[0]]?.parent
  return parent && !isPageRoot(doc, parent) ? [parent] : []
}

const union = (rs: WorldRect[]): WorldRect => {
  const x1 = Math.min(...rs.map((r) => r.x))
  const y1 = Math.min(...rs.map((r) => r.y))
  const x2 = Math.max(...rs.map((r) => r.x + r.width))
  const y2 = Math.max(...rs.map((r) => r.y + r.height))
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }
}

export function redlineScene(input: SceneInput): RedlineScene | null {
  const { doc, selection, hovered, devMode, rects, isRotated } = input
  if (!devMode || input.gesturing || !selection.length) return null
  const selNodes = selection.map((id) => doc.nodes[id]).filter((n): n is CNode => Boolean(n))
  const selRects = selNodes.map((n) => rects.get(n.id)).filter((r): r is WorldRect => Boolean(r))
  if (!selRects.length || selRects.length !== selNodes.length) return null
  const sel: RedRect = { ...union(selRects), ...(selNodes.some(isRotated) ? { rotated: true } : {}) }

  let other: RedRect | null = null
  if (hovered && !selection.includes(hovered)) {
    const hn = doc.nodes[hovered]
    const hr = rects.get(hovered)
    // the page itself is never a measuring target
    if (hn && hr && !isPageRoot(doc, hovered)) other = { ...hr, ...(isRotated(hn) ? { rotated: true } : {}) }
  }

  let parent: RedRect | null = null
  if (selNodes.length === 1) {
    const pid = selNodes[0].parent
    const pn = pid ? doc.nodes[pid] : undefined
    const pr = pid ? rects.get(pid) : undefined
    if (pn && pr && pid && !isPageRoot(doc, pid) && pid !== hovered) parent = { ...pr, ...(isRotated(pn) ? { rotated: true } : {}) }
  }

  const res = redlines(sel, other, parent)
  if (!res.lines.length && !res.skipped) return null
  const scene: RedlineScene = res
  if (res.skipped) {
    const at = other?.rotated ? other : sel
    scene.noteAt = { x: at.x, y: at.y, width: at.width, height: at.height }
  }
  return scene
}
