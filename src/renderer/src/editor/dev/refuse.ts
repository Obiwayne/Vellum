// Dev Mode is read-only: gestures that would edit say so instead of doing nothing. The store refuses every
// mutation itself (model/store.ts); these helpers only cover the paths that never reach the store.
import { notifyEditRefused } from '../../model/store'

/** Pixels a press has to travel before it counts as a drag attempt. */
export const DRAG_SLOP = 4

/**
 * A press on a layer in Dev Mode only selects. If the pointer then travels past the slop, tell the user once
 * that Dev Mode is read-only; a plain click says nothing.
 */
export function refuseOnDrag(docId: string, e: { clientX: number; clientY: number }): void {
  const x0 = e.clientX
  const y0 = e.clientY
  const stop = (): void => {
    window.removeEventListener('pointermove', move, true)
    window.removeEventListener('pointerup', stop, true)
    window.removeEventListener('pointercancel', stop, true)
  }
  function move(ev: PointerEvent): void {
    if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < DRAG_SLOP) return
    stop()
    notifyEditRefused(docId)
  }
  window.addEventListener('pointermove', move, true)
  window.addEventListener('pointerup', stop, true)
  window.addEventListener('pointercancel', stop, true)
}
