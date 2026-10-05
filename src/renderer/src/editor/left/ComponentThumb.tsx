// Scaled-down live preview of a main component for the Assets panel (no data-node-id, so the canvas
// resolver never sees it). Same rendering as the dashboard thumbnails; big components fall back to an icon.
// A row's preview is only rendered once it scrolls near the viewport (IntersectionObserver).
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { Diamond } from 'lucide-react'
import { CONTENT_DEFAULTS, ThumbNode, subtreeSize } from '../../dashboard/Thumbnail'
import type { Doc } from '../../model/types'

export const THUMB_W = 56
export const THUMB_H = 40
const MAX_NODES = 120
const PAD = 4

/** True once the element has come near the viewport (and stays true). Without IntersectionObserver it is always true. */
function useSeen(ref: React.RefObject<HTMLElement>, off: boolean): boolean {
  const [seen, setSeen] = useState(typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const el = ref.current
    if (seen || off || !el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true)
          io.disconnect()
        }
      },
      { rootMargin: '120px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [seen, off, ref])
  return seen
}

export function ComponentThumb({ doc, id }: { doc: Doc; id: string }): JSX.Element {
  const box = useRef<HTMLSpanElement | null>(null)
  const world = useRef<HTMLDivElement | null>(null)
  const [fit, setFit] = useState<{ scale: number; dx: number; dy: number } | null>(null)
  const node = doc.nodes[id]
  const tooBig = !node || subtreeSize(doc, id) > MAX_NODES
  const seen = useSeen(box, tooBig)

  useLayoutEffect(() => {
    const el = world.current?.firstElementChild
    if (!el || tooBig || !seen) return
    // layout size (offsetWidth/Height ignore the scale transform), so fit-content components measure right
    const w = (el as HTMLElement).offsetWidth
    const h = (el as HTMLElement).offsetHeight
    if (!w || !h) return
    const scale = Math.min((THUMB_W - PAD * 2) / w, (THUMB_H - PAD * 2) / h, 1)
    setFit({ scale, dx: (THUMB_W - w * scale) / 2, dy: (THUMB_H - h * scale) / 2 })
  }, [doc, id, tooBig, seen])

  if (tooBig) {
    return (
      <span className="lp-thumb lp-thumb--icon">
        <Diamond size={14} fill="currentColor" />
      </span>
    )
  }
  if (!seen) return <span className="lp-thumb lp-thumb--lazy" ref={box} data-thumb={id} />
  const vars: Record<string, string> = {}
  for (const t of doc.tokens) vars[t.name] = t.value
  return (
    <span className="lp-thumb" ref={box} data-thumb={id}>
      <div
        ref={world}
        className="lp-thumb__world"
        style={{
          ...CONTENT_DEFAULTS,
          ...(vars as CSSProperties),
          transform: fit ? `translate(${fit.dx}px, ${fit.dy}px) scale(${fit.scale})` : undefined,
          visibility: fit ? 'visible' : 'hidden'
        }}
      >
        <ThumbNode doc={doc} id={id} />
      </div>
    </span>
  )
}
