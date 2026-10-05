import { beforeEach, describe, expect, it } from 'vitest'
import { getStore, useStore } from './store'
import type { CNode, Doc } from './types'

const S = getStore
let id: string
const doc = (): Doc => S().docs[id]
const root = (): string => doc().pages[0].rootId
const node = (n: string): CNode => doc().nodes[n]

function setup() {
  const btn = S().createNode(id, { type: 'frame', name: 'Button', style: { width: 100, height: 40 } }, root())
  const label = S().createNode(id, { type: 'text', text: 'Click' }, btn)
  S().createComponent(id, [btn])
  const inst = S().createInstance(id, btn, root())
  const text = S().addProp(id, btn, { name: 'Label', type: 'text', default: 'Click' })
  S().bindProp(id, label, 'text', text)
  return { btn, label, inst, text }
}

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true)
  id = S().createDoc('T', { open: false })
})

describe('updateProp / removeProp / resetInstanceProps', () => {
  it('renames and changes the default; instances follow; one undo each', () => {
    const { btn, inst, text } = setup()
    S().updateProp(id, btn, text, { name: 'Caption', default: 'Go' })
    expect(node(btn).component!.props![0]).toMatchObject({ name: 'Caption', default: 'Go' })
    expect(node(node(inst).children[0]).text).toBe('Go')
    S().undo(id)
    expect(node(btn).component!.props![0]).toMatchObject({ name: 'Label', default: 'Click' })
    expect(node(node(inst).children[0]).text).toBe('Click')
  })

  it('refuses a blank or duplicate name, a wrong default type, variant props and unknown ids', () => {
    const { btn, text } = setup()
    const other = S().addProp(id, btn, { name: 'Other', type: 'boolean', default: true })
    const before = doc()
    expect(() => S().updateProp(id, btn, text, { name: ' ' })).toThrow(/needs a name/)
    expect(() => S().updateProp(id, btn, text, { name: 'Other' })).toThrow(/already exists/)
    expect(() => S().updateProp(id, btn, other, { default: 'yes' as unknown as boolean })).toThrow(/must be/)
    expect(() => S().updateProp(id, btn, 'nope', { name: 'x' })).toThrow(/not found/)
    expect(doc()).toBe(before)
    const second = S().addVariant(id, btn)
    const set = node(btn).component!.set as string
    expect(() => S().updateProp(id, second, node(set).componentSet!.props[0].id, { name: 'x' })).toThrow(/component set/)
  })

  it('removeProp drops bindings and instance values in one step; resetInstanceProps clears values', () => {
    const { btn, label, inst, text } = setup()
    S().setInstanceProp(id, inst, text, 'Hi')
    expect(node(node(inst).children[0]).text).toBe('Hi')
    S().resetInstanceProps(id, inst, text)
    expect(node(inst).instance?.props).toBeUndefined()
    expect(node(node(inst).children[0]).text).toBe('Click')
    S().setInstanceProp(id, inst, text, 'Hi')
    S().removeProp(id, btn, text)
    expect(node(label).bind).toBeUndefined()
    expect(node(inst).instance?.props).toBeUndefined()
    S().undo(id)
    expect(node(label).bind).toEqual({ text })
    expect(node(node(inst).children[0]).text).toBe('Hi')
  })

  it('a swap default is checked: only a main, and no cycle through a bound nested instance', () => {
    const { btn } = setup()
    const other = S().createNode(id, { type: 'frame', name: 'Other' }, root())
    S().createComponent(id, [other])
    const swap = S().addProp(id, other, { name: 'Icon', type: 'swap', default: btn })
    expect(() => S().updateProp(id, other, swap, { default: root() })).toThrow(/main component/)
    // Other holds a nested instance of Button bound to the swap prop: defaulting the swap to Other would nest Other in itself
    const nested = S().createInstance(id, btn, other)
    S().bindProp(id, nested, 'swap', swap)
    expect(() => S().updateProp(id, other, swap, { default: other })).toThrow(/itself/)
    expect(node(other).component!.props![0].default).toBe(btn)
  })
})

describe('editing a bound field edits the property', () => {
  it('text and visibility edits on a bound layer of an instance set the instance value, not an override', () => {
    const { btn, label, inst, text } = setup()
    const icon = S().createNode(id, { type: 'rect', name: 'Icon' }, btn)
    const show = S().addProp(id, btn, { name: 'Show', type: 'boolean', default: true })
    S().bindProp(id, icon, 'visible', show)
    const twinLabel = node(inst).children[0]
    const twinIcon = node(inst).children[1]

    S().setText(id, twinLabel, 'Hi')
    expect(node(inst).instance?.props).toEqual({ [text]: 'Hi' })
    expect(node(inst).instance?.overrides).toBeUndefined()
    expect(node(twinLabel).text).toBe('Hi')

    S().updateNode(id, twinIcon, { visible: false })
    expect(node(inst).instance?.props).toEqual({ [text]: 'Hi', [show]: false })
    expect(node(inst).instance?.overrides).toBeUndefined()
    expect(node(twinIcon).visible).toBe(false)

    // another instance is unaffected, and a main edit still reaches this one
    const other = S().createInstance(id, btn, root())
    expect(node(node(other).children[0]).text).toBe('Click')
    S().setText(id, label, 'Main') // the main's own text is shadowed by the property default? the bound layer shows the prop
    expect(node(twinLabel).text).toBe('Hi')

    // setting the default again removes the stored value
    S().setText(id, twinLabel, 'Click')
    expect(node(inst).instance?.props).toEqual({ [show]: false })
    S().undo(id)
    expect(node(twinLabel).text).toBe('Hi')
  })

  it('an unbound field and other keys of a bound layer still become overrides', () => {
    const { label, inst, text } = setup()
    const twinLabel = node(inst).children[0]
    S().setText(id, twinLabel, 'Hi')
    S().updateStyles(id, [twinLabel], { color: 'red' })
    expect(node(inst).instance?.props).toEqual({ [text]: 'Hi' })
    expect(node(inst).instance?.overrides?.[label]).toEqual({ style: { color: 'red' } })
    S().updateNode(id, twinLabel, { visible: false }) // visibility is not bound here
    expect(node(inst).instance?.overrides?.[label]).toMatchObject({ visible: false })
  })
})

describe('binding adopts the layer as the property default', () => {
  it('a text property takes the bound layer\'s text, so instances look unchanged', () => {
    const btn = S().createNode(id, { type: 'frame', name: 'Button', style: { width: 100, height: 40 } }, root())
    const label = S().createNode(id, { type: 'text', text: 'Click' }, btn)
    S().createComponent(id, [btn])
    const inst = S().createInstance(id, btn, root())
    const text = S().addProp(id, btn, { name: 'Label', type: 'text', default: 'Text' })
    expect(node(node(inst).children[0]).text).toBe('Click') // not bound yet
    S().bindProp(id, label, 'text', text)
    expect(node(btn).component!.props![0].default).toBe('Click')
    expect(node(node(inst).children[0]).text).toBe('Click') // unchanged by the binding
    expect(node(inst).instance?.props).toBeUndefined()
    S().undo(id)
    expect(node(btn).component!.props![0].default).toBe('Text')
  })

  it('a boolean takes the layer\'s visibility; a second layer bound later does not move the default', () => {
    const btn = S().createNode(id, { type: 'frame', name: 'Button', style: { width: 100, height: 40 } }, root())
    const a = S().createNode(id, { type: 'rect', name: 'A' }, btn)
    const b = S().createNode(id, { type: 'rect', name: 'B' }, btn)
    S().updateNode(id, a, { visible: false })
    S().createComponent(id, [btn])
    const inst = S().createInstance(id, btn, root())
    const show = S().addProp(id, btn, { name: 'Show', type: 'boolean', default: true })
    S().bindProp(id, a, 'visible', show)
    expect(node(btn).component!.props![0].default).toBe(false)
    expect(node(node(inst).children[0]).visible).toBe(false) // unchanged
    S().bindProp(id, b, 'visible', show) // b is visible, but a already set the default
    expect(node(btn).component!.props![0].default).toBe(false)
    expect(node(node(inst).children[1]).visible).toBe(false) // b now follows the property
    S().bindProp(id, a, 'visible', null)
    S().bindProp(id, a, 'visible', show) // still bound through b: default unchanged
    expect(node(btn).component!.props![0].default).toBe(false)
  })

  it('a swap property takes the nested instance\'s component', () => {
    const star = S().createNode(id, { type: 'frame', name: 'Star', style: { width: 10, height: 10 } }, root())
    const heart = S().createNode(id, { type: 'frame', name: 'Heart', style: { width: 10, height: 10 } }, root())
    const card = S().createNode(id, { type: 'frame', name: 'Card', style: { width: 50, height: 50 } }, root())
    for (const n of [star, heart, card]) S().createComponent(id, [n])
    const slot = S().createInstance(id, heart, card)
    const sw = S().addProp(id, card, { name: 'Icon', type: 'swap', default: star })
    S().bindProp(id, slot, 'swap', sw)
    expect(node(card).component!.props![0].default).toBe(heart)
    const inst = S().createInstance(id, card, root())
    expect(node(node(inst).children[0]).srcId).toBeDefined()
    expect(node(node(inst).children[0]).name).toBe(node(slot).name) // still the Heart slot
  })
})
