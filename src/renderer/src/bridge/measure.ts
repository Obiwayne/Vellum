// Offscreen layout measurement for MCP geometry. The canvas only renders the page the user is
// viewing, so sizes of fit-content boxes and positions of flow children on other pages (or in
// files that aren't open) can't be read from it. Here the node's artboard is rendered into a
// hidden container in the renderer document, the same way the canvas renders it (same markup,
// global CSS, inherited defaults and token variables), and measured from the DOM.
import { nodeToRenderHtml } from '../model/html'
import { isPageRoot, topLevelOf } from '../model/ops'
import type { Doc, WorldRect } from '../model/types'
import { CANVAS_CONTENT_DEFAULTS } from '../editor/canvas/contentDefaults'
import { loadDocFonts } from '../editor/canvas/useDocFonts'
import { toKebab, cssValue } from '../model/html'

const ID_ATTR = 'data-measure-id'
const MAX_CACHED = 6

interface Entry {
  doc: Doc
  world: HTMLElement
  top: HTMLElement
}

let host: HTMLDivElement | null = null
/** docId + artboard id → rendered artboard (valid while the doc object is unchanged) */
const cache = new Map<string, Entry>()
const fontsRequested = new WeakSet<Doc['nodes']>()

function getHost(): HTMLDivElement {
  if (host && host.isConnected) return host
  host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.dataset.canvasMeasure = ''
  // laid out but never painted or hit-tested; 0×0 + overflow hidden so it can't affect the page
  Object.assign(host.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    width: '0',
    height: '0',
    overflow: 'hidden',
    visibility: 'hidden',
    pointerEvents: 'none',
    zIndex: '-1'
  })
  document.body.appendChild(host)
  return host
}

function build(doc: Doc, topId: string): Entry | null {
  const top = doc.nodes[topId]
  if (!top) return null
  const world = document.createElement('div')
  // same containing block as the canvas world: very wide so fit-content artboards don't shrink
  const ws = world.style
  ws.position = 'absolute'
  ws.left = '0'
  ws.top = '0'
  ws.width = '1000000px'
  ws.height = '0'
  for (const [k, v] of Object.entries(CANVAS_CONTENT_DEFAULTS)) {
    if (v !== undefined && v !== null) ws.setProperty(toKebab(k), cssValue(k, v as string | number))
  }
  for (const t of doc.tokens) ws.setProperty(t.name, t.value)
  world.innerHTML = nodeToRenderHtml(doc, topId, true, ID_ATTR)
  const el = world.firstElementChild as HTMLElement | null
  if (!el) return null
  // the canvas places top-level nodes absolutely at x/y; measure relative to (0,0) and add x/y
  el.style.position = 'absolute'
  el.style.left = '0px'
  el.style.top = '0px'
  getHost().appendChild(world)
  if (!fontsRequested.has(doc.nodes)) {
    fontsRequested.add(doc.nodes)
    loadDocFonts(doc.nodes, doc.tokens)
  }
  return { doc, world, top: el }
}

function entryFor(doc: Doc, topId: string): Entry | null {
  const key = `${doc.id}:${topId}`
  const hit = cache.get(key)
  if (hit && hit.doc === doc && hit.world.isConnected) {
    // most recently used last
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  if (hit) {
    hit.world.remove()
    cache.delete(key)
  }
  // drop stale renders of other versions of this doc, and the least recently used ones
  for (const [k, e] of cache) {
    if (e.doc.id === doc.id && e.doc !== doc) {
      e.world.remove()
      cache.delete(k)
    }
  }
  while (cache.size >= MAX_CACHED) {
    const [k, e] = cache.entries().next().value as [string, Entry]
    e.world.remove()
    cache.delete(k)
  }
  const e = build(doc, topId)
  if (e) cache.set(key, e)
  return e
}

/** World rect of a node measured from an offscreen render of its artboard (null if hidden). */
export function measureOffscreen(doc: Doc, id: string): WorldRect | null {
  const n = doc.nodes[id]
  if (!n || !n.parent || isPageRoot(doc, id)) return null
  const topId = topLevelOf(doc, id)
  if (!topId) return null
  const topNode = doc.nodes[topId]
  const e = entryFor(doc, topId)
  if (!e || !topNode) return null
  const el = id === topId ? e.top : e.top.querySelector<HTMLElement>(`[${ID_ATTR}="${CSS.escape(id)}"]`)
  if (!el || el.getClientRects().length === 0) return null
  const o = e.top.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  return { x: topNode.x + (r.left - o.left), y: topNode.y + (r.top - o.top), width: r.width, height: r.height }
}

/** Remove every offscreen render (e.g. after a file is closed). */
export function clearMeasureCache(): void {
  for (const e of cache.values()) e.world.remove()
  cache.clear()
}
