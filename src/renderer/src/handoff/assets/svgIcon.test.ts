// @vitest-environment jsdom
// svgIcon uses the app's DOM based sanitiser, so these run with a DOM.
import { describe, expect, it } from 'vitest'
import { iconDocument, monochrome, optimiseSvg, unsafeSvg } from './svgIcon'

const doc = (inner: string, attrs: Record<string, string> = { viewBox: '0 0 24 24' }): string => iconDocument(inner, attrs)

describe('optimiseSvg', () => {
  it('a stroke icon from the picker keeps its drawing and follows the text colour', () => {
    const r = optimiseSvg(doc('<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>', { viewBox: '0 0 24 24', fill: 'none', stroke: '#111111', 'stroke-width': '2', 'stroke-linecap': 'round' }))!
    expect(r).toMatchObject({ recoloured: true, was: '#111111', multiColour: false })
    expect(r.svg).toContain('stroke="currentColor"')
    expect(r.svg).not.toContain('#111111')
    expect(r.svg).toContain('viewBox="0 0 24 24"')
    expect(r.svg).toContain('M5 12h14')
  })

  it('a single fill colour on the children is recoloured, named colours and #rgb count as the same colour', () => {
    const r = optimiseSvg(doc('<path fill="#F00" d="M0 0h5v5H0z"/><path fill="red" d="M6 6h5v5H6z"/>'))!
    expect(r.recoloured).toBe(true)
    expect(r.svg).toContain('currentColor')
    expect(r.svg).not.toMatch(/#f00|red/i)
  })

  it('two colours are left as drawn and flagged', () => {
    const r = optimiseSvg(doc('<path fill="#ff0000" d="M0 0h5v5H0z"/><path fill="#0000ff" d="M6 6h5v5H6z"/>'))!
    expect(r.recoloured).toBe(false)
    expect(r.multiColour).toBe(true)
    expect(r.svg).not.toContain('currentColor')
  })

  it('gradients are never single colour', () => {
    const r = optimiseSvg(doc('<defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/>'))!
    expect(r.recoloured).toBe(false)
    expect(r.multiColour).toBe(true)
  })

  it('an icon with no explicit colour is not guessed at', () => {
    const r = optimiseSvg(doc('<path d="M0 0h5v5H0z"/>'))!
    expect(r.recoloured).toBe(false)
    expect(r.multiColour).toBe(false)
  })

  it('scripts and handlers never survive', () => {
    const r = optimiseSvg(doc('<script>alert(1)</script><rect width="5" height="5" fill="#f00" onclick="alert(2)"/><a href="javascript:alert(3)"><rect width="1" height="1"/></a>'))
    const out = r ? r.svg : ''
    expect(out).not.toMatch(/script|onclick|javascript:|alert/i)
  })

  it('output is stable: the same markup gives the same bytes', () => {
    const a = optimiseSvg(doc('<path stroke="#111" d="M5 12h14"/>'))
    const b = optimiseSvg(doc('<path stroke="#111" d="M5 12h14"/>'))
    expect(a?.svg).toBe(b?.svg)
  })

  it('ids are prefixed so two icons inlined together cannot clash', () => {
    const r = optimiseSvg(doc('<defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/>'))!
    expect(r.svg).not.toMatch(/id="g"/)
  })
})

describe('monochrome', () => {
  it('reads attributes and inline style, ignores none and currentColor', () => {
    expect(monochrome('<svg fill="none"><path stroke="#111"/><path style="stroke: #111111"/></svg>')).toEqual({ colour: '#111111' })
    expect(monochrome('<svg><path stroke="currentColor"/></svg>')).toEqual({ colour: null, multi: false })
    expect(monochrome('<svg><style>.a{fill:red}</style></svg>')).toEqual({ colour: null, multi: true })
  })
})

describe('unsafeSvg', () => {
  it.each([
    ['<svg><script>x</script></svg>', 'active element'],
    ['<svg><foreignObject/></svg>', 'active element'],
    ['<svg><rect onload="x"/></svg>', 'event handler'],
    ['<svg><a href="javascript:x"/></svg>', 'script URL'],
    ['<svg><image href="https://evil/x.png"/></svg>', 'external reference'],
    ['<svg><rect fill="url(https://evil/x)"/></svg>', 'external url()']
  ])('%s', (svg, why) => expect(unsafeSvg(svg)).toBe(why))
  it('ordinary icons pass', () => expect(unsafeSvg('<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>')).toBeNull())
})
