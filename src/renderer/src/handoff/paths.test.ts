import { describe, expect, it } from 'vitest'
import { PathRegistry, assertSafePaths, slug, unsafePath } from './paths'

describe('slug', () => {
  it.each([
    ['Checkout screen', 'checkout-screen'],
    ['  Héllo Wörld!  ', 'hello-world'],
    ['Button / Large', 'button-large'],
    ['---', 'untitled'],
    ['', 'untitled'],
    ['日本語', 'untitled'],
    ['CON', 'con-1'],
    ['nul', 'nul-1'],
    ['COM1', 'com1-1'],
    ['lpt9', 'lpt9-1']
  ])('%j becomes %j', (input, expected) => expect(slug(input)).toBe(expected))

  it('never produces a path piece, a dot or a long name from hostile input', () => {
    for (const hostile of ['../../x', 'C:\Windows\System32', '/etc/passwd', 'a'.repeat(400), 'x\u0000y', '<script>', 'a/b\c']) {
      const s = slug(hostile)
      expect(s).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(s.length).toBeLessThanOrEqual(48)
      expect(unsafePath(`screens/${s}.md`)).toBeNull()
    }
  })
})

describe('PathRegistry', () => {
  it('hands out each path once and suffixes the next with -2, -3 before the extension', () => {
    const r = new PathRegistry()
    expect(r.take('screens', 'home', '.md')).toBe('screens/home.md')
    expect(r.take('screens', 'home', '.md')).toBe('screens/home-2.md')
    expect(r.take('screens', 'home', '.md')).toBe('screens/home-3.md')
    expect(r.take('screens', 'home', '.png')).toBe('screens/home.png')
  })

  it('compares case-insensitively (Windows) and keeps fixed paths out of reach', () => {
    const r = new PathRegistry()
    r.reserve('HANDOFF.md')
    expect(r.take('', 'handoff', '.md')).toBe('handoff-2.md')
    expect(r.take('a', 'X', '.md')).toBe('a/X.md')
    expect(r.take('a', 'x', '.md')).toBe('a/x-2.md')
  })
})

describe('unsafePath and assertSafePaths', () => {
  it.each([
    ['', 'empty'],
    ['a\b.md', 'backslash'],
    ['/abs.md', 'absolute'],
    ['C:/x.md', 'absolute'],
    ['../x.md', 'dot'],
    ['a/../x.md', 'dot'],
    ['a//b.md', 'dot or empty'],
    ['a/b?.md', 'character'],
    ['assets/con.png', 'reserved'],
    ['assets/NUL.txt', 'reserved']
  ])('%j is refused (%s)', (path) => expect(unsafePath(path)).not.toBeNull())

  it('accepts ordinary bundle paths', () => {
    for (const p of ['HANDOFF.md', '.handoff.json', 'screens/checkout.desktop.png', 'tokens/tokens.css', 'assets/images/hero@2x.jpg']) expect(unsafePath(p)).toBeNull()
  })

  it('throws on the first unsafe or duplicate path', () => {
    expect(() => assertSafePaths(['a.md', '../b.md'])).toThrow(/Unsafe bundle path/)
    expect(() => assertSafePaths(['a.md', 'A.md'])).toThrow(/Duplicate/)
    expect(() => assertSafePaths(['a.md', 'b.md'])).not.toThrow()
  })
})
