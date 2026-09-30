// Read-only, pannable/zoomable render of one page of a doc version, with the changed layers outlined.
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { Maximize, Minus, Plus } from 'lucide-react'
import { computeNodeStyle } from '../model/html'
import { cleanAttrs, sanitizeSvgMarkup } from '../model/sanitize'
import type { Doc } from '../model/types'
import { loadDocFonts } from '../editor/canvas/useDocFonts'
import { IconButton } from '../ui'

export type Mark = 'added' | 'changed'

const CONTENT_DEFAULTS: CSSProperties = {
  fontFamily: 'system-ui, sans-serif',
  fontSize: 16,
  lineHeight: 'normal',
  color: '#000000'
}
const MAX_MARKS = 400
const MIN_ZOOM = 0.02
const MAX_ZOOM = 8

const VNode = memo(function VNode({ doc, id, top }: { doc: Doc; id: string; top?: boolean }): JSX.Element | null {
  const n = doc.nodes[id]
  if (!n || !n.visible) return null
  const style = computeNodeStyle(doc, id) as CSSProperties
  const s: CSSProperties = top ? { ...style, position: 'absolute', left: n.x, top: n.y } : style
  switch (n.type) {
    case 'text':
      return (
        <div data-hv-id={id} style={s}>
          {n.text}
        </div>
      )
    case 'image': {
      const src = cleanAttrs(n.attrs).src
      return src ? <img data-hv-id={id} style={s} src={src} alt="" draggable={false} /> : <div data-hv-id={id} style={s} />
    }
    case 'svg': {
      const a = cleanAttrs(n.attrs)
      return (
        <svg
          data-hv-id={id}
          style={s}
          xmlns="http://www.w3.org/2000/svg"
          viewBox={a.viewBox}
          fill={a.fill}
          stroke={a.stroke}
          dangerouslySetInnerHTML={{ __html: sanitizeSvgMarkup(n.svg) }}
        />
      )
    }
    default:
      return (
        <div data-hv-id={id} style={s}>
          {n.children.map((c) => (
            <VNode key={c} doc={doc} id={c} />
          ))}
        </div>
      )
  }
})

interface Box {
  id: string
  mark: Mark
  x: number
  y: number
  w: number
  h: number
}

export interface VersionCanvasProps {
  doc: Doc
  pageId: string
  marks: Map<string, Mark>
  showMarks: boolean
  /** zoom to this node once it is rendered */
  focusId: string | null
  /** changes when the focus request repeats for the same node */
  focusTick: number
}

export function VersionCanvas({ doc, pageId, marks, showMarks, focusId, focusTick }: VersionCanvasProps): JSX.Element {
  const page = doc.pages.find((p) => p.id === pageId) ?? doc.pages[0]
  const viewport = useRef<HTMLDivElement | null>(null)
  const world = useRef<HTMLDivElement | null>(null)
  const [cam, setCam] = useState<{ x: number; y: number; zoom: number } | null>(null)
  const camRef = useRef(cam)
  camRef.current = cam
  const [boxes, setBoxes] = useState<Box[]>([])

  useEffect(() => loadDocFonts(doc.nodes, doc.tokens), [doc.nodes, doc.tokens])

  /** world-space rect of a rendered node (or of all top-level content) */
  const worldRect = useCallback((el: Element | null): { x: number; y: number; w: number; h: number } | null => {
    const w = world.current
    const c = camRef.current
    if (!w || !el) return null
    const zoom = c?.zoom ?? 1
    const wr = w.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    return { x: (r.left - wr.left) / zoom, y: (r.top - wr.top) / zoom, w: r.width / zoom, h: r.height / zoom }
  }, [])

  const contentRect = useCallback((): { x: number; y: number; w: number; h: number } | null => {
    const w = world.current
    if (!w) return null
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const el of Array.from(w.children)) {
      const r = worldRect(el)
      if (!r || (!r.w && !r.h)) continue
      x0 = Math.min(x0, r.x)
      y0 = Math.min(y0, r.y)
      x1 = Math.max(x1, r.x + r.w)
      y1 = Math.max(y1, r.y + r.h)
    }
    return isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null
  }, [worldRect])

  const fitTo = useCallback((r: { x: number; y: number; w: number; h: number } | null, maxZoom = 1, pad = 48): void => {
    const vp = viewport.current?.getBoundingClientRect()
    if (!vp) return
    if (!r) {
      setCam({ x: vp.width / 2, y: vp.height / 2, zoom: 1 })
      return
    }
    const zoom = Math.max(
      MIN_ZOOM,
      Math.min(maxZoom, (vp.width - pad * 2) / Math.max(1, r.w), (vp.height - pad * 2) / Math.max(1, r.h))
    )
    setCam({ x: vp.width / 2 - (r.x + r.w / 2) * zoom, y: vp.height / 2 - (r.y + r.h / 2) * zoom, zoom })
  }, [])

  const fit = useCallback(() => fitTo(contentRect()), [fitTo, contentRect])

  // outline boxes of the marked nodes (world coords), measured after render; nested marks of an added subtree are skipped
  const measure = useCallback((): void => {
    const w = world.current
    if (!w || !showMarks) {
      setBoxes([])
      return
    }
    const out: Box[] = []
    for (const [id, mark] of marks) {
      if (out.length >= MAX_MARKS) break
      let p = doc.nodes[id]?.parent
      let covered = false
      while (p) {
        if (marks.get(p) === 'added') {
          covered = true
          break
        }
        p = doc.nodes[p]?.parent ?? null
      }
      if (covered) continue
      const r = worldRect(w.querySelector(`[data-hv-id="${CSS.escape(id)}"]`))
      if (r && (r.w || r.h)) out.push({ id, mark, ...r })
    }
    setBoxes(out)
  }, [doc, marks, showMarks, worldRect])

  // new doc / page: fit once rendered, then measure the marks (again after images / fonts settle)
  useLayoutEffect(() => {
    fit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, page?.id])
  useEffect(() => {
    measure()
    const t = setTimeout(measure, 400)
    const u = setTimeout(measure, 1500)
    return () => {
      clearTimeout(t)
      clearTimeout(u)
    }
    // measuring divides by the zoom, so it must see the fitted camera: run after it is set
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, page?.id, marks, showMarks, cam === null])

  useEffect(() => {
    if (!focusId) return
    const t = setTimeout(() => {
      const el = world.current?.querySelector(`[data-hv-id="${CSS.escape(focusId)}"]`) ?? null
      const r = worldRect(el)
      if (r) fitTo(r, 2, 80)
    }, 30)
    return () => clearTimeout(t)
  }, [focusId, focusTick, doc, page?.id, fitTo, worldRect])

  // wheel: pan; Ctrl/⌘ + wheel: zoom at the cursor
  useEffect(() => {
    const vp = viewport.current
    if (!vp) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const c = camRef.current
      if (!c) return
      if (e.ctrlKey || e.metaKey) {
        const r = vp.getBoundingClientRect()
        const px = e.clientX - r.left
        const py = e.clientY - r.top
        const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, c.zoom * Math.exp(-e.deltaY * 0.01)))
        setCam({ zoom, x: px - ((px - c.x) / c.zoom) * zoom, y: py - ((py - c.y) / c.zoom) * zoom })
      } else {
        const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX
        const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY
        setCam({ ...c, x: c.x - dx, y: c.y - dy })
      }
    }
    vp.addEventListener('wheel', onWheel, { passive: false })
    return () => vp.removeEventListener('wheel', onWheel)
  }, [])

  // drag anywhere to pan (the view is read-only)
  const onPointerDown = (e: React.PointerEvent): void => {
    if ((e.target as HTMLElement).closest('.hv-zoom')) return
    const c = camRef.current
    if (!c) return
    e.preventDefault()
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const sx = e.clientX
    const sy = e.clientY
    el.classList.add('hv-canvas--dragging')
    const move = (ev: PointerEvent): void => setCam({ ...c, x: c.x + ev.clientX - sx, y: c.y + ev.clientY - sy })
    const up = (): void => {
      el.classList.remove('hv-canvas--dragging')
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  const zoomBy = (f: number): void => {
    const c = camRef.current
    const vp = viewport.current?.getBoundingClientRect()
    if (!c || !vp) return
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, c.zoom * f))
    const px = vp.width / 2
    const py = vp.height / 2
    setCam({ zoom, x: px - ((px - c.x) / c.zoom) * zoom, y: py - ((py - c.y) / c.zoom) * zoom })
  }

  const vars: Record<string, string> = {}
  for (const t of doc.tokens) vars[t.name] = t.value
  const tops = page ? doc.nodes[page.rootId]?.children ?? [] : []
  const z = cam?.zoom ?? 1

  return (
    <div ref={viewport} className="hv-canvas" style={{ background: page?.background ?? '#282828' }} onPointerDown={onPointerDown}>
      <div
        ref={world}
        className="hv-world"
        style={{
          ...CONTENT_DEFAULTS,
          ...(vars as CSSProperties),
          transform: cam ? `translate(${cam.x}px, ${cam.y}px) scale(${cam.zoom})` : undefined,
          visibility: cam ? 'visible' : 'hidden'
        }}
      >
        {tops.map((id) => (
          <VNode key={id} doc={doc} id={id} top />
        ))}
      </div>
      {cam && showMarks && (
        <div className="hv-marks">
          {boxes.map((b) => (
            <div
              key={b.id}
              className={`hv-mark hv-mark--${b.mark}${b.id === focusId ? ' hv-mark--focus' : ''}`}
              style={{ left: cam.x + b.x * z, top: cam.y + b.y * z, width: b.w * z, height: b.h * z }}
            />
          ))}
        </div>
      )}
      {!tops.length && <div className="hv-empty">This page is empty in this version</div>}
      <div className="hv-zoom">
        <IconButton icon={<Minus size={14} />} label="Zoom out" onClick={() => zoomBy(1 / 1.25)} />
        <span className="hv-zoom__value">{Math.round(z * 100)}%</span>
        <IconButton icon={<Plus size={14} />} label="Zoom in" onClick={() => zoomBy(1.25)} />
        <IconButton icon={<Maximize size={14} />} label="Zoom to fit" onClick={fit} />
      </div>
    </div>
  )
}
