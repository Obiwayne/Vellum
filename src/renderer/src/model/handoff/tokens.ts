// Token files of the bundle: tokens.css (one block per mode), tokens.json (W3C Design Tokens format, one group
// per mode) and tailwind.css (a Tailwind v4 @theme block of the base mode). Only used tokens are written.
import type { Doc, Token } from '../types'
import { BASE_MODE, tokenUse, type TokenUse } from '../devSpec'
import { modesOf, tokensCssWithModes } from '../modes'
import type { Scope } from './scope'
import type { TokenSpec } from './types'

/** The tokens of the scope in name order (the order is the same however the doc stores them). */
export function usedTokens(doc: Doc, scope: Scope): Token[] {
  return doc.tokens.filter((t) => scope.tokens.has(t.name)).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

export function tokenSpecs(doc: Doc, scope: Scope, precision: number): TokenSpec[] {
  const out: TokenSpec[] = []
  for (const t of usedTokens(doc, scope)) {
    const u = tokenUse(doc, t.name, precision)
    if (u) out.push({ name: u.name, type: u.type, values: u.values, usage: scope.tokenUsage.get(t.name) ?? 0 })
  }
  return out
}

const HEADER = '/* Generated from a Vellum design. Values here are the source of truth; names are suggestions. */\n'

export function tokensCss(doc: Doc, scope: Scope): string {
  const used = usedTokens(doc, scope)
  const css = tokensCssWithModes(doc, used, true)
  return `${HEADER}${css ? `${css}\n` : '/* no design tokens are used by the exported frames */\n'}`
}

interface DtcgToken {
  $type?: 'color' | 'dimension' | 'number'
  $value: string | number
  $extensions: { vellum: { name: string; value: string; oklch?: string } }
}

const dtcgType = (t: TokenUse['type']): DtcgToken['$type'] =>
  t === 'color' ? 'color' : t === 'length' ? 'dimension' : t === 'number' ? 'number' : undefined

/** DTCG: names lose their `--`; each mode is a top-level group (`base` when the document has no modes). */
export function tokensJson(doc: Doc, specs: TokenSpec[]): string {
  const modes = modesOf(doc)
  const keys = modes.length ? modes : [BASE_MODE]
  const out: Record<string, Record<string, DtcgToken>> = {}
  for (const mode of keys) {
    const group: Record<string, DtcgToken> = {}
    for (const t of specs) {
      const v = t.values[mode]
      if (!v) continue
      const type = dtcgType(t.type)
      const ext: DtcgToken['$extensions']['vellum'] = { name: t.name, value: v.value }
      if (/^okl(ch|ab)\(/i.test(v.value)) ext.oklch = v.value
      let value: string | number = v.hex8 ?? v.value
      if (t.type === 'number') value = Number(v.value)
      const tok: DtcgToken = type ? { $type: type, $value: value, $extensions: { vellum: ext } } : { $value: value, $extensions: { vellum: ext } }
      group[t.name.replace(/^--/, '')] = tok
    }
    out[mode] = group
  }
  return `${JSON.stringify(out, null, 2)}\n`
}

/** Tailwind v4: an @theme block with the base mode; other modes are named in a comment. */
export function tailwindCss(doc: Doc, scope: Scope): string {
  const used = usedTokens(doc, scope)
  const modes = modesOf(doc)
  const lines = [
    '/* Tailwind CSS v4. Paste into your stylesheet after @import "tailwindcss"; */',
    modes.length > 1
      ? `/* Base mode "${modes[0]}". Other modes (${modes.slice(1).join(', ')}) are in tokens.css under [data-mode="…"]. */`
      : '/* Single mode. */',
    '@theme {'
  ]
  for (const t of used) lines.push(`  ${t.name}: ${t.value};`)
  lines.push('}')
  return `${lines.join('\n')}\n`
}
