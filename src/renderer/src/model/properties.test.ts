import { describe, expect, it } from 'vitest'
import { produce } from 'immer'
import * as ops from './ops'
import * as c from './components'
import * as v from './variants'
import * as p from './properties'
import type { CNode } from './types'

/** Button main (label text, icon rect), a Stage frame to hold instances. */
function setup() {
  const doc = ops.makeDoc('d', 'Doc')
  const root = doc.pages[0].rootId
  const add = (n: Parameters<typeof ops.makeNode>[1], parent: string): CNode => {
    const node = ops.makeNode(doc, n)
    ops.insertNode(doc, node, parent)
    return node
  }
  const button = add({ type: 'frame', name: 'Button', style: { width: 120, height: 40 } }, root)
  const label = add({ type: 'text', text: 'Click' }, button.id)
  const icon = add({ type: 'rect', name: 'Icon' }, button.id)
  const stage = add({ type: 'frame', name: 'Stage' }, root)
  c.createComponent(doc, button.id)
  const kid = (inst: string, src: string): CNode => Object.values(doc.nodes).find((n) => n.parent === inst && n.srcId === src) as CNode
  return { doc, root, button, label, icon, stage, add, kid }
}

describe('definitions', () => {
  it('addProp stores boolean/text defs on a lone main and rejects bad input', () => {
    const { doc, button } = setup()
    const show = p.addProp(doc, button.id, { name: 'Show icon', type: 'boolean', default: true })
    const txt = p.addProp(doc, button.id, { name: 'Label', type: 'text', default: 'Click' })
    expect(c.propDefsOf(doc, button.id).map((d) => d.id)).toEqual([show, txt])
    expect(() => p.addProp(doc, button.id, { name: 'Show icon', type: 'boolean', default: false })).toThrow(/already exists/)
    expect(() => p.addProp(doc, button.id, { name: 'X', type: 'boolean', default: 'yes' as unknown as boolean })).toThrow(/boolean/)
    expect(() => p.addProp(doc, button.id, { name: 'V', type: 'variant', default: 'a' })).toThrow(/createVariant/)
    expect(() => p.addProp(doc, button.id, { name: 'S', type: 'swap', default: 'nope' })).toThrow(/main component/)
    expect(() => p.addProp(doc, button.id, { name: ' ', type: 'text', default: '' })).toThrow(/name/)
  })

  it('in a set the defs live on the set and every variant sees them', () => {
    const { doc, button } = setup()
    const b = v.createVariant(doc, button.id)
    const id = p.addProp(doc, b, { name: 'Show icon', type: 'boolean', default: true })
    const set = v.setOf(doc, button.id) as string
    expect(doc.nodes[set].componentSet!.props.some((d) => d.id === id)).toBe(true)
    expect(c.propDefsOf(doc, button.id).some((d) => d.id === id)).toBe(true)
    expect(doc.nodes[b].component!.props).toBeUndefined()
  })
})

describe('boolean, text', () => {
  it('boolean toggles visibility; the default applies until the instance sets a value', () => {
    const { doc, button, icon, stage, kid } = setup()
    const show = p.addProp(doc, button.id, { name: 'Show icon', type: 'boolean', default: true })
    p.bindProp(doc, icon.id, 'visible', show)
    const inst = c.createInstance(doc, button.id, stage.id)
    expect(kid(inst, icon.id).visible).toBe(true)
    p.setInstanceProp(doc, inst, show, false)
    expect(kid(inst, icon.id).visible).toBe(false)
    expect(doc.nodes[inst].instance!.props).toEqual({ [show]: false })
    p.setInstanceProp(doc, inst, show, true) // back to the default: not stored
    expect(doc.nodes[inst].instance!.props).toBeUndefined()
    expect(kid(inst, icon.id).visible).toBe(true)
  })

  it('a changed default flows to instances that never set the value', () => {
    const { doc, button, icon, stage, kid } = setup()
    const show = p.addProp(doc, button.id, { name: 'Show icon', type: 'boolean', default: true })
    p.bindProp(doc, icon.id, 'visible', show)
    const inst = c.createInstance(doc, button.id, stage.id)
    doc.nodes[button.id].component!.props!.find((d) => d.id === show)!.default = false
    c.syncInstances(doc, button.id)
    expect(kid(inst, icon.id).visible).toBe(false)
  })

  it('text sets the layer text and its auto name; unbinding restores the main text', () => {
    const { doc, button, label, stage, kid } = setup()
    const txt = p.addProp(doc, button.id, { name: 'Label', type: 'text', default: 'Click' })
    p.bindProp(doc, label.id, 'text', txt)
    const inst = c.createInstance(doc, button.id, stage.id)
    p.setInstanceProp(doc, inst, txt, 'Buy now')
    expect(kid(inst, label.id).text).toBe('Buy now')
    expect(kid(inst, label.id).name).toBe('Buy now')
    p.bindProp(doc, label.id, 'text', null)
    expect(doc.nodes[label.id].bind).toBeUndefined()
    expect(kid(inst, label.id).text).toBe('Click')
  })

  it('precedence: main < property value < explicit override', () => {
    const { doc, button, label, stage, kid } = setup()
    const txt = p.addProp(doc, button.id, { name: 'Label', type: 'text', default: 'Click' })
    p.bindProp(doc, label.id, 'text', txt)
    const inst = c.createInstance(doc, button.id, stage.id)
    p.setInstanceProp(doc, inst, txt, 'Prop')
    c.setOverride(doc, inst, label.id, { text: 'Override' })
    expect(kid(inst, label.id).text).toBe('Override')
    c.resetOverrides(doc, inst, label.id)
    expect(kid(inst, label.id).text).toBe('Prop')
    p.resetInstanceProps(doc, inst)
    expect(kid(inst, label.id).text).toBe('Click')
  })

  it('values are type-checked and unknown props refused', () => {
    const { doc, button, stage } = setup()
    const txt = p.addProp(doc, button.id, { name: 'Label', type: 'text', default: 'Click' })
    const inst = c.createInstance(doc, button.id, stage.id)
    expect(() => p.setInstanceProp(doc, inst, txt, true)).toThrow(/string/)
    expect(() => p.setInstanceProp(doc, inst, 'nope', 'x')).toThrow(/not found/)
    expect(() => p.setInstanceProp(doc, button.id, txt, 'x')).toThrow(/not an instance/)
  })

  it('bindProp rejects mismatched types, non-text layers, instance nodes and the root', () => {
    const { doc, button, label, icon, stage, kid } = setup()
    const show = p.addProp(doc, button.id, { name: 'Show', type: 'boolean', default: true })
    const txt = p.addProp(doc, button.id, { name: 'Label', type: 'text', default: 'x' })
    expect(() => p.bindProp(doc, label.id, 'text', show)).toThrow(/cannot drive/)
    expect(() => p.bindProp(doc, icon.id, 'text', txt)).toThrow(/text layer/)
    expect(() => p.bindProp(doc, button.id, 'visible', show)).toThrow(/root/)
    const inst = c.createInstance(doc, button.id, stage.id)
    expect(() => p.bindProp(doc, kid(inst, label.id).id, 'text', txt)).toThrow(/inside a main/)
    expect(() => p.bindProp(doc, label.id, 'visible', 'nope')).toThrow(/not found/)
  })
})

describe('removing a property', () => {
  it('drops bindings and instance values and re-syncs', () => {
    const { doc, button, icon, stage, kid } = setup()
    const show = p.addProp(doc, button.id, { name: 'Show', type: 'boolean', default: true })
    p.bindProp(doc, icon.id, 'visible', show)
    const inst = c.createInstance(doc, button.id, stage.id)
    p.setInstanceProp(doc, inst, show, false)
    p.removeProp(doc, button.id, show)
    expect(doc.nodes[icon.id].bind).toBeUndefined()
    expect(doc.nodes[inst].instance!.props).toBeUndefined()
    expect(kid(inst, icon.id).visible).toBe(true)
  })
})

describe('swap', () => {
  /** Card main with a nested Slot instance of Star; a second main Heart; each has its own text. */
  function swapSetup() {
    const s = setup()
    const { doc, root, add } = s
    const star = add({ type: 'frame', name: 'Star', style: { width: 24, height: 24 } }, root)
    add({ type: 'text', text: 'star' }, star.id)
    const heart = add({ type: 'frame', name: 'Heart', style: { width: 24, height: 24, backgroundColor: 'red' } }, root)
    add({ type: 'text', text: 'heart' }, heart.id)
    c.createComponent(doc, star.id)
    c.createComponent(doc, heart.id)
    const card = add({ type: 'frame', name: 'Card', style: { width: 200, height: 80 } }, root)
    const label = add({ type: 'text', text: 'Card' }, card.id)
    c.createComponent(doc, card.id)
    const slot = c.createInstance(doc, star.id, card.id)
    const texts = (inst: string): string[] =>
      Object.values(doc.nodes)
        .filter((n) => n.type === 'text' && ops.ancestors(doc, n.id).includes(inst))
        .map((n) => n.text as string)
    return { ...s, star, heart, card, slot, cardLabel: label, texts }
  }

  it('swap re-points a nested instance to another main for that instance only', () => {
    const { doc, root, star, heart, card, slot, kid, texts } = swapSetup()
    const sw = p.addProp(doc, card.id, { name: 'Icon', type: 'swap', default: star.id })
    p.bindProp(doc, slot, 'swap', sw)
    const a = c.createInstance(doc, card.id, root)
    const b = c.createInstance(doc, card.id, root)
    expect(texts(kid(a, slot).id)).toEqual(['star'])
    p.setInstanceProp(doc, a, sw, heart.id)
    expect(texts(kid(a, slot).id)).toEqual(['heart'])
    expect(doc.nodes[kid(a, slot).id].style.backgroundColor).toBe('red')
    expect(doc.nodes[kid(a, slot).id].style.width).toBe(24) // keeps the slot's own box
    expect(texts(kid(b, slot).id)).toEqual(['star']) // the other instance is untouched
    p.setInstanceProp(doc, a, sw, star.id) // default again
    expect(texts(kid(a, slot).id)).toEqual(['star'])
    expect(doc.nodes[a].instance!.props).toBeUndefined()
  })

  it('a swap that would put the host main inside itself throws CYCLE_MSG and changes nothing', () => {
    const { doc, star, heart, card, slot } = swapSetup()
    const sw = p.addProp(doc, card.id, { name: 'Icon', type: 'swap', default: star.id })
    p.bindProp(doc, slot, 'swap', sw)
    // an instance of Card placed inside Heart: Heart (the host) now contains Card
    const inHeart = c.createInstance(doc, card.id, heart.id)
    expect(() => p.setInstanceProp(doc, inHeart, sw, heart.id)).toThrow(c.CYCLE_MSG)
    expect(doc.nodes[inHeart].instance!.props).toBeUndefined()
    // a harmless swap in the same place still works
    p.setInstanceProp(doc, inHeart, sw, star.id)
  })

  it('a swap default that would nest the main in itself is refused at bind time', () => {
    const { doc, card, slot } = swapSetup()
    const self = p.addProp(doc, card.id, { name: 'Self', type: 'swap', default: card.id })
    expect(() => p.bindProp(doc, slot, 'swap', self)).toThrow(c.CYCLE_MSG)
  })

  it('only nested instances can follow a swap prop', () => {
    const { doc, star, card, cardLabel } = swapSetup()
    const sw = p.addProp(doc, card.id, { name: 'Icon', type: 'swap', default: star.id })
    expect(() => p.bindProp(doc, cardLabel.id, 'swap', sw)).toThrow(/nested instance/)
  })
})

describe('draft safety and sets', () => {
  it('a whole flow runs on an immer draft and leaves the source doc alone', () => {
    const { doc, button, label, stage } = setup()
    const frozen = produce(doc, () => undefined)
    const next = produce(frozen, (d) => {
      const txt = p.addProp(d, button.id, { name: 'Label', type: 'text', default: 'Click' })
      p.bindProp(d, label.id, 'text', txt)
      const inst = c.createInstance(d, button.id, stage.id)
      p.setInstanceProp(d, inst, txt, 'Hi')
    })
    expect(frozen.nodes[button.id].component!.props).toBeUndefined()
    expect(Object.values(next.nodes).some((n) => n.text === 'Hi')).toBe(true)
  })

  it('props defined on a set apply to instances of any variant', () => {
    const { doc, button, icon, stage, kid } = setup()
    const b = v.createVariant(doc, button.id)
    const show = p.addProp(doc, button.id, { name: 'Show', type: 'boolean', default: true })
    p.bindProp(doc, icon.id, 'visible', show)
    // the copy has its own icon node: bind that one too
    const copyIcon = doc.nodes[b].children.map((id) => doc.nodes[id]).find((n) => n.name === 'Icon') as CNode
    p.bindProp(doc, copyIcon.id, 'visible', show)
    const i1 = c.createInstance(doc, button.id, stage.id)
    const i2 = c.createInstance(doc, b, stage.id)
    p.setInstanceProp(doc, i1, show, false)
    p.setInstanceProp(doc, i2, show, false)
    expect(kid(i1, icon.id).visible).toBe(false)
    expect(kid(i2, copyIcon.id).visible).toBe(false)
  })
})
