// HTML <-> node conversion.
import type { CNode, Doc, NodeType, Style } from './types'
import { modeVars, nodeMode } from './modes'
import { anchoredAxes, isFlowChild, isFlowLayout, isPageRoot, makeNode, numericSize, textPreview } from './ops'
import { cleanAttrs, safeTag, sanitizeAttrs, sanitizeSvgMarkup } from './sanitize'

// ---------------------------------------------------------------------------------------------
// CSS helpers

/** CSS properties whose numeric values are unitless (mirrors React's list). */
const UNITLESS = new Set([
  'animationIterationCount', 'aspectRatio', 'borderImageOutset', 'borderImageSlice', 'borderImageWidth',
  'boxFlex', 'boxFlexGroup', 'boxOrdinalGroup', 'columnCount', 'columns', 'flex', 'flexGrow', 'flexPositive',
  'flexShrink', 'flexNegative', 'flexOrder', 'gridArea', 'gridRow', 'gridRowEnd', 'gridRowSpan', 'gridRowStart',
  'gridColumn', 'gridColumnEnd', 'gridColumnSpan', 'gridColumnStart', 'fontWeight', 'lineClamp', 'lineHeight',
  'opacity', 'order', 'orphans', 'scale', 'tabSize', 'widows', 'zIndex', 'zoom', 'fillOpacity', 'floodOpacity',
  'stopOpacity', 'strokeDasharray', 'strokeDashoffset', 'strokeMiterlimit', 'strokeOpacity', 'strokeWidth',
  'WebkitLineClamp'
])

export const isUnitless = (prop: string): boolean => UNITLESS.has(prop)

/** 'background-color' → 'backgroundColor', '-webkit-line-clamp' → 'WebkitLineClamp', '--x' kept. */
export function toCamel(prop: string): string {
  if (prop.startsWith('--')) return prop
  const p = prop.startsWith('-ms-') ? prop.slice(1) : prop
  return p.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
}

/** 'backgroundColor' → 'background-color', 'WebkitLineClamp' → '-webkit-line-clamp'. */
export function toKebab(prop: string): string {
  if (prop.startsWith('--')) return prop
  return prop.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()).replace(/^(webkit|moz|ms)-/, '-$1-')
}

/** Format a style value as CSS text. Numbers get 'px' unless the property is unitless. */
export function cssValue(prop: string, v: string | number): string {
  if (typeof v === 'number') return prop.startsWith('--') || UNITLESS.has(prop) || v === 0 ? String(v) : `${v}px`
  return v
}

/** Split a declaration list on ';' while respecting quotes and parentheses (data URLs etc.). */
function splitDeclarations(css: string): string[] {
  const out: string[] = []
  let depth = 0
  let quote: string | null = null
  let cur = ''
  for (const ch of css) {
    if (quote) {
      if (ch === quote) quote = null
    } else if (ch === '"' || ch === "'") quote = ch
    else if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    else if (ch === ';' && depth === 0) {
      out.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur.trim()) out.push(cur)
  return out
}

/** Parse an inline style attribute into a camelCase Style. Unitless numbers → number; units kept as strings. */
export function parseInlineStyle(css: string): Style {
  const style: Style = {}
  for (const decl of splitDeclarations(css)) {
    const i = decl.indexOf(':')
    if (i < 0) continue
    const rawProp = decl.slice(0, i).trim()
    const value = decl.slice(i + 1).trim().replace(/\s*!important$/i, '')
    if (!rawProp || !value) continue
    const prop = rawProp.startsWith('--') ? rawProp : toCamel(rawProp.toLowerCase())
    if (/^-?\d*\.?\d+$/.test(value)) style[prop] = parseFloat(value)
    else style[prop] = value
  }
  // width/height in px are stored as numbers (Fixed size), per the model rules.
  for (const k of ['width', 'height']) {
    const n = numericSize(style[k])
    if (n !== null && typeof style[k] === 'string') style[k] = n
  }
  return style
}

/** Style → inline CSS text. */
export function styleToCss(style: Style): string {
  return Object.entries(style)
    .filter(([, v]) => v !== '' && v !== undefined && v !== null)
    .map(([k, v]) => `${toKebab(k)}: ${cssValue(k, v)}`)
    .join('; ')
}

// ---------------------------------------------------------------------------------------------
// render style

/**
 * The effective CSS for rendering/exporting a node: its style plus absolute positioning when it
 * is placed by x/y inside a parent (not for top-level nodes — the canvas places those).
 * A left/top that isn't a px offset ('auto' for right/bottom anchoring, '50%', …) is kept as is.
 */
export function computeNodeStyle(doc: Doc, id: string, opts: { asRoot?: boolean; export?: boolean } = {}): Style {
  const n = doc.nodes[id]
  if (!n) return {}
  const s: Style = { ...n.style }
  const topLevel = n.parent ? isPageRoot(doc, n.parent) : true
  if (!opts.asRoot && !topLevel && !isFlowChild(doc, id)) {
    const anchored = anchoredAxes(n)
    s.position = 'absolute'
    if (!anchored.x) s.left = n.x
    if (!anchored.y) s.top = n.y
  }
  // a container is the positioning context for its absolute children (non-flow containers place
  // every child absolutely; flex/grid containers may have position:absolute children)
  if (n.children.length && !s.position) {
    if (!isFlowLayout(n.style) || n.children.some((c) => doc.nodes[c]?.style.position === 'absolute')) s.position = 'relative'
  }
  // canvas rendering keeps newlines/spaces; exports use <br /> instead
  if (!opts.export && n.type === 'text' && !s.whiteSpace) s.whiteSpace = 'pre-wrap'
  // an empty text node keeps one line of height (like an editable text box), so it stays visible
  // and selectable; exports keep browser semantics (an empty element is 0px tall)
  if (!opts.export && n.type === 'text' && !n.text && s.minHeight === undefined) s.minHeight = '1lh'
  if (!n.visible) s.display = 'none'
  // theme mode: the frame carries its mode's token values (exports use [data-mode] CSS instead)
  if (!opts.export) {
    const mode = nodeMode(doc, n)
    if (mode) Object.assign(s, modeVars(doc, mode))
  }
  return s
}

// ---------------------------------------------------------------------------------------------
// HTML → nodes

const TEXT_TAGS = new Set([
  'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'button', 'label', 'strong', 'b', 'em', 'i', 'small',
  'li', 'code', 'pre', 'blockquote', 'figcaption', 'td', 'th', 'u', 's', 'mark', 'sub', 'sup', 'q', 'cite', 'time'
])
const INLINE_FORMAT = new Set(['span', 'strong', 'b', 'em', 'i', 'a', 'small', 'code', 'u', 's', 'mark', 'sub', 'sup', 'br'])
/** Elements that are inline-level in a browser when they have no display of their own. */
const INLINE_LEVEL = new Set([
  'span', 'a', 'strong', 'b', 'em', 'i', 'small', 'code', 'u', 's', 'mark', 'sub', 'sup', 'img', 'svg', 'button',
  'label', 'input', 'select', 'textarea', 'time', 'q', 'cite', 'abbr', 'kbd', 'var', 'del', 'ins', 'picture', 'canvas'
])
/** Dropped with their content: scripts, metadata, embedded documents/plugins (never design content). */
const SKIP_TAGS = new Set([
  'script', 'style', 'meta', 'link', 'head', 'title', 'template', 'noscript', 'base', 'iframe', 'frame', 'frameset',
  'object', 'embed', 'applet', 'portal', 'fencedframe', 'math', 'noembed', 'noframes', 'xmp', 'plaintext', 'param'
])

const HEADING_DEFAULTS: Record<string, Style> = {
  h1: { fontSize: 32, fontWeight: 700 },
  h2: { fontSize: 24, fontWeight: 700 },
  h3: { fontSize: 18.72, fontWeight: 700 },
  h4: { fontSize: 16, fontWeight: 700 },
  h5: { fontSize: 13.28, fontWeight: 700 },
  h6: { fontSize: 10.72, fontWeight: 700 },
  strong: { fontWeight: 700 },
  b: { fontWeight: 700 },
  em: { fontStyle: 'italic' },
  i: { fontStyle: 'italic' }
}

/** Attributes copied into node.attrs (the element's tag is stored as attrs.tag). */
const KEEP_ATTRS = ['src', 'alt', 'href', 'title', 'target', 'rel']

/**
 * HTML whitespace (space, tab, CR, LF, FF). Unlike String.prototype.trim this does NOT include
 * U+00A0, so `&nbsp;` counts as content, as in a browser.
 */
const hasContent = (t: string | null | undefined): boolean => /[^ \t\r\n\f]/.test(t ?? '')
const htmlTrim = (t: string): string => t.replace(/^[ \t\r\n\f]+|[ \t\r\n\f]+$/g, '')

/** Typography properties: an empty element that sets any of these is an (empty) text box. */
const TEXT_STYLE_KEYS = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'color', 'textAlign', 'textTransform', 'textDecoration', 'whiteSpace']
/** Box properties: an empty element with any of these is a shape/spacer, not a text box. */
const BOX_STYLE_PREFIXES = ['background', 'border', 'boxShadow', 'outline', 'display', 'height', 'minHeight', 'maxHeight', 'aspectRatio']

/** Element with no content at all (only whitespace/comments) that is styled like text. */
function isEmptyTextBox(el: Element, style: Style): boolean {
  for (const c of Array.from(el.childNodes)) {
    if (c.nodeType === Node.COMMENT_NODE) continue
    if (c.nodeType === Node.TEXT_NODE && !hasContent(c.textContent)) continue
    return false
  }
  const keys = Object.keys(style)
  if (keys.some((k) => BOX_STYLE_PREFIXES.some((p) => k.startsWith(p)))) return false
  return keys.some((k) => TEXT_STYLE_KEYS.includes(k))
}

function collapse(text: string, pre: boolean): string {
  return pre ? text : text.replace(/[ \t\r\n\f]+/g, ' ')
}

/** Text of an element, turning <br> into newlines. */
function extractText(el: Element, pre: boolean): string {
  let out = ''
  el.childNodes.forEach((c) => {
    if (c.nodeType === Node.TEXT_NODE) out += collapse(c.textContent ?? '', pre)
    else if (c instanceof Element) {
      if (c.tagName.toLowerCase() === 'br') out += '\n'
      else out += extractText(c, pre)
    }
  })
  return out
}

/**
 * Element contains only text (and <br>/unstyled inline formatting). With `allowStyled`, styled
 * inline children are tolerated too (their styles are dropped) — used for text tags like <p>.
 */
function isTextOnly(el: Element, allowStyled = false): boolean {
  let hasText = false
  for (const c of Array.from(el.childNodes)) {
    if (c.nodeType === Node.TEXT_NODE) {
      if (hasContent(c.textContent)) hasText = true
    } else if (c instanceof Element) {
      const tag = c.tagName.toLowerCase()
      if (!INLINE_FORMAT.has(tag)) return false
      if (!allowStyled && tag !== 'br' && c.hasAttribute('style')) return false
      if (tag !== 'br' && c.children.length && !isTextOnly(c, allowStyled)) return false
      if (hasContent(c.textContent)) hasText = true
    } else if (c.nodeType !== Node.COMMENT_NODE) return false
  }
  return hasText
}

function trimText(t: string): string {
  return t
    .split('\n')
    .map(htmlTrim)
    .join('\n')
    .replace(/^\n+|\n+$/g, '')
}

function takeAttrs(el: Element, tag: string): Record<string, string> | undefined {
  const attrs: Record<string, string> = {}
  for (const a of KEEP_ATTRS) {
    const v = el.getAttribute(a)
    if (v !== null) attrs[a] = v
  }
  if (!['div', 'img', 'svg'].includes(tag)) attrs.tag = tag
  // no javascript: links, event handlers or unsafe tags (see sanitize.ts)
  return sanitizeAttrs(attrs)
}

/**
 * Move left/top into x/y where the model places nodes by x/y:
 *  - top-level nodes (roots written into a page root): left/top are world coordinates;
 *  - position:absolute (or fixed) elements: px left/top become x/y. A missing left/top is stored as
 *    'auto' so right/bottom anchoring (or the static position) works as in a browser; other values
 *    ('50%', 'calc(…)') are kept in the style.
 * Other elements keep left/top in their style (relative offsets).
 */
function extractPosition(style: Style, topLevel: boolean): { x: number; y: number } {
  let x = 0
  let y = 0
  if (style.position === 'fixed' && !topLevel) style.position = 'absolute'
  if (topLevel) {
    const l = numericSize(style.left)
    const t = numericSize(style.top)
    if (l !== null) x = l
    if (t !== null) y = t
    for (const k of ['left', 'top', 'right', 'bottom']) delete style[k]
    if (style.position === 'absolute' || style.position === 'relative' || style.position === 'fixed') delete style.position
  } else if (style.position === 'absolute') {
    const l = numericSize(style.left)
    const t = numericSize(style.top)
    if (l !== null) {
      x = l
      delete style.left
    } else if (style.left === undefined) style.left = 'auto'
    if (t !== null) {
      y = t
      delete style.top
    } else if (style.top === undefined) style.top = 'auto'
  }
  return { x, y }
}

function create(doc: Doc, type: NodeType, partial: Partial<CNode>): CNode {
  const n = makeNode(doc, { ...partial, type }, false)
  doc.nodes[n.id] = n
  return n
}

function isInlineLevel(el: Element): boolean {
  const d = /(?:^|;)\s*display\s*:\s*([\w-]+)/i.exec(el.getAttribute('style') ?? '')?.[1]?.toLowerCase()
  if (d) return d.startsWith('inline')
  return INLINE_LEVEL.has(el.tagName.toLowerCase())
}

function convertElement(doc: Doc, el: Element, topLevel: boolean): CNode | null {
  const tag = el.tagName.toLowerCase()
  if (SKIP_TAGS.has(tag)) return null
  const style: Style = { ...(HEADING_DEFAULTS[tag] ?? {}), ...parseInlineStyle(el.getAttribute('style') ?? '') }
  const pos = extractPosition(style, topLevel)
  const dataName = el.getAttribute('data-name') ?? el.getAttribute('data-layer') ?? el.getAttribute('layer-name') ?? undefined
  const attrs = takeAttrs(el, tag)

  if (tag === 'img') {
    const w = numericSize(el.getAttribute('width') ?? undefined)
    const h = numericSize(el.getAttribute('height') ?? undefined)
    if (w !== null && style.width === undefined) style.width = w
    if (h !== null && style.height === undefined) style.height = h
    return create(doc, 'image', { name: dataName ?? el.getAttribute('alt') ?? 'Image', style, attrs, ...pos })
  }

  if (tag === 'svg') {
    const svgAttrs: Record<string, string> = {}
    for (const a of Array.from(el.attributes)) {
      if (['style', 'width', 'height', 'xmlns', 'class', 'data-name', 'layer-name'].includes(a.name)) continue
      svgAttrs[a.name] = a.value
    }
    const w = numericSize(el.getAttribute('width') ?? undefined)
    const h = numericSize(el.getAttribute('height') ?? undefined)
    const vb = el.getAttribute('viewBox')?.split(/[\s,]+/).map(Number)
    if (style.width === undefined) style.width = w ?? (vb && vb.length === 4 ? vb[2] : 24)
    if (style.height === undefined) style.height = h ?? (vb && vb.length === 4 ? vb[3] : 24)
    return create(doc, 'svg', {
      name: dataName ?? 'SVG',
      style,
      svg: sanitizeSvgMarkup(el.innerHTML.trim()),
      attrs: sanitizeAttrs(svgAttrs),
      ...pos
    })
  }

  const pre = typeof style.whiteSpace === 'string' && style.whiteSpace.startsWith('pre')
  if (isTextOnly(el) || (TEXT_TAGS.has(tag) && isTextOnly(el, true)) || (!topLevel && isEmptyTextBox(el, style))) {
    const text = pre ? extractText(el, true) : trimText(extractText(el, false))
    return create(doc, 'text', { name: dataName ?? textPreview(text), text, style, attrs, ...pos })
  }

  const frame = create(doc, 'frame', { name: dataName ?? 'Frame', style, attrs, ...pos })
  const kids: CNode[] = []
  // bare text runs are inline content; element children decide below
  let inlineKids = true
  el.childNodes.forEach((c) => {
    if (c.nodeType === Node.TEXT_NODE) {
      const t = collapse(c.textContent ?? '', pre)
      if (hasContent(t)) {
        const text = pre ? t : htmlTrim(t)
        kids.push(create(doc, 'text', { name: textPreview(text), text, style: {} }))
      }
    } else if (c instanceof Element) {
      if (c.tagName.toLowerCase() === 'br') return
      const k = convertElement(doc, c, false)
      if (!k) return
      kids.push(k)
      if (k.style.position !== 'absolute' && !isInlineLevel(c)) inlineKids = false
    }
  })
  for (const k of kids) {
    k.parent = frame.id
    frame.children.push(k.id)
  }
  // The canvas lays out children of flex/grid frames in flow and places every other child at x/y.
  // A block container (no display) is converted so it looks the same as in a browser:
  //  - block-level children stack vertically at full width → flex column (align-items: stretch);
  //  - only inline-level children (spans, images, buttons…) sit on a line → wrapping flex row,
  //    aligned on the baseline and following text-align.
  // (Edit frame.style: makeNode gave the node its own copy of `style`.)
  const fs = frame.style
  const hasFlowKids = kids.some((k) => k.style.position !== 'absolute')
  const display = typeof fs.display === 'string' ? fs.display : undefined
  const blockish = display === undefined || ['block', 'inline-block', 'flow-root', 'list-item'].includes(display)
  if (hasFlowKids && blockish) {
    fs.display = display === 'inline-block' ? 'inline-flex' : 'flex'
    if (inlineKids) {
      fs.flexDirection = 'row'
      fs.flexWrap = 'wrap'
      fs.alignItems = 'baseline'
      const ta = String(fs.textAlign ?? '')
      if (ta === 'center') fs.justifyContent = 'center'
      else if (ta === 'right' || ta === 'end') fs.justifyContent = 'flex-end'
    } else {
      fs.flexDirection = 'column'
    }
  }
  return frame
}

/**
 * Parse HTML into nodes. New nodes are added to doc.nodes (ids allocated from doc.nextId) with
 * `parent: null` for the returned roots; the caller attaches them. Call on an immer draft.
 * `opts.topLevel`: the roots become top-level nodes (artboards), so their left/top are world x/y.
 * Otherwise the roots are ordinary children (position:absolute + left/top is kept as such).
 */
export function htmlToNodes(html: string, doc: Doc, opts: { topLevel?: boolean } = {}): string[] {
  const topLevel = opts.topLevel ?? false
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const roots: string[] = []
  parsed.body.childNodes.forEach((c) => {
    if (c instanceof Element) {
      const n = convertElement(doc, c, topLevel)
      if (n) roots.push(n.id)
    } else if (c.nodeType === Node.TEXT_NODE && hasContent(c.textContent)) {
      const text = trimText(collapse(c.textContent ?? '', false))
      roots.push(create(doc, 'text', { name: textPreview(text), text, style: {} }).id)
    }
  })
  return roots
}

// ---------------------------------------------------------------------------------------------
// render-mode HTML (mirrors how the canvas renders nodes; used for screenshots and measuring)

/** Node markup as the canvas renders it (render-mode styles, `idAttr` = node id on every element). */
export function nodeToRenderHtml(doc: Doc, id: string, asRoot = true, idAttr = 'data-node-id'): string {
  const n = doc.nodes[id]
  if (!n) return ''
  const css = styleToCss(computeNodeStyle(doc, id, { asRoot }))
  const style = css ? ` style="${escAttr(css)}"` : ''
  const data = ` ${idAttr}="${escAttr(id)}"`
  let attrs = ''
  for (const [k, v] of Object.entries(cleanAttrs(n.attrs))) {
    if (k === 'tag' || (n.type === 'image' && ['href', 'target', 'rel', 'title'].includes(k))) continue
    attrs += ` ${k}="${escAttr(v)}"`
  }
  switch (n.type) {
    case 'text':
      return `<div${data}${style}>${esc(n.text ?? '')}</div>`
    case 'image':
      return `<img${data}${attrs}${style} draggable="false" />`
    case 'svg':
      return `<svg xmlns="http://www.w3.org/2000/svg"${data}${attrs}${style}>${sanitizeSvgMarkup(n.svg)}</svg>`
    default:
      return `<div${data}${style}>${n.children.map((c) => nodeToRenderHtml(doc, c, false, idAttr)).join('')}</div>`
  }
}

// ---------------------------------------------------------------------------------------------
// nodes → HTML / JSX

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escAttr = (s: string): string => esc(s).replace(/"/g, '&quot;')

export function tagOf(n: CNode): string {
  if (n.type === 'image') return 'img'
  if (n.type === 'svg') return 'svg'
  const t = n.attrs?.tag
  return safeTag(t) ? t : 'div'
}

function htmlAttrs(n: CNode): string {
  let out = ''
  for (const [k, v] of Object.entries(cleanAttrs(n.attrs))) {
    if (k === 'tag') continue
    out += ` ${k}="${escAttr(v)}"`
  }
  return out
}

export function nodeToHtml(doc: Doc, id: string, opts: { indent?: string; asRoot?: boolean } = {}): string {
  const n = doc.nodes[id]
  if (!n) return ''
  const ind = opts.indent ?? ''
  const style = computeNodeStyle(doc, id, { asRoot: opts.asRoot ?? true, export: true })
  const css = styleToCss(style)
  const styleAttr = css ? ` style="${escAttr(css)}"` : ''
  const tag = tagOf(n)
  if (n.type === 'image') return `${ind}<img${htmlAttrs(n)}${styleAttr} />`
  if (n.type === 'svg') {
    return `${ind}<svg xmlns="http://www.w3.org/2000/svg"${htmlAttrs(n)}${styleAttr}>${sanitizeSvgMarkup(n.svg)}</svg>`
  }
  if (n.type === 'text') {
    return `${ind}<${tag}${htmlAttrs(n)}${styleAttr}>${esc(n.text ?? '').replace(/\n/g, '<br />')}</${tag}>`
  }
  const kids = n.children
    .filter((c) => doc.nodes[c]?.visible !== false)
    .map((c) => nodeToHtml(doc, c, { indent: ind + '  ', asRoot: false }))
  if (!kids.length) return `${ind}<${tag}${htmlAttrs(n)}${styleAttr}></${tag}>`
  return `${ind}<${tag}${htmlAttrs(n)}${styleAttr}>\n${kids.join('\n')}\n${ind}</${tag}>`
}

function jsxStyle(style: Style): string {
  const parts = Object.entries(style).map(([k, v]) => {
    const key = /^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)
    return `${key}: ${typeof v === 'number' ? v : JSON.stringify(v)}`
  })
  return parts.length ? ` style={{ ${parts.join(', ')} }}` : ''
}

const JSX_ATTR_RENAME: Record<string, string> = { class: 'className', for: 'htmlFor', 'stroke-width': 'strokeWidth', 'fill-rule': 'fillRule', 'clip-rule': 'clipRule', 'stroke-linecap': 'strokeLinecap', 'stroke-linejoin': 'strokeLinejoin' }

function jsxAttrs(n: CNode): string {
  let out = ''
  for (const [k, v] of Object.entries(cleanAttrs(n.attrs))) {
    if (k === 'tag') continue
    out += ` ${JSX_ATTR_RENAME[k] ?? k}=${JSON.stringify(v)}`
  }
  return out
}

function jsxText(t: string): string {
  return t
    .split('\n')
    .map((line) => (/[{}<>]/.test(line) || /^\s|\s$/.test(line) ? `{${JSON.stringify(line)}}` : line))
    .join('<br />')
}

/** svg inner markup → JSX-compatible (kebab attrs → camel). */
function svgInnerToJsx(markup: string): string {
  return markup
    .replace(/\s([a-z]+(?:-[a-z]+)+)=/g, (_m, a: string) => ` ${a === 'xlink:href' ? 'href' : toCamel(a)}=`)
    .replace(/\sclass=/g, ' className=')
}

export type JsxFormat = 'inline-styles' | 'tailwind'

/** JSX for a node subtree. 'tailwind' currently falls back to inline styles. */
export function nodeToJsx(doc: Doc, id: string, _format: JsxFormat = 'inline-styles', indent = '', asRoot = true): string {
  const n = doc.nodes[id]
  if (!n) return ''
  const style = computeNodeStyle(doc, id, { asRoot, export: true })
  const tag = tagOf(n)
  const s = jsxStyle(style)
  if (n.type === 'image') return `${indent}<img${jsxAttrs(n)}${s} />`
  if (n.type === 'svg') {
    return `${indent}<svg xmlns="http://www.w3.org/2000/svg"${jsxAttrs(n)}${s}>${svgInnerToJsx(sanitizeSvgMarkup(n.svg))}</svg>`
  }
  if (n.type === 'text') return `${indent}<${tag}${jsxAttrs(n)}${s}>${jsxText(n.text ?? '')}</${tag}>`
  const kids = n.children
    .filter((c) => doc.nodes[c]?.visible !== false)
    .map((c) => nodeToJsx(doc, c, _format, indent + '  ', false))
  if (!kids.length) return `${indent}<${tag}${jsxAttrs(n)}${s} />`
  return `${indent}<${tag}${jsxAttrs(n)}${s}>\n${kids.join('\n')}\n${indent}</${tag}>`
}
