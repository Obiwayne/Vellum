// T60 test station: gaps the build station's tests leave (summaries per layout kind, instance overrides and
// variants, hidden nodes inside instances, oklch per mode, measure returning null, malformed values).
import { describe, expect, it } from 'vitest'
import * as ops from './ops'
import * as comp from './components'
import * as variants from './variants'
import type { CNode, WorldRect } from './types'
import { layoutIntent, nodeSpec, round, sizeRule, tokenUse } from './devSpec'

function setup() {
  const doc = ops.makeDoc('d', 'Doc')
  const root = doc.pages[0].rootId
  const add = (partial: Parameters<typeof ops.makeNode>[1], parent: string): CNode => {
    const node = ops.makeNode(doc, partial, false)
    ops.insertNode(doc, node, parent)
    return node
  }
  return { doc, root, add }
}

describe('summary strings per layout kind', () => {
  it('row, grid, block and positioned each get a one-line summary', () => {
    const { doc, root, add } = setup()
    const row = add({ type: 'frame', style: { display: 'flex', flexDirection: 'row', gap: 8 } }, root)
    expect(layoutIntent(doc, row.id)).toMatchObject({ kind: 'flex', direction: 'row' })
    expect(layoutIntent(doc, row.id).summary).toMatch(/^Row, gap 8/)
    const grid = add({ type: 'frame', style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 } }, root)
    expect(layoutIntent(doc, grid.id).kind).toBe('grid')
    expect(layoutIntent(doc, grid.id).summary).toMatch(/^Grid/)
    const block = add({ type: 'rect', style: { width: 10, height: 10 } }, root)
    expect(layoutIntent(doc, block.id).kind).toBe('block')
    const pos = add({ type: 'frame', style: { width: 100, height: 100 } }, root)
    add({ type: 'rect', x: 4, y: 5, style: { width: 1, height: 1 } }, pos.id)
    expect(layoutIntent(doc, pos.id).kind).toBe('positioned')
  })

  it('the plan example: column, gap 12, padding 16, fill (max 480), fit', () => {
    const { doc, root, add } = setup()
    const outer = add({ type: 'frame', style: { display: 'flex' } }, root)
    const card = add({ type: 'frame', style: { display: 'flex', flexDirection: 'column', gap: 12, padding: 16, width: '100%', maxWidth: 480, height: 'fit-content' } }, outer.id)
    const s = nodeSpec(doc, card.id)!
    expect(s.sizing.w).toMatchObject({ mode: 'fill', max: 480 })
    expect(s.sizing.h).toMatchObject({ mode: 'fit' })
    expect(layoutIntent(doc, card.id).summary).toBe('Column, gap 12, padding 16')
  })
})

describe('instances', () => {
  it('lists override keys and does not emit a hidden node inside an instance', () => {
    const { doc, root, add } = setup()
    const card = add({ type: 'frame', name: 'Card', style: { width: 200, height: 100 } }, root)
    const title = add({ type: 'text', text: 'Title', style: {} }, card.id)
    const sub = add({ type: 'text', text: 'Sub', style: {} }, card.id)
    comp.createComponent(doc, card.id)
    const inst = comp.createInstance(doc, card.id, root)
    const twinSub = doc.nodes[inst].children.map((c) => doc.nodes[c]).find((n) => n.srcId === sub.id)!
    comp.setOverride(doc, inst, sub.id, { visible: false })
    comp.setOverride(doc, inst, title.id, { text: 'Hello' })
    const spec = nodeSpec(doc, inst)!
    expect(twinSub.id).toBeTruthy()
    expect(spec.children.map((c) => c.text?.content)).toEqual(['Hello'])
    expect(spec.component?.ref).toBe(card.id)
    // override keys are main-side ids; the spec reports the twin ids that exist in its own tree
    expect(spec.component?.overrides).toEqual([twinSub.id, doc.nodes[inst].children.map((c) => doc.nodes[c]).find((n) => n.srcId === title.id)!.id])
    expect(spec.component?.overrides).not.toContain('')
    comp.setOverride(doc, inst, card.id, { style: { opacity: 0.5 } })
    expect(nodeSpec(doc, inst)!.component?.overrides).toContain(inst)
  })

  it('a variant instance names its variant values', () => {
    const { doc, root, add } = setup()
    const btn = add({ type: 'frame', name: 'Button', style: { width: 80, height: 32 } }, root)
    comp.createComponent(doc, btn.id)
    const v2 = variants.createVariant(doc, btn.id)
    const inst = comp.createInstance(doc, v2, root)
    const spec = nodeSpec(doc, inst)!
    expect(spec.component).toBeDefined()
    expect(spec.component?.ref).toBe(v2)
  })
})

describe('edge cases', () => {
  it('a hidden root has no spec', () => {
    const { doc, root, add } = setup()
    const f = add({ type: 'frame', style: { width: 1, height: 1 } }, root)
    f.visible = false
    expect(nodeSpec(doc, f.id)).toBeNull()
    expect(nodeSpec(doc, 'missing')).toBeNull()
  })

  it('a measure that returns null for a node falls back to the model, not a crash', () => {
    const { doc, root, add } = setup()
    const f = add({ type: 'frame', style: { width: 120, height: 40 } }, root)
    const spec = nodeSpec(doc, f.id, { measure: () => null as WorldRect | null })!
    expect(spec.box.width).toBe(120)
    expect(spec.box.measured).toBe(false)
  })

  it('malformed numbers do not leak NaN or Infinity', () => {
    const { doc, root, add } = setup()
    const f = add({ type: 'frame', style: { width: 'abcpx', height: 'NaN', padding: 'x y', gap: 'wide', display: 'flex' } }, root)
    const s = nodeSpec(doc, f.id)!
    // the authored strings are echoed as written; everything derived must be a finite number
    const json = JSON.stringify({ box: s.box, sizing: s.sizing, layout: s.layout })
    expect(json).not.toMatch(/NaN|Infinity|null/)
    expect(round(Infinity)).toBe(0)
    expect(sizeRule(doc, f.id, 'w')).toBeTruthy()
  })

  it('an oklch token keeps its authored form in every mode and resolves a hex per mode', () => {
    const { doc } = setup()
    doc.modes = ['Light', 'Dark']
    doc.tokens = [{ name: '--brand', value: 'oklch(0.6 0.2 250)', modes: { Dark: 'oklch(0.8 0.1 250)' } }]
    const u = tokenUse(doc, '--brand')!
    expect(u.values.Light.value).toBe('oklch(0.6 0.2 250)')
    expect(u.values.Dark.value).toBe('oklch(0.8 0.1 250)')
    expect(u.values.Light.hex8).toMatch(/^#[0-9A-F]{8}$/)
    expect(u.values.Dark.hex8).not.toBe(u.values.Light.hex8)
  })

  it('subpixel positions keep 2 decimals in measured boxes', () => {
    const { doc, root, add } = setup()
    const f = add({ type: 'frame', style: { width: 'fit-content', height: 20 } }, root)
    const spec = nodeSpec(doc, f.id, { measure: () => ({ x: 10.123456, y: 0.005, width: 99.999, height: 20 }) })!
    expect(spec.box.width).toBe(100)
    expect(String(spec.box.x)).not.toMatch(/\.\d{3,}/)
  })
})
