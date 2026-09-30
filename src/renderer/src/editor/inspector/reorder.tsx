// Drag to reorder for the inspector's layer lists (fills, shadows, filters): a grip per row, an
// insertion line while dragging, and one commit on drop (so a reorder is a single undo step).
import { useId, useRef, useState } from 'react'
import { GripVertical } from 'lucide-react'

/** Copy of `list` with the item at `from` moved to index `to`. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const next = [...list]
  const [it] = next.splice(from, 1)
  next.splice(to, 0, it)
  return next
}

export interface Reorder {
  /** props for row i (merged with its own class) */
  row: (i: number, className?: string) => { 'data-reorder': string; className?: string }
  /** drag handle for row i; `onMove` gets the final index of the dropped row */
  grip: (i: number, onMove: (from: number, to: number) => void) => JSX.Element
}

interface Drag {
  from: number
  /** insertion point between rows, 0..count */
  slot: number
  count: number
}
// the index of the dropped row once it is removed from its old place
const target = (d: Drag): number => (d.slot > d.from ? d.slot - 1 : d.slot)

export function useReorder(): Reorder {
  const group = useId()
  const drag = useRef<Drag | null>(null)
  const [, setTick] = useState(0)
  const rows = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(`[data-reorder="${CSS.escape(group)}"]`)]
  const cur = drag.current
  const moving = cur !== null && target(cur) !== cur.from
  return {
    row: (i, className) => ({
      'data-reorder': group,
      className:
        [
          className,
          cur?.from === i && 'insp-dragging',
          moving && cur.slot === i && 'insp-drop-before',
          moving && cur.slot === cur.count && i === cur.count - 1 && 'insp-drop-after'
        ]
          .filter(Boolean)
          .join(' ') || undefined
    }),
    grip: (i, onMove) => (
      <span
        className="insp-grip"
        title="Drag to reorder"
        onPointerDown={(e) => {
          if (e.button !== 0) return
          e.preventDefault()
          e.stopPropagation()
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { from: i, slot: i, count: rows().length }
          setTick((n) => n + 1)
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          const slot = rows().filter((el) => {
            const r = el.getBoundingClientRect()
            return r.top + r.height / 2 < e.clientY
          }).length
          if (slot === d.slot) return
          drag.current = { ...d, slot }
          setTick((n) => n + 1)
        }}
        onPointerUp={() => {
          const d = drag.current
          drag.current = null
          setTick((n) => n + 1)
          if (d && target(d) !== d.from) onMove(d.from, target(d))
        }}
        onPointerCancel={() => {
          drag.current = null
          setTick((n) => n + 1)
        }}
      >
        <GripVertical size={12} />
      </span>
    )
  }
}
