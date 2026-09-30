// Node / selection actions used by shortcuts, context menus and the toolbar. All take docId first.
import { activePage, getStore } from '../../model/store'
import * as ops from '../../model/ops'
import { nodeToHtml, nodeToJsx, styleToCss } from '../../model/html'
import type { CNode, Doc, Style, WorldRect } from '../../model/types'
import { centerOn, visibleWorldRect, zoomToRect } from './camera'
import { clientToWorld, intersects, measure, union } from './geometry'
import { containerAt } from './selection'
import { toast } from './toast'

// ------------------------------------------------------------------------------------------------
// helpers

const S = getStore
const docOf = (docId: string): Doc | undefined => S().docs[docId]
export const selectionOf = (docId: string): string[] => S().editors[docId]?.selection ?? []
export const rootOf = (docId: string): string => activePage(S(), docId)?.rootId ?? ''

function topSel(docId: string): string[] {
  const doc = docOf(docId)
  if (!doc) return []
  return ops.sortByTreeOrder(doc, ops.topmostOnly(doc, selectionOf(docId)).filter((id) => doc.nodes[id]?.parent))
}

/** World origin used for x/y of children of `parentId`. */
function originOf(docId: string, parentId: string): { x: number; y: number } {
  const doc = docOf(docId)
  if (!doc || ops.isPageRoot(doc, parentId)) return { x: 0, y: 0 }
  const r = measure(parentId, docId) ?? ops.worldRect(doc, parentId)
  return r ? { x: r.x, y: r.y } : { x: 0, y: 0 }
}

// ------------------------------------------------------------------------------------------------
// text editing registry (the rendered editor registers its commit function)

export const textEditing: {
  current: { id: string; commit: () => void } | null
  /** id of a text node created by the text tool that has not been committed yet */
  justCreated: string | null
} = { current: null, justCreated: null }

export function commitTextEditing(): void {
  textEditing.current?.commit()
}

export function startTextEditing(docId: string, id: string): void {
  S().select(docId, [id])
  S().setEditingText(docId, id)
}

// ------------------------------------------------------------------------------------------------
// selection

export function selectParent(docId: string): void {
  const doc = docOf(docId)
  if (!doc) return
  const parents = new Set<string>()
  for (const id of selectionOf(docId)) {
    const p = doc.nodes[id]?.parent
    if (p && !ops.isPageRoot(doc, p)) parents.add(p)
  }
  S().select(docId, [...parents])
}

export function selectChildren(docId: string): void {
  const doc = docOf(docId)
  if (!doc) return
  const kids = selectionOf(docId).flatMap((id) => doc.nodes[id]?.children ?? [])
  if (kids.length) S().select(docId, kids.filter((k) => !doc.nodes[k]?.locked))
}

export function selectAll(docId: string): void {
  const doc = docOf(docId)
  if (!doc) return
  const sel = selectionOf(docId)
  const parent = sel.length ? doc.nodes[sel[0]]?.parent : rootOf(docId)
  if (!parent) return
  S().select(docId, (doc.nodes[parent]?.children ?? []).filter((c) => !doc.nodes[c]?.locked))
}

export function selectSibling(docId: string, dir: 1 | -1): void {
  const doc = docOf(docId)
  const id = selectionOf(docId)[0]
  const p = id ? doc?.nodes[doc.nodes[id]?.parent ?? ''] : undefined
  if (!doc || !p) return
  const i = p.children.indexOf(id)
  const n = p.children.length
  S().select(docId, [p.children[(i + dir + n) % n]])
}

export function nextArtboard(docId: string, dir: 1 | -1): void {
  const doc = docOf(docId)
  if (!doc) return
  const boards = doc.nodes[rootOf(docId)]?.children ?? []
  if (!boards.length) return
  const cur = selectionOf(docId)[0]
  const top = cur ? ops.topLevelOf(doc, cur) : undefined
  const i = top ? boards.indexOf(top) : -1
  const next = boards[i < 0 ? (dir > 0 ? 0 : boards.length - 1) : (i + dir + boards.length) % boards.length]
  S().select(docId, [next])
  const r = measure(next, docId)
  if (r) zoomToRect(r, docId, { maxZoom: 1 })
}

// ------------------------------------------------------------------------------------------------
// basic edits

export function deleteSelection(docId: string): void {
  const sel = selectionOf(docId)
  if (sel.length) S().deleteNodes(docId, sel)
}

export function duplicateSelection(docId: string): void {
  const sel = topSel(docId)
  if (!sel.length) return
  const ids = S().duplicateNodes(docId, sel)
  if (ids.length) S().select(docId, ids)
}

export function toggleVisible(docId: string): void {
  const doc = docOf(docId)
  const sel = selectionOf(docId)
  if (!doc || !sel.length) return
  const show = sel.every((id) => doc.nodes[id]?.visible === false)
  S().mutate(docId, show ? 'Show' : 'Hide', (d) => {
    for (const id of sel) if (d.nodes[id]) d.nodes[id].visible = show
  })
}

export function toggleLocked(docId: string): void {
  const doc = docOf(docId)
  const sel = selectionOf(docId)
  if (!doc || !sel.length) return
  const lock = !sel.every((id) => doc.nodes[id]?.locked)
  S().mutate(docId, lock ? 'Lock' : 'Unlock', (d) => {
    for (const id of sel) if (d.nodes[id]) d.nodes[id].locked = lock
  })
}

export function toggleClip(docId: string): void {
  const doc = docOf(docId)
  const sel = selectionOf(docId).filter((id) => doc?.nodes[id]?.type === 'frame')
  if (!doc || !sel.length) return
  const clipped = sel.every((id) => doc.nodes[id].style.overflow === 'clip' || doc.nodes[id].style.overflow === 'hidden')
  S().updateStyles(docId, sel, { overflow: clipped ? null : 'clip' })
}

export type ZOrder = 'front' | 'back' | 'forward' | 'backward'

export function reorder(docId: string, how: ZOrder): void {
  const sel = topSel(docId)
  if (!sel.length) return
  const label = { front: 'Bring to front', back: 'Send to back', forward: 'Move forward', backward: 'Move backward' }[how]
  S().mutate(docId, label, (d) => {
    const byParent = new Map<string, string[]>()
    for (const id of sel) {
      const p = d.nodes[id]?.parent
      if (p) byParent.set(p, [...(byParent.get(p) ?? []), id])
    }
    for (const [pid, ids] of byParent) {
      const p = d.nodes[pid]
      const set = new Set(ids)
      let kids = [...p.children]
      if (how === 'front') kids = [...kids.filter((k) => !set.has(k)), ...kids.filter((k) => set.has(k))]
      else if (how === 'back') kids = [...kids.filter((k) => set.has(k)), ...kids.filter((k) => !set.has(k))]
      else if (how === 'forward') {
        for (let i = kids.length - 2; i >= 0; i--) {
          if (set.has(kids[i]) && !set.has(kids[i + 1])) [kids[i], kids[i + 1]] = [kids[i + 1], kids[i]]
        }
      } else {
        for (let i = 1; i < kids.length; i++) {
          if (set.has(kids[i]) && !set.has(kids[i - 1])) [kids[i], kids[i - 1]] = [kids[i - 1], kids[i]]
        }
      }
      p.children = kids
    }
  })
}

/** Arrow-key nudge: positioned nodes move by (dx, dy); flow children reorder along the flex axis. */
export function nudge(docId: string, dx: number, dy: number): void {
  const doc = docOf(docId)
  const sel = topSel(docId).filter((id) => !doc?.nodes[id]?.locked)
  if (!doc || !sel.length) return
  S().mutate(
    docId,
    'Nudge',
    (d) => {
      for (const id of sel) {
        const n = d.nodes[id]
        if (!n) continue
        if (ops.isFlowChild(d, id)) {
          const p = d.nodes[n.parent as string]
          const row = String(p.style.flexDirection ?? 'row').startsWith('row') && p.style.display !== 'grid'
          const step = row ? Math.sign(dx) : Math.sign(dy)
          if (!step) continue
          const i = p.children.indexOf(id)
          const j = Math.max(0, Math.min(p.children.length - 1, i + step))
          if (i === j) continue
          p.children.splice(i, 1)
          p.children.splice(j, 0, id)
        } else {
          ops.detachAnchors(d, id)
          n.x += dx
          n.y += dy
        }
      }
    },
    { coalesce: 'nudge:' + sel.join(',') }
  )
}

// ------------------------------------------------------------------------------------------------
// structure

export function wrapOrAddFlex(docId: string): void {
  const doc = docOf(docId)
  const sel = topSel(docId)
  if (!doc || !sel.length) return
  const one = sel.length === 1 ? doc.nodes[sel[0]] : undefined
  if (one && one.type === 'frame' && !ops.isFlowLayout(one.style)) {
    S().addFlex(docId, one.id)
    return
  }
  const w = S().wrapInFlex(docId, sel)
  if (w) S().select(docId, [w])
}

/** Frame selection (Shift+F): wrap in a plain (non-flex) frame sized to the selection bounds. */
export function frameSelection(docId: string): void {
  const doc = docOf(docId)
  const all = topSel(docId)
  if (!doc || !all.length) return
  const parentId = doc.nodes[all[0]].parent as string
  const ids = all.filter((id) => doc.nodes[id].parent === parentId)
  const rects = new Map(ids.map((id) => [id, measure(id, docId) ?? ops.worldRect(doc, id)]))
  const bounds = union([...rects.values()])
  if (!bounds) return
  const origin = originOf(docId, parentId)
  let wrapperId = ''
  S().mutate(docId, 'Frame selection', (d) => {
    const parent = d.nodes[parentId]
    const wrapper = ops.makeNode(
      d,
      {
        type: 'frame',
        name: 'Frame',
        style: { width: Math.round(bounds.width), height: Math.round(bounds.height), boxSizing: 'border-box', overflow: 'clip' }
      },
      false
    )
    wrapperId = wrapper.id
    wrapper.x = Math.round(bounds.x - origin.x)
    wrapper.y = Math.round(bounds.y - origin.y)
    const index = Math.min(...ids.map((id) => parent.children.indexOf(id)))
    ops.insertNode(d, wrapper, parentId, index)
    for (const id of ids) {
      const n = d.nodes[id]
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
  })
  if (wrapperId) S().select(docId, [wrapperId])
}

// ------------------------------------------------------------------------------------------------
// clipboard

interface Clip {
  docId: string
  nodes: Record<string, CNode>
  roots: string[]
  rects: Record<string, WorldRect | null>
  plain: string
}

let clip: Clip | null = null
let styleClip: Style | null = null

function collect(doc: Doc, ids: string[]): Record<string, CNode> {
  const out: Record<string, CNode> = {}
  for (const id of ids) for (const n of [id, ...ops.descendants(doc, id)]) out[n] = JSON.parse(JSON.stringify(doc.nodes[n]))
  return out
}

async function writeSystemClipboard(html: string, plain: string): Promise<void> {
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' })
      })
    ])
  } catch {
    try {
      await navigator.clipboard.writeText(plain)
    } catch {
      /* internal clipboard still works */
    }
  }
}

export async function writeText(text: string, notice?: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    if (notice) toast(notice)
  } catch {
    toast('Could not access the clipboard')
  }
}

export async function copySelection(docId: string): Promise<void> {
  const doc = docOf(docId)
  const sel = topSel(docId)
  if (!doc || !sel.length) return
  const html = sel.map((id) => nodeToHtml(doc, id)).join('\n')
  clip = {
    docId,
    nodes: collect(doc, sel),
    roots: sel,
    rects: Object.fromEntries(sel.map((id) => [id, measure(id, docId)])),
    plain: html
  }
  await writeSystemClipboard(html, html)
}

export async function cutSelection(docId: string): Promise<void> {
  await copySelection(docId)
  deleteSelection(docId)
}

function cloneFromClip(d: Doc, nodes: Record<string, CNode>, id: string): string {
  const src = nodes[id]
  const copy: CNode = JSON.parse(JSON.stringify(src))
  copy.id = ops.newId(d)
  copy.parent = null
  copy.children = []
  d.nodes[copy.id] = copy
  for (const c of src.children) {
    if (!nodes[c]) continue
    const cid = cloneFromClip(d, nodes, c)
    d.nodes[cid].parent = copy.id
    copy.children.push(cid)
  }
  return copy.id
}

export type PasteMode = 'normal' | 'onTop' | 'replace'

interface PasteTarget {
  parentId: string
  index?: number
  replace?: string
}

function pasteTarget(docId: string, mode: PasteMode, sourceIds: string[] = []): PasteTarget {
  const doc = docOf(docId)
  const root = rootOf(docId)
  const sel = topSel(docId)
  if (!doc) return { parentId: root }
  if (mode === 'replace' && sel.length) {
    const n = doc.nodes[sel[0]]
    return { parentId: n.parent as string, index: ops.indexInParent(doc, n.id), replace: n.id }
  }
  if (mode === 'onTop') {
    const src = sourceIds.find((id) => doc.nodes[id]?.parent)
    if (src) return { parentId: doc.nodes[src].parent as string, index: ops.indexInParent(doc, src) + 1 }
  }
  if (sel.length === 1) {
    const n = doc.nodes[sel[0]]
    if (n.type === 'frame' && !sourceIds.includes(n.id)) return { parentId: n.id }
  }
  if (sel.length) {
    const last = sel[sel.length - 1]
    return { parentId: doc.nodes[last].parent as string, index: ops.indexInParent(doc, last) + 1 }
  }
  return { parentId: root }
}

/** After inserting roots under a target, fix their positions per paste mode. */
function placeRoots(
  docId: string,
  d: Doc,
  roots: string[],
  target: PasteTarget,
  mode: PasteMode,
  orig: Array<WorldRect | null>,
  replaceRect: WorldRect | null
): void {
  const isRoot = ops.isPageRoot(d, target.parentId)
  const parentFlow = !isRoot && ops.isFlowLayout(d.nodes[target.parentId]?.style)
  if (parentFlow) return
  const origin = isRoot ? { x: 0, y: 0 } : originOf(docId, target.parentId)
  // world rects of the pasted content before placement
  const rects = roots.map((id, i) => {
    const n = d.nodes[id]
    const w = ops.numericSize(n.style.width) ?? orig[i]?.width ?? 0
    const h = ops.numericSize(n.style.height) ?? orig[i]?.height ?? 0
    const o = orig[i]
    return o ? { x: o.x, y: o.y, width: o.width || w, height: o.height || h } : { x: origin.x + n.x, y: origin.y + n.y, width: w, height: h }
  })
  const bounds = union(rects)
  if (!bounds) return
  let dx = 0
  let dy = 0
  if (mode === 'replace' && replaceRect) {
    dx = replaceRect.x - bounds.x
    dy = replaceRect.y - bounds.y
  } else if (mode === 'onTop') {
    dx = 0
    dy = 0
  } else if (isRoot) {
    const vis = visibleWorldRect(docId)
    const sourcesVisible = orig.some(Boolean) && vis && intersects(vis, bounds)
    if (sourcesVisible) {
      dx = bounds.width + 40
    } else if (vis) {
      dx = vis.x + vis.width / 2 - (bounds.x + bounds.width / 2)
      dy = vis.y + vis.height / 2 - (bounds.y + bounds.height / 2)
    }
  } else {
    // inside a positioned frame: keep original offsets relative to the new parent, if we have them
    roots.forEach((id) => {
      const n = d.nodes[id]
      n.x = Math.round(n.x)
      n.y = Math.round(n.y)
    })
    return
  }
  roots.forEach((id, i) => {
    const n = d.nodes[id]
    n.x = Math.round(rects[i].x + dx - origin.x)
    n.y = Math.round(rects[i].y + dy - origin.y)
  })
}

async function readSystemClipboard(): Promise<{ html?: string; text?: string; image?: Blob }> {
  const out: { html?: string; text?: string; image?: Blob } = {}
  try {
    const items = await navigator.clipboard.read()
    for (const item of items) {
      for (const type of item.types) {
        if (type === 'text/html' && out.html === undefined) out.html = await (await item.getType(type)).text()
        else if (type === 'text/plain' && out.text === undefined) out.text = await (await item.getType(type)).text()
        else if (type.startsWith('image/') && !out.image) out.image = await item.getType(type)
      }
    }
  } catch {
    try {
      out.text = await navigator.clipboard.readText()
    } catch {
      /* no access */
    }
  }
  return out
}

const blobToDataUrl = (b: Blob): Promise<string> =>
  new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = () => rej(r.error)
    r.readAsDataURL(b)
  })

/** HTML that is just an image wrapper (what browsers put next to the bitmap on "Copy image"). */
const isImageOnlyHtml = (html: string): boolean =>
  /<img[\s>]/i.test(html) &&
  html
    .replace(/<(img|meta|br|\/?(html|body|head|span|div|p|a|picture|source))\b[^>]*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim() === ''

export async function paste(docId: string, mode: PasteMode = 'normal'): Promise<void> {
  const [sys, media] = await Promise.all([
    readSystemClipboard(),
    window.canvasApi?.readClipboardMedia?.().catch(() => undefined) ?? Promise.resolve(undefined)
  ])
  const norm = (t: string | undefined): string => (t ?? '').replace(/\s+/g, '')
  const hasMedia = !!(media?.image || media?.files.length || sys.image)
  const sysEmpty = sys.text === undefined && sys.html === undefined && !hasMedia
  // our own copy is still on the clipboard when its text matches (or the clipboard couldn't be read)
  const useInternal =
    clip && (sysEmpty || (!!clip.plain && (norm(sys.text) === norm(clip.plain) || norm(sys.html).includes(norm(clip.plain)))))
  if (useInternal && clip) {
    pasteInternal(docId, clip, mode)
    return
  }
  // image files copied in File Explorer
  if (media?.files.length) {
    await insertMedia(docId, media.files.map((f) => ({ name: f.name, src: f.dataUrl, svg: f.svg })), { mode })
    return
  }
  // a bitmap: screenshots, "Copy image" in a browser or another app
  const bitmap = media?.image ?? (sys.image ? await blobToDataUrl(sys.image) : undefined)
  if (bitmap && (!sys.html || isImageOnlyHtml(sys.html))) {
    await insertMedia(docId, [{ name: 'Image', src: bitmap }], { mode })
    return
  }
  const html = sys.html ?? (sys.text && /^\s*</.test(sys.text) ? sys.text : undefined)
  if (html) {
    if (/^\s*<svg[\s>]/i.test(html)) {
      insertSvgMarkup(docId, html)
      return
    }
    pasteExternal(docId, mode, (parentId, index) => S().insertHtml(docId, parentId, html, index))
    return
  }
  if (sys.text) {
    const text = sys.text
    pasteExternal(docId, mode, (parentId, index) => [S().createNode(docId, { type: 'text', text }, parentId, index)])
  }
}

function pasteInternal(docId: string, c: Clip, mode: PasteMode): void {
  const doc = docOf(docId)
  if (!doc) return
  const target = pasteTarget(docId, mode, c.docId === docId ? c.roots : [])
  const replaceRect = target.replace ? measure(target.replace, docId) : null
  let roots: string[] = []
  S().transact(docId, 'Paste', () => {
    S().mutate(docId, 'Paste', (d) => {
      const parent = d.nodes[target.parentId]
      if (!parent) return
      let i = target.index ?? parent.children.length
      roots = c.roots.map((r) => {
        const id = cloneFromClip(d, c.nodes, r)
        d.nodes[id].parent = target.parentId
        parent.children.splice(i++, 0, id)
        return id
      })
      placeRoots(docId, d, roots, target, mode, c.roots.map((r) => c.rects[r] ?? null), replaceRect)
    })
    if (target.replace) S().deleteNodes(docId, [target.replace])
  })
  if (roots.length) S().select(docId, roots)
}

function pasteExternal(docId: string, mode: PasteMode, insert: (parentId: string, index?: number) => string[]): void {
  const target = pasteTarget(docId, mode)
  const replaceRect = target.replace ? measure(target.replace, docId) : null
  let roots: string[] = []
  S().transact(docId, 'Paste', () => {
    roots = insert(target.parentId, target.index)
    S().mutate(docId, 'Place', (d) => placeRoots(docId, d, roots, target, mode === 'onTop' ? 'normal' : mode, roots.map(() => null), replaceRect))
    if (target.replace) S().deleteNodes(docId, [target.replace])
  })
  if (roots.length) S().select(docId, roots)
}

const LAYOUT_KEYS = new Set(['width', 'height', 'left', 'top', 'right', 'bottom', 'position', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight'])

export function copyStyles(docId: string): void {
  const doc = docOf(docId)
  const id = selectionOf(docId)[0]
  if (!doc || !id) return
  styleClip = Object.fromEntries(Object.entries(doc.nodes[id].style).filter(([k]) => !LAYOUT_KEYS.has(k)))
  void writeText(styleToCss(styleClip).replace(/; /g, ';\n') + ';', 'Copied styles')
}

export const hasStyleClip = (): boolean => styleClip !== null

export function pasteStyles(docId: string): void {
  const sel = selectionOf(docId)
  if (!styleClip || !sel.length) return
  const sc = styleClip
  S().mutate(docId, 'Paste styles', (d) => {
    for (const id of sel) {
      const n = d.nodes[id]
      if (!n) continue
      const keep = Object.fromEntries(Object.entries(n.style).filter(([k]) => LAYOUT_KEYS.has(k)))
      n.style = { ...keep, ...sc }
    }
  })
}

export function copyAs(docId: string, format: 'html' | 'jsx' | 'css'): void {
  const doc = docOf(docId)
  const sel = topSel(docId)
  if (!doc || !sel.length) return
  let text = ''
  if (format === 'html') text = sel.map((id) => nodeToHtml(doc, id)).join('\n')
  else if (format === 'jsx') text = sel.map((id) => nodeToJsx(doc, id, 'inline-styles')).join('\n')
  else text = sel.map((id) => styleToCss(doc.nodes[id].style).replace(/; /g, ';\n') + ';').join('\n\n')
  void writeText(text, `Copied as ${format.toUpperCase()}`)
}

export function copyLink(docId: string): void {
  const id = selectionOf(docId)[0]
  if (id) void writeText(`canvas://file/${docId}?node=${id}`, 'Copied link')
}

// ------------------------------------------------------------------------------------------------
// creation helpers (toolbar)

/** Parent for inserting new content from the toolbar: the selected frame, else the page. */
function insertParent(docId: string): string {
  const doc = docOf(docId)
  const sel = selectionOf(docId)
  if (doc && sel.length === 1 && doc.nodes[sel[0]]?.type === 'frame') return sel[0]
  return rootOf(docId)
}

function centerTopLevel(docId: string, d: Doc, ids: string[], sizes: Array<{ w: number; h: number }>): void {
  const vis = visibleWorldRect(docId)
  if (!vis) return
  ids.forEach((id, i) => {
    const n = d.nodes[id]
    if (!n || !ops.isTopLevel(d, id)) return
    n.x = Math.round(vis.x + vis.width / 2 - sizes[i].w / 2)
    n.y = Math.round(vis.y + vis.height / 2 - sizes[i].h / 2)
  })
}

const loadImageSize = (src: string): Promise<{ w: number; h: number }> =>
  new Promise((res) => {
    const img = new Image()
    img.onload = () => res({ w: img.naturalWidth || 200, h: img.naturalHeight || 200 })
    img.onerror = () => res({ w: 200, h: 200 })
    img.src = src
  })

export interface MediaItem {
  name: string
  /** image URL (data: or http[s]:) */
  src?: string
  /** SVG markup */
  svg?: string
}

/**
 * Insert images/SVGs. With `at` (client coordinates, e.g. a drop point) they go into the frame under
 * that point — appended when it's a flex frame, positioned at the point otherwise — or onto the page
 * centred on the point. Without `at` they go into the selected frame / the visible area.
 * Several items are laid out side by side with a 40px gap.
 */
export async function insertMedia(
  docId: string,
  items: MediaItem[],
  opts: { mode?: PasteMode; at?: { clientX: number; clientY: number } } = {}
): Promise<string[]> {
  const doc = docOf(docId)
  if (!doc || !items.length) return []
  const sized = await Promise.all(
    items.map(async (it) => {
      if (it.svg) return { it, w: 0, h: 0 }
      let { w, h } = await loadImageSize(it.src ?? '')
      const max = 800
      if (w > max || h > max) {
        const k = max / Math.max(w, h)
        w = Math.round(w * k)
        h = Math.round(h * k)
      }
      return { it, w, h }
    })
  )
  const at = opts.at
  const parentId = at
    ? containerAt(docId, at.clientX, at.clientY)
    : opts.mode && opts.mode !== 'normal'
      ? rootOf(docId)
      : insertParent(docId)
  const created: string[] = []
  S().transact(docId, items.length > 1 ? 'Insert images' : 'Insert image', () => {
    for (const { it, w, h } of sized) {
      if (it.svg) {
        const m = it.svg.replace(/^[\s\S]*?(?=<svg[\s>])/i, '')
        if (/<svg[\s>]/i.test(m)) created.push(...S().insertHtml(docId, parentId, m))
      } else if (it.src) {
        created.push(
          S().createNode(
            docId,
            { type: 'image', name: it.name, attrs: { src: it.src, alt: it.name }, style: { width: w, height: h, objectFit: 'cover' } },
            parentId
          )
        )
      }
    }
    S().mutate(docId, 'Place', (d) => {
      const sizes = created.map((id) => {
        const st = d.nodes[id]?.style
        return { w: ops.numericSize(st?.width) ?? 24, h: ops.numericSize(st?.height) ?? 24 }
      })
      if (!at) {
        // side by side, centred in the visible area as a group
        const total = sizes.reduce((t, z) => t + z.w, 0) + 40 * (sizes.length - 1)
        const vis = visibleWorldRect(docId)
        if (!vis) return
        let x = vis.x + vis.width / 2 - total / 2
        created.forEach((id, i) => {
          const n = d.nodes[id]
          if (n && ops.isTopLevel(d, id)) {
            n.x = Math.round(x)
            n.y = Math.round(vis.y + vis.height / 2 - sizes[i].h / 2)
          }
          x += sizes[i].w + 40
        })
        return
      }
      const parent = d.nodes[parentId]
      if (parent && parent.type === 'frame' && ops.isFlex(parent)) return // flex lays them out
      const p = clientToWorld(at.clientX, at.clientY, docId)
      const origin = parent && parent.type === 'frame' ? measure(parentId, docId) : null
      let x = p.x - (origin?.x ?? 0) - sizes[0].w / 2
      created.forEach((id, i) => {
        const n = d.nodes[id]
        if (!n) return
        n.x = Math.round(x)
        n.y = Math.round(p.y - (origin?.y ?? 0) - sizes[i].h / 2)
        x += sizes[i].w + 40
      })
    })
  })
  if (created.length) S().select(docId, created)
  return created
}

export async function insertImage(docId: string, src: string, name: string, mode: PasteMode = 'normal'): Promise<void> {
  await insertMedia(docId, [{ name, src }], { mode })
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|avif|ico|svg)$/i

/** Files / images dropped onto the canvas (from File Explorer or a browser). Returns true when handled. */
export async function dropMedia(docId: string, dt: DataTransfer, clientX: number, clientY: number): Promise<boolean> {
  const files = [...dt.files].filter((f) => f.type.startsWith('image/') || IMAGE_EXT.test(f.name))
  const items: MediaItem[] = []
  for (const f of files) {
    const name = f.name.replace(/\.[^.]+$/, '') || 'Image'
    if (f.type === 'image/svg+xml' || /\.svg$/i.test(f.name)) items.push({ name, svg: await f.text() })
    else items.push({ name, src: await blobToDataUrl(f) })
  }
  if (!items.length) {
    // an image dragged out of a web page: use its URL
    const html = dt.getData('text/html')
    const fromHtml = /<img[^>]+src="([^"]+)"/i.exec(html)?.[1]?.replace(/&amp;/g, '&')
    const uri = dt
      .getData('text/uri-list')
      .split(/\r?\n/)
      .find((l) => l && !l.startsWith('#'))
    const src = fromHtml ?? uri
    if (src && /^(https?:|data:image\/)/i.test(src)) {
      const file = decodeURIComponent(src.split(/[?#]/)[0].split('/').pop() ?? '').replace(/\.[^.]+$/, '')
      items.push({ name: src.startsWith('data:') || !file ? 'Image' : file, src })
    }
  }
  if (!items.length) return false
  await insertMedia(docId, items, { at: { clientX, clientY } })
  return true
}

/** Opens a file picker and inserts the chosen image as a data URL. */
export function createImageFromFile(docId: string): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.onchange = async () => {
    const f = input.files?.[0]
    if (!f) return
    const src = await blobToDataUrl(f)
    await insertImage(docId, src, f.name.replace(/\.[^.]+$/, '') || 'Image')
  }
  input.click()
}

/** Insert SVG markup (from the Create SVG dialog). */
export function insertSvgMarkup(docId: string, markup: string): boolean {
  const m = markup.trim()
  if (!/<svg[\s>]/i.test(m)) {
    toast('Paste SVG markup starting with <svg')
    return false
  }
  const parentId = insertParent(docId)
  let ids: string[] = []
  S().transact(docId, 'Create SVG', () => {
    ids = S().insertHtml(docId, parentId, m)
    S().mutate(docId, 'Place', (d) =>
      centerTopLevel(
        docId,
        d,
        ids,
        ids.map((id) => ({ w: ops.numericSize(d.nodes[id]?.style.width) ?? 24, h: ops.numericSize(d.nodes[id]?.style.height) ?? 24 }))
      )
    )
  })
  if (ids.length) S().select(docId, ids)
  return ids.length > 0
}

// ------------------------------------------------------------------------------------------------
// UI

export function toggleHideUI(): void {
  document.body.classList.toggle('cv-hide-ui')
}

export function revealSelection(docId: string): void {
  const r = union(selectionOf(docId).map((id) => measure(id, docId)))
  const vis = visibleWorldRect(docId)
  if (r && vis && !intersects(r, vis)) centerOn(r, docId)
}
