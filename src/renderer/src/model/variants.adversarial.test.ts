// Test-station checks on top of variants.test.ts: failure atomicity, placement, instances of variants, migration from old docs.
import { describe, expect, it } from 'vitest'
import { produce } from 'immer'
import * as ops from './ops'
import * as c from './components'
import * as v from './variants'
import type { CNode } from './types'

function setup(parentStyle: Record<string, string | number> = {}) {
  const doc = ops.makeDoc('d', 'Doc')
  const root = doc.pages[0].rootId
  const add = (n: Parameters<typeof ops.makeNode>[1], parent: string): CNode => {
    const node = ops.makeNode(doc, n)
    ops.insertNode(doc, node, parent)
    return node
  }
  const holder = add({ type: 'frame', name: 'Holder', style: parentStyle }, root)
  const before = add({ type: 'rect', name: 'Before' }, holder.id)
  const button = add({ type: 'frame', name: 'Button', style: { width: 120, height: 40 } }, holder.id)
  const after = add({ type: 'rect', name: 'After' }, holder.id)
  add({ type: 'text', text: 'Click' }, button.id)
  c.createComponent(doc, button.id)
  return { doc, root, holder, before, button, after, add }
}

describe('createVariant: placement', () => {
  it('a main inside a flex frame: the set takes its slot, siblings keep their order', () => {
    const { doc, holder, before, button, after } = setup({ display: 'flex', flexDirection: 'column' })
    v.createVariant(doc, button.id)
    const set = v.setOf(doc, button.id) as string
    expect(doc.nodes[holder.id].children).toEqual([before.id, set, after.id])
    expect(doc.nodes[button.id].parent).toBe(set)
  })

  it('new variants land right after the one they were copied from', () => {
    const { doc, button } = setup()
    const b = v.createVariant(doc, button.id)
    const c1 = v.createVariant(doc, button.id, undefined)
    const set = v.setOf(doc, button.id) as string
    expect(doc.nodes[set].children).toEqual([button.id, c1, b])
  })
})

describe('createVariant: failures', () => {
  it('on an immer draft a refused call leaves the doc untouched (what the store relies on)', () => {
    const { doc, button } = setup()
    const before = JSON.stringify(doc)
    // a lone main wrapped, then the same default combination again: refused after the wrap started
    const frozen = produce(doc, () => undefined)
    expect(() =>
      produce(frozen, (d) => {
        const sid = v.createVariant(d, button.id)
        const prop = d.nodes[v.setOf(d, button.id) as string].componentSet!.props[0]
        v.createVariant(d, sid, { [prop.id]: 'Default' }) // duplicates the original: throws
      })
    ).toThrow(/already exists/)
    expect(JSON.stringify(doc)).toBe(before)
  })

  it('KNOWN (minor): on a plain doc an unknown prop id throws only after a lone main was wrapped in a set', () => {
    const { doc, button } = setup()
    expect(() => v.createVariant(doc, button.id, { nope: 'x' })).toThrow(/Unknown variant property/)
    // the wrap already happened; inside a store mutation (immer draft) the throw discards it, see the test above
    expect(v.setOf(doc, button.id)).not.toBeNull()
  })
})

describe('variants and instances', () => {
  it('an instance of a variant main syncs when that variant is edited, others stay put', () => {
    const { doc, root, button, add } = setup()
    const b = v.createVariant(doc, button.id)
    const stage = add({ type: 'frame', name: 'Stage' }, root)
    const i1 = c.createInstance(doc, button.id, stage.id)
    const i2 = c.createInstance(doc, b, stage.id)
    const label = (inst: string): CNode => doc.nodes[doc.nodes[inst].children[0]]
    const mainLabel = doc.nodes[doc.nodes[b].children[0]]
    mainLabel.text = 'Loud'
    c.syncInstances(doc, b)
    expect(label(i2).text).toBe('Loud')
    expect(label(i1).text).toBe('Click')
  })

  it('a variant copy is itself a normal main (createComponent refuses it, Already a component)', () => {
    const { doc, button } = setup()
    const b = v.createVariant(doc, button.id)
    expect(() => c.createComponent(doc, b)).toThrow()
    expect(doc.nodes[b].component?.set).toBeTruthy()
  })
})

describe('pickMain: odd inputs', () => {
  it('ignores values for props the set does not have, and unknown options fall back by score', () => {
    const { doc, button } = setup()
    const b = v.createVariant(doc, button.id)
    const set = v.setOf(doc, button.id) as string
    const prop = doc.nodes[set].componentSet!.props[0]
    expect(v.pickMain(doc, set, { nope: 'x' })).toBe(button.id) // default = first main
    expect(v.pickMain(doc, set, { [prop.id]: 'Nonexistent' })).toBe(button.id) // nothing matches: first in order
    expect(v.pickMain(doc, set, { [prop.id]: doc.nodes[b].component!.variant![prop.id] })).toBe(b)
  })
})

describe('migration', () => {
  it('a v1 doc ends at DOC_VERSION 4 and keeps the v2 line-height pin', () => {
    const d = ops.makeDoc('d', 'Old')
    const root = d.pages[0].rootId
    const t = ops.makeNode(d, { type: 'text', text: 'x' }, false)
    d.nodes[t.id] = t
    t.parent = root
    d.nodes[root].children.push(t.id)
    const old = { ...d, version: 1 }
    const up = ops.migrateDoc(old)
    expect(up.version).toBe(4)
    expect(ops.DOC_VERSION).toBe(4)
    expect(up.nodes[t.id].style.lineHeight).toBe('20px')
  })

  it('a doc already at v4 is returned as is', () => {
    const d = ops.makeDoc('d', 'New')
    expect(ops.migrateDoc(d)).toBe(d)
  })
})
