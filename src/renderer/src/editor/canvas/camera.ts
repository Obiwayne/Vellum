// Camera / zoom actions. Public API used by the toolbar, shortcuts, context menus and the
// inspector's zoom dropdown. Every function takes an optional docId (defaults to the active doc).
// Camera convention: screen = world * zoom + (camera.x, camera.y), relative to the viewport.
import { activeDocId, activePage, getStore } from '../../model/store'
import type { WorldRect } from '../../model/types'
import { measure, union } from './geometry'

export const MIN_ZOOM = 0.02
export const MAX_ZOOM = 256

const viewports = new Map<string, HTMLElement>()

/** CanvasView registers its viewport element so zoom actions know the visible size. */
export function registerViewport(docId: string, el: HTMLElement | null): void {
  if (el) viewports.set(docId, el)
  else viewports.delete(docId)
}

export const clampZoom = (z: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))

const resolveDoc = (docId?: string): string | null => docId ?? activeDocId(getStore())

export function viewportSize(docId?: string): { width: number; height: number } {
  const id = resolveDoc(docId)
  const el = id ? viewports.get(id) : undefined
  if (!el) return { width: 800, height: 600 }
  return { width: el.clientWidth, height: el.clientHeight }
}

/** Set zoom keeping the given viewport point (default: viewport centre) fixed. */
export function zoomAt(zoom: number, point?: { x: number; y: number }, docId?: string): void {
  const id = resolveDoc(docId)
  if (!id) return
  const cam = getStore().editors[id]?.camera
  if (!cam) return
  const z = clampZoom(zoom)
  const vs = viewportSize(id)
  const p = point ?? { x: vs.width / 2, y: vs.height / 2 }
  const k = z / cam.zoom
  getStore().setCamera(id, { zoom: z, x: p.x - (p.x - cam.x) * k, y: p.y - (p.y - cam.y) * k })
}

export function zoomIn(docId?: string): void {
  const id = resolveDoc(docId)
  const z = id ? getStore().editors[id]?.camera.zoom : undefined
  if (z !== undefined) zoomAt(z * 2, undefined, id ?? undefined)
}

export function zoomOut(docId?: string): void {
  const id = resolveDoc(docId)
  const z = id ? getStore().editors[id]?.camera.zoom : undefined
  if (z !== undefined) zoomAt(z / 2, undefined, id ?? undefined)
}

export function zoomTo100(docId?: string): void {
  zoomAt(1, undefined, docId)
}

/** Fit a world rect into the viewport with padding (screen px). */
export function zoomToRect(rect: WorldRect, docId?: string, opts: { padding?: number; maxZoom?: number } = {}): void {
  const id = resolveDoc(docId)
  if (!id) return
  const pad = opts.padding ?? 64
  const vs = viewportSize(id)
  const w = Math.max(rect.width, 1)
  const h = Math.max(rect.height, 1)
  const zoom = clampZoom(Math.min((vs.width - pad * 2) / w, (vs.height - pad * 2) / h, opts.maxZoom ?? MAX_ZOOM))
  getStore().setCamera(id, {
    zoom,
    x: vs.width / 2 - (rect.x + rect.width / 2) * zoom,
    y: vs.height / 2 - (rect.y + rect.height / 2) * zoom
  })
}

/** Centre the viewport on a world rect without changing zoom. */
export function centerOn(rect: WorldRect, docId?: string): void {
  const id = resolveDoc(docId)
  if (!id) return
  const cam = getStore().editors[id]?.camera
  if (!cam) return
  const vs = viewportSize(id)
  getStore().setCamera(id, {
    x: vs.width / 2 - (rect.x + rect.width / 2) * cam.zoom,
    y: vs.height / 2 - (rect.y + rect.height / 2) * cam.zoom
  })
}

/** World rect of everything on the active page (null when empty). */
export function pageBounds(docId?: string): WorldRect | null {
  const id = resolveDoc(docId)
  if (!id) return null
  const s = getStore()
  const doc = s.docs[id]
  const page = activePage(s, id)
  if (!doc || !page) return null
  return union((doc.nodes[page.rootId]?.children ?? []).map((c) => measure(c, id)))
}

export function zoomToFit(docId?: string): void {
  const r = pageBounds(docId)
  if (r) zoomToRect(r, docId)
  else zoomTo100(docId)
}

export function zoomToSelection(docId?: string): void {
  const id = resolveDoc(docId)
  if (!id) return
  const sel = getStore().editors[id]?.selection ?? []
  const r = union(sel.map((n) => measure(n, id)))
  if (r) zoomToRect(r, id)
  else zoomToFit(id)
}

/** Visible world rect of the viewport. */
export function visibleWorldRect(docId?: string): WorldRect | null {
  const id = resolveDoc(docId)
  const cam = id ? getStore().editors[id]?.camera : undefined
  if (!cam) return null
  const vs = viewportSize(id ?? undefined)
  return { x: -cam.x / cam.zoom, y: -cam.y / cam.zoom, width: vs.width / cam.zoom, height: vs.height / cam.zoom }
}

/** Human zoom label, e.g. "100%". */
export const zoomLabel = (zoom: number): string => `${Math.round(zoom * 100)}%`
