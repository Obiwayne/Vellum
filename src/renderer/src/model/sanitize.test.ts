import { describe, expect, it } from 'vitest'
import { safeUrl } from '@renderer/model/sanitize'

describe('safeUrl', () => {
  it('allows http(s) and relative links, rejects script URLs', () => {
    expect(safeUrl('https://example.com', 'link')).toBe(true)
    expect(safeUrl('a/b.png', 'image')).toBe(true)
    expect(safeUrl('javascript:alert(1)', 'link')).toBe(false)
  })

  it('only allows same-document fragments for fragment kind', () => {
    expect(safeUrl('#grad', 'fragment')).toBe(true)
    expect(safeUrl('https://x.com/a.svg#grad', 'fragment')).toBe(false)
  })
})
