import { beforeEach, describe, expect, it } from 'vitest'
import { diffDocs } from '@shared/docDiff'
import { getStore, useStore } from './store'
import * as ops from './ops'
import { isAncestor } from './ops'
import type { CNode, Doc } from './types'

const S = getStore
let id: string
const doc = (): Doc => S().docs[id]
const root = (): string => doc().pages[0].rootId
const node = (n: string): CNode => doc().nodes[n]
const kids = (n: string): CNode[] => node(n).children.map(node)
const twin = (inst: string, src: string): CNode => {
  const t = Object.values(doc().nodes).find((n) => n.srcId === src && isAncestor(doc(), inst, n.id))
  if (!t) throw new Error(`no twin of ${src}`)
  return t
}

/** Button main (120x40) with a "Click" text and an icon rect; a Stage frame. addVariant wraps it in a set. */
function setup() {
  const button = S().createNode(id, { type: 'frame', name: 'Button', style: { width: 120, height: 40 } }, root())
  const label = S().createNode(id, { type: 'text', text: 'Click' }, button)
  const icon = S().createNode(id, { type: 'rect', name: 'Icon', style: { width: 16, height: 16 } }, button)
  const stage = S().createNode(id, { type: 'frame', name: 'Stage' }, root())
  S().createComponent(id, [button])
  return { button, label, icon, stage }
}

/** setup + a second variant ("Variant 2", 200 wide) and an instance of the default one. */
function withVariant() {
  const s = setup()
  const second = S().addVariant(id, s.button)
  S().updateStyles(id, [second], { width: 200 })
  const setId = node(s.button).component!.set as string
  const prop = node(setId).componentSet!.props[0].id
  const inst = S().createInstance(id, s.button, s.stage)
  return { ...s, second, setId, prop, inst }
}

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true)
  id = S().createDoc('T', { open: false })
})

describe('addVariant', () => {
  it('wraps a lone main in a set, adds the copy, and one undo removes both effects', () => {
    const { button, stage } = setup()
    const before = JSON.stringify(doc().nodes)
    const second = S().addVariant(id, button)
    const setId = node(button).component!.set as string
    expect(node(second).parent).toBe(setId)
    expect(node(setId).componentSet?.props[0].options).toEqual(['Default', 'Variant 2'])
    S().undo(id)
    expect(JSON.stringify(doc().nodes)).toBe(before)
    expect(node(stage)).toBeDefined()
    S().redo(id)
    expect(node(second)).toBeDefined()
  })
})

describe('setVariantValue', () => {
  it('re-points the instance, takes the new main\'s size and layers, and one undo restores everything', () => {
    const { second, inst, prop, label, button } = withVariant()
    S().setText(id, label, 'Go') // Default's text; Variant 2 keeps its own copy
    expect(kids(inst)[0].text).toBe('Go')
    const before = JSON.stringify(doc().nodes)
    const dropped = S().setVariantValue(id, inst, prop, 'Variant 2')
    expect(dropped).toBe(0)
    expect(node(inst).instance?.of).toBe(second)
    expect(node(inst).style.width).toBe(200)
    expect(kids(inst).map((k) => k.text ?? k.type)).toEqual(['Click', 'rect'])
    S().undo(id)
    expect(JSON.stringify(doc().nodes)).toBe(before)
    expect(node(inst).instance?.of).toBe(button)
    expect(node(inst).style.width).toBe(120)
    S().redo(id)
    expect(node(inst).instance?.of).toBe(second)
  })

  it('carries overrides over to the matching layers and back', () => {
    const { second, inst, prop, label, button } = withVariant()
    S().setText(id, twin(inst, label).id, 'Mine')
    S().updateStyles(id, [twin(inst, label).id], { color: 'red' })
    S().setVariantValue(id, inst, prop, 'Variant 2')
    const newLabel = kids(second)[0].id
    expect(node(inst).instance?.overrides?.[newLabel]).toMatchObject({ text: 'Mine', style: { color: 'red' } })
    expect(node(inst).instance?.overrides?.[label]).toBeUndefined()
    expect(kids(inst)[0]).toMatchObject({ text: 'Mine', style: { color: 'red' } })
    expect(S().setVariantValue(id, inst, prop, 'Default')).toBe(0)
    expect(node(inst).instance?.of).toBe(button)
    expect(kids(inst)[0]).toMatchObject({ text: 'Mine', style: { color: 'red' } })
  })

  it('a layer missing in the other variant drops its override and is counted; undo brings it back', () => {
    const { second, inst, prop, icon, label } = withVariant()
    S().deleteNodes(id, [kids(second)[1].id]) // Variant 2 has no icon
    S().updateStyles(id, [twin(inst, icon).id], { backgroundColor: 'blue' })
    S().setText(id, twin(inst, label).id, 'Kept')
    const before = JSON.stringify(doc().nodes)
    const dropped = S().setVariantValue(id, inst, prop, 'Variant 2')
    expect(dropped).toBe(1)
    expect(kids(inst)).toHaveLength(1)
    expect(kids(inst)[0].text).toBe('Kept')
    expect(Object.keys(node(inst).instance?.overrides ?? {})).toEqual([kids(second)[0].id])
    S().undo(id)
    expect(JSON.stringify(doc().nodes)).toBe(before)
    expect(node(inst).instance?.overrides?.[icon]).toBeDefined()
  })

  it('layers match by position and type; at equal distance the same name wins', () => {
    const { button, stage } = setup()
    const second = S().addVariant(id, button)
    const prop = node(node(button).component!.set as string).componentSet!.props[0].id
    // Default: [Click, Icon]; Variant 2 becomes [Left, Click, Icon]: Icon sits at distance 1 from Left (0) and from Icon (2)
    const left = S().createNode(id, { type: 'rect', name: 'Left' }, second, 0)
    const inst = S().createInstance(id, button, stage)
    S().updateStyles(id, [twin(inst, kids(button)[1].id).id], { opacity: 0.5 })
    S().setVariantValue(id, inst, prop, 'Variant 2')
    const icon2 = kids(second)[2].id
    expect(node(inst).instance?.overrides?.[icon2]).toBeDefined()
    expect(node(inst).instance?.overrides?.[left]).toBeUndefined()
    expect(kids(inst).map((k) => k.name)).toEqual(['Left', 'Click', 'Icon'])
  })

  it('position decides before the name: a same-type layer at the same index wins over a same-named one further away', () => {
    const { button, stage } = setup()
    const a = S().createNode(id, { type: 'rect', name: 'A' }, button)
    S().createNode(id, { type: 'rect', name: 'B' }, button)
    const second = S().addVariant(id, button)
    const [, , sa, sb] = kids(second)
    S().moveNodes(id, [sb.id], second, 2) // Variant 2: text, Icon, B, A
    const prop = node(node(button).component!.set as string).componentSet!.props[0].id
    const inst = S().createInstance(id, button, stage)
    S().updateStyles(id, [twin(inst, a).id], { opacity: 0.5 })
    S().setVariantValue(id, inst, prop, 'Variant 2')
    expect(node(inst).instance?.overrides?.[sb.id]).toBeDefined() // index 2 in both
    expect(node(inst).instance?.overrides?.[sa.id]).toBeUndefined()
  })

  it('refuses unknown props/options, non-instances, and cross-set targets', () => {
    const { inst, prop, button } = withVariant()
    expect(() => S().setVariantValue(id, inst, 'nope', 'x')).toThrow(/not found/)
    expect(() => S().setVariantValue(id, inst, prop, 'Huge')).toThrow(/not an option/)
    expect(() => S().setVariantValue(id, button, prop, 'Default')).toThrow(/not an instance/)
  })
})

describe('deleting variants', () => {
  it('deleting a variant main re-points its instances to the default variant instead of detaching', () => {
    const { button, second, inst, prop, label } = withVariant()
    S().setVariantValue(id, inst, prop, 'Variant 2')
    expect(label).toBeTruthy()
    S().setText(id, kids(inst)[0].id, 'Mine') // override on a Variant 2 layer
    const newLabel = kids(second)[0].id
    expect(node(inst).instance?.overrides?.[newLabel]).toBeDefined()
    S().deleteNodes(id, [second])
    expect(node(second)).toBeUndefined()
    expect(node(inst).instance?.of).toBe(button) // default variant
    expect(node(inst).srcId).toBeDefined()
    expect(kids(inst)[0].text).toBe('Mine') // override carried back to the default's label
    expect(node(inst).style.width).toBe(120)
    S().undo(id)
    expect(node(second)).toBeDefined()
    expect(node(inst).instance?.of).toBe(second)
  })

  it('deleting the last variant of a set detaches (nothing to move to), in the same step', () => {
    const { button, second, inst } = withVariant()
    S().deleteNodes(id, [second])
    S().deleteNodes(id, [button])
    expect(node(inst).instance).toBeUndefined()
    S().undo(id)
    expect(node(inst).instance?.of).toBe(button)
  })

  it('deleting the whole set detaches its instances', () => {
    const { setId, inst } = withVariant()
    S().deleteNodes(id, [setId])
    expect(node(inst).instance).toBeUndefined()
    expect(node(inst).children.length).toBeGreaterThan(0)
  })
})

describe('duplicating a set', () => {
  it('duplicates its mains; the copies belong to the copy and keep their variant values', () => {
    const { setId, button, second, prop } = withVariant()
    const [copy] = S().duplicateNodes(id, [setId])
    const mains = kids(copy)
    expect(mains).toHaveLength(2)
    expect(mains.every((m) => m.component?.set === copy)).toBe(true)
    expect(mains.map((m) => m.component?.variant?.[prop])).toEqual(['Default', 'Variant 2'])
    expect(mains.map((m) => m.id)).not.toContain(button)
    expect(node(copy).componentSet?.props[0].id).toBe(prop)
    expect(node(button).component?.set).toBe(setId) // the original is untouched
    expect(node(second).component?.set).toBe(setId)
    // instances of the copy's variants switch inside the copy
    const inst = S().createInstance(id, mains[0].id, root())
    S().setVariantValue(id, inst, prop, 'Variant 2')
    expect(node(inst).instance?.of).toBe(mains[1].id)
  })
})

describe('property actions are one undo step', () => {
  it('addProp, bindProp and setInstanceProp each undo in one step, mains and instances together', () => {
    const { button, label, icon, inst } = withVariant()
    const text = S().addProp(id, button, { name: 'Label', type: 'text', default: 'Click' })
    S().undo(id)
    expect(node(node(button).component!.set as string).componentSet?.props.find((p) => p.id === text)).toBeUndefined()
    S().redo(id)
    const shown = S().addProp(id, button, { name: 'Show icon', type: 'boolean', default: true })
    S().bindProp(id, label, 'text', text)
    S().bindProp(id, icon, 'visible', shown)
    expect(node(label).bind).toEqual({ text })
    const before = JSON.stringify(doc().nodes)
    S().setInstanceProp(id, inst, text, 'Hi')
    S().setInstanceProp(id, inst, shown, false)
    expect(kids(inst).map((k) => [k.text ?? k.type, k.visible])).toEqual([['Hi', true], ['rect', false]])
    S().undo(id)
    S().undo(id)
    expect(JSON.stringify(doc().nodes)).toBe(before)
    S().undo(id) // bind icon
    expect(node(icon).bind).toBeUndefined()
    expect(kids(inst)[1].visible).toBe(true)
  })

  it('refused edits throw and change nothing', () => {
    const { button, label, inst } = withVariant()
    const before = doc()
    expect(() => S().addProp(id, button, { name: 'X', type: 'boolean', default: 'yes' as unknown as boolean })).toThrow()
    expect(() => S().bindProp(id, twin(inst, label).id, 'text', null)).toThrow()
    expect(() => S().setInstanceProp(id, inst, 'nope', true)).toThrow()
    expect(doc()).toBe(before)
  })
})

describe('docDiff lists variant and property changes once', () => {
  it('a main edit lists the main, not the derived twins', () => {
    const { label, inst } = withVariant()
    const before = doc()
    S().setText(id, label, 'New')
    const d = diffDocs(before, doc())
    expect(d.changed.map((c) => c.id)).toEqual([label])
    expect(JSON.stringify(d).includes(kids(inst)[0].id)).toBe(false)
  })

  it('addVariant: the set and the new main are listed, no derived nodes', () => {
    const { button } = setup()
    const before = doc()
    const second = S().addVariant(id, button)
    const d = diffDocs(before, doc())
    const setId = node(button).component!.set as string
    expect(d.added.map((a) => a.id)).toContain(setId)
    expect(d.added.map((a) => a.id)).toContain(second)
    const ids = [...d.added, ...d.changed].map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('switching a variant or setting a property lists the instance once', () => {
    const { inst, prop, button, label } = withVariant()
    const text = S().addProp(id, button, { name: 'Label', type: 'text', default: 'Click' })
    S().bindProp(id, label, 'text', text)
    let before = doc()
    S().setVariantValue(id, inst, prop, 'Variant 2')
    let d = diffDocs(before, doc())
    expect(d.changed.map((c) => c.id)).toEqual([inst])
    expect(d.changed[0].aspects).toContain('content')
    before = doc()
    S().setInstanceProp(id, inst, text, 'Bye')
    d = diffDocs(before, doc())
    expect(d.changed.map((c) => c.id)).toEqual([inst])
    expect(d.added).toEqual([])
  })

  it('a property definition change lists the set frame as changed', () => {
    const { button, setId } = withVariant()
    const before = doc()
    S().addProp(id, button, { name: 'Show icon', type: 'boolean', default: true })
    const d = diffDocs(before, doc())
    expect(d.changed.map((c) => c.id)).toEqual([setId])
    expect(d.changed[0].aspects).toContain('content')
  })
})

describe('performance', () => {
  it('a set of 4 variants and 20 instances in a 2000-node doc stays fast', () => {
    const { button, stage } = setup()
    for (let k = 0; k < 3; k++) S().addVariant(id, button)
    const setId = node(button).component!.set as string
    const prop = node(setId).componentSet!.props[0].id
    S().mutate(id, 'Filler', (d) => {
      for (let k = 0; k < 2000; k++) ops.insertNode(d, ops.makeNode(d, { type: 'rect' }), d.pages[0].rootId)
    })
    const insts: string[] = []
    for (let k = 0; k < 20; k++) insts.push(S().createInstance(id, button, stage))
    expect(kids(setId)).toHaveLength(4)
    const label = kids(button)[0].id

    let t0 = performance.now()
    S().setText(id, label, 'Changed') // a main edit syncs 20 instances
    const edit = performance.now() - t0
    expect(kids(insts[19])[0].text).toBe('Changed')
    t0 = performance.now()
    S().setVariantValue(id, insts[0], prop, 'Variant 3')
    const swap = performance.now() - t0
    expect(node(insts[0]).instance?.of).toBe(kids(setId)[2].id)
    expect(edit).toBeLessThan(1000)
    expect(swap).toBeLessThan(500)
  }, 30_000)
})

describe('test station: adversarial', () => {
  it('deleting the default variant moves its instances to the remaining variant, one undo restores', () => {
    const { button, second, inst } = withVariant()
    expect(node(inst).instance?.of).toBe(button)
    S().deleteNodes(id, [button])
    expect(node(button)).toBeUndefined()
    expect(node(inst).instance?.of).toBe(second)
    expect(node(inst).style.width).toBe(200)
    S().undo(id)
    expect(node(button)).toBeDefined()
    expect(node(inst).instance?.of).toBe(button)
    expect(node(inst).style.width).toBe(120)
  })

  it('choosing the option the instance already has changes nothing and drops nothing', () => {
    const { button, inst, prop } = withVariant()
    const opt = node(button).component!.variant![prop]
    const before = JSON.stringify(doc().nodes)
    expect(S().setVariantValue(id, inst, prop, opt)).toBe(0)
    expect(JSON.stringify(doc().nodes)).toBe(before)
  })

  it('switch then undo then redo lands on the switched state with overrides intact', () => {
    const { second, inst, prop } = withVariant()
    S().setText(id, kids(inst)[0].id, 'Mine')
    S().setVariantValue(id, inst, prop, 'Variant 2')
    const switched = JSON.stringify(doc().nodes)
    expect(node(inst).instance?.of).toBe(second)
    S().undo(id)
    expect(node(inst).instance?.of).not.toBe(second)
    S().redo(id)
    expect(JSON.stringify(doc().nodes)).toBe(switched)
  })

  it('a duplicated set does not steal instances from the original', () => {
    const { button, setId, inst } = withVariant()
    const [copy] = S().duplicateNodes(id, [setId])
    expect(node(inst).instance?.of).toBe(button)
    expect(node(copy).componentSet).toBeDefined()
    const copyMains = kids(copy)
    expect(copyMains.length).toBe(2)
    for (const m of copyMains) expect(m.component?.set).toBe(copy)
  })
})

describe('component sets are not components', () => {
  it('createComponent refuses a set frame and leaves it intact', () => {
    const { setId } = withVariant()
    expect(() => S().createComponent(id, [setId])).toThrow(/already groups/)
    expect(node(setId).component).toBeUndefined()
    expect(node(setId).componentSet).toBeDefined()
  })
})
