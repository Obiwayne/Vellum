import { describe, expect, it } from 'vitest'
import { produce } from 'immer'
import * as ops from './ops'
import * as c from './components'
import * as v from './variants'
import type { CNode, Doc } from './types'

/** A page with a "Button" frame (a label text inside) turned into a main, and a Stage frame. */
function setup() {
  const doc = ops.makeDoc('d', 'Doc')
  const root = doc.pages[0].rootId
  const add = (n: Parameters<typeof ops.makeNode>[1], parent: string): CNode => {
    const node = ops.makeNode(doc, n)
    ops.insertNode(doc, node, parent)
    return node
  }
  const button = add({ type: 'frame', name: 'Button', style: { width: 120, height: 40 } }, root)
  button.x = 50
  button.y = 70
  const label = add({ type: 'text', text: 'Click' }, button.id)
  const stage = add({ type: 'frame', name: 'Stage' }, root)
  c.createComponent(doc, button.id)
  return { doc, root, button, label, stage }
}

describe('migrateDoc v3 -> v4', () => {
  it('only bumps the version and leaves nodes alone', () => {
    const d = ops.makeDoc('d', 'Old')
    d.version = 3
    const m = ops.migrateDoc(d)
    expect(ops.DOC_VERSION).toBe(5)
    expect(m.version).toBe(5)
    expect(m.nodes).toBe(d.nodes)
    expect(ops.migrateDoc(m)).toBe(m)
  })
})

describe('createVariant', () => {
  it('wraps a lone main in a set, as its Default variant, and adds the copy beside it', () => {
    const { doc, root, button } = setup()
    const copy = v.createVariant(doc, button.id)
    const setId = v.setOf(doc, button.id) as string
    const set = doc.nodes[setId]
    expect(set.componentSet?.name).toBe('Button')
    expect(set.parent).toBe(root)
    expect(doc.nodes[root].children).toContain(setId)
    expect(doc.nodes[root].children).not.toContain(button.id)
    expect([set.x, set.y]).toEqual([50, 70]) // the set takes the main's place
    expect(set.children).toEqual([button.id, copy])
    expect([button.x, button.y]).toEqual([0, 0])
    const prop = set.componentSet!.props[0]
    expect(prop).toMatchObject({ type: 'variant', options: ['Default', 'Variant 2'], default: 'Default' })
    expect(doc.nodes[button.id].component).toMatchObject({ name: 'Button', set: setId, variant: { [prop.id]: 'Default' } })
    expect(doc.nodes[copy].component).toMatchObject({ name: 'Button', set: setId, variant: { [prop.id]: 'Variant 2' } })
    expect(doc.nodes[copy].name).toBe('Variant=Variant 2')
    expect(v.variantsOf(doc, setId).map((m) => m.id)).toEqual([button.id, copy])
  })

  it('copies the subtree with fresh ids and no component flag on inner nodes', () => {
    const { doc, button, label } = setup()
    const copy = v.createVariant(doc, button.id)
    const [kid] = doc.nodes[copy].children
    expect(kid).not.toBe(label.id)
    expect(doc.nodes[kid]).toMatchObject({ type: 'text', text: 'Click', parent: copy })
    expect(doc.nodes[button.id].children).toEqual([label.id])
  })

  it('a second variant joins the same set; explicit values name it and add options', () => {
    const { doc, button } = setup()
    v.createVariant(doc, button.id)
    const setId = v.setOf(doc, button.id) as string
    const pid = doc.nodes[setId].componentSet!.props[0].id
    const third = v.createVariant(doc, button.id, { [pid]: 'Large' }, 'Big')
    expect(doc.nodes[third].name).toBe('Big')
    expect(doc.nodes[third].parent).toBe(setId)
    expect(doc.nodes[setId].children).toEqual([button.id, third, doc.nodes[setId].children[2]]) // inserted after the source
    expect(doc.nodes[setId].componentSet!.props[0].options).toEqual(['Default', 'Variant 2', 'Large'])
    expect(v.variantsOf(doc, setId)).toHaveLength(3)
  })

  it('refuses a duplicate combination, an unknown prop, non-components and instances', () => {
    const { doc, button, stage } = setup()
    v.createVariant(doc, button.id)
    const setId = v.setOf(doc, button.id) as string
    const pid = doc.nodes[setId].componentSet!.props[0].id
    expect(() => v.createVariant(doc, button.id, { [pid]: 'Default' })).toThrow(/already exists/)
    expect(() => v.createVariant(doc, button.id, { nope: 'x' })).toThrow(/Unknown/)
    expect(() => v.createVariant(doc, stage.id)).toThrow(/not a component/)
    const inst = c.createInstance(doc, button.id, stage.id)
    expect(() => v.createVariant(doc, inst)).toThrow()
    expect(() => v.createVariant(doc, doc.nodes[inst].children[0])).toThrow()
  })

  it('instances of the original main keep pointing at it and still sync', () => {
    const { doc, button, label, stage } = setup()
    const inst = c.createInstance(doc, button.id, stage.id)
    v.createVariant(doc, button.id)
    expect(doc.nodes[inst].instance?.of).toBe(button.id)
    doc.nodes[label.id].text = 'Go'
    c.syncInstances(doc, button.id)
    expect(doc.nodes[doc.nodes[inst].children[0]].text).toBe('Go')
  })

  it('works on a draft, so the store can make it one undo step', () => {
    const { doc, button } = setup()
    const next = produce(doc, (d: Doc) => {
      v.createVariant(d, button.id)
    })
    expect(v.setOf(next, button.id)).not.toBeNull()
    expect(v.setOf(doc, button.id)).toBeNull() // input untouched
  })
})

describe('pickMain', () => {
  /** A set with Size (S, M, L) and Tone (Plain, Loud): mains for S/Plain, M/Plain, M/Loud, L/Plain. */
  function sized() {
    const { doc, button } = setup()
    const first = v.createVariant(doc, button.id) // wraps; Variant prop = Default / Variant 2
    const setId = v.setOf(doc, button.id) as string
    const set = doc.nodes[setId]
    const [size] = set.componentSet!.props
    size.name = 'Size'
    size.options = ['S', 'M', 'L']
    size.default = 'S'
    const tone = { id: 'tone', name: 'Tone', type: 'variant' as const, options: ['Plain', 'Loud'], default: 'Plain' }
    set.componentSet!.props.push(tone)
    const make = (src: string, sz: string, t: string): string => {
      const id = v.createVariant(doc, src, { [size.id]: sz, tone: t })
      return id
    }
    // reshape the two mains created so far, then add the rest
    doc.nodes[button.id].component!.variant = { [size.id]: 'S', tone: 'Plain' }
    doc.nodes[first].component!.variant = { [size.id]: 'M', tone: 'Plain' }
    const mLoud = make(button.id, 'M', 'Loud')
    const lPlain = make(button.id, 'L', 'Plain')
    return { doc, setId, size: size.id, S: button.id, M: first, mLoud, lPlain }
  }

  it('exact match', () => {
    const { doc, setId, size, M, mLoud, lPlain } = sized()
    expect(v.pickMain(doc, setId, { [size]: 'M', tone: 'Plain' })).toBe(M)
    expect(v.pickMain(doc, setId, { [size]: 'M', tone: 'Loud' })).toBe(mLoud)
    expect(v.pickMain(doc, setId, { [size]: 'L', tone: 'Plain' })).toBe(lPlain)
  })

  it('missing values fall back to the defaults', () => {
    const { doc, setId, size, S, mLoud } = sized()
    expect(v.pickMain(doc, setId)).toBe(S) // S / Plain
    expect(v.pickMain(doc, setId, { tone: 'Loud', [size]: 'M' })).toBe(mLoud)
    expect(v.pickMain(doc, setId, { [size]: 'M' })).not.toBe(mLoud) // tone defaults to Plain
  })

  it('no exact match: the most matching props win, ties go to the first in order', () => {
    const { doc, setId, size, S, mLoud, lPlain } = sized()
    // there is no L / Loud: L / Plain (size matches) and M / Loud (tone matches) both score 1
    const order = v.variantsOf(doc, setId).map((m) => m.id)
    const firstOfTies = order.find((id) => id === mLoud || id === lPlain)
    expect(v.pickMain(doc, setId, { [size]: 'L', tone: 'Loud' })).toBe(firstOfTies)
    // reordering the set changes the tie-break
    doc.nodes[setId].children.reverse()
    const reversed = v.variantsOf(doc, setId).map((m) => m.id).find((id) => id === mLoud || id === lPlain)
    expect(reversed).not.toBe(firstOfTies)
    expect(v.pickMain(doc, setId, { [size]: 'L', tone: 'Loud' })).toBe(reversed)
    // an unknown option matches nothing on that prop: the rest decides (tone Plain -> S / Plain is first)
    doc.nodes[setId].children.reverse()
    expect(v.pickMain(doc, setId, { [size]: 'XL' })).toBe(S)
  })

  it('returns null for a non-set and for an empty set', () => {
    const { doc, button, stage } = setup()
    expect(v.pickMain(doc, stage.id)).toBeNull()
    expect(v.pickMain(doc, button.id)).toBeNull()
    v.createVariant(doc, button.id)
    const setId = v.setOf(doc, button.id) as string
    doc.nodes[setId].children = []
    expect(v.pickMain(doc, setId)).toBeNull()
  })

  it('variantValues fills defaults for missing props', () => {
    const { doc, setId, size, S } = sized()
    delete doc.nodes[S].component!.variant![size]
    expect(v.variantValues(doc, S)).toEqual({ [size]: 'S', tone: 'Plain' })
    expect(setId).toBeTruthy()
  })
})
