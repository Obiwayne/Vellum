// Infinite canvas: renders the active page as real DOM inside a camera-transformed world, and
// handles pointer interaction (select, marquee, move/reorder, resize, draw, text, pen, pan/zoom).
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { activePage, getStore, useStore } from '../../model/store'
import { history } from '../../model/history'
import * as ops from '../../model/ops'
import type { Doc, WorldRect } from '../../model/types'
import { useContextMenu } from '../../ui'
import { CANVAS_COMMAND_EVENT, type CanvasCommand } from '../../shell/commands'
import { installCanvasShortcuts } from '../shortcuts'
import { NodeView } from './NodeView'
import { Overlay, SHADER_COLOR, SHADER_IMAGE, type Guide, type Handle, type Transient } from './Overlay'
import { clampZoom, registerViewport } from './camera'
import { clientToWorld, contains, intersects, measure, rectFromPoints, registerWorld, union } from './geometry'
import { containerAt, drillNode, nodeIdFromTarget, pickNode } from './selection'
import * as A from './actions'
import { canvasMenu, nodeMenu } from './menus'
import { toast } from './toast'
import './canvas.css'
import { useDocFonts } from './useDocFonts'
import { CANVAS_CONTENT_DEFAULTS } from './contentDefaults'

/** Inherited defaults for canvas content (see contentDefaults.ts). */
export { CANVAS_CONTENT_DEFAULTS }

export { NodeView }

const DRAG_THRESHOLD = 3
const SNAP_PX = 5

type Pt = { x: number; y: number }

interface SnapLine {
  pos: number
  from: number
  to: number
}
interface SnapTargets {
  xs: SnapLine[]
  ys: SnapLine[]
}

function rectLines(r: WorldRect): SnapTargets {
  return {
    xs: [r.x, r.x + r.width / 2, r.x + r.width].map((pos) => ({ pos, from: r.y, to: r.y + r.height })),
    ys: [r.y, r.y + r.height / 2, r.y + r.height].map((pos) => ({ pos, from: r.x, to: r.x + r.width }))
  }
}

/** Snap lines from siblings (and the parent box) of the moving nodes. */
function snapTargets(doc: Doc, docId: string, ids: string[]): SnapTargets {
  const out: SnapTargets = { xs: [], ys: [] }
  const exclude = new Set(ids)
  const parentId = doc.nodes[ids[0]]?.parent
  if (!parentId) return out
  const add = (r: WorldRect | null): void => {
    if (!r) return
    const l = rectLines(r)
    out.xs.push(...l.xs)
    out.ys.push(...l.ys)
  }
  for (const c of doc.nodes[parentId]?.children ?? []) {
    if (exclude.has(c) || doc.nodes[c]?.visible === false) continue
    add(measure(c, docId))
  }
  if (!ops.isPageRoot(doc, parentId)) add(measure(parentId, docId))
  return out
}

/** Best snap offset for a set of moving positions against target lines (within threshold). */
function bestSnap(moving: number[], lines: SnapLine[], th: number): number | null {
  let best: number | null = null
  for (const m of moving) {
    for (const l of lines) {
      const d = l.pos - m
      if (Math.abs(d) <= th && (best === null || Math.abs(d) < Math.abs(best))) best = d
    }
  }
  return best
}

function guidesFor(b: WorldRect, t: SnapTargets): Guide[] {
  const out: Guide[] = []
  const mx = [b.x, b.x + b.width / 2, b.x + b.width]
  const my = [b.y, b.y + b.height / 2, b.y + b.height]
  for (const l of t.xs) {
    if (mx.some((m) => Math.abs(m - l.pos) < 0.01))
      out.push({ axis: 'x', pos: l.pos, from: Math.min(l.from, b.y), to: Math.max(l.to, b.y + b.height) })
  }
  for (const l of t.ys) {
    if (my.some((m) => Math.abs(m - l.pos) < 0.01))
      out.push({ axis: 'y', pos: l.pos, from: Math.min(l.from, b.x), to: Math.max(l.to, b.x + b.width) })
  }
  return out
}

/** Insertion index + indicator line for dropping into a flow container. */
function flowInsertion(
  doc: Doc,
  docId: string,
  targetId: string,
  p: Pt,
  exclude: Set<string>
): { index: number; line: Transient['insert'] } | null {
  const t = doc.nodes[targetId]
  const tr = measure(targetId, docId)
  if (!t || !tr) return null
  const row = t.style.display === 'grid' || t.style.display === 'inline-grid' || !String(t.style.flexDirection ?? 'row').startsWith('column')
  const kids = t.children.filter((c) => !exclude.has(c) && doc.nodes[c]?.visible !== false && ops.isFlowChild(doc, c))
  const rects = kids.map((k) => measure(k, docId))
  let i = kids.length
  for (let k = 0; k < kids.length; k++) {
    const r = rects[k]
    if (!r) continue
    const mid = row ? r.x + r.width / 2 : r.y + r.height / 2
    if ((row ? p.x : p.y) < mid) {
      i = k
      break
    }
  }
  const index = i < kids.length ? t.children.indexOf(kids[i]) : t.children.length
  const before = rects[i - 1]
  const after = rects[i]
  let line: Transient['insert']
  if (row) {
    const x = before && after ? (before.x + before.width + after.x) / 2 : after ? after.x - 2 : before ? before.x + before.width + 2 : tr.x + 4
    const ref = after ?? before
    line = ref ? { x1: x, y1: ref.y, x2: x, y2: ref.y + ref.height } : { x1: x, y1: tr.y + 4, x2: x, y2: tr.y + tr.height - 4 }
  } else {
    const y = before && after ? (before.y + before.height + after.y) / 2 : after ? after.y - 2 : before ? before.y + before.height + 2 : tr.y + 4
    const ref = after ?? before
    line = ref ? { x1: ref.x, y1: y, x2: ref.x + ref.width, y2: y } : { x1: tr.x + 4, y1: y, x2: tr.x + tr.width - 4, y2: y }
  }
  return { index, line }
}

type Gesture =
  | { kind: 'pan'; start: Pt; cam: { x: number; y: number } }
  | { kind: 'marquee'; start: Pt; base: string[]; additive: boolean }
  | {
      kind: 'move'
      startClient: Pt
      startWorld: Pt
      started: boolean
      clickOnly: string | null
      alt: boolean
      ids: string[]
      positioned: string[]
      flow: string[]
      orig: Map<string, Pt>
      rects: Map<string, WorldRect>
      bounds: WorldRect | null
      snap: SnapTargets
      exclude: Set<string>
      target: string | null
      index?: number
      delta: Pt
    }
  | {
      kind: 'resize'
      handle: Handle
      startWorld: Pt
      ids: string[]
      rects: Map<string, WorldRect>
      orig: Map<string, Pt>
      bounds: WorldRect
      snap: SnapTargets
    }
  | { kind: 'draw'; tool: 'frame' | 'rect' | 'shader'; startClient: Pt; start: Pt; parent: string; rect: WorldRect | null }

export function CanvasView({ docId }: { docId: string }): JSX.Element | null {
  const doc = useStore((s) => s.docs[docId])
  useDocFonts(doc)
  const page = useStore((s) => activePage(s, docId))
  const camera = useStore((s) => s.editors[docId]?.camera)
  const tool = useStore((s) => s.editors[docId]?.tool ?? 'move')
  const working = useStore((s) => (s.editors[docId]?.workingNodes.length ?? 0) > 0)
  const pixelGrid = useStore((s) => s.prefs['canvas.pixelGrid'] !== false)
  const viewport = useRef<HTMLDivElement | null>(null)
  const world = useRef<HTMLDivElement | null>(null)
  const gesture = useRef<Gesture | null>(null)
  const pen = useRef<{ points: Pt[]; parent: string } | null>(null)
  const [transient, setTransient] = useState<Transient>({})
  const [space, setSpace] = useState(false)
  const [panning, setPanning] = useState(false)
  const spaceRef = useRef(false)
  const ctx = useContextMenu()
  // stable window listeners that forward to the latest render's handlers
  const live = useRef<{ onMove: (e: PointerEvent) => void; onUp: (e: PointerEvent) => void; onCancel: () => void }>({
    onMove: () => undefined,
    onUp: () => undefined,
    onCancel: () => undefined
  })
  const listeners = useRef({
    move: (e: PointerEvent): void => live.current.onMove(e),
    up: (e: PointerEvent): void => live.current.onUp(e),
    cancel: (): void => live.current.onCancel()
  })

  // ---------------------------------------------------------------- registration
  useEffect(() => {
    registerWorld(docId, world.current)
    registerViewport(docId, viewport.current)
    ops.setWorldRectResolver((dId, id) => (dId === docId ? measure(id, docId) : null))
    const l = listeners.current
    return () => {
      window.removeEventListener('pointermove', l.move)
      window.removeEventListener('pointerup', l.up)
      window.removeEventListener('pointercancel', l.cancel)
      const g = gesture.current
      if (g && (g.kind === 'resize' || (g.kind === 'move' && g.started))) history.end(docId)
      gesture.current = null
      ops.setWorldRectResolver(null)
      registerWorld(docId, null)
      registerViewport(docId, null)
    }
  }, [docId])

  // ---------------------------------------------------------------- pen
  const finishPen = useCallback(
    (closed = false) => {
      const p = pen.current
      pen.current = null
      setTransient((t) => ({ ...t, pen: undefined }))
      if (!p || p.points.length < 2) return
      const s = getStore()
      const d = s.docs[docId]
      if (!d) return
      const xs = p.points.map((q) => q.x)
      const ys = p.points.map((q) => q.y)
      const minX = Math.floor(Math.min(...xs))
      const minY = Math.floor(Math.min(...ys))
      const w = Math.max(1, Math.ceil(Math.max(...xs) - minX))
      const h = Math.max(1, Math.ceil(Math.max(...ys) - minY))
      const dAttr =
        p.points.map((q, i) => `${i ? 'L' : 'M'}${+(q.x - minX).toFixed(2)} ${+(q.y - minY).toFixed(2)}`).join(' ') + (closed ? ' Z' : '')
      const svg = `<path d="${dAttr}" fill="none" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`
      const parentFlow = !ops.isPageRoot(d, p.parent) && ops.isFlowLayout(d.nodes[p.parent]?.style)
      const origin = originFor(d, p.parent)
      const id = s.createNode(
        docId,
        {
          type: 'svg',
          name: 'Path',
          svg,
          attrs: { viewBox: `0 0 ${w} ${h}`, fill: 'none' },
          x: parentFlow ? 0 : Math.round(minX - origin.x),
          y: parentFlow ? 0 : Math.round(minY - origin.y),
          style: { width: w, height: h, overflow: 'visible' }
        },
        p.parent
      )
      s.select(docId, [id])
      s.setTool(docId, 'move')
    },
    [docId]
  )

  useEffect(() => {
    if (tool !== 'pen' && pen.current) finishPen()
  }, [tool, finishPen])

  // ---------------------------------------------------------------- keyboard (space, pen) + shortcuts
  useEffect(() => {
    const isText = (el: EventTarget | null): boolean =>
      el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
    const down = (e: KeyboardEvent): void => {
      if (isText(e.target)) return
      if (e.key === ' ' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        if (!spaceRef.current) {
          spaceRef.current = true
          setSpace(true)
        }
        return
      }
      if (pen.current && (e.key === 'Enter' || e.key === 'Escape')) {
        e.preventDefault()
        e.stopPropagation()
        finishPen()
        return
      }
      if (e.key === 'Escape' && gesture.current) {
        e.preventDefault()
        e.stopPropagation()
        cancelGesture()
      }
    }
    const up = (e: KeyboardEvent): void => {
      if (e.key === ' ') {
        spaceRef.current = false
        setSpace(false)
      }
    }
    const blur = (): void => {
      spaceRef.current = false
      setSpace(false)
    }
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    window.addEventListener('blur', blur)
    const uninstall = installCanvasShortcuts(docId)
    return () => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
      window.removeEventListener('blur', blur)
      uninstall()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, finishPen])

  // Edit menu commands
  useEffect(() => {
    const on = (e: Event): void => {
      if (getStore().activeTab !== docId) return
      const { command } = (e as CustomEvent<CanvasCommand>).detail
      if (command === 'copy') void A.copySelection(docId)
      else if (command === 'cut') void A.cutSelection(docId)
      else if (command === 'paste') void A.paste(docId)
      else if (command === 'selectAll') A.selectAll(docId)
    }
    window.addEventListener(CANVAS_COMMAND_EVENT, on)
    return () => window.removeEventListener(CANVAS_COMMAND_EVENT, on)
  }, [docId])

  // ---------------------------------------------------------------- wheel: pan / zoom
  useEffect(() => {
    const el = viewport.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const s = getStore()
      const cam = s.editors[docId]?.camera
      if (!cam) return
      const wheelZooms = s.prefs['canvas.scrollWheelZooms'] === true
      if (e.ctrlKey || e.metaKey || (wheelZooms && !e.shiftKey)) {
        const r = el.getBoundingClientRect()
        const px = e.clientX - r.left
        const py = e.clientY - r.top
        const invert = s.prefs['canvas.invertZoom'] === true ? -1 : 1
        const k = Math.abs(e.deltaY) < 50 ? 0.01 : 0.0025
        const zoom = clampZoom(cam.zoom * Math.exp(-e.deltaY * k * invert))
        const f = zoom / cam.zoom
        s.setCamera(docId, { zoom, x: px - (px - cam.x) * f, y: py - (py - cam.y) * f })
      } else {
        const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX
        const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY
        s.setCamera(docId, { x: cam.x - dx, y: cam.y - dy })
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [docId])

  // ---------------------------------------------------------------- helpers
  const zoomNow = (): number => getStore().editors[docId]?.camera.zoom ?? 1
  const snapPixel = (v: number): number => (getStore().prefs['canvas.snapToPixel'] === false ? Math.round(v * 100) / 100 : Math.round(v))

  function originFor(d: Doc, parentId: string): Pt {
    if (ops.isPageRoot(d, parentId)) return { x: 0, y: 0 }
    const r = measure(parentId, docId)
    return r ? { x: r.x, y: r.y } : { x: 0, y: 0 }
  }

  function endListeners(): void {
    const l = listeners.current
    window.removeEventListener('pointermove', l.move)
    window.removeEventListener('pointerup', l.up)
    window.removeEventListener('pointercancel', l.cancel)
  }

  function beginListeners(): void {
    const l = listeners.current
    window.addEventListener('pointermove', l.move)
    window.addEventListener('pointerup', l.up)
    window.addEventListener('pointercancel', l.cancel)
  }

  function cancelGesture(): void {
    const g = gesture.current
    gesture.current = null
    endListeners()
    setPanning(false)
    if (g && (g.kind === 'move' || g.kind === 'resize') && (g.kind === 'resize' || g.started)) {
      history.end(docId)
      getStore().undo(docId)
    }
    setTransient({})
  }

  // ---------------------------------------------------------------- pointer: down
  function onPointerDown(e: React.PointerEvent): void {
    const s = getStore()
    const ed = s.editors[docId]
    const d = s.docs[docId]
    if (!ed || !d || gesture.current) return
    // commit inline text edit / blur inspector inputs when interacting with the canvas
    if (ed.editingTextId) A.commitTextEditing()
    const active = document.activeElement as HTMLElement | null
    if (active && active !== document.body && typeof active.blur === 'function') active.blur()

    if (e.button === 1 || (e.button === 0 && (spaceRef.current || ed.tool === 'pan'))) {
      e.preventDefault()
      gesture.current = { kind: 'pan', start: { x: e.clientX, y: e.clientY }, cam: { x: ed.camera.x, y: ed.camera.y } }
      setPanning(true)
      beginListeners()
      return
    }
    const world0 = clientToWorld(e.clientX, e.clientY, docId)

    if (e.button === 2) {
      const deepest = nodeIdFromTarget(e.target)
      const pick = deepest ? pickNode(d, deepest, ed.selection, e.ctrlKey || e.metaKey) : null
      if (pick && !ed.selection.includes(pick)) s.select(docId, [pick])
      if (!pick) s.select(docId, [])
      return
    }
    if (e.button !== 0) return

    switch (ed.tool) {
      case 'frame':
      case 'rect':
      case 'shader': {
        const parent = containerAt(docId, e.clientX, e.clientY)
        gesture.current = { kind: 'draw', tool: ed.tool, startClient: { x: e.clientX, y: e.clientY }, start: world0, parent, rect: null }
        beginListeners()
        return
      }
      case 'text': {
        e.preventDefault()
        const parent = containerAt(docId, e.clientX, e.clientY)
        const flow = !ops.isPageRoot(d, parent) && ops.isFlowLayout(d.nodes[parent]?.style)
        const o = originFor(d, parent)
        const id = s.createNode(
          docId,
          { type: 'text', text: '', x: flow ? 0 : Math.round(world0.x - o.x), y: flow ? 0 : Math.round(world0.y - o.y - 10) },
          parent
        )
        A.textEditing.justCreated = id
        s.setTool(docId, 'move')
        A.startTextEditing(docId, id)
        return
      }
      case 'pen': {
        e.preventDefault()
        if (!pen.current) pen.current = { points: [], parent: containerAt(docId, e.clientX, e.clientY) }
        const pts = pen.current.points
        const z = zoomNow()
        if (pts.length >= 2 && Math.hypot(pts[0].x - world0.x, pts[0].y - world0.y) * z < 8) {
          pts.push({ ...pts[0] })
          finishPen(true)
          return
        }
        let p = world0
        if (e.shiftKey && pts.length) p = constrain45(pts[pts.length - 1], world0)
        pts.push(p)
        setTransient((t) => ({ ...t, pen: { points: [...pts], cursor: p } }))
        return
      }
      case 'comment':
        toast('Comments are not available in Vellum')
        s.setTool(docId, 'move')
        return
      case 'image':
      case 'svg':
        s.setTool(docId, 'move')
        break
      default:
        break
    }

    // move tool
    const deepest = nodeIdFromTarget(e.target)
    const pick = deepest ? pickNode(d, deepest, ed.selection, e.ctrlKey || e.metaKey) : null
    if (!pick) {
      if (!e.shiftKey) s.select(docId, [])
      gesture.current = { kind: 'marquee', start: world0, base: e.shiftKey ? ed.selection : [], additive: e.shiftKey }
      beginListeners()
      return
    }
    if (e.shiftKey) {
      s.select(docId, [pick], true)
      return
    }
    const already = ed.selection.includes(pick)
    if (!already) s.select(docId, [pick])
    startMove(e, already ? pick : null)
  }

  function startMove(e: React.PointerEvent, clickOnly: string | null): void {
    gesture.current = {
      kind: 'move',
      startClient: { x: e.clientX, y: e.clientY },
      startWorld: clientToWorld(e.clientX, e.clientY, docId),
      started: false,
      clickOnly,
      alt: e.altKey,
      ids: [],
      positioned: [],
      flow: [],
      orig: new Map(),
      rects: new Map(),
      bounds: null,
      snap: { xs: [], ys: [] },
      exclude: new Set(),
      target: null,
      delta: { x: 0, y: 0 }
    }
    beginListeners()
  }

  /** Called when a move crosses the drag threshold. */
  function initMove(g: Extract<Gesture, { kind: 'move' }>, altNow: boolean): boolean {
    const s = getStore()
    let d = s.docs[docId]
    const sel = s.editors[docId]?.selection ?? []
    let ids = ops.sortByTreeOrder(d, ops.topmostOnly(d, sel)).filter((id) => d.nodes[id]?.parent && !d.nodes[id].locked)
    if (!ids.length) return false
    history.begin(docId, 'Move')
    if (g.alt || altNow) {
      // Alt-drag duplicates, the copies start where the originals are
      const src = ids
      const dups = s.duplicateNodes(docId, src)
      s.mutate(docId, 'Duplicate', (dd) => {
        dups.forEach((id, i) => {
          const o = dd.nodes[src[i]]
          if (o && dd.nodes[id]) {
            dd.nodes[id].x = o.x
            dd.nodes[id].y = o.y
          }
        })
      })
      s.select(docId, dups)
      ids = dups
      d = getStore().docs[docId]
    }
    // right/bottom-anchored nodes move by x/y from where they are drawn
    const anchored = ids.filter((id) => {
      const a = ops.anchoredAxes(d.nodes[id])
      return !ops.isFlowChild(d, id) && (a.x || a.y)
    })
    if (anchored.length) {
      s.mutate(docId, 'Move', (dd) => anchored.forEach((id) => ops.detachAnchors(dd, id)))
      d = getStore().docs[docId]
    }
    g.ids = ids
    g.positioned = ids.filter((id) => !ops.isFlowChild(d, id))
    g.flow = ids.filter((id) => ops.isFlowChild(d, id))
    for (const id of ids) {
      g.orig.set(id, { x: d.nodes[id].x, y: d.nodes[id].y })
      const r = measure(id, docId)
      if (r) g.rects.set(id, r)
    }
    g.bounds = union([...g.rects.values()])
    g.snap = snapTargets(d, docId, ids)
    g.exclude = new Set(ids)
    g.started = true
    return true
  }

  // ---------------------------------------------------------------- pointer: move
  function onMove(e: PointerEvent): void {
    const g = gesture.current
    if (!g) return
    const s = getStore()
    const z = zoomNow()
    const p = clientToWorld(e.clientX, e.clientY, docId)

    if (g.kind === 'pan') {
      s.setCamera(docId, { x: g.cam.x + e.clientX - g.start.x, y: g.cam.y + e.clientY - g.start.y })
      return
    }

    if (g.kind === 'marquee') {
      const rect = rectFromPoints(g.start, p)
      setTransient({ marquee: rect, gesturing: true })
      const d = s.docs[docId]
      const root = activePage(s, docId)?.rootId
      if (!d || !root) return
      const hits: string[] = []
      for (const top of d.nodes[root]?.children ?? []) {
        const n = d.nodes[top]
        if (!n || n.locked || !n.visible) continue
        const r = measure(top, docId)
        if (!r || !intersects(rect, r)) continue
        if (contains(rect, r) || !n.children.length) {
          hits.push(top)
          continue
        }
        // partially covered artboard: select the children the marquee touches
        const kids = n.children.filter((c) => {
          const cr = measure(c, docId)
          return cr && !d.nodes[c]?.locked && d.nodes[c]?.visible !== false && intersects(rect, cr)
        })
        hits.push(...kids)
      }
      const next = g.additive ? [...new Set([...g.base, ...hits])] : hits
      const cur = s.editors[docId]?.selection ?? []
      if (next.length !== cur.length || next.some((id, i) => cur[i] !== id)) s.select(docId, next)
      return
    }

    if (g.kind === 'draw') {
      if (!g.rect && Math.hypot(e.clientX - g.startClient.x, e.clientY - g.startClient.y) < DRAG_THRESHOLD) return
      let w = p.x - g.start.x
      let h = p.y - g.start.y
      if (e.shiftKey) {
        const m = Math.max(Math.abs(w), Math.abs(h))
        w = Math.sign(w || 1) * m
        h = Math.sign(h || 1) * m
      }
      let rect = e.altKey
        ? { x: g.start.x - Math.abs(w), y: g.start.y - Math.abs(h), width: Math.abs(w) * 2, height: Math.abs(h) * 2 }
        : rectFromPoints(g.start, { x: g.start.x + w, y: g.start.y + h })
      rect = {
        x: snapPixel(rect.x),
        y: snapPixel(rect.y),
        width: Math.max(1, snapPixel(rect.width)),
        height: Math.max(1, snapPixel(rect.height))
      }
      g.rect = rect
      setTransient({ draw: { rect, tool: g.tool }, gesturing: true })
      return
    }

    if (g.kind === 'move') {
      if (!g.started) {
        if (Math.hypot(e.clientX - g.startClient.x, e.clientY - g.startClient.y) < DRAG_THRESHOLD) return
        if (!initMove(g, e.altKey)) {
          gesture.current = null
          endListeners()
          return
        }
      }
      const d = s.docs[docId]
      let dx = p.x - g.startWorld.x
      let dy = p.y - g.startWorld.y
      if (e.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0
        else dx = 0
      }
      let guides: Guide[] = []
      if (g.positioned.length && g.bounds && !e.ctrlKey) {
        const b = g.bounds
        const th = SNAP_PX / z
        const sx = bestSnap([b.x + dx, b.x + dx + b.width / 2, b.x + dx + b.width], g.snap.xs, th)
        const sy = bestSnap([b.y + dy, b.y + dy + b.height / 2, b.y + dy + b.height], g.snap.ys, th)
        if (sx !== null) dx += sx
        if (sy !== null) dy += sy
        guides = guidesFor({ ...b, x: b.x + dx, y: b.y + dy }, g.snap)
      }
      g.delta = { x: dx, y: dy }
      if (g.positioned.length) {
        const pos = g.positioned
        s.mutate(docId, 'Move', (dd) => {
          for (const id of pos) {
            const o = g.orig.get(id)
            const n = dd.nodes[id]
            if (!o || !n) continue
            n.x = snapPixel(o.x + dx)
            n.y = snapPixel(o.y + dy)
          }
        })
      }
      // drop target
      const firstParent = d.nodes[g.ids[0]]?.parent ?? ''
      const artboardsOnly = g.ids.every((id) => ops.isTopLevel(d, id) && d.nodes[id].type === 'frame')
      let target = artboardsOnly ? firstParent : containerAt(docId, e.clientX, e.clientY, g.exclude)
      let insert: Transient['insert']
      g.index = undefined
      const targetFlow = !ops.isPageRoot(d, target) && ops.isFlowLayout(d.nodes[target]?.style)
      if (targetFlow) {
        const ins = flowInsertion(d, docId, target, p, g.exclude)
        if (ins) {
          g.index = ins.index
          insert = ins.line
        }
      }
      // positioned nodes staying in their positioned parent need no target highlight
      const reparenting = g.ids.some((id) => d.nodes[id]?.parent !== target)
      if (!reparenting && !g.flow.length) target = firstParent
      g.target = target
      const ghosts = g.flow.map((id) => {
        const r = g.rects.get(id)
        return r ? { ...r, x: r.x + dx, y: r.y + dy } : null
      })
      setTransient({
        gesturing: true,
        guides,
        insert,
        ghosts: ghosts.filter((r): r is WorldRect => Boolean(r)),
        dropTarget: reparenting && !ops.isPageRoot(d, target) ? target : undefined
      })
      return
    }

    if (g.kind === 'resize') {
      doResize(g, p, e)
    }
  }

  function doResize(g: Extract<Gesture, { kind: 'resize' }>, p: Pt, e: PointerEvent): void {
    const s = getStore()
    const z = zoomNow()
    const B = g.bounds
    const h = g.handle
    const hasW = h.includes('w')
    const hasE = h.includes('e')
    const hasN = h.includes('n')
    const hasS = h.includes('s')
    const dx = p.x - g.startWorld.x
    const dy = p.y - g.startWorld.y
    let x1 = B.x
    let y1 = B.y
    let x2 = B.x + B.width
    let y2 = B.y + B.height
    if (hasE) x2 += dx
    if (hasW) x1 += dx
    if (hasS) y2 += dy
    if (hasN) y1 += dy
    const guides: Guide[] = []
    if (!e.shiftKey && !e.ctrlKey) {
      const th = SNAP_PX / z
      if (hasE || hasW) {
        const v = hasE ? x2 : x1
        const sn = bestSnap([v], g.snap.xs, th)
        if (sn !== null) {
          if (hasE) x2 += sn
          else x1 += sn
        }
      }
      if (hasN || hasS) {
        const v = hasS ? y2 : y1
        const sn = bestSnap([v], g.snap.ys, th)
        if (sn !== null) {
          if (hasS) y2 += sn
          else y1 += sn
        }
      }
    }
    if (e.altKey) {
      if (hasE) x1 = B.x - (x2 - (B.x + B.width))
      if (hasW) x2 = B.x + B.width + (B.x - x1)
      if (hasS) y1 = B.y - (y2 - (B.y + B.height))
      if (hasN) y2 = B.y + B.height + (B.y - y1)
    }
    const horiz = hasE || hasW
    const vert = hasN || hasS
    let changeW = horiz
    let changeH = vert
    if (e.shiftKey && B.width > 0 && B.height > 0) {
      const ratio = B.width / B.height
      let w = Math.max(1, x2 - x1)
      let hh = Math.max(1, y2 - y1)
      if (horiz && vert) {
        if (w / B.width > hh / B.height) hh = w / ratio
        else w = hh * ratio
      } else if (horiz) hh = w / ratio
      else w = hh * ratio
      const cx = B.x + B.width / 2
      const cy = B.y + B.height / 2
      if (horiz) {
        if (e.altKey) {
          x1 = cx - w / 2
          x2 = cx + w / 2
        } else if (hasW) x1 = x2 - w
        else x2 = x1 + w
      } else {
        x1 = cx - w / 2
        x2 = cx + w / 2
      }
      if (vert) {
        if (e.altKey) {
          y1 = cy - hh / 2
          y2 = cy + hh / 2
        } else if (hasN) y1 = y2 - hh
        else y2 = y1 + hh
      } else {
        y1 = cy - hh / 2
        y2 = cy + hh / 2
      }
      changeW = true
      changeH = true
    }
    x1 = snapPixel(x1)
    x2 = snapPixel(x2)
    y1 = snapPixel(y1)
    y2 = snapPixel(y2)
    if (x2 - x1 < 1) {
      if (hasW) x1 = x2 - 1
      else x2 = x1 + 1
    }
    if (y2 - y1 < 1) {
      if (hasN) y1 = y2 - 1
      else y2 = y1 + 1
    }
    const sx = (x2 - x1) / (B.width || 1)
    const sy = (y2 - y1) / (B.height || 1)
    const nb = { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }
    for (const l of g.snap.xs) if ([nb.x, nb.x + nb.width].some((m) => Math.abs(m - l.pos) < 0.01) && horiz)
      guides.push({ axis: 'x', pos: l.pos, from: Math.min(l.from, nb.y), to: Math.max(l.to, nb.y + nb.height) })
    for (const l of g.snap.ys) if ([nb.y, nb.y + nb.height].some((m) => Math.abs(m - l.pos) < 0.01) && vert)
      guides.push({ axis: 'y', pos: l.pos, from: Math.min(l.from, nb.x), to: Math.max(l.to, nb.x + nb.width) })

    s.mutate(docId, 'Resize', (d) => {
      for (const id of g.ids) {
        const n = d.nodes[id]
        const r0 = g.rects.get(id)
        const o = g.orig.get(id)
        if (!n || !r0 || !o) continue
        const nx = x1 + (r0.x - B.x) * sx
        const ny = y1 + (r0.y - B.y) * sy
        if (changeW) n.style.width = Math.max(1, snapPixel(r0.width * sx))
        if (changeH) n.style.height = Math.max(1, snapPixel(r0.height * sy))
        if (!ops.isFlowChild(d, id)) {
          n.x = snapPixel(o.x + (nx - r0.x))
          n.y = snapPixel(o.y + (ny - r0.y))
        }
      }
    })
    setTransient({ gesturing: true, guides })
  }

  // ---------------------------------------------------------------- pointer: up
  function onUp(_e: PointerEvent): void {
    const g = gesture.current
    gesture.current = null
    endListeners()
    setPanning(false)
    if (!g) return
    const s = getStore()

    if (g.kind === 'move') {
      if (!g.started) {
        if (g.clickOnly && (s.editors[docId]?.selection.length ?? 0) > 1) s.select(docId, [g.clickOnly])
        setTransient({})
        return
      }
      try {
        const d = s.docs[docId]
        const target = g.target
        if (target && d.nodes[target]) {
          const targetFlow = !ops.isPageRoot(d, target) && ops.isFlowLayout(d.nodes[target].style)
          const movePos = g.positioned.filter((id) => d.nodes[id]?.parent !== target || targetFlow)
          const moveFlow = g.flow
          const onlySamePositioned = !movePos.length && !moveFlow.length
          if (!onlySamePositioned) {
            if (targetFlow) {
              const all = [...movePos, ...moveFlow]
              if (all.length) s.moveNodes(docId, all, target, g.index)
            } else {
              if (movePos.length) s.moveNodes(docId, movePos, target)
              if (moveFlow.length) {
                const o = originFor(s.docs[docId], target)
                const ghostPos = new Map(
                  moveFlow.map((id) => {
                    const r = g.rects.get(id)
                    return [id, r ? { x: r.x + g.delta.x - o.x, y: r.y + g.delta.y - o.y } : null] as const
                  })
                )
                s.moveNodes(docId, moveFlow, target)
                s.mutate(docId, 'Move', (dd) => {
                  for (const id of moveFlow) {
                    const gp = ghostPos.get(id)
                    if (gp && dd.nodes[id]) {
                      dd.nodes[id].x = snapPixel(gp.x)
                      dd.nodes[id].y = snapPixel(gp.y)
                    }
                  }
                })
              }
            }
          }
        }
      } finally {
        history.end(docId)
      }
      setTransient({})
      return
    }

    if (g.kind === 'resize') {
      history.end(docId)
      setTransient({})
      return
    }

    if (g.kind === 'draw') {
      const d = s.docs[docId]
      const rect = g.rect ?? { x: snapPixel(g.start.x), y: snapPixel(g.start.y), width: 100, height: 100 }
      const flow = !ops.isPageRoot(d, g.parent) && ops.isFlowLayout(d.nodes[g.parent]?.style)
      const o = originFor(d, g.parent)
      const base = { width: rect.width, height: rect.height }
      const style =
        g.tool === 'shader'
          ? { ...base, backgroundColor: SHADER_COLOR, backgroundImage: SHADER_IMAGE, overflow: 'clip', boxSizing: 'border-box' }
          : base
      const id = s.createNode(
        docId,
        {
          type: g.tool === 'rect' ? 'rect' : 'frame',
          name: g.tool === 'shader' ? 'Shader' : undefined,
          x: flow ? 0 : snapPixel(rect.x - o.x),
          y: flow ? 0 : snapPixel(rect.y - o.y),
          style
        },
        g.parent
      )
      s.select(docId, [id])
      s.setTool(docId, 'move')
      setTransient({})
      return
    }

    setTransient({})
  }

  function onCancel(): void {
    cancelGesture()
  }

  // ---------------------------------------------------------------- overlay handlers
  function onHandleDown(e: React.PointerEvent, handle: Handle): void {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    const s = getStore()
    const d = s.docs[docId]
    const sel = s.editors[docId]?.selection ?? []
    const ids = ops.topmostOnly(d, sel).filter((id) => d.nodes[id] && !d.nodes[id].locked)
    const rects = new Map<string, WorldRect>()
    const orig = new Map<string, Pt>()
    for (const id of ids) {
      const r = measure(id, docId)
      if (r) rects.set(id, r)
      orig.set(id, { x: d.nodes[id].x, y: d.nodes[id].y })
    }
    const bounds = union([...rects.values()])
    if (!bounds) return
    history.begin(docId, 'Resize')
    gesture.current = {
      kind: 'resize',
      handle,
      startWorld: clientToWorld(e.clientX, e.clientY, docId),
      ids,
      rects,
      orig,
      bounds,
      snap: snapTargets(d, docId, ids)
    }
    beginListeners()
  }

  function onLabelDown(e: React.PointerEvent, id: string): void {
    e.stopPropagation()
    const s = getStore()
    if (e.button === 2) {
      s.select(docId, [id])
      return
    }
    if (e.button !== 0) return
    if (e.shiftKey) {
      s.select(docId, [id], true)
      return
    }
    const already = s.editors[docId]?.selection.includes(id) ?? false
    if (!already) s.select(docId, [id])
    startMove(e, already ? id : null)
  }

  // ---------------------------------------------------------------- hover / dblclick / context menu
  function onPointerMoveHover(e: React.PointerEvent): void {
    if (gesture.current) return
    const s = getStore()
    const ed = s.editors[docId]
    const d = s.docs[docId]
    if (!ed || !d) return
    if (pen.current) {
      const pts = pen.current.points
      let p = clientToWorld(e.clientX, e.clientY, docId)
      if (e.shiftKey && pts.length) p = constrain45(pts[pts.length - 1], p)
      setTransient((t) => ({ ...t, pen: { points: [...pts], cursor: p } }))
      return
    }
    if (ed.tool !== 'move' || spaceRef.current) {
      if (ed.hovered) s.setHovered(docId, null)
      return
    }
    const deepest = nodeIdFromTarget(e.target)
    const pick = deepest ? pickNode(d, deepest, ed.selection, e.ctrlKey || e.metaKey) : null
    if (pick !== ed.hovered) s.setHovered(docId, pick)
  }

  function onDoubleClick(e: React.MouseEvent): void {
    const s = getStore()
    const ed = s.editors[docId]
    const d = s.docs[docId]
    if (!ed || !d) return
    if (pen.current) {
      finishPen()
      return
    }
    if (ed.tool !== 'move') return
    const deepest = nodeIdFromTarget(e.target)
    if (!deepest) return
    const drill = drillNode(d, deepest, ed.selection)
    if (drill) {
      s.select(docId, [drill])
      return
    }
    const sel = ed.selection
    if (sel.length === 1 && sel[0] === deepest && d.nodes[deepest]?.type === 'text' && !d.nodes[deepest].locked) {
      A.startTextEditing(docId, deepest)
    }
  }

  function onContextMenu(e: React.MouseEvent): void {
    e.preventDefault()
    const s = getStore()
    const sel = s.editors[docId]?.selection ?? []
    const at = { x: e.clientX, y: e.clientY }
    ctx.open(e, sel.length ? nodeMenu(docId, at) : canvasMenu(docId))
  }

  live.current = { onMove, onUp, onCancel }

  if (!doc || !page || !camera) return null
  const root = doc.nodes[page.rootId]
  const tokenVars = Object.fromEntries(doc.tokens.map((t) => [t.name, t.value])) as CSSProperties
  const cursor =
    panning ? 'grabbing' : space || tool === 'pan' ? 'grab' : tool === 'text' ? 'text' : tool === 'move' ? 'default' : 'crosshair'
  const gridSize = camera.zoom

  return (
    <div
      ref={viewport}
      className="cv-viewport"
      style={{ background: page.background, cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMoveHover}
      onPointerLeave={() => {
        if (getStore().editors[docId]?.hovered) getStore().setHovered(docId, null)
      }}
      onMouseDown={(e) => {
        // keep focus behaviour under our control (text editing, inspector inputs are blurred manually)
        if (!(e.target instanceof HTMLElement && e.target.closest('[data-editing], input'))) e.preventDefault()
      }}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      <div
        ref={world}
        data-canvas-world
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          // wide containing block so top-level fit-content boxes don't shrink to min-content
          width: 1000000,
          height: 0,
          transformOrigin: '0 0',
          transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
          ...CANVAS_CONTENT_DEFAULTS,
          ...tokenVars
        }}
      >
        {root?.children.map((id) => (
          <NodeView key={id} docId={docId} id={id} parentFlow={false} topLevel />
        ))}
      </div>
      {pixelGrid && camera.zoom >= 8 && (
        <div
          className="cv-pixel-grid"
          style={{
            backgroundSize: `${gridSize}px ${gridSize}px`,
            backgroundPosition: `${camera.x}px ${camera.y}px`
          }}
        />
      )}
      <Overlay docId={docId} transient={transient} onHandleDown={onHandleDown} onLabelDown={onLabelDown} />
      {working && <div className="cv-glow" />}
      {ctx.element}
    </div>
  )
}

function constrain45(a: Pt, b: Pt): Pt {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4)
  const len = Math.hypot(dx, dy)
  return { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len }
}
