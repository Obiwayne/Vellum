// T67 test station: cases the build station's tests leave open.
import { beforeEach, describe, expect, it } from 'vitest'
import { getStore, useStore } from '../../model/store'
import { redlines, relationOf } from '../../model/redlines'
import type { CNode, Doc, WorldRect } from '../../model/types'
import { redlineScene } from './redlineScene'

const S = getStore
let id: string
const doc = (): Doc => S().docs[id]

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true)
  id = S().createDoc('Redlines', { open: false })
})

const R = (x: number, y: number, width: number, height: number): WorldRect => ({ x, y, width, height })

describe('pure geometry: degenerate and awkward input', () => {
  it('zero-size and negative-size rects never produce NaN, Infinity or negative values', () => {
    const cases: Array<[WorldRect, WorldRect]> = [
      [R(0, 0, 0, 0), R(10, 10, 0, 0)],
      [R(0, 0, 10, 10), R(20, 20, -5, -5)],
      [R(5, 5, 10, 10), R(5, 5, 10, 10)]
    ]
    for (const [a, b] of cases) {
      const r = redlines(a, b, R(-100, -100, 500, 500))
      for (const l of r.lines) {
        expect(Number.isFinite(l.value), JSON.stringify(l)).toBe(true)
        expect(l.value).toBeGreaterThan(0)
        for (const p of [l.from.x, l.from.y, l.to.x, l.to.y]) expect(Number.isFinite(p)).toBe(true)
        expect(l.label).not.toMatch(/NaN|Infinity|-/)
      }
    }
  })

  it('a layer that overflows its parent still gets labelled, positive distances', () => {
    const r = redlines(R(-20, 10, 100, 50), null, R(0, 0, 200, 100))
    expect(r.lines.length).toBeGreaterThan(0)
    expect(r.lines.every((l) => l.value > 0 && /^\d+(\.\d+)?$/.test(l.label))).toBe(true)
  })

  it('precision is honoured and large coordinates stay exact', () => {
    const r = redlines(R(1e6, 1e6, 10, 10), R(1e6 + 30.12345, 1e6, 10, 10), null, 2)
    expect(r.lines[0].label).toBe('20.12')
  })

  it('relation is symmetric for separate, overlap and nesting', () => {
    const a = R(0, 0, 100, 100)
    const inner = R(10, 10, 20, 20)
    expect(relationOf(a, inner)).toBe('contains')
    expect(relationOf(inner, a)).toBe('contained')
    expect(relationOf(a, R(200, 0, 10, 10))).toBe('separate')
    expect(relationOf(R(200, 0, 10, 10), a)).toBe('separate')
  })
})

describe('scene: selection and hover edge cases', () => {
  function tree() {
    const root = doc().pages[0].rootId
    const frame = S().createNode(id, { type: 'frame', name: 'Card', style: { width: 400, height: 300 } }, root)
    const a = S().createNode(id, { type: 'frame', name: 'A', style: { width: 100, height: 50 } }, frame)
    const b = S().createNode(id, { type: 'frame', name: 'B', style: { width: 100, height: 50 } }, frame)
    const inner = S().createNode(id, { type: 'rect', name: 'Inner', style: { width: 10, height: 10 } }, a)
    const rects = new Map<string, WorldRect>([
      [frame, R(0, 0, 400, 300)],
      [a, R(20, 20, 100, 50)],
      [b, R(220, 20, 100, 50)],
      [inner, R(30, 30, 10, 10)]
    ])
    return { root, frame, a, b, inner, rects }
  }
  const input = (over: Partial<Parameters<typeof redlineScene>[0]>): Parameters<typeof redlineScene>[0] => ({
    doc: doc(),
    selection: [],
    hovered: null,
    devMode: true,
    rects: new Map(),
    isRotated: (_n: CNode) => false,
    ...over
  })

  it('hovering a descendant of the selection measures it as nested, not as a neighbour', () => {
    const t = tree()
    const s = redlineScene(input({ selection: [t.a], hovered: t.inner, rects: t.rects }))!
    expect(s.relation).toBe('contains')
    expect(s.lines.filter((l) => l.kind === 'offset').map((l) => l.label).sort()).toEqual(['10', '10', '30', '80'].sort())
  })

  it('hovering an ancestor that is not the direct parent measures the offsets once', () => {
    const t = tree()
    const s = redlineScene(input({ selection: [t.inner], hovered: t.frame, rects: t.rects }))!
    // inner sits in A (direct parent): its insets to A plus the offsets to the hovered Card
    expect(s.lines.some((l) => l.kind === 'inset')).toBe(true)
    expect(s.lines.some((l) => l.kind === 'offset')).toBe(true)
  })

  it('an unknown hovered id and a selection that was deleted draw nothing and do not throw', () => {
    const t = tree()
    expect(() => redlineScene(input({ selection: [t.a], hovered: 'nope', rects: t.rects }))).not.toThrow()
    expect(redlineScene(input({ selection: ['gone'], rects: t.rects }))).toBeNull()
  })

  it('hovering the page root measures nothing against it', () => {
    const t = tree()
    const s = redlineScene(input({ selection: [t.frame], hovered: t.root, rects: new Map([...t.rects, [t.root, R(0, 0, 9999, 9999)]]) }))
    expect(s).toBeNull()
  })

  // T67-F1 (fixed): a layer inside a rotated or scaled ancestor is drawn as its bounding box, so it counts as rotated.
  it('a layer inside a rotated parent is treated as rotated: no distances, a "rotated" note', () => {
    const t = tree()
    const s = redlineScene(input({ selection: [t.a], hovered: t.b, rects: t.rects, isRotated: (n) => n.id === t.frame }))
    expect(s?.skipped).toBe('rotated')
    expect(s?.lines ?? []).toEqual([])
  })
})
