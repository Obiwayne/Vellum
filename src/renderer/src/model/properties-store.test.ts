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
