// Test-station checks on top of properties.test.ts (the builder is also the tester here, so these try to break it).
import { describe, expect, it } from 'vitest'
import * as ops from './ops'
import * as c from './components'
import * as v from './variants'
import * as p from './properties'
import type { CNode } from './types'

function setup() {
  const doc = ops.makeDoc('d', 'Doc')
  const root = doc.pages[0].rootId
  const add = (n: Parameters<typeof ops.makeNode>[1], parent: string): CNode => {
    const node = ops.makeNode(doc, n)
    ops.insertNode(doc, node, parent)
    return node
  }
  const kid = (inst: string, src: string): CNode => Object.values(doc.nodes).find((n) => n.parent === inst && n.srcId === src) as CNode
  const texts = (under: string): string[] =>
    Object.values(doc.nodes)
      .filter((n) => n.type === 'text' && ops.ancestors(doc, n.id).includes(under))
      .map((n) => n.text as string)
  return { doc, root, add, kid, texts }
}

/** Button (label, icon) as a main + a Stage. */
function button() {
  const s = setup()
  const b = s.add({ type: 'frame', name: 'Button', style: { width: 120, height: 40 } }, s.root)
  const label = s.add({ type: 'text', text: 'Click' }, b.id)
  const icon = s.add({ type: 'rect', name: 'Icon' }, b.id)
  const stage = s.add({ type: 'frame', name: 'Stage' }, s.root)
  c.createComponent(s.doc, b.id)
  return { ...s, b, label, icon, stage }
}

describe('precedence main < prop < override, per type', () => {
  it('boolean: an explicit visible override beats the property value, and reset hands control back', () => {
    const { doc, b, icon, stage, kid } = button()
    const show = p.addProp(doc, b.id, { name: 'Show', type: 'boolean', default: true })
    p.bindProp(doc, icon.id, 'visible', show)
    const inst = c.createInstance(doc, b.id, stage.id)
    p.setInstanceProp(doc, inst, show, false)
    c.setOverride(doc, inst, icon.id, { visible: true })
    expect(kid(inst, icon.id).visible).toBe(true) // override wins over prop=false
    c.resetOverrides(doc, inst, icon.id)
    expect(kid(inst, icon.id).visible).toBe(false) // prop again
    p.setInstanceProp(doc, inst, show, true)
    c.setOverride(doc, inst, icon.id, { visible: false })
    expect(kid(inst, icon.id).visible).toBe(false)
  })

  it('swap: an override on the swapped-in main\'s own node still applies, keyed by that node', () => {
    const { doc, root, add, kid, texts } = button()
    const star = add({ type: 'frame', name: 'Star', style: { width: 24, height: 24 } }, root)
    add({ type: 'text', text: 'star' }, star.id)
    const heart = add({ type: 'frame', name: 'Heart', style: { width: 24, height: 24 } }, root)
    const heartText = add({ type: 'text', text: 'heart' }, heart.id)
    c.createComponent(doc, star.id)
    c.createComponent(doc, heart.id)
    const card = add({ type: 'frame', name: 'Card', style: { width: 200, height: 80 } }, root)
    c.createComponent(doc, card.id)
    const slot = c.createInstance(doc, star.id, card.id)
    const sw = p.addProp(doc, card.id, { name: 'Icon', type: 'swap', default: star.id })
    p.bindProp(doc, slot, 'swap', sw)
    const inst = c.createInstance(doc, card.id, root)
    p.setInstanceProp(doc, inst, sw, heart.id)
    c.setOverride(doc, inst, heartText.id, { text: 'HEART!' })
    expect(texts(kid(inst, slot).id)).toEqual(['HEART!'])
    // swapping back drops the swapped-in main's overrides at the next sync (their node is gone from the instance)
    p.setInstanceProp(doc, inst, sw, star.id)
    expect(texts(kid(inst, slot).id)).toEqual(['star'])
  })
})

describe('deleted and stale bindings', () => {
  it('a boolean bound to a layer that is later deleted from the main: sync does not crash, value stays valid', () => {
    const { doc, b, icon, stage } = button()
    const show = p.addProp(doc, b.id, { name: 'Show', type: 'boolean', default: true })
    p.bindProp(doc, icon.id, 'visible', show)
    const inst = c.createInstance(doc, b.id, stage.id)
    p.setInstanceProp(doc, inst, show, false)
    ops.removeNode(doc, icon.id)
    c.syncInstances(doc, b.id)
    expect(Object.values(doc.nodes).some((n) => n.parent === inst && n.srcId === icon.id)).toBe(false)
    expect(doc.nodes[inst].instance!.props).toEqual({ [show]: false }) // the prop itself is still defined
    p.setInstanceProp(doc, inst, show, true) // still settable, nothing to apply it to
    expect(doc.nodes[inst].instance!.props).toBeUndefined()
    p.removeProp(doc, b.id, show) // and removable
  })

  it('a prop removed from a set while instances of two variants hold values', () => {
    const { doc, b, label, icon, stage, kid } = button()
    const b2 = v.createVariant(doc, b.id)
    const show = p.addProp(doc, b.id, { name: 'Show', type: 'boolean', default: true })
    const txt = p.addProp(doc, b.id, { name: 'Label', type: 'text', default: 'Click' })
    const copy = (node: CNode): CNode => doc.nodes[doc.nodes[b2].children[doc.nodes[b.id].children.indexOf(node.id)]]
    for (const [main, ic, lb] of [[b.id, icon, label], [b2, copy(icon), copy(label)]] as [string, CNode, CNode][]) {
      void main
      p.bindProp(doc, ic.id, 'visible', show)
      p.bindProp(doc, lb.id, 'text', txt)
    }
    const i1 = c.createInstance(doc, b.id, stage.id)
    const i2 = c.createInstance(doc, b2, stage.id)
    for (const i of [i1, i2]) {
      p.setInstanceProp(doc, i, show, false)
      p.setInstanceProp(doc, i, txt, 'Custom')
    }
    p.removeProp(doc, b2, show) // removed through the OTHER variant
    for (const i of [i1, i2]) expect(doc.nodes[i].instance!.props).toEqual({ [txt]: 'Custom' })
    expect(doc.nodes[icon.id].bind).toBeUndefined()
    expect(doc.nodes[copy(icon).id].bind).toBeUndefined()
    expect(kid(i1, icon.id).visible).toBe(true)
    expect(kid(i2, copy(icon).id).visible).toBe(true)
    expect(kid(i1, label.id).text).toBe('Custom') // the other prop is untouched
  })
})

describe('defaults and hand-edited values', () => {
  it('empty or junk instance.props falls back to the defaults and is pruned', () => {
    const { doc, b, label, icon, stage, kid } = button()
    const show = p.addProp(doc, b.id, { name: 'Show', type: 'boolean', default: false })
    const txt = p.addProp(doc, b.id, { name: 'Label', type: 'text', default: 'Dflt' })
    p.bindProp(doc, icon.id, 'visible', show)
    p.bindProp(doc, label.id, 'text', txt)
    p.updateProp(doc, b.id, show, { default: false }) // binding adopted the layers' values; set the defaults this test wants
    p.updateProp(doc, b.id, txt, { default: 'Dflt' })
    const inst = c.createInstance(doc, b.id, stage.id)
    doc.nodes[inst].instance!.props = {}
    c.syncInstance(doc, inst)
    expect(kid(inst, icon.id).visible).toBe(false)
    expect(kid(inst, label.id).text).toBe('Dflt')
    expect(doc.nodes[inst].instance!.props).toBeUndefined()
    doc.nodes[inst].instance!.props = { [show]: 'yes' as unknown as boolean, [txt]: 5 as unknown as string, ghost: true }
    c.syncInstance(doc, inst)
    expect(kid(inst, icon.id).visible).toBe(false)
    expect(kid(inst, label.id).text).toBe('Dflt')
    expect(doc.nodes[inst].instance!.props).toBeUndefined()
  })

  it('a binding that points at a prop of the wrong type or a missing prop is ignored at sync', () => {
    const { doc, b, label, stage, kid } = button()
    const show = p.addProp(doc, b.id, { name: 'Show', type: 'boolean', default: false })
    const inst = c.createInstance(doc, b.id, stage.id)
    doc.nodes[label.id].bind = { text: show } // hand-edited: boolean prop on a text aspect
    c.syncInstances(doc, b.id)
    expect(kid(inst, label.id).text).toBe('Click')
    doc.nodes[label.id].bind = { text: 'ghost' }
    c.syncInstances(doc, b.id)
    expect(kid(inst, label.id).text).toBe('Click')
  })
})

describe('nested instances and swaps', () => {
  it('a text prop set on a nested instance shows through the outer instance; derived children cannot be bound', () => {
    const { doc, root, add, kid, texts } = button()
    // Pill main with a text prop, nested as a slot inside Card
    const pill = add({ type: 'frame', name: 'Pill', style: { width: 60, height: 20 } }, root)
    const pillText = add({ type: 'text', text: 'pill' }, pill.id)
    c.createComponent(doc, pill.id)
    const ptxt = p.addProp(doc, pill.id, { name: 'Text', type: 'text', default: 'pill' })
    p.bindProp(doc, pillText.id, 'text', ptxt)
    const card = add({ type: 'frame', name: 'Card', style: { width: 200, height: 80 } }, root)
    c.createComponent(doc, card.id)
    const slot = c.createInstance(doc, pill.id, card.id)
    p.setInstanceProp(doc, slot, ptxt, 'NEW')
    expect(texts(slot)).toEqual(['NEW'])
    const outer = c.createInstance(doc, card.id, root)
    expect(texts(kid(outer, slot).id)).toEqual(['NEW']) // the nested value is part of what the main shows
    // later change of the nested value re-flows to the outer instance once the host syncs
    p.setInstanceProp(doc, slot, ptxt, 'NEWER')
    c.syncInstances(doc, card.id)
    expect(texts(kid(outer, slot).id)).toEqual(['NEWER'])
    // the derived child inside the outer instance is not bindable
    expect(() => p.bindProp(doc, ops.descendants(doc, outer).find((d) => doc.nodes[d].type === 'text') as string, 'text', ptxt)).toThrow(/inside a main/)
  })

  it('swapping to a main of a different size keeps the slot box, including height', () => {
    const { doc, root, add, kid } = button()
    const small = add({ type: 'frame', name: 'Small', style: { width: 24, height: 24 } }, root)
    const big = add({ type: 'frame', name: 'Big', style: { width: 96, height: 64 } }, root)
    add({ type: 'rect', name: 'r', style: { width: 96, height: 64 } }, big.id)
    c.createComponent(doc, small.id)
    c.createComponent(doc, big.id)
    const card = add({ type: 'frame', name: 'Card', style: { width: 200, height: 80 } }, root)
    c.createComponent(doc, card.id)
    const slot = c.createInstance(doc, small.id, card.id)
    const sw = p.addProp(doc, card.id, { name: 'Icon', type: 'swap', default: small.id })
    p.bindProp(doc, slot, 'swap', sw)
    const inst = c.createInstance(doc, card.id, root)
    p.setInstanceProp(doc, inst, sw, big.id)
    const twin = doc.nodes[kid(inst, slot).id]
    expect(twin.style.width).toBe(24)
    expect(twin.style.height).toBe(24)
    expect(twin.children.length).toBe(1) // but the content is Big's
  })

  it('a swap cycle through two levels is refused (Outer > Mid > ... > Outer)', () => {
    const { doc, root, add } = button()
    const leaf = add({ type: 'frame', name: 'Leaf' }, root)
    c.createComponent(doc, leaf.id)
    const card = add({ type: 'frame', name: 'Card' }, root)
    c.createComponent(doc, card.id)
    const slot = c.createInstance(doc, leaf.id, card.id)
    const sw = p.addProp(doc, card.id, { name: 'Icon', type: 'swap', default: leaf.id })
    p.bindProp(doc, slot, 'swap', sw)
    const outer = add({ type: 'frame', name: 'Outer' }, root)
    c.createComponent(doc, outer.id)
    const mid = add({ type: 'frame', name: 'Mid' }, root)
    c.createComponent(doc, mid.id)
    c.createInstance(doc, outer.id, mid.id) // Mid contains an Outer instance
    const cardInOuter = c.createInstance(doc, card.id, outer.id) // Outer contains a Card instance
    // swapping that Card's slot to Mid would make Outer contain Mid, which contains Outer
    expect(() => p.setInstanceProp(doc, cardInOuter, sw, mid.id)).toThrow(c.CYCLE_MSG)
    expect(doc.nodes[cardInOuter].instance!.props).toBeUndefined()
    // a main that does not lead back is fine
    expect(() => p.setInstanceProp(doc, cardInOuter, sw, leaf.id)).not.toThrow()
  })
})
