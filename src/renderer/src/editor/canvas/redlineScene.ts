// What the redline overlay draws, from the editor state: the selected layer(s), the layer under the pointer and
// the selection's parent. Only in Dev Mode. The geometry itself is model/redlines.ts (pure); this file decides
// which rects take part and which are "rotated", so it can be tested without a canvas.
import type { CNode, Doc, WorldRect } from '../../model/types'
import { isFlowLayout, isPageRoot } from '../../model/ops'
import { layoutIntent } from '../../model/devSpec'
import { containerRedlines, redlines, type RedRect, type RedlineResult } from '../../model/redlines'
import { sizeBadgeText } from './sizeLabel'

export interface RedlineScene extends RedlineResult {
  /** world rect of the layer the "rotated" note is drawn at, when something was skipped */
  noteAt?: WorldRect
  /** size chips: the hovered layer's size with its sizing rule in words ("Fit 120 × 40") */
  sizeLabels: Array<{ at: WorldRect; text: string }>
}

/** Children shown with a container's gaps: more than this and the gaps are not drawn (a long list is noise). */
const MAX_CHILDREN = 60

export interface SceneInput {
  doc: Doc
  selection: string[]
  hovered: string | null
  devMode: boolean
  /** measured world rects by node id (the overlay's `rects`) */
  rects: Map<string, WorldRect>
  /** the layer itself has rotation, scale or skew in effect (ancestors are checked by the scene) */
  isRotated: (n: CNode) => boolean
  /** a gesture (drag, resize...) is in progress: draw nothing */
  gesturing?: boolean
}

/** Ids whose rect the scene needs besides the selection and the hovered layer: the selection's parent and, for a flex or grid container, its visible children. */
export function sceneExtraIds(doc: Doc, selection: string[], devMode: boolean): string[] {
  if (!devMode || selection.length !== 1) return []
  const n = doc.nodes[selection[0]]
  if (!n) return []
  const out: string[] = []
  if (n.parent && !isPageRoot(doc, n.parent)) out.push(n.parent)
  if (n.type === 'frame' && isFlowLayout(n.style)) {
    for (const c of n.children) if (doc.nodes[c]?.visible && out.length < MAX_CHILDREN + 1) out.push(c)
  }
  return out
}

const union = (rs: WorldRect[]): WorldRect => {
  const x1 = Math.min(...rs.map((r) => r.x))
  const y1 = Math.min(...rs.map((r) => r.y))
  const x2 = Math.max(...rs.map((r) => r.x + r.width))
  const y2 = Math.max(...rs.map((r) => r.y + r.height))
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }
}

export function redlineScene(input: SceneInput): RedlineScene | null {
  const { doc, selection, hovered, devMode, rects } = input
  // a layer inside a rotated or scaled ancestor is measured as a bounding box too: it counts as rotated itself
  const isRotated = (n: CNode): boolean => {
    const seen = new Set<string>()
    for (let cur: CNode | undefined = n; cur && !seen.has(cur.id) && !isPageRoot(doc, cur.id); cur = cur.parent ? doc.nodes[cur.parent] : undefined) {
      seen.add(cur.id)
      if (input.isRotated(cur)) return true
    }
    return false
  }
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

  // a single flex or grid container: its padding on four sides and the gaps between its children
  if (selNodes.length === 1 && !sel.rotated) {
    const n = selNodes[0]
    if (n.type === 'frame' && isFlowLayout(n.style)) {
      const kids = n.children
        .filter((c) => doc.nodes[c]?.visible)
        .map((c) => rects.get(c))
        .filter((r): r is WorldRect => Boolean(r))
      if (kids.length <= MAX_CHILDREN) res.lines.push(...containerRedlines({ box: sel, padding: layoutIntent(doc, n.id).padding, children: kids }))
    }
  }

  const sizeLabels: RedlineScene['sizeLabels'] = []
  if (other && !other.rotated && hovered) {
    const hn = doc.nodes[hovered]
    if (hn) sizeLabels.push({ at: { x: other.x, y: other.y, width: other.width, height: other.height }, text: sizeBadgeText([hn], other) })
  }

  if (!res.lines.length && !res.skipped && !sizeLabels.length) return null
  const scene: RedlineScene = { ...res, sizeLabels }
  if (res.skipped) {
    const at = other?.rotated ? other : sel
    scene.noteAt = { x: at.x, y: at.y, width: at.width, height: at.height }
  }
  return scene
}
