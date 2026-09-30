// Screen-space overlay above the world: frame labels, hover/selection outlines, handles, size
// badge, agent working outlines + glow, snapping guides, marquee, drawing previews.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { activePage, useStore } from '../../model/store'
import type { Camera, CNode, WorldRect } from '../../model/types'
import { LAYOUT_EVENT, measure, union } from './geometry'

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export interface Guide {
  axis: 'x' | 'y'
  pos: number
  from: number
  to: number
}

export interface Transient {
  marquee?: WorldRect
  guides?: Guide[]
  insert?: { x1: number; y1: number; x2: number; y2: number }
  ghosts?: WorldRect[]
  draw?: { rect: WorldRect; tool: string }
  pen?: { points: Array<{ x: number; y: number }>; cursor?: { x: number; y: number } }
  dropTarget?: string
  gesturing?: boolean
}

interface Props {
  docId: string
  transient: Transient
  onHandleDown: (e: React.PointerEvent, handle: Handle) => void
  onLabelDown: (e: React.PointerEvent, id: string) => void
}

export const SHADER_COLOR = '#1E1B4B'
export const SHADER_IMAGE =
  'radial-gradient(at 20% 25%, #FF7A59 0px, transparent 55%), radial-gradient(at 80% 20%, #7B61FF 0px, transparent 55%), radial-gradient(at 70% 85%, #00C2A8 0px, transparent 55%), radial-gradient(at 15% 90%, #FFC53D 0px, transparent 50%)'
const SHADER_BACKGROUND = `${SHADER_IMAGE}, ${SHADER_COLOR}`

const toScreen = (r: WorldRect, cam: Camera): WorldRect => ({
  x: r.x * cam.zoom + cam.x,
  y: r.y * cam.zoom + cam.y,
  width: r.width * cam.zoom,
  height: r.height * cam.zoom
})

const box = (r: WorldRect, extra: CSSProperties = {}): CSSProperties => ({
  position: 'absolute',
  left: r.x,
  top: r.y,
  width: r.width,
  height: r.height,
  ...extra
})

function dimLabel(v: string | number | undefined, measured: number): string {
  const m = Math.round(measured * 100) / 100
  const txt = Number.isInteger(m) ? String(m) : m.toFixed(1).replace(/\.0$/, '')
  if (v === undefined || v === 'fit-content' || v === 'auto' || v === 'max-content' || v === 'min-content') return `Fit ${txt}`
  if (v === '100%' || v === 'stretch') return `Fill ${txt}`
  return txt
}

export function sizeBadgeText(nodes: CNode[], rect: WorldRect): string {
  if (nodes.length === 1) {
    const n = nodes[0]
    return `${dimLabel(n.style.width, rect.width)} × ${dimLabel(n.style.height, rect.height)}`
  }
  return `${dimLabel(0, rect.width)} × ${dimLabel(0, rect.height)}`
}

const HANDLE_CURSOR: Record<Handle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize'
}

export function Overlay({ docId, transient, onHandleDown, onLabelDown }: Props): JSX.Element | null {
  const doc = useStore((s) => s.docs[docId])
  const ed = useStore((s) => s.editors[docId])
  const page = useStore((s) => activePage(s, docId))
  const renameNode = useStore((s) => s.renameNode)
  const [tick, setTick] = useState(0)
  const [rects, setRects] = useState<Map<string, WorldRect>>(new Map())
  const [renaming, setRenaming] = useState<string | null>(null)

  useEffect(() => {
    const on = (): void => setTick((t) => t + 1)
    window.addEventListener(LAYOUT_EVENT, on)
    window.addEventListener('resize', on)
    // fonts loading can change text metrics
    document.fonts?.addEventListener?.('loadingdone', on)
    return () => {
      window.removeEventListener(LAYOUT_EVENT, on)
      window.removeEventListener('resize', on)
      document.fonts?.removeEventListener?.('loadingdone', on)
    }
  }, [])

  const topLevel = page && doc ? doc.nodes[page.rootId]?.children ?? [] : []
  const selection = ed?.selection ?? []
  const hovered = ed?.hovered ?? null
  const working = ed?.workingNodes ?? []

  useLayoutEffect(() => {
    if (!doc) return
    const ids = new Set<string>([...topLevel, ...selection, ...working])
    if (hovered) ids.add(hovered)
    if (transient.dropTarget) ids.add(transient.dropTarget)
    const m = new Map<string, WorldRect>()
    for (const id of ids) {
      const r = measure(id, docId)
      if (r) m.set(id, r)
    }
    setRects(m)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, selection, hovered, working, tick, page?.id, transient.dropTarget, ed?.editingTextId])

  if (!doc || !ed || !page) return null
  const cam = ed.camera
  const sr = (id: string): WorldRect | null => {
    const r = rects.get(id)
    return r ? toScreen(r, cam) : null
  }

  const selNodes = selection.map((id) => doc.nodes[id]).filter((n): n is CNode => Boolean(n))
  const selWorld = union(selection.map((id) => rects.get(id)))
  const selScreen = selWorld ? toScreen(selWorld, cam) : null
  const editing = ed.editingTextId
  const showHandles =
    selScreen && !editing && ed.tool === 'move' && !transient.gesturing && selNodes.every((n) => !n.locked)
  const hoverScreen = hovered && !selection.includes(hovered) && !transient.gesturing ? sr(hovered) : null

  return (
    <div className="cv-overlay">
      {/* frame labels */}
      {topLevel.map((id) => {
        const n = doc.nodes[id]
        if (!n || n.type !== 'frame' || !n.visible) return null
        const r = sr(id)
        if (!r) return null
        const selected = selection.includes(id)
        if (renaming === id) {
          return (
            <input
              key={id}
              className="cv-label-input"
              style={{ left: r.x, top: r.y - 22, width: Math.max(80, Math.min(r.width, 240)) }}
              defaultValue={n.name}
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') {
                  e.currentTarget.value = n.name
                  e.currentTarget.blur()
                }
              }}
              onBlur={(e) => {
                const v = e.currentTarget.value.trim()
                if (v && v !== n.name) renameNode(docId, id, v)
                setRenaming(null)
              }}
            />
          )
        }
        return (
          <div
            key={id}
            className={'cv-label' + (selected || hovered === id ? ' cv-label--active' : '')}
            style={{ left: r.x, top: r.y - 20, maxWidth: Math.max(r.width, 24) }}
            onPointerDown={(e) => onLabelDown(e, id)}
            onDoubleClick={(e) => {
              e.stopPropagation()
              setRenaming(id)
            }}
          >
            {n.name}
          </div>
        )
      })}

      {/* hover */}
      {hoverScreen && <div className="cv-outline" style={box(hoverScreen)} />}

      {/* drop target */}
      {transient.dropTarget && sr(transient.dropTarget) && (
        <div className="cv-outline" style={box(sr(transient.dropTarget) as WorldRect)} />
      )}

      {/* selection outlines */}
      {selection.map((id) => {
        const r = sr(id)
        return r ? <div key={id} className="cv-outline" style={box(r)} /> : null
      })}

      {/* agent working */}
      {working.map((id) => {
        const r = sr(id)
        if (!r) return null
        return (
          <div key={'w' + id} className="cv-working" style={box(r)}>
            <span className="cv-working__tag">Claude</span>
          </div>
        )
      })}

      {/* selection bounds + handles + badge */}
      {selScreen && selection.length > 1 && <div className="cv-outline" style={box(selScreen)} />}
      {showHandles && selScreen && <Handles r={selScreen} onDown={onHandleDown} />}
      {selScreen && !editing && selWorld && (
        <div className="cv-badge" style={{ left: selScreen.x + selScreen.width / 2, top: selScreen.y + selScreen.height + 8 }}>
          {sizeBadgeText(selNodes, selWorld)}
        </div>
      )}

      {/* ghosts (dragging flow children) */}
      {transient.ghosts?.map((g, i) => <div key={'g' + i} className="cv-ghost" style={box(toScreen(g, cam))} />)}

      {/* insertion indicator */}
      {transient.insert && (
        <div
          className="cv-insert"
          style={(() => {
            const a = { x: transient.insert.x1 * cam.zoom + cam.x, y: transient.insert.y1 * cam.zoom + cam.y }
            const b = { x: transient.insert.x2 * cam.zoom + cam.x, y: transient.insert.y2 * cam.zoom + cam.y }
            return a.x === b.x
              ? { left: a.x - 1, top: Math.min(a.y, b.y), width: 2, height: Math.abs(b.y - a.y) }
              : { left: Math.min(a.x, b.x), top: a.y - 1, width: Math.abs(b.x - a.x), height: 2 }
          })()}
        />
      )}

      {/* snapping guides */}
      {transient.guides?.map((g, i) => {
        const s =
          g.axis === 'x'
            ? { left: g.pos * cam.zoom + cam.x, top: g.from * cam.zoom + cam.y, width: 1, height: (g.to - g.from) * cam.zoom }
            : { left: g.from * cam.zoom + cam.x, top: g.pos * cam.zoom + cam.y, width: (g.to - g.from) * cam.zoom, height: 1 }
        return <div key={'s' + i} className="cv-guide" style={s} />
      })}

      {/* drawing preview */}
      {transient.draw && (
        <>
          <div
            className="cv-draw"
            style={box(toScreen(transient.draw.rect, cam), {
              background:
                transient.draw.tool === 'rect' ? '#D9D9D9' : transient.draw.tool === 'shader' ? SHADER_BACKGROUND : '#FFFFFF'
            })}
          />
          {(() => {
            const r = toScreen(transient.draw.rect, cam)
            return (
              <div className="cv-badge" style={{ left: r.x + r.width / 2, top: r.y + r.height + 8 }}>
                {Math.round(transient.draw.rect.width)} × {Math.round(transient.draw.rect.height)}
              </div>
            )
          })()}
        </>
      )}

      {/* pen preview */}
      {transient.pen && transient.pen.points.length > 0 && <PenPreview pen={transient.pen} cam={cam} />}

      {/* marquee */}
      {transient.marquee && <div className="cv-marquee" style={box(toScreen(transient.marquee, cam))} />}
    </div>
  )
}

function Handles({ r, onDown }: { r: WorldRect; onDown: (e: React.PointerEvent, h: Handle) => void }): JSX.Element {
  const EDGE = 8
  const edges: Array<[Handle, CSSProperties]> = [
    ['n', { left: r.x, top: r.y - EDGE / 2, width: r.width, height: EDGE }],
    ['s', { left: r.x, top: r.y + r.height - EDGE / 2, width: r.width, height: EDGE }],
    ['w', { left: r.x - EDGE / 2, top: r.y, width: EDGE, height: r.height }],
    ['e', { left: r.x + r.width - EDGE / 2, top: r.y, width: EDGE, height: r.height }]
  ]
  const corners: Array<[Handle, number, number]> = [
    ['nw', r.x, r.y],
    ['ne', r.x + r.width, r.y],
    ['se', r.x + r.width, r.y + r.height],
    ['sw', r.x, r.y + r.height]
  ]
  return (
    <>
      {edges.map(([h, s]) => (
        <div key={h} className="cv-edge" style={{ ...s, cursor: HANDLE_CURSOR[h] }} onPointerDown={(e) => onDown(e, h)} />
      ))}
      {corners.map(([h, x, y]) => (
        <div
          key={h}
          className="cv-handle"
          style={{ left: x - 3.5, top: y - 3.5, cursor: HANDLE_CURSOR[h] }}
          onPointerDown={(e) => onDown(e, h)}
        />
      ))}
    </>
  )
}

function PenPreview({ pen, cam }: { pen: NonNullable<Transient['pen']>; cam: Camera }): JSX.Element {
  const pts = pen.points.map((p) => ({ x: p.x * cam.zoom + cam.x, y: p.y * cam.zoom + cam.y }))
  const cur = pen.cursor ? { x: pen.cursor.x * cam.zoom + cam.x, y: pen.cursor.y * cam.zoom + cam.y } : null
  const ref = useRef<SVGSVGElement | null>(null)
  return (
    <svg ref={ref} className="cv-pen" width="100%" height="100%">
      <polyline
        points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
        fill="none"
        stroke="#000"
        strokeWidth={Math.max(1, 1.5 * cam.zoom)}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {cur && (
        <line
          x1={pts[pts.length - 1].x}
          y1={pts[pts.length - 1].y}
          x2={cur.x}
          y2={cur.y}
          stroke="var(--accent)"
          strokeWidth={1}
          strokeDasharray="4 3"
        />
      )}
      {pts.map((p, i) => (
        <rect key={i} x={p.x - 3.5} y={p.y - 3.5} width={7} height={7} fill="#fff" stroke="var(--accent)" strokeWidth={1} />
      ))}
    </svg>
  )
}
