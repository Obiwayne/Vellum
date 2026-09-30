// Scaled-down live DOM preview of a doc's first page (no data-node-id, so the canvas resolver never sees it).
import { memo, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { computeNodeStyle } from '../model/html'
import { numericSize } from '../model/ops'
import type { Doc } from '../model/types'

const CONTENT_DEFAULTS: CSSProperties = {
  fontFamily: 'system-ui, sans-serif',
  fontSize: 16,
  lineHeight: 'normal',
  color: '#000000'
}
const MAX_NODES = 3000

function ThumbNode({ doc, id, top }: { doc: Doc; id: string; top?: { x: number; y: number } }): JSX.Element | null {
  const n = doc.nodes[id]
  if (!n) return null
  const style = computeNodeStyle(doc, id) as CSSProperties
  const s: CSSProperties = top ? { ...style, position: 'absolute', left: top.x, top: top.y } : style
  switch (n.type) {
    case 'text':
      return <div style={s}>{n.text}</div>
    case 'image':
      return n.attrs?.src ? <img style={s} src={n.attrs.src} alt="" draggable={false} /> : <div style={s} />
    case 'svg':
      return (
        <svg
          style={s}
          xmlns="http://www.w3.org/2000/svg"
          viewBox={n.attrs?.viewBox}
          fill={n.attrs?.fill}
          stroke={n.attrs?.stroke}
          dangerouslySetInnerHTML={{ __html: n.svg ?? '' }}
        />
      )
    default:
      return (
        <div style={s}>
          {n.children.map((c) => (
            <ThumbNode key={c} doc={doc} id={c} />
          ))}
        </div>
      )
  }
}

/** Approximate world bounds of the first page's top-level nodes (fit-content sizes are measured after render). */
function modelBounds(doc: Doc, rootId: string): { x: number; y: number; w: number; h: number } | null {
  const tops = (doc.nodes[rootId]?.children ?? []).map((id) => doc.nodes[id]).filter((n) => n && n.visible)
  if (!tops.length) return null
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const n of tops) {
    const w = numericSize(n.style.width) ?? 100
    const h = numericSize(n.style.height) ?? 100
    x0 = Math.min(x0, n.x)
    y0 = Math.min(y0, n.y)
    x1 = Math.max(x1, n.x + w)
    y1 = Math.max(y1, n.y + h)
  }
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) }
}

export const Thumbnail = memo(function Thumbnail({ doc }: { doc: Doc }): JSX.Element {
  const page = doc.pages[0]
  const box = useRef<HTMLDivElement | null>(null)
  const world = useRef<HTMLDivElement | null>(null)
  const [fit, setFit] = useState<{ scale: number; dx: number; dy: number } | null>(null)
  const bounds = page ? modelBounds(doc, page.rootId) : null
  const tooBig = Object.keys(doc.nodes).length > MAX_NODES

  // measure the rendered content (handles fit-content) and scale it into the box
  useLayoutEffect(() => {
    if (!bounds || !box.current || !world.current || tooBig) return
    const b = box.current.getBoundingClientRect()
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    const wr = world.current.getBoundingClientRect()
    const cur = fit?.scale ?? 1
    for (const el of Array.from(world.current.children)) {
      const r = el.getBoundingClientRect()
      if (!r.width && !r.height) continue
      x0 = Math.min(x0, (r.left - wr.left) / cur)
      y0 = Math.min(y0, (r.top - wr.top) / cur)
      x1 = Math.max(x1, (r.right - wr.left) / cur)
      y1 = Math.max(y1, (r.bottom - wr.top) / cur)
    }
    if (!isFinite(x0)) return
    const pad = 12
    const w = Math.max(1, x1 - x0)
    const h = Math.max(1, y1 - y0)
    const scale = Math.min((b.width - pad * 2) / w, (b.height - pad * 2) / h, 1)
    setFit({ scale, dx: (b.width - w * scale) / 2 - x0 * scale, dy: (b.height - h * scale) / 2 - y0 * scale })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc])

  if (!page || !bounds || tooBig) {
    return (
      <div className="db-thumb" ref={box}>
        {doc.thumbnail && <img className="db-thumb__img" src={doc.thumbnail} alt="" draggable={false} />}
      </div>
    )
  }

  const vars: Record<string, string> = {}
  for (const t of doc.tokens) vars[t.name] = t.value
  const root = doc.nodes[page.rootId]
  return (
    <div className="db-thumb" ref={box} style={{ background: page.background }}>
      <div
        ref={world}
        className="db-thumb__world"
        style={{
          ...CONTENT_DEFAULTS,
          ...(vars as CSSProperties),
          transform: fit ? `translate(${fit.dx}px, ${fit.dy}px) scale(${fit.scale})` : undefined,
          visibility: fit ? 'visible' : 'hidden'
        }}
      >
        {root.children.map((id) => {
          const n = doc.nodes[id]
          return n ? <ThumbNode key={id} doc={doc} id={id} top={{ x: n.x, y: n.y }} /> : null
        })}
      </div>
    </div>
  )
})
