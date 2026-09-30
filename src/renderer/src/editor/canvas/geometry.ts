// DOM measurement helpers for the canvas. The world container is registered by CanvasView; all
// rects here are in WORLD coordinates (camera independent).
import { getStore } from '../../model/store'
import type { Camera, WorldRect } from '../../model/types'

let worldEl: HTMLElement | null = null
let worldDocId: string | null = null

export function registerWorld(docId: string, el: HTMLElement | null): void {
  if (el) {
    worldEl = el
    worldDocId = docId
  } else if (worldDocId === docId) {
    worldEl = null
    worldDocId = null
  }
}

export const getWorldEl = (): HTMLElement | null => worldEl
export const getWorldDocId = (): string | null => worldDocId

export function nodeEl(id: string): HTMLElement | null {
  if (!worldEl) return null
  return worldEl.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`)
}

/** Measured world rect of a rendered node (null if not rendered / display:none). */
export function measure(id: string, docId = worldDocId): WorldRect | null {
  if (!worldEl || !docId || docId !== worldDocId) return null
  const el = nodeEl(id)
  if (!el || el.getClientRects().length === 0) return null
  const zoom = getStore().editors[docId]?.camera.zoom ?? 1
  const w = worldEl.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  return { x: (r.left - w.left) / zoom, y: (r.top - w.top) / zoom, width: r.width / zoom, height: r.height / zoom }
}

/** Client (screen) point → world point. */
export function clientToWorld(clientX: number, clientY: number, docId = worldDocId): { x: number; y: number } {
  const cam = docId ? getStore().editors[docId]?.camera : undefined
  if (!worldEl || !cam) return { x: clientX, y: clientY }
  const w = worldEl.getBoundingClientRect()
  return { x: (clientX - w.left) / cam.zoom, y: (clientY - w.top) / cam.zoom }
}

/** World rect → screen rect (relative to the viewport). */
export const toScreen = (r: WorldRect, cam: Camera): WorldRect => ({
  x: r.x * cam.zoom + cam.x,
  y: r.y * cam.zoom + cam.y,
  width: r.width * cam.zoom,
  height: r.height * cam.zoom
})

export function union(rects: Array<WorldRect | null | undefined>): WorldRect | null {
  const rs = rects.filter((r): r is WorldRect => Boolean(r))
  if (!rs.length) return null
  const x1 = Math.min(...rs.map((r) => r.x))
  const y1 = Math.min(...rs.map((r) => r.y))
  const x2 = Math.max(...rs.map((r) => r.x + r.width))
  const y2 = Math.max(...rs.map((r) => r.y + r.height))
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }
}

export const intersects = (a: WorldRect, b: WorldRect): boolean =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y

export const contains = (outer: WorldRect, inner: WorldRect): boolean =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height

export function rectFromPoints(a: { x: number; y: number }, b: { x: number; y: number }): WorldRect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }
}

/** Notify the overlay that rendered layout changed without a store change (image load, typing). */
export const LAYOUT_EVENT = 'canvas:layout'
export function notifyLayout(): void {
  window.dispatchEvent(new Event(LAYOUT_EVENT))
}
