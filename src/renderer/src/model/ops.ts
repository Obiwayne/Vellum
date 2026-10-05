// Pure document helpers. Functions that take a `doc` and mutate it are meant to be called on an
// immer draft (inside store mutations). Read-only helpers work on plain docs or drafts.
import type { CNode, Doc, NodeType, Page, Style, StylePatch, WorldRect } from './types'

// ---------------------------------------------------------------------------------------------
// ids & defaults

/** Allocates the next "<n>-0" id and bumps doc.nextId (mutates doc). */
export function newId(doc: Doc): string {
  const id = `${doc.nextId}-0`
  doc.nextId += 1
  return id
}

export const PAGE_BACKGROUND = '#282828'

export const TEXT_DEFAULTS: Style = {
  fontFamily: 'system-ui, sans-serif',
  fontSize: 16,
  lineHeight: '1.25', // unitless: scales with the font size, so Fit containers grow with the text
  color: '#000000',
  width: 'fit-content'
}

export function defaultStyle(type: NodeType): Style {
  switch (type) {
    case 'frame':
      return { width: 380, height: 380, backgroundColor: '#FFFFFF', overflow: 'clip', boxSizing: 'border-box' }
    case 'rect':
      return { width: 100, height: 100, backgroundColor: '#D9D9D9', boxSizing: 'border-box' }
    case 'text':
      return { ...TEXT_DEFAULTS }
    case 'image':
      return { width: 200, height: 200, objectFit: 'cover' }
    case 'svg':
      return { width: 24, height: 24 }
  }
}

export function defaultName(type: NodeType, text?: string): string {
  switch (type) {
    case 'frame':
      return 'Frame'
    case 'rect':
      return 'Rectangle'
    case 'text':
      return textPreview(text ?? '') || 'Text'
    case 'image':
      return 'Image'
    case 'svg':
      return 'SVG'
  }
}

export function textPreview(text: string, max = 40): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max).trimEnd() + '…' : t
}

/** Build a complete CNode from a partial (does NOT insert it). Allocates an id if missing. */
export function makeNode(doc: Doc, partial: Partial<CNode> & { type: NodeType }, withDefaults = true): CNode {
  const type = partial.type
  const style: Style = withDefaults ? { ...defaultStyle(type), ...(partial.style ?? {}) } : { ...(partial.style ?? {}) }
  const node: CNode = {
    id: partial.id ?? newId(doc),
    type,
    name: partial.name ?? defaultName(type, partial.text),
    parent: null,
    children: [],
    style,
    x: partial.x ?? 0,
    y: partial.y ?? 0,
    visible: partial.visible ?? true,
    locked: partial.locked ?? false
  }
  if (type === 'text') node.text = partial.text ?? ''
  if (partial.svg !== undefined) node.svg = partial.svg
  if (partial.attrs) node.attrs = { ...partial.attrs }
  return node
}

export function makePage(doc: Doc, name: string): Page {
  const rootId = newId(doc)
  const pageId = `p-${rootId}`
  doc.nodes[rootId] = {
    id: rootId,
    type: 'frame',
    name,
    parent: null,
    children: [],
    style: {},
    x: 0,
    y: 0,
    visible: true,
    locked: false
  }
  const page: Page = { id: pageId, name, rootId, background: PAGE_BACKGROUND }
  doc.pages.push(page)
  return page
}

export function makeDoc(id: string, name: string): Doc {
  const now = Date.now()
  const doc: Doc = { id, name, pages: [], nodes: {}, tokens: [], nextId: 1, createdAt: now, updatedAt: now, version: DOC_VERSION }
  makePage(doc, 'Page 1')
  return doc
}

/** Current document format version (Doc.version). */
export const DOC_VERSION = 5

/**
 * Upgrade a loaded document to DOC_VERSION without changing how it looks. Returns the same object
 * when nothing changed, otherwise a new (plain) doc.
 *  - v1 → v2: canvas content used to inherit `line-height: 20px`; it now inherits `normal` (as in a
 *    browser). Text nodes that relied on the old default get an explicit `lineHeight: '20px'`.
 */
export function migrateDoc(doc: Doc): Doc {
  const v = doc.version ?? 1
  if (v >= DOC_VERSION) return doc
  // v2 → v3 (components) and v3 → v4 (variants) only add optional node fields: nothing to rewrite
  if (v === 2 || v === 3) return { ...doc, version: DOC_VERSION }
  const nodes: Record<string, CNode> = { ...doc.nodes }
  const hasLineHeight = (id: string): boolean => {
    let cur: string | null = id
    while (cur) {
      const n: CNode | undefined = doc.nodes[cur]
      if (!n) return false
      if (n.style.lineHeight !== undefined) return true
      cur = n.parent
    }
    return false
  }
  for (const n of Object.values(doc.nodes)) {
    if (n.type === 'text' && !hasLineHeight(n.id)) nodes[n.id] = { ...n, style: { ...n.style, lineHeight: '20px' } }
  }
  return { ...doc, nodes, version: DOC_VERSION }
}

// ---------------------------------------------------------------------------------------------
// queries

export const getNode = (doc: Doc, id: string): CNode | undefined => doc.nodes[id]

export function getChildren(doc: Doc, id: string): CNode[] {
  const n = doc.nodes[id]
  if (!n) return []
  return n.children.map((c) => doc.nodes[c]).filter((c): c is CNode => Boolean(c))
}

export const isPageRoot = (doc: Doc, id: string): boolean => doc.pages.some((p) => p.rootId === id)

/** Parent chain, nearest first, up to and including the page root. */
export function ancestors(doc: Doc, id: string): string[] {
  const out: string[] = []
  let cur = doc.nodes[id]?.parent ?? null
  while (cur) {
    out.push(cur)
    cur = doc.nodes[cur]?.parent ?? null
  }
  return out
}

export function isAncestor(doc: Doc, ancestorId: string, id: string): boolean {
  return ancestors(doc, id).includes(ancestorId)
}

/** All descendant ids (depth-first, excluding id). */
export function descendants(doc: Doc, id: string): string[] {
  const out: string[] = []
  const walk = (nid: string): void => {
    for (const c of doc.nodes[nid]?.children ?? []) {
      out.push(c)
      walk(c)
    }
  }
  walk(id)
  return out
}

export function pageOf(doc: Doc, id: string): Page | undefined {
  const chain = [id, ...ancestors(doc, id)]
  const rootId = chain[chain.length - 1]
  return doc.pages.find((p) => p.rootId === rootId)
}

/** Top-level node (artboard) containing id, or id itself when it is top-level. */
export function topLevelOf(doc: Doc, id: string): string | undefined {
  const chain = [id, ...ancestors(doc, id)]
  return chain.length >= 2 ? chain[chain.length - 2] : undefined
}

export const isTopLevel = (doc: Doc, id: string): boolean => {
  const p = doc.nodes[id]?.parent
  return p != null && isPageRoot(doc, p)
}

/** True when the style lays children out in flow (flex or grid). */
export function isFlowLayout(style: Style | undefined): boolean {
  const d = style?.display
  return d === 'flex' || d === 'inline-flex' || d === 'grid' || d === 'inline-grid'
}

/** Grid container? */
export function isGrid(node: CNode | undefined): boolean {
  const d = node?.style.display
  return d === 'grid' || d === 'inline-grid'
}

/** Flex container? (grid counts as flow too — see isFlowLayout) */
export function isFlex(node: CNode | undefined): boolean {
  const d = node?.style.display
  return d === 'flex' || d === 'inline-flex'
}

/** Node participates in its parent's flow (parent is flex/grid and node not absolutely positioned). */
export function isFlowChild(doc: Doc, id: string): boolean {
  const n = doc.nodes[id]
  if (!n || !n.parent || isPageRoot(doc, n.parent)) return false
  const p = doc.nodes[n.parent]
  return isFlowLayout(p?.style) && n.style.position !== 'absolute'
}

/** Node is placed with x/y (top-level, child of non-flow frame, or position:absolute). */
export const isPositioned = (doc: Doc, id: string): boolean => !isFlowChild(doc, id)

/**
 * Positioned node whose left/top is not a px offset (x/y) but a CSS value kept in the style:
 * 'auto' (anchored by right/bottom, or the static position), '50%', 'calc(…)' and so on.
 */
export function anchoredAxes(n: CNode): { x: boolean; y: boolean } {
  const s = n.style
  return {
    x: s.left !== undefined && numericSize(s.left) === null,
    y: s.top !== undefined && numericSize(s.top) === null
  }
}

// ---------------------------------------------------------------------------------------------
// constraints
//
// How a positioned child (x/y inside a frame) follows its parent's size. Written as plain CSS, so
// the canvas and every export behave the same. Per axis (horizontal shown; vertical uses
// top/bottom/height, and parentW is the parent's padding box):
//   start   left: x                                        (Left, the default)
//   end     left: auto; right: parentW - x - w             (Right)
//   both    left: x; right: parentW - x - w; width: auto   (Left & right)
//   center  left: calc(50% ± |x - parentW / 2|px)          (Center)
//   scale   left: x / parentW %; width: w / parentW %      (Scale)
// 'end', 'center' and 'scale' keep left/top in the style (see anchoredAxes); 'start'/'both' use x/y.
// Gestures edit nodes as plain px boxes: detachAnchors → change x/y/size → restoreConstraints.

export type Constraint = 'start' | 'end' | 'both' | 'center' | 'scale'
export type ConstraintAxis = 'h' | 'v'
export interface Constraints {
  h: Constraint
  v: Constraint
}

const AXIS_KEYS = {
  h: { start: 'left', end: 'right', size: 'width', pos: 'x' },
  v: { start: 'top', end: 'bottom', size: 'height', pos: 'y' }
} as const

const isPct = (v: unknown): boolean => typeof v === 'string' && /%\s*$/.test(v)
const round2 = (v: number): number => Math.round(v * 100) / 100
const pct = (v: number): string => `${Math.round(v * 10000) / 100}%`

/** Positioned child of a frame (not top-level, not in flow): the nodes constraints apply to. */
export function canConstrain(doc: Doc, id: string): boolean {
  const n = doc.nodes[id]
  return Boolean(n?.parent && !isPageRoot(doc, n.parent) && !isFlowChild(doc, id))
}

export function axisConstraint(n: CNode, axis: ConstraintAxis): Constraint {
  const k = AXIS_KEYS[axis]
  const start = n.style[k.start]
  const end = n.style[k.end]
  if (isPct(start) && isPct(n.style[k.size])) return 'scale'
  if (start === '50%' || (typeof start === 'string' && /^calc\(\s*50%/.test(start))) return 'center'
  if (end !== undefined && end !== '' && end !== 'auto') return start === 'auto' ? 'end' : 'both'
  return 'start'
}

export const getConstraints = (n: CNode): Constraints => ({ h: axisConstraint(n, 'h'), v: axisConstraint(n, 'v') })

/** Placed by something other than plain left/top px, so gestures detach it first (detachAnchors). */
export function needsDetach(n: CNode): boolean {
  const a = anchoredAxes(n)
  const c = getConstraints(n)
  return a.x || a.y || c.h !== 'start' || c.v !== 'start'
}

function borders(p: CNode | undefined): { l: number; t: number; r: number; b: number } {
  const w = (k: string): number => numericSize(p?.style[k] ?? p?.style.borderWidth) ?? 0
  return { l: w('borderLeftWidth'), t: w('borderTopWidth'), r: w('borderRightWidth'), b: w('borderBottomWidth') }
}

/** A child box in its parent's padding box, plus that padding box's size. */
interface Box {
  x: number
  y: number
  w: number
  h: number
  pw: number
  ph: number
}

/** Parent padding-box size, measured through the resolver. */
function parentSize(doc: Doc, n: CNode): { pw: number; ph: number } | null {
  const pr = n.parent ? resolver?.(doc.id, n.parent) : null
  if (!pr || !n.parent) return null
  const b = borders(doc.nodes[n.parent])
  return { pw: pr.width - b.l - b.r, ph: pr.height - b.t - b.b }
}

/** Where the node is drawn (measured). */
function measuredBox(doc: Doc, id: string): Box | null {
  const n = doc.nodes[id]
  if (!n?.parent) return null
  const r = resolver?.(doc.id, id)
  const pr = resolver?.(doc.id, n.parent)
  const ps = parentSize(doc, n)
  if (!r || !pr || !ps) return null
  const b = borders(doc.nodes[n.parent])
  return { x: r.x - pr.x - b.l, y: r.y - pr.y - b.t, w: r.width, h: r.height, ...ps }
}

/** Writes one axis of a constraint for a node occupying `box`, so it stays where it is. */
function writeAxis(n: CNode, axis: ConstraintAxis, c: Constraint, box: Box): void {
  const k = AXIS_KEYS[axis]
  const s = n.style
  const pos = axis === 'h' ? box.x : box.y
  const size = axis === 'h' ? box.w : box.h
  const ps = axis === 'h' ? box.pw : box.ph
  delete s[k.start]
  delete s[k.end]
  // leaving Left & right / Scale: the stretched or relative size becomes a fixed one
  if (c !== 'both' && c !== 'scale' && (s[k.size] === 'auto' || isPct(s[k.size]))) s[k.size] = round2(size)
  n[k.pos] = round2(pos)
  if (c === 'end') {
    s[k.start] = 'auto'
    s[k.end] = round2(ps - pos - size)
  } else if (c === 'both') {
    s[k.end] = round2(ps - pos - size)
    s[k.size] = 'auto'
  } else if (c === 'center') {
    const off = round2(pos - ps / 2)
    s[k.start] = `calc(50% ${off < 0 ? '-' : '+'} ${Math.abs(off)}px)`
  } else if (c === 'scale' && ps > 0) {
    s[k.start] = pct(pos / ps)
    s[k.size] = pct(size / ps)
  }
}

/** Set one axis' constraint without moving the node (converted from its measured box). */
export function setConstraint(doc: Doc, id: string, axis: ConstraintAxis, c: Constraint): void {
  const n = doc.nodes[id]
  if (!n || !canConstrain(doc, id)) return
  const box = measuredBox(doc, id)
  if (box) writeAxis(n, axis, c, box)
}

/**
 * Before moving a positioned node by x/y: turn left/top anchoring that isn't px (see anchoredAxes)
 * and any constraint other than Left/Top into plain x/y offsets and px sizes using its measured
 * box, so the move starts where the node is drawn. Returns the constraints it had, for
 * restoreConstraints once the edit is done.
 */
export function detachAnchors(doc: Doc, id: string): Constraints {
  const n = doc.nodes[id]
  if (!n?.parent || isFlowChild(doc, id) || isPageRoot(doc, n.parent)) return { h: 'start', v: 'start' }
  const c = getConstraints(n)
  const a = anchoredAxes(n)
  const ax = a.x || c.h !== 'start'
  const ay = a.y || c.v !== 'start'
  if (!ax && !ay) return c
  const box = measuredBox(doc, id)
  if (!box) return c
  // the stretched / relative size itself becomes px
  if (c.h === 'both' || c.h === 'scale') n.style.width = round2(box.w)
  if (c.v === 'both' || c.v === 'scale') n.style.height = round2(box.h)
  if (ax) writeAxis(n, 'h', 'start', box)
  if (ay) writeAxis(n, 'v', 'start', box)
  return c
}

/**
 * After editing a detached node (plain x/y and px size): write its constraints back for its new
 * model box. A size that isn't px (fit-content text) is measured.
 */
export function restoreConstraints(doc: Doc, id: string, c: Constraints): void {
  if (c.h === 'start' && c.v === 'start') return
  const n = doc.nodes[id]
  if (!n || !canConstrain(doc, id)) return
  const ps = parentSize(doc, n)
  const r = resolver?.(doc.id, id)
  const w = numericSize(n.style.width) ?? r?.width
  const h = numericSize(n.style.height) ?? r?.height
  if (!ps || w === undefined || h === undefined) return
  const box: Box = { x: n.x, y: n.y, w, h, ...ps }
  if (c.h !== 'start') writeAxis(n, 'h', c.h, box)
  if (c.v !== 'start') writeAxis(n, 'v', c.v, box)
}

/** Edit a positioned node as a plain px box (x/y/width/height), keeping its constraints. */
export function editPlain(doc: Doc, id: string, fn: (n: CNode) => void): void {
  const n = doc.nodes[id]
  if (!n) return
  const c = detachAnchors(doc, id)
  fn(n)
  restoreConstraints(doc, id, c)
}

export function indexInParent(doc: Doc, id: string): number {
  const n = doc.nodes[id]
  if (!n?.parent) return -1
  return doc.nodes[n.parent]?.children.indexOf(id) ?? -1
}

/** number for px sizes (380 or '380px'), null for 'fit-content', '100%', 'auto', etc. */
export function numericSize(v: string | number | undefined): number | null {
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const m = /^(-?\d*\.?\d+)(px)?$/.exec(v.trim())
    if (m) return parseFloat(m[1])
  }
  return null
}

// ---------------------------------------------------------------------------------------------
// world geometry
//
// The model alone can't know sizes of flow children or fit-content boxes. The canvas registers
// a DOM-based resolver (setWorldRectResolver) that returns measured world rects; the helpers
// below use it when available and fall back to model arithmetic otherwise.

type RectResolver = (docId: string, id: string) => WorldRect | null
let resolver: RectResolver | null = null

export function setWorldRectResolver(fn: RectResolver | null): void {
  resolver = fn
}

/** World position of the node's top-left, computed from the model. Null if a flow child is in the chain. */
export function modelWorldPosition(doc: Doc, id: string): { x: number; y: number } | null {
  let x = 0
  let y = 0
  let cur: string | null = id
  while (cur && !isPageRoot(doc, cur)) {
    const n: CNode | undefined = doc.nodes[cur]
    if (!n) return null
    if (isFlowChild(doc, cur)) return null
    x += n.x
    y += n.y
    cur = n.parent
  }
  return { x, y }
}

/** World rect of a node (DOM-measured when the canvas registered a resolver). */
export function worldRect(doc: Doc, id: string): WorldRect | null {
  const r = resolver?.(doc.id, id)
  if (r) return r
  const p = modelWorldPosition(doc, id)
  const n = doc.nodes[id]
  if (!p || !n) return null
  return { x: p.x, y: p.y, width: numericSize(n.style.width) ?? 0, height: numericSize(n.style.height) ?? 0 }
}

/** Origin (world coords of the content-box top-left used for children x/y) of a container. */
function containerOrigin(doc: Doc, id: string): { x: number; y: number } | null {
  if (isPageRoot(doc, id)) return { x: 0, y: 0 }
  const r = worldRect(doc, id)
  return r ? { x: r.x, y: r.y } : null
}

// ---------------------------------------------------------------------------------------------
// mutations (call on drafts)

export function insertNode(doc: Doc, node: CNode, parentId: string, index?: number): void {
  const parent = doc.nodes[parentId]
  if (!parent) throw new Error(`Parent ${parentId} not found`)
  node.parent = parentId
  doc.nodes[node.id] = node
  const i = index === undefined || index < 0 || index > parent.children.length ? parent.children.length : index
  parent.children.splice(i, 0, node.id)
}

/** Remove node and its subtree. */
export function removeNode(doc: Doc, id: string): void {
  const n = doc.nodes[id]
  if (!n) return
  if (n.parent) {
    const p = doc.nodes[n.parent]
    if (p) p.children = p.children.filter((c) => c !== id)
  }
  for (const d of descendants(doc, id)) delete doc.nodes[d]
  delete doc.nodes[id]
}

export function applyStylePatch(style: Style, patch: StylePatch): void {
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === '') delete style[k]
    else style[k] = v
  }
}

/**
 * Move node under newParentId at index (index is in the parent's children list AFTER removal).
 * Keeps world position when the node is positioned both before and after the move.
 */
export function reparent(doc: Doc, id: string, newParentId: string, index?: number): void {
  const n = doc.nodes[id]
  const np = doc.nodes[newParentId]
  if (!n || !np) return
  if (id === newParentId || isAncestor(doc, id, newParentId)) throw new Error('Cannot move a node into itself')

  const before = worldRect(doc, id)
  if (n.parent) {
    const op = doc.nodes[n.parent]
    if (op) op.children = op.children.filter((c) => c !== id)
  }
  const i = index === undefined || index < 0 || index > np.children.length ? np.children.length : index
  np.children.splice(i, 0, id)
  n.parent = newParentId

  if (!isFlowChild(doc, id)) {
    const origin = containerOrigin(doc, newParentId)
    if (before && origin) {
      n.x = Math.round(before.x - origin.x)
      n.y = Math.round(before.y - origin.y)
    }
  }
}

/** Deep-clone subtree with fresh ids. Returns new root id (not inserted into a parent). */
export function cloneSubtree(doc: Doc, id: string): string {
  const src = doc.nodes[id]
  if (!src) throw new Error(`Node ${id} not found`)
  const copy: CNode = JSON.parse(JSON.stringify(src))
  copy.id = newId(doc)
  copy.parent = null
  copy.children = []
  delete copy.component // a copy of a main is a plain frame; a copy of an instance stays an instance
  doc.nodes[copy.id] = copy
  for (const c of src.children) {
    const cid = cloneSubtree(doc, c)
    doc.nodes[cid].parent = copy.id
    copy.children.push(cid)
  }
  return copy.id
}

/**
 * Duplicate a node next to itself (inserted right after it). Top-level nodes are offset to the
 * right by their width + 40 so the copy doesn't overlap.
 */
export function duplicate(doc: Doc, id: string): string {
  const src = doc.nodes[id]
  if (!src?.parent) throw new Error(`Cannot duplicate ${id}`)
  const cid = cloneSubtree(doc, id)
  const parent = doc.nodes[src.parent]
  const idx = parent.children.indexOf(id)
  parent.children.splice(idx + 1, 0, cid)
  const copy = doc.nodes[cid]
  copy.parent = src.parent
  if (isPageRoot(doc, src.parent)) {
    const w = worldRect(doc, id)?.width ?? numericSize(src.style.width) ?? 0
    copy.x = src.x + w + 40
  }
  return cid
}

const FLEX_KEYS = [
  'display',
  'flexDirection',
  'flexWrap',
  'gap',
  'rowGap',
  'columnGap',
  'alignItems',
  'justifyContent',
  'alignContent',
  'justifyItems',
  'gridTemplateColumns',
  'gridTemplateRows',
  'gridAutoFlow',
  'gridAutoRows',
  'gridAutoColumns'
]

/** Grid-item keys a child keeps only while its parent is a grid. */
const GRID_ITEM_KEYS = ['gridColumn', 'gridRow', 'gridArea', 'justifySelf']

/** Turn a frame into a flex container with the default settings. */
export function addFlex(doc: Doc, id: string): void {
  const n = doc.nodes[id]
  if (!n || n.type !== 'frame') return
  Object.assign(n.style, {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'start',
    gap: 16,
    padding: '16px',
    height: 'fit-content'
  })
}

/** Turn a frame into a grid: two equal columns by default (children flow into cells). */
export function addGrid(doc: Doc, id: string): void {
  const n = doc.nodes[id]
  if (!n || n.type !== 'frame') return
  for (const k of FLEX_KEYS) delete n.style[k]
  Object.assign(n.style, {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 16,
    padding: n.style.padding ?? '16px',
    alignItems: 'start',
    height: 'fit-content'
  })
  // children flow into cells; fixed widths would overflow narrow cells, so let them fill
  for (const c of n.children) {
    const child = doc.nodes[c]
    if (child && child.style.position !== 'absolute' && child.type !== 'text' && child.style.width === undefined) child.style.width = '100%'
  }
}

/** Switch a flow container between flex and grid, keeping gap, padding and children. */
export function switchLayout(doc: Doc, id: string, to: 'flex' | 'grid'): void {
  const n = doc.nodes[id]
  if (!n || n.type !== 'frame') return
  const keep = { gap: n.style.gap, padding: n.style.padding }
  if (to === 'grid') addGrid(doc, id)
  else {
    for (const k of FLEX_KEYS) delete n.style[k]
    for (const c of n.children) for (const k of GRID_ITEM_KEYS) delete doc.nodes[c]?.style[k]
    Object.assign(n.style, { display: 'flex', flexDirection: 'column', alignItems: 'start' })
  }
  if (keep.gap !== undefined) n.style.gap = keep.gap
  if (keep.padding !== undefined) n.style.padding = keep.padding
}

/**
 * Remove flex from a frame; children become absolutely positioned at their current
 * (measured if possible) offsets, or stacked vertically as a fallback.
 */
export function removeFlex(doc: Doc, id: string): void {
  const n = doc.nodes[id]
  if (!n) return
  const origin = worldRect(doc, id)
  const measured = n.children.map((c) => (resolver ? resolver(doc.id, c) : null))
  let cursorY = 0
  n.children.forEach((c, i) => {
    const child = doc.nodes[c]
    if (!child || child.style.position === 'absolute') return
    const r = measured[i]
    if (r && origin) {
      child.x = Math.round(r.x - origin.x)
      child.y = Math.round(r.y - origin.y)
    } else {
      child.x = 0
      child.y = cursorY
      cursorY += (numericSize(child.style.height) ?? 20) + 16
    }
  })
  for (const k of FLEX_KEYS) delete n.style[k]
  for (const c of n.children) for (const k of GRID_ITEM_KEYS) delete doc.nodes[c]?.style[k]
  delete n.style.padding
}

/**
 * Wrap nodes (same parent expected; others are moved into the wrapper too) in a new transparent
 * flex frame placed where the first node was. Returns wrapper id.
 */
export function wrapInFlex(doc: Doc, ids: string[]): string | null {
  const nodes = ids.map((i) => doc.nodes[i]).filter((n): n is CNode => Boolean(n?.parent))
  if (!nodes.length) return null
  const parentId = nodes[0].parent as string
  const parent = doc.nodes[parentId]
  const pairs = [...nodes]
    .sort((a, b) => parent.children.indexOf(a.id) - parent.children.indexOf(b.id))
    .map((n) => ({ n, r: worldRect(doc, n.id) }))
  // direction: spread more horizontally than vertically → row
  let direction: 'row' | 'column' = 'column'
  const known = pairs.map((p) => p.r).filter((r): r is WorldRect => Boolean(r))
  if (known.length > 1 && known.length === pairs.length) {
    const xs = known.map((r) => r.x)
    const ys = known.map((r) => r.y)
    if (Math.max(...xs) - Math.min(...xs) > Math.max(...ys) - Math.min(...ys)) direction = 'row'
    pairs.sort((a, b) => (direction === 'row' ? a.r!.x - b.r!.x : a.r!.y - b.r!.y))
  }
  const sorted = pairs.map((p) => p.n)

  const wrapper = makeNode(
    doc,
    {
      type: 'frame',
      name: 'Frame',
      style: {
        display: 'flex',
        flexDirection: direction,
        alignItems: 'start',
        gap: 16,
        width: 'fit-content',
        height: 'fit-content',
        boxSizing: 'border-box'
      }
    },
    false
  )
  const firstIndex = Math.min(...sorted.map((n) => parent.children.indexOf(n.id)).filter((i) => i >= 0))
  if (!isFlowChild(doc, sorted[0].id)) {
    const xs = sorted.map((n) => n.x)
    const ys = sorted.map((n) => n.y)
    wrapper.x = Math.min(...xs)
    wrapper.y = Math.min(...ys)
  }
  insertNode(doc, wrapper, parentId, firstIndex)
  for (const n of sorted) {
    const p = doc.nodes[n.parent as string]
    p.children = p.children.filter((c) => c !== n.id)
    n.parent = wrapper.id
    wrapper.children.push(n.id)
    if (n.style.position === 'absolute') delete n.style.position
  }
  return wrapper.id
}

/**
 * Wrap sibling nodes in a plain frame ("Frame" clips, "Group" doesn't) sized to `bounds` (world coords),
 * placed where the first node was. `rects` are the nodes' world rects, `origin` the parent's world origin.
 * Returns the wrapper id.
 */
export function wrapNodes(
  doc: Doc,
  ids: string[],
  kind: 'Frame' | 'Group',
  rects: Map<string, WorldRect | null>,
  bounds: WorldRect,
  origin: { x: number; y: number }
): string | null {
  const parentId = doc.nodes[ids[0]]?.parent
  const parent = parentId ? doc.nodes[parentId] : undefined
  if (!parent) return null
  const wrapper = makeNode(
    doc,
    {
      type: 'frame',
      name: kind,
      style: {
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
        boxSizing: 'border-box',
        ...(kind === 'Frame' ? { overflow: 'clip' } : {})
      }
    },
    false
  )
  wrapper.x = Math.round(bounds.x - origin.x)
  wrapper.y = Math.round(bounds.y - origin.y)
  insertNode(doc, wrapper, parent.id, Math.min(...ids.map((id) => parent.children.indexOf(id))))
  const inOrder = [...ids].sort((a, b) => parent.children.indexOf(a) - parent.children.indexOf(b))
  for (const id of inOrder) {
    const n = doc.nodes[id]
    const r = rects.get(id)
    parent.children = parent.children.filter((c) => c !== id)
    n.parent = wrapper.id
    wrapper.children.push(id)
    if (r) {
      n.x = Math.round(r.x - bounds.x)
      n.y = Math.round(r.y - bounds.y)
    }
    if (n.style.position === 'absolute') delete n.style.position
  }
  return wrapper.id
}

/** A frame with children and a parent: top-level frames can be dissolved, a page's root frame can't. */
export function canUngroup(doc: Doc, id: string): boolean {
  const n = doc.nodes[id]
  return Boolean(n && n.type === 'frame' && n.children.length > 0 && n.parent)
}

/**
 * Dissolve frames: children take the frame's place in its parent. In a flex/grid parent they join its
 * flow in order; elsewhere they keep their world position.
 * `rects` are the children's world rects, `origins` each frame's parent world origin.
 * Returns the freed child ids.
 */
export function ungroupNodes(
  doc: Doc,
  groupIds: string[],
  rects: Map<string, WorldRect | null>,
  origins: Map<string, { x: number; y: number }>
): string[] {
  const freed: string[] = []
  for (const g of groupIds) {
    if (!canUngroup(doc, g)) continue
    const group = doc.nodes[g]
    const parent = doc.nodes[group.parent as string]
    const origin = origins.get(g) ?? { x: 0, y: 0 }
    const kids = [...group.children]
    for (const c of kids) {
      const n = doc.nodes[c]
      const r = rects.get(c)
      n.parent = parent.id
      if (isFlowLayout(parent.style)) {
        // auto-layout parent: the children join its flow at the group's index, in order
        if (n.style.position === 'absolute') delete n.style.position
        n.x = 0
        n.y = 0
      } else if (r) {
        n.x = Math.round(r.x - origin.x)
        n.y = Math.round(r.y - origin.y)
      }
      freed.push(c)
    }
    parent.children.splice(parent.children.indexOf(g), 1, ...kids)
    group.children = []
    removeNode(doc, g)
  }
  return freed
}

/** Sort ids into document (tree) order. */
export function sortByTreeOrder(doc: Doc, ids: string[]): string[] {
  const order = new Map<string, number>()
  let i = 0
  const walk = (id: string): void => {
    order.set(id, i++)
    for (const c of doc.nodes[id]?.children ?? []) walk(c)
  }
  for (const p of doc.pages) walk(p.rootId)
  return [...ids].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
}

/** Drop ids whose ancestor is also in the list (so subtree ops don't double-apply). */
export function topmostOnly(doc: Doc, ids: string[]): string[] {
  const set = new Set(ids)
  return ids.filter((id) => !ancestors(doc, id).some((a) => set.has(a)))
}
