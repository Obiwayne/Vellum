import { beforeEach, describe, expect, it } from 'vitest'
import { getStore, useStore } from '../../model/store'
import type { CNode, Doc, WorldRect } from '../../model/types'
import { redlineScene, sceneExtraIds } from './redlineScene'
import { hoverPick } from './selection'

const S = getStore
let id: string
const doc = (): Doc => S().docs[id]

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true)
  id = S().createDoc('Redlines', { open: false })
})

/** A frame with two children; rects are given by the test, as the overlay would measure them. */
function scene() {
  const root = doc().pages[0].rootId
  const frame = S().createNode(id, { type: 'frame', name: 'Card', style: { width: 400, height: 300 } }, root)
  const a = S().createNode(id, { type: 'frame', name: 'A', style: { width: 100, height: 50 } }, frame)
  const b = S().createNode(id, { type: 'frame', name: 'B', style: { width: 100, height: 50 } }, frame)
  const rects = new Map<string, WorldRect>([
    [frame, { x: 0, y: 0, width: 400, height: 300 }],
    [a, { x: 20, y: 20, width: 100, height: 50 }],
    [b, { x: 220, y: 20, width: 100, height: 50 }]
  ])
  return { root, frame, a, b, rects }
}

const base = (over: Partial<Parameters<typeof redlineScene>[0]>) => ({
  doc: doc(),
  selection: [] as string[],
  hovered: null as string | null,
  devMode: true,
  rects: new Map<string, WorldRect>(),
  isRotated: (_n: CNode) => false,
  ...over
})

describe('redline scene', () => {
  it('is empty outside Dev Mode, with no selection, and while a gesture runs', () => {
    const s = scene()
    expect(redlineScene(base({ selection: [s.a], hovered: s.b, rects: s.rects, devMode: false }))).toBeNull()
    expect(redlineScene(base({ selection: [], hovered: s.b, rects: s.rects }))).toBeNull()
    expect(redlineScene(base({ selection: [s.a], hovered: s.b, rects: s.rects, gesturing: true }))).toBeNull()
  })

  it('selected -> hovered gap and selected -> parent insets', () => {
    const s = scene()
    const r = redlineScene(base({ selection: [s.a], hovered: s.b, rects: s.rects }))!
    const gap = r.lines.filter((l) => l.kind === 'gap')
    expect(gap.map((l) => l.label)).toEqual(['100'])
    const inset = r.lines.filter((l) => l.kind === 'inset')
    expect(inset.map((l) => `${l.axis}:${l.label}`)).toEqual(['x:20', 'x:280', 'y:20', 'y:230'])
  })

  it('hovering the parent shows the offsets once, not twice', () => {
    const s = scene()
    const r = redlineScene(base({ selection: [s.a], hovered: s.frame, rects: s.rects }))!
    expect(r.relation).toBe('contained')
    expect(r.lines.every((l) => l.kind === 'offset')).toBe(true)
    expect(r.lines).toHaveLength(4)
  })

  it('shows only the parent insets when nothing is hovered, and none for a top-level frame', () => {
    const s = scene()
    const r = redlineScene(base({ selection: [s.a], rects: s.rects }))!
    expect(r.lines.every((l) => l.kind === 'inset')).toBe(true)
    expect(redlineScene(base({ selection: [s.frame], rects: s.rects }))).toBeNull()
  })

  it('hovering a selected layer measures nothing against itself', () => {
    const s = scene()
    const r = redlineScene(base({ selection: [s.a], hovered: s.a, rects: s.rects }))!
    expect(r.relation).toBeNull()
  })

  it('a multi-selection is measured as one box and gets no parent insets', () => {
    const s = scene()
    const r = redlineScene(base({ selection: [s.a, s.b], hovered: s.frame, rects: s.rects }))!
    expect(r.lines.every((l) => l.kind === 'offset')).toBe(true)
    const withParent = redlineScene(base({ selection: [s.a, s.b], rects: s.rects }))
    expect(withParent).toBeNull()
  })

  it('a rotated selection says rotated and measures nothing', () => {
    const s = scene()
    const r = redlineScene(base({ selection: [s.a], hovered: s.b, rects: s.rects, isRotated: (n) => n.id === s.a }))!
    expect(r.skipped).toBe('rotated')
    expect(r.lines).toEqual([])
    expect(r.noteAt).toEqual(s.rects.get(s.a))
  })

  it('a rotated hovered layer says rotated at that layer', () => {
    const s = scene()
    const r = redlineScene(base({ selection: [s.a], hovered: s.b, rects: s.rects, isRotated: (n) => n.id === s.b }))!
    expect(r.skipped).toBe('rotated')
    expect(r.noteAt).toEqual(s.rects.get(s.b))
  })

  it('waits for measurements: a selected layer with no rect draws nothing', () => {
    const s = scene()
    s.rects.delete(s.a)
    expect(redlineScene(base({ selection: [s.a], hovered: s.b, rects: s.rects }))).toBeNull()
  })

  it('asks for the parent rect only for a single selection in Dev Mode', () => {
    const s = scene()
    expect(sceneExtraIds(doc(), [s.a], true)).toEqual([s.frame])
    expect(sceneExtraIds(doc(), [s.a], false)).toEqual([])
    expect(sceneExtraIds(doc(), [s.a, s.b], true)).toEqual([])
    expect(sceneExtraIds(doc(), [s.frame], true)).toEqual([])
  })
})

describe('flex and grid containers: padding, gaps and size chips', () => {
  function row() {
    const root = doc().pages[0].rootId
    const f = S().createNode(
      id,
      { type: 'frame', name: 'Row', style: { display: 'flex', flexDirection: 'row', gap: 20, padding: 16, width: 400, height: 100 } },
      root
    )
    const a = S().createNode(id, { type: 'frame', name: 'A', style: { width: 100, height: 50 } }, f)
    const b = S().createNode(id, { type: 'frame', name: 'B', style: { width: 100, height: 50 } }, f)
    const hidden = S().createNode(id, { type: 'frame', name: 'H', style: { width: 10, height: 10 } }, f)
    S().updateNode(id, hidden, { visible: false })
    const rects = new Map<string, WorldRect>([
      [f, { x: 0, y: 0, width: 400, height: 100 }],
      [a, { x: 16, y: 16, width: 100, height: 50 }],
      [b, { x: 136, y: 16, width: 100, height: 50 }]
    ])
    return { f, a, b, rects, hidden }
  }

  it('a selected flex container shows its padding and the gap between children', () => {
    const s = row()
    const r = redlineScene(base({ selection: [s.f], rects: s.rects }))!
    expect(r.lines.filter((l) => l.kind === 'padding').map((l) => l.label)).toEqual(['16', '16', '16', '16'])
    expect(r.lines.filter((l) => l.kind === 'spacing').map((l) => l.label)).toEqual(['20'])
  })

  it('asks for the children rects of a container, and not for hidden ones', () => {
    const s = row()
    const ids = sceneExtraIds(doc(), [s.f], true)
    expect(ids).toEqual(expect.arrayContaining([s.a, s.b]))
    expect(ids).not.toContain(s.hidden)
  })

  it('a block frame has no padding or gap redlines', () => {
    const root = doc().pages[0].rootId
    const f = S().createNode(id, { type: 'frame', name: 'Block', style: { width: 100, height: 100, padding: 10 } }, root)
    const rects = new Map<string, WorldRect>([[f, { x: 0, y: 0, width: 100, height: 100 }]])
    expect(redlineScene(base({ selection: [f], rects }))).toBeNull()
  })

  it('hovered layer gets a size chip with its sizing rule in words', () => {
    const s = scene()
    s.rects.set(s.b, { x: 220, y: 20, width: 100, height: 50 })
    S().updateStyles(id, [s.b], { width: 'fit-content' })
    const r = redlineScene(base({ selection: [s.a], hovered: s.b, rects: s.rects }))!
    expect(r.sizeLabels).toEqual([{ at: { x: 220, y: 20, width: 100, height: 50 }, text: 'Fit 100 × 50' }])
  })

  it('no chip when nothing is hovered or the hovered layer is rotated', () => {
    const s = scene()
    expect(redlineScene(base({ selection: [s.a], rects: s.rects }))!.sizeLabels).toEqual([])
    const r = redlineScene(base({ selection: [s.a], hovered: s.b, rects: s.rects, isRotated: (n) => n.id === s.b }))!
    expect(r.sizeLabels).toEqual([])
  })
})

describe('hoverPick: Alt measures to any layer in Dev Mode', () => {
  it('Alt in Dev Mode returns the deepest layer, locked or not; otherwise the normal pick', () => {
    const root = doc().pages[0].rootId
    const outer = S().createNode(id, { type: 'frame', name: 'Outer', style: { width: 300, height: 300 } }, root)
    const mid = S().createNode(id, { type: 'frame', name: 'Mid', style: { width: 200, height: 200 } }, outer)
    const leaf = S().createNode(id, { type: 'rect', name: 'Leaf', style: { width: 50, height: 50 } }, mid)
    const d = doc()
    expect(hoverPick(d, leaf, [], { deep: false, alt: false, devMode: true })).toBe(mid)
    expect(hoverPick(d, leaf, [], { deep: false, alt: true, devMode: true })).toBe(leaf)
    expect(hoverPick(d, leaf, [], { deep: false, alt: true, devMode: false })).toBe(mid)
    expect(hoverPick(d, leaf, [], { deep: true, alt: false, devMode: false })).toBe(leaf)
    expect(hoverPick(d, 'nope', [], { deep: false, alt: true, devMode: true })).toBeNull()
  })
})

describe('layers under a rotated or scaled ancestor', () => {
  it('count as rotated: the rect is a bounding box, not their edges', () => {
    const s = scene()
    const only = (id: string) => (n: CNode) => n.id === id
    // the parent frame is rotated; A is not, but sits inside it
    const r = redlineScene(base({ selection: [s.a], hovered: s.b, rects: s.rects, isRotated: only(s.frame) }))!
    expect(r.skipped).toBe('rotated')
    expect(r.lines).toEqual([])
    // hovering a layer under a rotated ancestor
    const h = redlineScene(base({ selection: [s.frame], hovered: s.b, rects: s.rects, isRotated: only(s.frame) }))!
    expect(h.skipped).toBe('rotated')
    expect(h.sizeLabels).toEqual([])
  })

  it('a rotated sibling elsewhere does not affect it', () => {
    const s = scene()
    const r = redlineScene(base({ selection: [s.a], hovered: s.b, rects: s.rects, isRotated: (n) => n.name === 'Elsewhere' }))!
    expect(r.skipped).toBeUndefined()
    expect(r.lines.length).toBeGreaterThan(0)
  })
})
