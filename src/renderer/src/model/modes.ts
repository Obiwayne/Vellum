// Theme modes (e.g. Light / Dark): one set of tokens with a value per mode. `doc.modes[0]` is the
// base mode, whose values are `token.value`; other modes override values in `token.modes[mode]`.
// A frame picks a mode with the `data-mode` attribute; its token values are applied as CSS custom
// properties on that frame, so they cascade to everything inside it (plain CSS, like exports).
import type { CNode, Doc, Token } from './types'

export const MODE_ATTR = 'data-mode'

export const modesOf = (doc: Doc | undefined): string[] => (doc?.modes && doc.modes.length > 1 ? doc.modes : [])

/** Value of a token in a mode (base value when the mode has no override). */
export function tokenValueIn(doc: Doc, t: Token, mode: string | null | undefined): string {
  const modes = modesOf(doc)
  if (!mode || !modes.length || mode === modes[0]) return t.value
  return t.modes?.[mode] ?? t.value
}

/** The mode a node sets itself (only modes that exist in the doc). */
export function nodeMode(doc: Doc, n: CNode | undefined): string | null {
  const m = n?.attrs?.[MODE_ATTR]
  return m && modesOf(doc).includes(m) ? m : null
}

/** Mode in effect at a node: its own, else the nearest ancestor's, else null (base). */
export function effectiveMode(doc: Doc, id: string): string | null {
  let cur: string | null = id
  const seen = new Set<string>()
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    const n: CNode | undefined = doc.nodes[cur]
    const m = nodeMode(doc, n)
    if (m) return m
    cur = n?.parent ?? null
  }
  return null
}

/** CSS custom properties a node with a mode applies (every token, so nested modes fully reset). */
export function modeVars(doc: Doc, mode: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const t of doc.tokens) if (/^--[\w-]+$/.test(t.name)) out[t.name] = tokenValueIn(doc, t, mode)
  return out
}

/** `:root{…}` plus one `[data-mode="X"]{…}` block per extra mode (for exports and get_tokens css). */
export function tokensCssWithModes(doc: Doc, tokens: Token[] = doc.tokens, pretty = false): string {
  const valid = tokens.filter((t) => /^--[\w-]+$/.test(t.name))
  if (!valid.length) return ''
  const block = (sel: string, list: Array<[string, string]>): string =>
    pretty ? `${sel} {\n${list.map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}` : `${sel}{${list.map(([k, v]) => `${k}:${v}`).join(';')}}`
  const modes = modesOf(doc)
  const out = [block(':root', valid.map((t) => [t.name, t.value]))]
  for (const m of modes) {
    // the base mode also gets a block so a nested frame can switch back to it
    const list = valid.map((t): [string, string] => [t.name, tokenValueIn(doc, t, m)])
    out.push(block(`[${MODE_ATTR}="${m.replace(/["\\]/g, '')}"]`, list))
  }
  return out.join(pretty ? '\n\n' : '')
}

export const MODE_NAME_RE = /^[A-Za-z0-9][\w -]{0,31}$/
