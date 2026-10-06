// T38: oklch() colours (the whole starter theme uses them) must parse, so pickers can list and preview them.
import { describe, expect, it } from 'vitest'
import { parseColor } from './color'

describe('parseColor with oklch()', () => {
  it('reads oklch() without needing a browser canvas', () => {
    const c = parseColor('oklch(62.3% 0.214 258)')
    expect(c).not.toBeNull()
    // a saturated blue: blue channel dominant, fully opaque
    expect(c!.b).toBeGreaterThan(c!.r)
    expect(c!.b).toBeGreaterThan(c!.g)
    expect(c!.a).toBe(1)
  })
})
