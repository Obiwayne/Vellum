// Where a font family comes from, for `HandoffOptions.fontSource` (H3 prints the licence line from it).
// Nothing is downloaded or bundled: the family is named and its source stated.
import type { FontSource } from '../types'

export interface FontKnowledge {
  /** families the app can load from Google Fonts */
  google: Iterable<string>
  /** families installed on this PC (queryLocalFonts), when known */
  local?: Iterable<string>
}

const GENERIC = new Set(['system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded', 'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', '-apple-system', 'blinkmacsystemfont'])

export function fontSourceFor(known: FontKnowledge): (family: string) => FontSource {
  const google = new Set([...known.google].map((f) => f.toLowerCase()))
  const local = new Set([...(known.local ?? [])].map((f) => f.toLowerCase()))
  return (family) => {
    const f = family.trim().replace(/^["']|["']$/g, '').toLowerCase()
    if (GENERIC.has(f)) return 'system'
    if (google.has(f)) return 'google'
    if (local.has(f)) return 'local'
    return 'unknown'
  }
}
