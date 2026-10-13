import { describe, expect, it } from 'vitest'
import * as ops from '../model/ops'
import { setDev } from '../model/dev'
import { nodeSpec } from '../model/devSpec'
import type { CNode } from '../model/types'
import { breakpointDelta, isEmptyDelta } from './deltas'
import { withDev } from './collect'
import { buildHandoff } from './index'

function setup() {
  const doc = ops.makeDoc('d', 'File')
  const root = doc.pages[0].rootId
  const add = (partial: Parameters<typeof ops.makeNode>[1], parent: string): CNode => {
    const n = ops.makeNode(doc, partial, false)
    ops.insertNode(doc, n, parent)
    return n
  }
  const frame = (name: string, bp: string, width: number, style: Record<string, string | number> = {}): CNode => {
    const f = add({ type: 'frame', name, style: { width, height: 600, display: 'flex', flexDirection: 'row', gap: 24, padding: 24, backgroundColor: '#FFFFFF', ...style } }, root)
    setDev(doc, f.id, { screen: { name: 'Home', bp }, ready: { at: 1 } })
    return f
  }
  const spec = (id: string) => withDev(doc, nodeSpec(doc, id)!)
  const delta = (a: CNode, b: CNode) =>
    breakpointDelta(doc, { name: 'Desktop', frameId: a.id, root: spec(a.id) }, { name: 'Mobile', frameId: b.id, root: spec(b.id) })
  return { doc, root, add, frame, spec, delta }
}

describe('breakpoint deltas', () => {
  it('matches layers by name path and reports intent and look changes only', () => {
    const { add, frame, delta } = setup()
    const d = frame('Home Desktop', 'Desktop', 1280)
    const m = frame('Home Mobile', 'Mobile', 390, { flexDirection: 'column', gap: 12, padding: 16 })
    for (const f of [d, m]) {
      add({ type: 'text', name: 'Title', text: 'Welcome', style: { fontSize: f === d ? 32 : 24, fontWeight: 700, color: '#111111' } }, f.id)
      add({ type: 'rect', name: 'Same', style: { width: 10, height: 10, backgroundColor: '#FF0000' } }, f.id)
    }
    const r = delta(d, m)
    expect(r.base).toBe('Desktop')
    const byPath = Object.fromEntries(r.changes.map((c) => [c.path, c.changes]))
    expect(Object.keys(byPath).sort()).toEqual(['', 'Title'])
    expect(byPath[''].map((c) => c.property)).toEqual(['layout'])
    expect(byPath[''][0]).toMatchObject({ from: 'Row, gap 24, padding 24', to: 'Column, gap 12, padding 16' })
    expect(byPath.Title).toEqual([{ property: 'font size', from: '32px', to: '24px' }])
    expect(r.onlyHere).toEqual([])
    expect(r.notHere).toEqual([])
    expect(isEmptyDelta(r)).toBe(false)
  })

  it('lists layers only at one breakpoint, topmost only, and tells hidden from absent', () => {
    const { add, frame, delta } = setup()
    const d = frame('Home Desktop', 'Desktop', 1280)
    const m = frame('Home Mobile', 'Mobile', 390)
    const side = add({ type: 'frame', name: 'Sidebar', style: { width: 200, height: 100 } }, d.id)
    add({ type: 'text', name: 'Menu', text: 'Menu', style: {} }, side.id)
    add({ type: 'rect', name: 'Promo', style: { width: 5, height: 5 } }, d.id)
    const hidden = add({ type: 'rect', name: 'Promo', style: { width: 5, height: 5 } }, m.id)
    hidden.visible = false
    const burger = add({ type: 'frame', name: 'Hamburger', style: { width: 20, height: 20 } }, m.id)
    add({ type: 'rect', name: 'Bar', style: { width: 20, height: 2 } }, burger.id)
    const r = delta(d, m)
    expect(r.notHere).toEqual(['Sidebar'])
    expect(r.hiddenHere).toEqual(['Promo'])
    expect(r.onlyHere).toEqual(['Hamburger'])
  })

  it('same names next to each other are matched in order and flagged', () => {
    const { add, frame, delta } = setup()
    const d = frame('Desktop frame', 'Desktop', 1280)
    const m = frame('Mobile frame', 'Mobile', 390)
    for (const f of [d, m]) {
      add({ type: 'rect', name: 'Item', style: { width: 10, height: 10, backgroundColor: '#111111' } }, f.id)
      add({ type: 'rect', name: 'Item', style: { width: 10, height: 10, backgroundColor: f === d ? '#222222' : '#333333' } }, f.id)
    }
    const r = delta(d, m)
    expect(r.ambiguous).toEqual(['Item'])
    expect(r.changes.map((c) => c.path)).toEqual(['Item (2)'])
    expect(r.changes[0].changes[0]).toMatchObject({ property: 'fill and stroke', from: 'fill #222222FF', to: 'fill #333333FF' })
  })

  it('identical breakpoints have an empty delta (the frame width and height are not changes)', () => {
    const { add, frame, delta } = setup()
    const d = frame('A', 'Desktop', 1280)
    const m = frame('B', 'Mobile', 390)
    for (const f of [d, m]) add({ type: 'rect', name: 'Box', style: { width: 10, height: 10 } }, f.id)
    expect(isEmptyDelta(delta(d, m))).toBe(true)
  })

  it('a text content change is a change too', () => {
    const { add, frame, delta } = setup()
    const d = frame('A', 'Desktop', 1280)
    const m = frame('B', 'Mobile', 390)
    add({ type: 'text', name: 'Label', text: 'Open the menu', style: {} }, d.id)
    add({ type: 'text', name: 'Label', text: 'Menu', style: {} }, m.id)
    const r = delta(d, m)
    expect(r.changes).toEqual([{ path: 'Label', changes: [{ property: 'text', from: '"Open the menu"', to: '"Menu"' }] }])
  })
})

describe('through the bundle', () => {
  const OPTS = { version: 1, exportedAt: '2026-01-01T00:00:00.000Z', vellum: '1.0.0' }

  it('spec.json carries the delta of every non-base breakpoint and the markdown prints it', () => {
    const { doc, add, frame } = setup()
    const d = frame('Home Desktop', 'Desktop', 1280)
    const m = frame('Home Mobile', 'Mobile', 390, { flexDirection: 'column' })
    add({ type: 'rect', name: 'Banner', style: { width: 100, height: 10 } }, d.id)
    const r = buildHandoff(doc, { frames: [d.id, m.id], ...OPTS })
    const spec = JSON.parse(r.files['spec.json'])
    const bps = spec.screens[0].breakpoints
    expect(bps[0].delta).toBeUndefined()
    expect(bps[1].delta).toMatchObject({ base: 'Desktop', notHere: ['Banner'] })
    const md = r.files['screens/home.md']
    expect(md).toContain('Compared with Desktop (the base): 1 layer change, 1 not shown.')
    expect(md).toContain('Not at Mobile (present at Desktop): Banner')
    expect(md).toContain('| (the frame) | layout: Row, gap 24, padding 24 → Column, gap 24, padding 24 |')
    expect(md).toContain('Suggestion: write the narrowest layout first')
  })

  it('a single frame has no delta and no suggestion', () => {
    const { doc, frame } = setup()
    const only = frame('Only', 'Desktop', 1280)
    const r = buildHandoff(doc, { frames: [only.id], ...OPTS })
    expect(r.files['screens/home.md']).not.toContain('Compared with')
    expect(r.files['screens/home.md']).not.toContain('Suggestion')
  })

  it('layer names that look like markdown cannot break the table', () => {
    const { doc, add, frame } = setup()
    const d = frame('D', 'Desktop', 1280)
    const m = frame('M', 'Mobile', 390)
    add({ type: 'rect', name: 'a | b\n# heading', style: { width: 1, height: 1 } }, d.id)
    const r = buildHandoff(doc, { frames: [d.id, m.id], ...OPTS })
    const md = r.files['screens/home.md']
    expect(md).not.toMatch(/^# heading/m)
    expect(md).toContain('Not at Mobile (present at Desktop): a')
  })
})
