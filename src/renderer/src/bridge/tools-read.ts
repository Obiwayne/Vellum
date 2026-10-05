// MCP tools: read-only inspection (selection, children, node info, tree summary, find, computed styles).
import { getStore } from '../model/store'
import { descendants, isPageRoot } from '../model/ops'
import { computeNodeStyle, toCamel } from '../model/html'
import type { CNode, Doc } from '../model/types'
import { componentInfo } from './tools-components'
import {
  arr,
  artboardOf,
  componentName,
  geometry,
  getDoc,
  registerHandler,
  requireNode,
  resolveDocId,
  scoped,
  str
} from './registry'

registerHandler('get_selection', (args) => {
  const docId = resolveDocId(args)
  const doc = getDoc(docId)
  const sel = (getStore().editors[docId]?.selection ?? []).filter((id) => doc.nodes[id])
  const selectedNodes = sel.map((id) => {
    const n = doc.nodes[id]
    const g = geometry(doc, id)
    const ab = artboardOf(doc, id)
    return {
      id,
      name: n.name,
      component: componentName(n),
      width: g.width,
      height: g.height,
      worldX: g.worldX,
      worldY: g.worldY,
      x: g.x,
      y: g.y,
      artboardId: ab,
      artboardName: ab ? doc.nodes[ab]?.name ?? null : null,
      parentId: n.parent,
      childCount: n.children.length,
      ...componentInfo(doc, n),
      ...(n.type === 'text' ? { textContent: n.text ?? '' } : {})
    }
  })
  return scoped(docId, { selectedNodes, count: selectedNodes.length })
})

registerHandler('get_children', (args) => {
  const docId = resolveDocId(args)
  const doc = getDoc(docId)
  const n = requireNode(doc, args.nodeId)
  const children = n.children
    .filter((c) => doc.nodes[c])
    .map((c) => {
      const k = doc.nodes[c]
      const g = geometry(doc, c)
      return {
        id: c,
        name: k.name,
        component: componentName(k),
        childCount: k.children.length,
        width: g.width,
        height: g.height,
        worldX: g.worldX,
        worldY: g.worldY,
        x: g.x,
        y: g.y,
        ...componentInfo(doc, k),
        ...(k.visible ? {} : { isVisible: false })
      }
    })
  return scoped(docId, { children, count: children.length })
})

registerHandler('get_node_info', (args) => {
  const docId = resolveDocId(args)
  const doc = getDoc(docId)
  const n = requireNode(doc, args.nodeId)
  const g = geometry(doc, n.id)
  return scoped(docId, {
    id: n.id,
    name: n.name,
    component: isPageRoot(doc, n.id) ? 'Root' : componentName(n),
    width: g.width,
    height: g.height,
    worldX: g.worldX,
    worldY: g.worldY,
    x: g.x,
    y: g.y,
    isVisible: n.visible,
    isLocked: n.locked,
    parentId: n.parent,
    childIds: [...n.children],
    childCount: n.children.length,
    artboardId: artboardOf(doc, n.id),
    textContent: n.type === 'text' ? n.text ?? '' : null,
    ...componentInfo(doc, n, true),
    ...(n.type === 'image' ? { src: n.attrs?.src ?? null } : {})
  })
})

// ------------------------------------------------------------------------------------------------
// tree summary

const fmt = (v: number | null): string => (v === null ? '?' : String(Math.round(v)))

function preview(t: string, max = 40): string {
  const s = t.replace(/\s+/g, ' ').trim()
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

export function treeSummary(doc: Doc, id: string, maxDepth: number): string {
  const lines: string[] = []
  const walk = (nid: string, depth: number): void => {
    const n = doc.nodes[nid]
    if (!n) return
    const g = geometry(doc, nid)
    let line = `${'  '.repeat(depth)}${isPageRoot(doc, nid) ? 'Page' : componentName(n)} "${n.name}" (${nid})`
    if (!isPageRoot(doc, nid)) line += ` ${fmt(g.width)}×${fmt(g.height)}`
    if (n.type === 'text') line += ` "${preview(n.text ?? '')}"`
    if (!n.visible) line += ' [hidden]'
    if (n.locked) line += ' [locked]'
    const kids = n.children.filter((c) => doc.nodes[c])
    if (kids.length && depth >= maxDepth) line += ` … ${kids.length} ${kids.length === 1 ? 'child' : 'children'}`
    lines.push(line)
    if (depth < maxDepth) for (const c of kids) walk(c, depth + 1)
  }
  walk(id, 0)
  return lines.join('\n')
}

registerHandler('get_tree_summary', (args) => {
  const docId = resolveDocId(args)
  const doc = getDoc(docId)
  const n = requireNode(doc, args.nodeId)
  const depth = Math.max(0, Math.min(10, typeof args.depth === 'number' ? Math.floor(args.depth) : 3))
  return scoped(docId, { summary: treeSummary(doc, n.id, depth), nodeId: n.id, depth })
})

// ------------------------------------------------------------------------------------------------
// find_nodes

function wildcard(pattern: string, anchored: boolean): RegExp {
  const esc = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(anchored ? `^${esc}$` : esc, 'i')
}

let colorCtx: CanvasRenderingContext2D | null = null
/** Normalise any CSS colour to the browser's canonical form, or null when it isn't a colour. */
function normColor(v: string): string | null {
  colorCtx ??= document.createElement('canvas').getContext('2d')
  if (!colorCtx) return null
  colorCtx.fillStyle = '#010203'
  colorCtx.fillStyle = v
  const a = String(colorCtx.fillStyle)
  if (a !== '#010203') return a
  colorCtx.fillStyle = '#030201'
  colorCtx.fillStyle = v
  return String(colorCtx.fillStyle) === '#030201' ? null : a
}

const TYPE_ALIASES: Record<string, string> = {
  frame: 'frame',
  text: 'text',
  image: 'image',
  img: 'image',
  svg: 'svg',
  rect: 'rect',
  rectangle: 'rect'
}

interface Match {
  styleName?: string
  styleValue?: string
  textValue?: string
  name?: string
}

function matchFilter(doc: Doc, n: CNode, f: { styleName?: string; styleValue?: string }): Match[] {
  const out: Match[] = []
  const tokens = new Map(doc.tokens.map((t) => [t.name, t.value]))
  const nameRe = f.styleName ? wildcard(toCamel(f.styleName.trim()).replace(/^-+/, ''), true) : null
  const nameReKebab = f.styleName ? wildcard(f.styleName.trim(), true) : null
  let want = f.styleValue?.trim()
  if (want && /^--[\w-]+$/.test(want)) want = `var(${want})`
  const wantColor = want && !want.includes('*') && !want.startsWith('var(') ? normColor(want) : null
  const valueRe = want ? wildcard(want, true) : null
  for (const [k, raw] of Object.entries(n.style)) {
    if (nameRe && !nameRe.test(k) && !(nameReKebab && nameReKebab.test(k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())))) continue
    const v = typeof raw === 'number' ? (['opacity', 'fontWeight', 'lineHeight', 'flexGrow', 'flexShrink', 'zIndex'].includes(k) ? String(raw) : `${raw}px`) : raw
    if (!want) {
      out.push({ styleName: k, styleValue: v })
      continue
    }
    if (valueRe?.test(v) || valueRe?.test(String(raw))) {
      out.push({ styleName: k, styleValue: v })
      continue
    }
    // tokens and colours inside composite values (gradients, borders, shadows)
    if (want.startsWith('var(') && v.includes(want.slice(0, -1))) {
      out.push({ styleName: k, styleValue: want })
      continue
    }
    if (wantColor) {
      const refs = v.match(/var\(--[\w-]+\)/g) ?? []
      const ref = refs.find((r) => {
        const tv = tokens.get(r.slice(4, -1))
        return tv !== undefined && normColor(tv) === wantColor
      })
      if (ref) {
        out.push({ styleName: k, styleValue: ref })
        continue
      }
      const parts = v.match(/#[0-9a-fA-F]{3,8}\b|(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color)\([^)]*\)|\b[a-z]+\b/g) ?? []
      const hit = parts.find((p) => normColor(p) === wantColor)
      if (hit) out.push({ styleName: k, styleValue: hit })
    }
  }
  return out
}

registerHandler('find_nodes', (args) => {
  const docId = resolveDocId(args)
  const doc = getDoc(docId)
  let scope: string[]
  const nodeId = str(args.nodeId)
  const pageId = str(args.pageId)
  if (nodeId) {
    requireNode(doc, nodeId)
    scope = [nodeId, ...descendants(doc, nodeId)]
  } else if (pageId) {
    const p = doc.pages.find((x) => x.id === pageId)
    if (!p) throw new Error(`Page ${pageId} not found`)
    scope = descendants(doc, p.rootId)
  } else {
    scope = doc.pages.flatMap((p) => descendants(doc, p.rootId))
  }
  const q = str(args.query) ?? str(args.name)
  const qRe = q ? (q.includes('*') ? wildcard(q, true) : wildcard(q, false)) : null
  const typeArg = str(args.type)?.toLowerCase()
  const type = typeArg ? TYPE_ALIASES[typeArg] ?? typeArg : undefined
  const textValue = str(args.textValue)
  const textRe = textValue ? wildcard(textValue, true) : null
  const filters = arr<{ styleName?: string; styleValue?: string }>(args.filters)
  if (!qRe && !type && !textRe && !filters.length) throw new Error('Pass at least one of query/name, type, textValue or filters')

  const pageOfRoot = new Map(doc.pages.map((p) => [p.rootId, p.id]))
  const pageFor = (id: string): string | undefined => {
    let cur: string | null = id
    while (cur) {
      const pid = pageOfRoot.get(cur)
      if (pid) return pid
      cur = doc.nodes[cur]?.parent ?? null
    }
    return undefined
  }

  const results: unknown[] = []
  let total = 0
  for (const id of scope) {
    const n = doc.nodes[id]
    if (!n || isPageRoot(doc, id)) continue
    const matched: Match[] = []
    if (type && n.type !== type) continue
    if (qRe) {
      if (!qRe.test(n.name)) continue
      matched.push({ name: n.name })
    }
    if (textRe) {
      if (n.type !== 'text' || !textRe.test(n.text ?? '')) continue
      matched.push({ textValue: n.text ?? '' })
    }
    let ok = true
    for (const f of filters) {
      const m = matchFilter(doc, n, f)
      if (!m.length) {
        ok = false
        break
      }
      matched.push(...m)
    }
    if (!ok) continue
    total++
    if (results.length < 200) {
      results.push({
        id,
        name: n.name,
        component: componentName(n),
        pageId: pageFor(id),
        artboardId: artboardOf(doc, id),
        ...componentInfo(doc, n),
        ...(n.type === 'text' ? { textContent: preview(n.text ?? '', 80) } : {}),
        matched
      })
    }
  }
  return scoped(docId, { nodes: results, count: results.length, ...(total > results.length ? { total, truncated: true } : {}) })
})

// ------------------------------------------------------------------------------------------------
// computed styles

const INHERITED_TEXT = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'color', 'letterSpacing', 'fontStyle', 'textAlign']
const TEXT_DEFAULTS: Record<string, string | number> = {
  fontFamily: 'system-ui, sans-serif',
  fontSize: '16px',
  fontWeight: 400,
  lineHeight: 'normal',
  color: '#000000'
}
const PX_KEYS = new Set(['width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'fontSize', 'borderRadius'])

export function findElement(id: string): HTMLElement | null {
  const sel = `[data-node-id="${CSS.escape(id)}"]`
  return (document.querySelector(`[data-canvas-world] ${sel}`) as HTMLElement | null) ?? (document.querySelector(sel) as HTMLElement | null)
}

export function inheritedStyle(doc: Doc, id: string): Record<string, string | number> {
  const out: Record<string, string | number> = { ...TEXT_DEFAULTS }
  const chain: string[] = []
  let cur = doc.nodes[id]?.parent ?? null
  while (cur) {
    chain.unshift(cur)
    cur = doc.nodes[cur]?.parent ?? null
  }
  for (const a of chain) {
    const s = doc.nodes[a]?.style ?? {}
    for (const k of INHERITED_TEXT) if (s[k] !== undefined) out[k] = s[k]
  }
  return out
}

registerHandler('get_computed_styles', (args) => {
  const docId = resolveDocId(args)
  const doc = getDoc(docId)
  const styles: Record<string, unknown> = {}
  const notFound: string[] = []
  for (const id of arr<string>(args.nodeIds)) {
    const n = doc.nodes[id]
    if (!n) {
      notFound.push(id)
      continue
    }
    const s: Record<string, string | number> = {}
    const base = computeNodeStyle(doc, id, {})
    // the one-line min-height of empty text is a canvas affordance, not a node style
    if (n.type === 'text' && !n.text && n.style.minHeight === undefined) delete base.minHeight
    const topLevel = n.parent ? isPageRoot(doc, n.parent) : false
    if (topLevel) {
      s.position = 'absolute'
      s.left = n.x
      s.top = n.y
    }
    for (const [k, v] of Object.entries(base)) s[k] = typeof v === 'number' && PX_KEYS.has(k) ? `${v}px` : v
    if (n.type === 'text') {
      // typography that the text inherits from ancestors (read from the live DOM when on screen)
      const el = findElement(id)
      const cs = el ? getComputedStyle(el) : null
      const inherited = inheritedStyle(doc, id)
      for (const k of INHERITED_TEXT) {
        if (s[k] !== undefined) continue
        if (cs) {
          const v = cs.getPropertyValue(k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()))
          if (v && !(k === 'letterSpacing' && v === 'normal') && !(k === 'fontStyle' && v === 'normal') && !(k === 'textAlign' && v === 'start')) {
            s[k] = k === 'fontWeight' ? Number(v) || v : v
          }
        } else if (inherited[k] !== undefined) s[k] = inherited[k]
      }
      if (typeof s.fontSize === 'number') s.fontSize = `${s.fontSize}px`
    }
    styles[id] = s
  }
  return scoped(docId, { styles, ...(notFound.length ? { notFound } : {}) })
})
