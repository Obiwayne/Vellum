// Scaled-down live preview of a main component for the Assets panel (no data-node-id, so the canvas
// resolver never sees it). Same rendering as the dashboard thumbnails; big components fall back to an icon.
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { Diamond } from 'lucide-react'
import { CONTENT_DEFAULTS, ThumbNode, subtreeSize } from '../../dashboard/Thumbnail'
import type { Doc } from '../../model/types'

export const THUMB_W = 56
export const THUMB_H = 40
const MAX_NODES = 120
const PAD = 4

export function ComponentThumb({ doc, id }: { doc: Doc; id: string }): JSX.Element {
  const world = useRef<HTMLDivElement | null>(null)
  const [fit, setFit] = useState<{ scale: number; dx: number; dy: number } | null>(null)
  const node = doc.nodes[id]
  const tooBig = !node || subtreeSize(doc, id) > MAX_NODES

  useLayoutEffect(() => {
    const el = world.current?.firstElementChild
    if (!el || tooBig) return
    // layout size (offsetWidth/Height ignore the scale transform), so fit-content components measure right
    const w = (el as HTMLElement).offsetWidth
    const h = (el as HTMLElement).offsetHeight
    if (!w || !h) return
    const scale = Math.min((THUMB_W - PAD * 2) / w, (THUMB_H - PAD * 2) / h, 1)
    setFit({ scale, dx: (THUMB_W - w * scale) / 2, dy: (THUMB_H - h * scale) / 2 })
  }, [doc, id, tooBig])

  if (tooBig) {
    return (
      <span className="lp-thumb lp-thumb--icon">
        <Diamond size={14} fill="currentColor" />
      </span>
    )
  }
  const vars: Record<string, string> = {}
  for (const t of doc.tokens) vars[t.name] = t.value
  return (
    <span className="lp-thumb" data-thumb={id}>
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
