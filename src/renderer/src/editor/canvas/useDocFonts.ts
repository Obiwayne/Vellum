// Loads the web fonts a document uses so the canvas renders them (e.g. "Inter" written by the agent
// or restored from disk). Generic/system families are skipped; unknown families are tried against
// Google Fonts once and cached by loadGoogleFont.
import { useEffect } from 'react'
import type { Doc } from '../../model/types'
import { loadGoogleFont } from '../inspector/fonts'

const GENERIC = new Set([
  'system-ui', 'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', 'ui-sans-serif', 'ui-serif',
  'ui-monospace', '-apple-system', 'blinkmacsystemfont', 'inherit', 'initial'
])

function families(value: string, tokens: Map<string, string>, out: Set<string>, depth = 0): void {
  for (const part of value.split(',')) {
    const raw = part.trim()
    const v = /^var\((--[\w-]+)/.exec(raw)
    if (v) {
      const t = tokens.get(v[1])
      if (t && depth < 4) families(t, tokens, out, depth + 1)
      continue
    }
    const name = raw.replace(/^["']|["']$/g, '')
    if (name && !GENERIC.has(name.toLowerCase())) out.add(name)
  }
}

/** Start loading the web fonts used by these nodes/tokens (no-op for fonts already available). */
export function loadDocFonts(nodes: Doc['nodes'], tokenList: Doc['tokens'] | undefined): void {
  const tokens = new Map((tokenList ?? []).map((t) => [t.name, t.value]))
  const out = new Set<string>()
  for (const n of Object.values(nodes)) {
    const f = n.style.fontFamily
    if (f != null) families(String(f), tokens, out)
  }
  for (const name of out) {
    if (document.fonts.check(`16px "${name}"`) && [...document.fonts].some((f) => f.family.replace(/"/g, '') === name)) continue
    void loadGoogleFont(name)
  }
}

export function useDocFonts(doc: Doc | undefined): void {
  const nodes = doc?.nodes
  const tokenList = doc?.tokens
  useEffect(() => {
    if (nodes) loadDocFonts(nodes, tokenList)
  }, [nodes, tokenList])
}
