import { describe, expect, it } from 'vitest'
import { containerRedlines, redlines, relationOf, type RedRect } from './redlines'

const r = (x: number, y: number, width: number, height: number, rotated = false): RedRect => ({ x, y, width, height, ...(rotated ? { rotated: true } : {}) })
const vals = (lines: ReturnType<typeof redlines>['lines']): string[] => lines.map((l) => `${l.kind}:${l.axis}:${l.label}`)

describe('relationOf', () => {
  it.each([
    [r(0, 0, 100, 100), r(200, 0, 50, 50), 'separate'],
    [r(0, 0, 100, 100), r(100, 20, 50, 50), 'touching'],
    [r(0, 0, 100, 100), r(50, 50, 100, 100), 'overlap'],
    [r(0, 0, 100, 100), r(10, 10, 20, 20), 'contains'],
    [r(10, 10, 20, 20), r(0, 0, 100, 100), 'contained'],
    [r(0, 0, 100, 100), r(0, 0, 100, 100), 'contains']
  ] as const)('%j against %j is %s', (a, b, expected) => expect(relationOf(a, b)).toBe(expected))
})

describe('separate layers: the gap between facing edges', () => {
  it('measures a horizontal gap at the middle of the shared height', () => {
    const res = redlines(r(0, 0, 100, 100), r(180, 20, 40, 40))
    expect(res.relation).toBe('separate')
    expect(vals(res.lines)).toEqual(['gap:x:80'])
    const l = res.lines[0]
    expect(l.from).toEqual({ x: 100, y: 40 })
    expect(l.to).toEqual({ x: 180, y: 40 })
  })

  it('measures a vertical gap, and both gaps for a diagonal neighbour', () => {
    expect(vals(redlines(r(0, 0, 100, 50), r(10, 120, 30, 30)).lines)).toEqual(['gap:y:70'])
    const diag = redlines(r(0, 0, 100, 100), r(130, 160, 20, 20))
    expect(vals(diag.lines)).toEqual(['gap:x:30', 'gap:y:60'])
  })

  it('works when the other layer is above or to the left', () => {
    const res = redlines(r(200, 200, 50, 50), r(0, 0, 100, 100))
    expect(vals(res.lines)).toEqual(['gap:x:100', 'gap:y:100'])
    expect(res.lines[0].from.x).toBeLessThan(res.lines[0].to.x)
  })

  it('keeps fractional distances to 2 decimals with trailing zeros trimmed', () => {
    expect(vals(redlines(r(0, 0, 100.25, 10), r(120.5, 0, 10, 10)).lines)).toEqual(['gap:x:20.25'])
    expect(vals(redlines(r(0, 0, 100, 10), r(110.333, 0, 10, 10)).lines)).toEqual(['gap:x:10.33'])
    expect(vals(redlines(r(0, 0, 100, 10), r(110.5, 0, 10, 10), null, 0).lines)).toEqual(['gap:x:11'])
  })
})

describe('touching layers', () => {
  it('side by side: no zero gap is drawn, the vertical offsets are', () => {
    const res = redlines(r(0, 0, 100, 100), r(100, 20, 50, 50))
    expect(res.relation).toBe('touching')
    expect(vals(res.lines)).toEqual(['offset:y:20', 'offset:y:30'])
  })

  it('stacked: only the horizontal offsets', () => {
    const res = redlines(r(0, 0, 100, 100), r(10, 100, 60, 40))
    expect(vals(res.lines)).toEqual(['offset:x:10', 'offset:x:30'])
  })

  it('identical rects have nothing to measure', () => {
    expect(redlines(r(0, 0, 10, 10), r(0, 0, 10, 10)).lines).toEqual([])
  })
})

describe('overlap and containment: edge to edge', () => {
  it('a child inside the hovered layer gets its four insets, zero ones left out', () => {
    const res = redlines(r(20, 30, 40, 40), r(0, 0, 100, 100))
    expect(res.relation).toBe('contained')
    expect(vals(res.lines)).toEqual(['offset:x:20', 'offset:x:40', 'offset:y:30', 'offset:y:30'])
    expect(vals(redlines(r(0, 30, 40, 40), r(0, 0, 100, 100)).lines)).toEqual(['offset:x:60', 'offset:y:30', 'offset:y:30'])
  })

  it('partial overlap shows how far the edges are apart', () => {
    const res = redlines(r(0, 0, 100, 100), r(60, 40, 100, 100))
    expect(res.relation).toBe('overlap')
    expect(vals(res.lines)).toEqual(['offset:x:60', 'offset:x:60', 'offset:y:40', 'offset:y:40'])
  })
})

describe('parent insets', () => {
  it('measures the four edges to the parent, drawn at the selection', () => {
    const res = redlines(r(20, 10, 60, 40), null, r(0, 0, 100, 100))
    expect(res.relation).toBeNull()
    expect(vals(res.lines)).toEqual(['inset:x:20', 'inset:x:20', 'inset:y:10', 'inset:y:50'])
    expect(res.lines[0].from).toEqual({ x: 0, y: 30 })
    expect(res.lines[0].to).toEqual({ x: 20, y: 30 })
  })

  it('adds to the hovered distances', () => {
    const res = redlines(r(20, 10, 60, 40), r(0, 200, 10, 10), r(0, 0, 100, 100))
    expect(res.lines.some((l) => l.kind === 'gap')).toBe(true)
    expect(res.lines.filter((l) => l.kind === 'inset')).toHaveLength(4)
  })

  it('is ignored for a parent the selection is not inside of', () => {
    expect(redlines(r(500, 500, 10, 10), null, r(0, 0, 100, 100)).lines).toEqual([])
  })

  it('a rotated parent gives no insets', () => {
    expect(redlines(r(20, 10, 60, 40), null, r(0, 0, 100, 100, true)).lines).toEqual([])
  })
})

describe('rotated layers', () => {
  it('a rotated selection is skipped with a reason', () => {
    const res = redlines(r(0, 0, 100, 100, true), r(200, 0, 10, 10), r(0, 0, 500, 500))
    expect(res).toEqual({ relation: null, lines: [], skipped: 'rotated' })
  })

  it('a rotated hovered layer is skipped too, parent insets included', () => {
    const res = redlines(r(0, 0, 100, 100), r(200, 0, 10, 10, true), r(0, 0, 500, 500))
    expect(res.skipped).toBe('rotated')
    expect(res.lines).toEqual([])
  })
})

describe('nothing selected', () => {
  it('has no lines', () => {
    expect(redlines(null, r(0, 0, 1, 1), r(0, 0, 5, 5))).toEqual({ relation: null, lines: [] })
  })
})

describe('containerRedlines: padding and gaps of a flex or grid container', () => {
  const box = r(0, 0, 400, 200)
  const kids = [r(16, 16, 100, 50), r(136, 16, 100, 50), r(256, 16, 100, 50)]

  it('measures padding on four sides at the middle of each edge, zero sides left out', () => {
    const ls = containerRedlines({ box, padding: [16, 44, 0, 16], children: [] })
    expect(ls.map((l) => `${l.kind}:${l.axis}:${l.label}`)).toEqual(['padding:y:16', 'padding:x:44', 'padding:x:16'])
    expect(ls[0].from).toEqual({ x: 200, y: 0 })
    expect(ls[0].to).toEqual({ x: 200, y: 16 })
    expect(ls[1].from).toEqual({ x: 356, y: 100 })
    expect(ls[1].to).toEqual({ x: 400, y: 100 })
  })

  it('measures the gap between neighbours in a row, once each', () => {
    const ls = containerRedlines({ box, padding: [0, 0, 0, 0], children: kids })
    expect(ls.map((l) => `${l.kind}:${l.axis}:${l.label}`)).toEqual(['spacing:x:20', 'spacing:x:20'])
    expect(ls[0].from).toEqual({ x: 116, y: 41 })
    expect(ls[0].to).toEqual({ x: 136, y: 41 })
  })

  it('measures vertical gaps in a column', () => {
    const col = [r(0, 0, 100, 40), r(0, 52, 100, 40), r(0, 104, 100, 40)]
    const ls = containerRedlines({ box: r(0, 0, 100, 144), padding: [0, 0, 0, 0], children: col })
    expect(ls.map((l) => `${l.axis}:${l.label}`)).toEqual(['y:12', 'y:12'])
  })

  it('shows row and column gaps of a grid, and a different last gap', () => {
    const grid = [r(0, 0, 50, 50), r(60, 0, 50, 50), r(0, 70, 50, 50), r(60, 70, 50, 50)]
    const ls = containerRedlines({ box: r(0, 0, 110, 120), padding: [0, 0, 0, 0], children: grid })
    const got = ls.map((l) => `${l.axis}:${l.label}`).sort()
    expect(got).toEqual(['x:10', 'x:10', 'y:20', 'y:20'])
  })

  it('draws nothing for a rotated container, and caps the number of gaps', () => {
    expect(containerRedlines({ box: r(0, 0, 400, 200, true), padding: [8, 8, 8, 8], children: kids })).toEqual([])
    const many = Array.from({ length: 200 }, (_, i) => r(i * 12, 0, 10, 10))
    const ls = containerRedlines({ box: r(0, 0, 2400, 10), padding: [0, 0, 0, 0], children: many })
    expect(ls.filter((l) => l.kind === 'spacing').length).toBe(60)
  })

  it('overlapping or touching children have no gap', () => {
    const ls = containerRedlines({ box, padding: [0, 0, 0, 0], children: [r(0, 0, 100, 50), r(100, 0, 100, 50), r(150, 0, 100, 50)] })
    expect(ls).toEqual([])
  })
})
