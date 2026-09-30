// Selection colours: every colour used by the selected nodes and their descendants (fills, gradients,
// text colour, borders, outlines, shadows, SVG paint), grouped by normalised value, plus a
// replace-everywhere edit. Literal colours are grouped as `#RRGGBB(AA)`; `var(--token)` stays a token.
import type { CNode, Doc, Token } from '../../model/types'
import { descendants } from '../../model/ops'
import { formatColor, parseColor } from '../../ui'
import { resolveTokenValue } from './ColorInput'

export interface ColorUse {
  /** normalised colour ('#RRGGBB' / '#RRGGBBAA') or 'var(--token)' */
  key: string
  /** number of places that use it */
  count: number
}

/** Style keys that may hold colours (as the whole value, or inside a gradient/shadow/shorthand). */
const COLOR_KEY_RE = /color|background|border|outline|shadow|^(fill|stroke)$/i
/** …minus the longhands of those that never do. */
const NON_COLOR_KEY_RE = /radius|width|style|size|position|repeat|clip|origin|attachment|blendmode|offset/i
/** SVG paint attributes in `node.svg` markup. */
const SVG_ATTR_RE = /(\s(?:fill|stroke|stop-color|flood-color|lighting-color)\s*=\s*)(["'])(.*?)\2/gi
const SVG_ROOT_ATTRS = ['fill', 'stroke', 'color']
/**
 * One colour-ish token in a CSS value: url() (skipped), var(), hex, colour functions, or a bare word
 * (named colours such as `red`; other words like `solid` or `to` don't parse as colours).
 */
const COLOR_RE =
  /url\([^)]*\)|var\(\s*(--[\w-]+)\s*(?:,(?:[^()]|\([^()]*\))*)?\)|#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\)|\b[a-z]+\b/gi
const SKIP_WORDS = new Set(['transparent', 'currentcolor', 'inherit', 'initial', 'unset', 'revert', 'none'])

const wordCache = new Map<string, string | null>()

/** Group key for one match of COLOR_RE, or null when it isn't a colour. */
function keyOf(match: string, tokenName: string | undefined, tokens: Token[]): string | null {
  if (tokenName) return parseColor(resolveTokenValue(tokens, tokenName)) ? `var(${tokenName})` : null
  if (/^url\(/i.test(match)) return null
  const lower = match.toLowerCase()
  if (SKIP_WORDS.has(lower)) return null
  if (/^[a-z]+$/.test(lower)) {
    if (!wordCache.has(lower)) {
      const c = parseColor(lower)
      wordCache.set(lower, c ? formatColor(c) : null)
    }
    return wordCache.get(lower) ?? null
  }
  const c = parseColor(match)
  return c ? formatColor(c) : null
}

function eachColor(value: string, tokens: Token[], fn: (key: string) => void): void {
  for (const m of value.matchAll(COLOR_RE)) {
    const k = keyOf(m[0], m[1], tokens)
    if (k) fn(k)
  }
}

function replaceIn(value: string, tokens: Token[], from: string, to: string): string {
  return value.replace(COLOR_RE, (m: string, tokenName: string | undefined) => (keyOf(m, tokenName, tokens) === from ? to : m))
}

const isColorKey = (k: string): boolean => COLOR_KEY_RE.test(k) && !NON_COLOR_KEY_RE.test(k)

/** Selected nodes plus all their descendants, each once, in tree order per selected root. */
export function colorScope(doc: Doc, ids: string[]): CNode[] {
  const seen = new Set<string>()
  const out: CNode[] = []
  for (const id of ids)
    for (const nid of [id, ...descendants(doc, id)]) {
      const n = doc.nodes[nid]
      if (!n || seen.has(nid)) continue
      seen.add(nid)
      out.push(n)
    }
  return out
}

/** Every distinct colour in the selection (first use first) with its number of uses. */
export function collectColors(doc: Doc, ids: string[]): ColorUse[] {
  const counts = new Map<string, number>()
  const add = (k: string): void => void counts.set(k, (counts.get(k) ?? 0) + 1)
  for (const n of colorScope(doc, ids)) {
    for (const [k, v] of Object.entries(n.style)) if (typeof v === 'string' && isColorKey(k)) eachColor(v, doc.tokens, add)
    if (n.type === 'svg') {
      for (const a of SVG_ROOT_ATTRS) if (n.attrs?.[a]) eachColor(n.attrs[a], doc.tokens, add)
      if (n.svg) for (const m of n.svg.matchAll(SVG_ATTR_RE)) eachColor(m[3], doc.tokens, add)
    }
  }
  return [...counts].map(([key, count]) => ({ key, count }))
}

/** Replace colour `from` (a ColorUse key) with `to` everywhere in the selection. Call on a draft. */
export function replaceColor(d: Doc, ids: string[], from: string, to: string): void {
  for (const n of colorScope(d, ids)) {
    for (const [k, v] of Object.entries(n.style)) {
      if (typeof v !== 'string' || !isColorKey(k)) continue
      const next = replaceIn(v, d.tokens, from, to)
      if (next !== v) n.style[k] = next
    }
    if (n.type === 'svg') {
      for (const a of SVG_ROOT_ATTRS) {
        const v = n.attrs?.[a]
        if (!v || !n.attrs) continue
        const next = replaceIn(v, d.tokens, from, to)
        if (next !== v) n.attrs[a] = next
      }
      if (n.svg) {
        const next = n.svg.replace(SVG_ATTR_RE, (_m, pre: string, q: string, val: string) => `${pre}${q}${replaceIn(val, d.tokens, from, to)}${q}`)
        if (next !== n.svg) n.svg = next
      }
    }
  }
}
