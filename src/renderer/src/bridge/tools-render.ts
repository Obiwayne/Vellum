// MCP tools: code generation (get_jsx) and the render payload used for screenshots/exports.
import { computeNodeStyle, cssValue, jsxWhen, nodeToHtml, nodeToJsx, nodeToRenderHtml, tagOf, toCamel, toKebab, type JsxHooks } from '../model/html'
import { cleanAttrs, sanitizeSvgMarkup } from '../model/sanitize'
import { descendants, isPageRoot, pageOf, topLevelOf } from '../model/ops'
import type { CNode, Doc } from '../model/types'
import { effectiveMode, modeVars, nodeMode, tokensCssWithModes } from '../model/modes'
import { inheritedStyle } from './tools-read'
import { styleToTailwind } from './tailwind'
import { jsxWithComponents } from './jsx-components'
import { geometry, getDoc, registerHandler, requireNode, resolveDocId, scoped, str } from './registry'

export { nodeToRenderHtml }

/** Every font-family value used by the node, its ancestors (inherited) and font tokens. */
export function fontsFor(doc: Doc, id: string): string[] {
  const ids = [id, ...descendants(doc, id)]
  const inherited = inheritedStyle(doc, id).fontFamily
  const out = new Set<string>()
  const tokens = new Map(doc.tokens.map((t) => [t.name, t.value]))
  const resolve = (v: string): string => v.replace(/var\((--[\w-]+)(?:,\s*([^)]*))?\)/g, (_m, name: string, fb?: string) => tokens.get(name) ?? fb ?? '')
  for (const i of ids) {
    const f = doc.nodes[i]?.style.fontFamily
    if (typeof f === 'string') out.add(resolve(f))
  }
  if (typeof inherited === 'string') out.add(resolve(inherited))
  return [...out]
}

/** Opaque backdrop for formats without alpha (JPG): the artboard's fill, else the page background. */
export function exportBackground(doc: Doc, id: string): string {
  const top = topLevelOf(doc, id)
  const bg = top ? doc.nodes[top]?.style.backgroundColor : undefined
  if (typeof bg === 'string' && bg.trim() && bg.trim() !== 'transparent') return bg.trim()
  return pageOf(doc, id)?.background ?? '#FFFFFF'
}

registerHandler('_render_node', (args) => {
  const docId = resolveDocId(args)
  const doc = getDoc(docId)
  const n = requireNode(doc, args.nodeId)
  if (isPageRoot(doc, n.id)) throw new Error('Cannot render a page root; pass an artboard or node id')
  const g = geometry(doc, n.id)
  const inh = inheritedStyle(doc, n.id)
  // both end up inside <style> elements of the rendered/exported document: a '<' could close the
  // element ("</style><script>…"), so it is CSS-escaped; token names must be custom-property names
  const cssSafe = (v: string): string => v.replace(/</g, '\\3c ')
  const inheritedCss = cssSafe(
    Object.entries(inh)
      .filter(([k]) => /^-?[A-Za-z][\w-]*$/.test(k))
      .map(([k, v]) => `${toKebab(k)}:${cssValue(k, v)}`)
      .join(';')
  )
  // tokens with their theme modes; a node inside a moded frame renders in that mode
  const inherited = n.parent ? effectiveMode(doc, n.parent) : null
  const rootVars = inherited && !nodeMode(doc, n) ? Object.entries(modeVars(doc, inherited)).map(([k, v]) => `${k}:${v}`).join(';') : ''
  const tokensCss = cssSafe(tokensCssWithModes(doc) + (rootVars ? `:root{${rootVars}}` : ''))
  return scoped(docId, {
    nodeId: n.id,
    name: n.name,
    html: nodeToRenderHtml(doc, n.id, true),
    exportHtml: nodeToHtml(doc, n.id),
    tokensCss,
    fontFamilies: fontsFor(doc, n.id),
    width: g && g.width !== null && g.width > 0 ? g.width : null,
    height: g && g.height !== null && g.height > 0 ? g.height : null,
    inheritedCss,
    pageBackground: pageOf(doc, n.id)?.background ?? '#282828',
    background: exportBackground(doc, n.id).replace(/</g, '')
  })
})

// ------------------------------------------------------------------------------------------------
// get_jsx

const JSX_ATTR_RENAME: Record<string, string> = { class: 'className', for: 'htmlFor' }

function jsxAttrs(n: CNode): string {
  let out = ''
  for (const [k, v] of Object.entries(cleanAttrs(n.attrs))) {
    if (k === 'tag') continue
    const name = JSX_ATTR_RENAME[k] ?? (k.includes('-') && !k.startsWith('data-') && !k.startsWith('aria-') ? toCamel(k) : k)
    out += ` ${name}=${JSON.stringify(v)}`
  }
  return out
}

function jsxText(t: string): string {
  return t
    .split('\n')
    .map((line) => (/[{}<>]/.test(line) || /^\s|\s$/.test(line) ? `{${JSON.stringify(line)}}` : line))
    .join('<br />')
}

function svgInnerToJsx(markup: string): string {
  return markup
    .replace(/\s([a-z]+(?:-[a-z]+)+)=/g, (_m, a: string) => ` ${toCamel(a)}=`)
    .replace(/\sclass=/g, ' className=')
    .replace(/\sxlink:href=/g, ' href=')
}

export function nodeToTailwindJsx(doc: Doc, id: string, indent: string, asRoot: boolean, hooks?: JsxHooks): string {
  const n = doc.nodes[id]
  if (!n) return ''
  const swapped = hooks?.replace?.(n, hooks.when?.(n) ? indent + '  ' : indent)
  if (swapped) return jsxWhen(n, swapped, indent, hooks)
  return jsxWhen(n, tailwindPlain(doc, n, hooks?.when?.(n) ? indent + '  ' : indent, asRoot, hooks), indent, hooks)
}

function tailwindPlain(doc: Doc, n: CNode, indent: string, asRoot: boolean, hooks?: JsxHooks): string {
  const id = n.id
  const classes = styleToTailwind(computeNodeStyle(doc, id, { asRoot, export: true }))
  if (asRoot) classes.unshift('[font-synthesis:none]', 'antialiased')
  const cls = classes.length ? ` className="${classes.join(' ')}"` : ''
  const tag = tagOf(n)
  if (n.type === 'image') return `${indent}<img${jsxAttrs(n)}${cls} />`
  if (n.type === 'svg') return `${indent}<svg xmlns="http://www.w3.org/2000/svg"${jsxAttrs(n)}${cls}>${svgInnerToJsx(sanitizeSvgMarkup(n.svg))}</svg>`
  if (n.type === 'text') {
    const t = hooks?.text?.(n) ?? jsxText(n.text ?? '')
    return t.length > 60 ? `${indent}<${tag}${jsxAttrs(n)}${cls}>\n${indent}  ${t}\n${indent}</${tag}>` : `${indent}<${tag}${jsxAttrs(n)}${cls}>${t}</${tag}>`
  }
  const kids = n.children.filter((c) => doc.nodes[c]?.visible !== false || hooks?.when?.(doc.nodes[c])).map((c) => nodeToTailwindJsx(doc, c, indent + '  ', false, hooks))
  if (!kids.length) return `${indent}<${tag}${jsxAttrs(n)}${cls} />`
  return `${indent}<${tag}${jsxAttrs(n)}${cls}>\n${kids.join('\n')}\n${indent}</${tag}>`
}

registerHandler('get_jsx', (args) => {
  const docId = resolveDocId(args)
  const doc = getDoc(docId)
  const n = requireNode(doc, args.nodeId)
  const format = str(args.format) === 'inline-styles' ? 'inline-styles' : 'tailwind'
  const withComponents = jsxWithComponents(doc, n.id, format)
  if (withComponents !== null) return scoped(docId, withComponents)
  const jsx = format === 'tailwind' ? nodeToTailwindJsx(doc, n.id, '    ', true) : nodeToJsx(doc, n.id, 'inline-styles', '    ')
  return scoped(docId, `(\n${jsx}\n  )`)
})
