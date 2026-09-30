// Which gradient fill is being edited on the canvas (not part of the document). The Fill section
// turns it on for one node + fill layer; the overlay then draws the gradient handles over that node.
import { create } from 'zustand'
import { useStore } from '../../model/store'

export interface GradientTarget {
  docId: string
  nodeId: string
  /** index into readFills(node.style) */
  index: number
}

export const useGradientEdit = create<{ target: GradientTarget | null }>(() => ({ target: null }))

export const setGradientTarget = (target: GradientTarget | null): void => useGradientEdit.setState({ target })

export const isGradientTarget = (t: GradientTarget | null, docId: string, nodeId: string, index: number): boolean =>
  Boolean(t && t.docId === docId && t.nodeId === nodeId && t.index === index)

// selecting anything else ends on-canvas gradient editing
useStore.subscribe((s) => {
  const t = useGradientEdit.getState().target
  if (!t) return
  const sel = s.editors[t.docId]?.selection
  if (!sel || sel.length !== 1 || sel[0] !== t.nodeId || !s.docs[t.docId]?.nodes[t.nodeId]) setGradientTarget(null)
})
