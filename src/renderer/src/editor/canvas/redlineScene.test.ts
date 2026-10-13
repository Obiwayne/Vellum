import { beforeEach, describe, expect, it } from 'vitest'
import { getStore, useStore } from '../../model/store'
import type { CNode, Doc, WorldRect } from '../../model/types'
import { redlineScene, sceneExtraIds } from './redlineScene'

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
