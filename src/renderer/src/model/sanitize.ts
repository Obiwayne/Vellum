// Sanitising of design content that ends up as markup in the app (canvas, thumbnails, offscreen
// measuring, screenshots) or in exported files. Designs come from MCP agents, HTML pasted from
// other apps, imported SVG files and files on disk (which may be old or hand-edited), so none of it
// is trusted. The renderer CSP (script-src 'self') already blocks inline script; this is the second
// layer and also keeps exports clean.
//
//  - sanitizeSvgMarkup: the inner markup of an <svg> node. Only SVG-namespace elements survive (no
//    <script>, <foreignObject>, HTML break-out elements like <img>/<iframe>/<meta>/<base>), no event
//    handlers, no javascript:/vbscript: or external <use> references, no SMIL animation of href or
//    event attributes. Re-serialised by hand, so the output is always well-formed and escaped.
//  - sanitizeAttrs: node.attrs (src/href/alt/title/tag/…, and the root <svg> attributes).
//  - safeUrl: the URL rules shared by both.

const SVG_NS = 'http://www.w3.org/2000/svg'
const XLINK_NS = 'http://www.w3.org/1999/xlink'

/** Tags that must never be emitted as a node's element (attrs.tag). */
const BLOCKED_TAGS = new Set([
  'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'base', 'meta', 'link',
  'portal', 'fencedframe', 'template', 'noscript', 'svg', 'math', 'html', 'head', 'body', 'title', 'xmp',
  'plaintext', 'noembed', 'noframes', 'image', 'param'
])

/** SVG elements that are dropped with their content. */
const SVG_BLOCKED = new Set(['script', 'foreignobject', 'iframe', 'handler', 'listener', 'discard'])
/** SMIL elements; dropped when they animate an href or an event attribute. */
const SVG_ANIMATION = new Set(['set', 'animate', 'animatetransform', 'animatemotion', 'animatecolor'])

const ATTR_NAME = /^[a-zA-Z_:][-a-zA-Z0-9_:.]*$/
const TAG_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

/** Characters browsers ignore inside a URL scheme ("java\tscript:", control chars, whitespace). */
const stripForScheme = (v: string): string => v.replace(/[\u0000-\u0020\u007f-\u00a0\u1680\u180e\u2000-\u2029\u205f\u3000\ufeff]/g, '').toLowerCase()

export type UrlKind = 'link' | 'image' | 'fragment'

/**
 * Is `v` a URL that is safe in this position?
 *  - 'fragment': only same-document references (#id) — SVG <use>, <feImage>, gradients' href;
 *  - 'image': relative, http(s), blob:, or data:image/… (images can't run script);
 *  - 'link': relative, #, http(s), mailto:, tel:.
 */
export function safeUrl(v: string, kind: UrlKind): boolean {
  const s = stripForScheme(v)
  if (kind === 'fragment') return s.startsWith('#')
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(s)?.[1]
  if (!scheme) return true // relative / fragment
  if (scheme === 'http' || scheme === 'https') return true
  if (kind === 'image') return scheme === 'blob' || (scheme === 'data' && /^data:image\//.test(s))
  return scheme === 'mailto' || scheme === 'tel'
}

/** A CSS value that can load a script URL or old-IE expressions (never needed by a design). */
const dangerousCss = (v: string): boolean => {
  const s = stripForScheme(v)
  return /javascript:|vbscript:|expression\(|-moz-binding|behavior:|@import|data:text\/html/.test(s)
}

/** Attribute value that is a script URL in any position. */
const scriptUrl = (v: string): boolean => /^(javascript|vbscript|livescript):|^data:text\/html/.test(stripForScheme(v))

const escText = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escAttrValue = (s: string): string => escText(s).replace(/"/g, '&quot;')

/** Clean one attribute of an SVG element; null drops it. */
function svgAttr(el: Element, attr: Attr): string | null {
  const name = attr.name
  const lower = name.toLowerCase()
  const value = attr.value
  if (!ATTR_NAME.test(name) || lower.startsWith('on')) return null
  if (attr.namespaceURI && attr.namespaceURI !== XLINK_NS && !lower.startsWith('xml')) return null
  if (lower === 'href' || lower === 'xlink:href' || lower === 'src') {
    const tag = el.localName.toLowerCase()
    if (tag === 'image') return safeUrl(value, 'image') ? value : null
    if (tag === 'a') return safeUrl(value, 'link') ? value : null
    return safeUrl(value, 'fragment') ? value : null
  }
  if (lower === 'style') return dangerousCss(value) ? null : value
  if (scriptUrl(value)) return null
  return value
}

function serializeSvg(node: Node, out: string[], depth: number): void {
  if (depth > 200) return
  if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) {
    out.push(escText(node.nodeValue ?? ''))
    return
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return // comments, processing instructions
  const el = node as Element
  if (el.namespaceURI !== SVG_NS) return // HTML break-out (<img>, <iframe>, <meta>…) or MathML
  const tag = el.localName
  const lower = tag.toLowerCase()
  if (SVG_BLOCKED.has(lower) || !ATTR_NAME.test(tag)) return
  if (SVG_ANIMATION.has(lower)) {
    const target = (el.getAttribute('attributeName') ?? '').toLowerCase()
    if (!target || target.includes('href') || target.startsWith('on') || target === 'style') return
  }
  let attrs = ''
  for (const a of Array.from(el.attributes)) {
    const v = svgAttr(el, a)
    if (v !== null) attrs += ` ${a.name}="${escAttrValue(v)}"`
  }
  if (lower === 'style') {
    const css = el.textContent ?? ''
    out.push(`<${tag}${attrs}>${dangerousCss(css) ? '' : escText(css)}</${tag}>`)
    return
  }
  out.push(`<${tag}${attrs}>`)
  el.childNodes.forEach((c) => serializeSvg(c, out, depth + 1))
  out.push(`</${tag}>`)
}

const svgCache = new Map<string, string>()
const SVG_CACHE_MAX = 2000

/** Sanitised inner markup of an <svg> element (see the file header). Cached by input. */
export function sanitizeSvgMarkup(markup: string | undefined | null): string {
  if (!markup) return ''
  const hit = svgCache.get(markup)
  if (hit !== undefined) return hit
  let result = ''
  try {
    // parse exactly the way the sinks do (HTML parser, inside <svg>); DOMParser documents are inert
    const doc = new DOMParser().parseFromString(`<!doctype html><html><body><svg xmlns="${SVG_NS}">${markup}</svg></body></html>`, 'text/html')
    const out: string[] = []
    const svg = doc.body.querySelector('svg')
    svg?.childNodes.forEach((c) => serializeSvg(c, out, 0))
    result = out.join('')
  } catch {
    result = ''
  }
  if (svgCache.size >= SVG_CACHE_MAX) svgCache.delete(svgCache.keys().next().value as string)
  svgCache.set(markup, result)
  return result
}

/** Is `tag` safe to emit as a node's element name (exports, JSX)? */
export const safeTag = (tag: unknown): tag is string => typeof tag === 'string' && TAG_NAME.test(tag) && !BLOCKED_TAGS.has(tag)

/** Attributes that are dropped from node.attrs whatever their value. */
const DROP_ATTRS = new Set(['style', 'srcdoc', 'formaction', 'action', 'http-equiv', 'xmlns', 'is', 'autofocus', 'ping'])

/**
 * Clean node.attrs: valid names only, no event handlers, safe URLs in src/href/xlink:href, no
 * script URLs anywhere, a safe `tag`. Returns undefined when nothing is left.
 */
export function sanitizeAttrs(attrs: Record<string, unknown> | undefined | null): Record<string, string> | undefined {
  if (!attrs || typeof attrs !== 'object') return undefined
  const out: Record<string, string> = {}
  for (const [k, raw] of Object.entries(attrs)) {
    if (typeof raw !== 'string' && typeof raw !== 'number') continue
    const v = String(raw)
    const lower = k.toLowerCase()
    if (k === 'tag') {
      if (safeTag(v)) out.tag = v
      continue
    }
    if (!ATTR_NAME.test(k) || lower.startsWith('on') || DROP_ATTRS.has(lower) || lower === '__proto__') continue
    if (lower === 'src' || lower === 'srcset' || lower === 'poster') {
      if (lower === 'srcset' ? v.split(',').every((p) => safeUrl(p.trim().split(/\s+/)[0] ?? '', 'image')) : safeUrl(v, 'image')) out[k] = v
      continue
    }
    if (lower === 'href' || lower === 'xlink:href') {
      if (safeUrl(v, 'link')) out[k] = v
      continue
    }
    if (scriptUrl(v)) continue
    out[k] = v
  }
  return Object.keys(out).length ? out : undefined
}

/** Attrs as a string map for rendering, cleaned (cached per attrs object). */
const attrCache = new WeakMap<object, Record<string, string>>()
export function cleanAttrs(attrs: Record<string, string> | undefined): Record<string, string> {
  if (!attrs) return {}
  const hit = attrCache.get(attrs)
  if (hit) return hit
  const c = sanitizeAttrs(attrs) ?? {}
  attrCache.set(attrs, c)
  return c
}
