// Bridge handler registry + shared helpers for the MCP tools (renderer side).
import { activeDocId, activePage, getStore } from '../model/store'
import { anchoredAxes, isFlowChild, isPageRoot, modelWorldPosition, numericSize, pageOf, topLevelOf, worldRect } from '../model/ops'
import { measureOffscreen } from './measure'
import type { CNode, Doc, Page, Token } from '../model/types'

export type BridgeHandler = (args: Record<string, unknown>) => unknown | Promise<unknown>

export const handlers: Record<string, BridgeHandler> = {}

export function registerHandler(tool: string, fn: BridgeHandler): void {
  handlers[tool] = fn
}

/** Resolve the doc a tool should act on: args.fileId, else the active tab, else the most recent doc. */
export function resolveDocId(args: Record<string, unknown>): string {
  const s = getStore()
  const explicit = typeof args.fileId === 'string' && args.fileId ? args.fileId : undefined
  if (explicit) {
    if (!s.docs[explicit]) throw new Error(`File ${explicit} not found. Use list_files to see available files.`)
    return explicit
  }
  const id = activeDocId(s) ?? s.recents.find((r) => s.docs[r] && !s.docs[r].archived)
  if (!id) throw new Error('No file is open. Use list_files / open_file, or create_file.')
  return id
}

export function getDoc(docId: string): Doc {
  const d = getStore().docs[docId]
  if (!d) throw new Error(`File ${docId} not found`)
  return d
}

/** The page named by args.pageId, or the page the user is viewing. */
export function resolvePage(doc: Doc, pageId: unknown): Page {
  if (typeof pageId === 'string' && pageId) {
    const p = doc.pages.find((x) => x.id === pageId)
    if (!p) throw new Error(`Page ${pageId} not found. Pages: ${doc.pages.map((x) => `${x.id} (${x.name})`).join(', ')}`)
    return p
  }
  const p = activePage(getStore(), doc.id)
  if (!p) throw new Error('File has no pages')
  return p
}

export function requireNode(doc: Doc, id: unknown): CNode {
  if (typeof id !== 'string' || !id) throw new Error('Missing node id')
  const n = doc.nodes[id]
  if (!n) throw new Error(`Node ${id} not found`)
  return n
}

export const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
export const arr = <T = unknown>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])

// ------------------------------------------------------------------------------------------------
// response header ({file:{id,name}, contentHash:{tokens}})

function hash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export const tokensHash = (tokens: Token[]): string => hash(JSON.stringify(tokens.map((t) => [t.name, t.value])))

export interface Scoped {
  __header: { file: { id: string; name: string }; contentHash: { tokens: string } }
  body: unknown
}

/** Wrap a file-scoped result so the MCP server emits the header block first. */
export function scoped(docId: string, body: unknown): Scoped {
  const doc = getDoc(docId)
  return { __header: { file: { id: doc.id, name: doc.name }, contentHash: { tokens: tokensHash(doc.tokens) } }, body }
}

// ------------------------------------------------------------------------------------------------
// node descriptions

export function componentName(n: CNode): string {
  switch (n.type) {
    case 'frame':
      return 'Frame'
    case 'rect':
      return 'Rectangle'
    case 'text':
      return 'Text'
    case 'image':
      return 'Image'
    case 'svg':
      return 'SVG'
  }
}

/** True when the node's page is on screen (so DOM measurement is available). */
export function isMeasurable(doc: Doc, id: string): boolean {
  const s = getStore()
  if (activeDocId(s) !== doc.id) return false
  const p = pageOf(doc, id)
  return Boolean(p && activePage(s, doc.id)?.id === p.id)
}

export interface Geometry {
  width: number | null
  height: number | null
  worldX: number | null
  worldY: number | null
  x: number | null
  y: number | null
}

const round = (v: number): number => Math.round(v * 100) / 100

/**
 * Size and position of a node, measured from the DOM: from the canvas when the node's page is on
 * screen, otherwise from an offscreen render of its artboard (bridge/measure.ts). Model arithmetic
 * is the fallback (hidden nodes, page roots).
 */
export function geometry(doc: Doc, id: string): Geometry {
  const n = doc.nodes[id]
  if (!n) return { width: null, height: null, worldX: null, worldY: null, x: null, y: null }
  let width: number | null = null
  let height: number | null = null
  let worldX: number | null = null
  let worldY: number | null = null
  let measured = false
  if (!isPageRoot(doc, id)) {
    const r = isMeasurable(doc, id) ? worldRect(doc, id) : measureOffscreen(doc, id)
    if (r && (r.width > 0 || r.height > 0 || n.visible)) {
      width = r.width
      height = r.height
      worldX = r.x
      worldY = r.y
      measured = true
    }
  }
  if (!measured) {
    width = numericSize(n.style.width)
    height = numericSize(n.style.height)
    const p = modelWorldPosition(doc, id)
    if (p) {
      worldX = p.x
      worldY = p.y
    }
  }
  let x: number | null = null
  let y: number | null = null
  const topLevel = n.parent ? isPageRoot(doc, n.parent) : true
  if (topLevel) {
    x = worldX
    y = worldY
  } else if (!isFlowChild(doc, id) && !(measured && (anchoredAxes(n).x || anchoredAxes(n).y))) {
    x = n.x
    y = n.y
  } else if (n.parent && worldX !== null && worldY !== null) {
    const pg = geometry(doc, n.parent)
    if (pg.worldX !== null && pg.worldY !== null) {
      x = worldX - pg.worldX
      y = worldY - pg.worldY
    }
  }
  const r = (v: number | null): number | null => (v === null ? null : round(v))
  return { width: r(width), height: r(height), worldX: r(worldX), worldY: r(worldY), x: r(x), y: r(y) }
}

export function artboardOf(doc: Doc, id: string): string | null {
  const n = doc.nodes[id]
  if (!n || !n.parent || isPageRoot(doc, id)) return null
  if (isPageRoot(doc, n.parent)) return null
  return topLevelOf(doc, id) ?? null
}

/** Mark the artboards containing these nodes as "being worked on" by the agent. */
export function markWorking(docId: string, ids: string[]): void {
  const doc = getStore().docs[docId]
  if (!doc) return
  const out = new Set<string>()
  for (const id of ids) {
    if (!doc.nodes[id] || isPageRoot(doc, id)) continue
    out.add(topLevelOf(doc, id) ?? id)
  }
  if (out.size) getStore().addWorkingNodes(docId, [...out])
}

/** Next free spot to the right of the page's existing artboards (80px gap). */
export function nextArtboardPosition(doc: Doc, page: Page, gap = 80): { x: number; y: number } {
  const root = doc.nodes[page.rootId]
  const kids = (root?.children ?? []).filter((c) => doc.nodes[c])
  if (!kids.length) return { x: 0, y: 0 }
  let right = -Infinity
  let top = Infinity
  for (const c of kids) {
    const g = geometry(doc, c)
    const n = doc.nodes[c]
    const x = g.worldX ?? n.x
    const y = g.worldY ?? n.y
    const w = g.width ?? numericSize(n.style.width) ?? 0
    right = Math.max(right, x + w)
    top = Math.min(top, y)
  }
  return { x: Math.round(right + gap), y: Math.round(top) }
}

/** '1440px' → 1440 for width/height (model convention); left/top pulled out. */
export function normalizeStyles(input: Record<string, unknown>): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {}
  for (const [k, v] of Object.entries(input ?? {})) {
    if (v === null || v === undefined) {
      out[k] = null
      continue
    }
    if (typeof v !== 'string' && typeof v !== 'number') continue
    let val: string | number = v
    if (typeof val === 'string') {
      val = val.trim().replace(/\s*!important$/i, '')
      if (['width', 'height'].includes(k)) {
        const num = numericSize(val)
        if (num !== null) val = num
      } else if (/^-?\d*\.?\d+$/.test(val)) {
        val = parseFloat(val)
      }
    }
    out[k] = val
  }
  return out
}

/** Yield so React can commit pending renders (DOM measurement after mutations). */
export const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
