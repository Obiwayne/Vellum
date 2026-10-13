import { describe, expect, it } from 'vitest'
import * as ops from './ops'
import * as comp from './components'
import * as variants from './variants'
import { canonicalState, drawnStateDeltas, makeStateProperty, stateProp, stateTarget, styleDelta } from './devState'
import type { CNode } from './types'

describe('state vocabulary', () => {
  it('maps names to canonical states', () => {
    expect(canonicalState('Hover')).toBe('hover')
    expect(canonicalState('Active')).toBe('pressed')
    expect(canonicalState('Pressed')).toBe('pressed')
    expect(canonicalState('Focus visible')).toBe('focus-visible')
    expect(canonicalState('focused')).toBe('focus')
    expect(canonicalState('Rest')).toBe('default')
    expect(canonicalState('Inactive')).toBe('disabled')
    expect(canonicalState('Loading')).toBe('loading')
    expect(canonicalState('Dragging over')).toBe('dragging-over')
  })
  it('maps states to CSS and ARIA, unknown names to data-state', () => {
    expect(stateTarget('hover')).toEqual({ css: ':hover' })
    expect(stateTarget('Pressed')).toEqual({ css: ':active' })
    expect(stateTarget('focus-visible')).toEqual({ css: ':focus-visible' })
    expect(stateTarget('disabled')).toEqual({ css: ':disabled', attr: '[aria-disabled="true"]' })
    expect(stateTarget('selected').attr).toBe('[aria-selected="true"]')
    expect(stateTarget('error').attr).toBe('[aria-invalid="true"]')
    expect(stateTarget('loading').attr).toBe('[aria-busy="true"]')
    expect(stateTarget('Skeleton"x').attr).toBe('[data-state="skeletonx"]')
    expect(stateTarget('default')).toEqual({ css: '' })
  })
})

describe('styleDelta', () => {
  it('lists only what differs, ignores size and position, marks removals null', () => {
    expect(styleDelta({ color: 'a', width: 1, opacity: 1 }, { color: 'b', width: 2, left: 5 })).toEqual({ color: 'b', opacity: null })
    expect(styleDelta({ color: 'a' }, { color: 'a' })).toEqual({})
  })
})

function setup() {
  const doc = ops.makeDoc('d', 'D')
  const root = doc.pages[0].rootId
  const add = (partial: Parameters<typeof ops.makeNode>[1], parent: string): CNode => {
    const n = ops.makeNode(doc, partial, false)
    ops.insertNode(doc, n, parent)
    return n
  }
  const main = add({ type: 'frame', name: 'Button', style: { width: 100, height: 40, backgroundColor: '#2563EB' } }, root)
  const label = add({ type: 'text', name: 'Label', text: 'Go', style: { color: '#FFFFFF' } }, main.id)
  comp.createComponent(doc, main.id, 'Button')
  return { doc, root, main, label }
}

describe('makeStateProperty', () => {
  it('turns a lone main into a set with State = default | hover', () => {
    const { doc, main } = setup()
    const r = makeStateProperty(doc, main.id)
    expect(r.ok).toBe(true)
    const setId = doc.nodes[main.id].component!.set!
    expect(r.ok && r.setId).toBe(setId)
    const p = stateProp(doc, setId)!
    expect(p.name).toBe('State')
    expect(p.options).toEqual(['default', 'hover'])
    expect(p.default).toBe('default')
    expect(variants.variantsOf(doc, setId)).toHaveLength(2)
  })

  it('renames a single variant property to State and is idempotent', () => {
    const { doc, main } = setup()
    variants.createVariant(doc, main.id) // Variant property with Default and Variant 2
    const setId = doc.nodes[main.id].component!.set!
    expect(stateProp(doc, setId)).toBeUndefined()
    expect(makeStateProperty(doc, setId).ok).toBe(true)
    expect(stateProp(doc, setId)?.name).toBe('State')
    const before = JSON.stringify(doc.nodes[setId].componentSet)
    expect(makeStateProperty(doc, main.id).ok).toBe(true)
    expect(JSON.stringify(doc.nodes[setId].componentSet)).toBe(before)
  })

  it('refuses things that are not components', () => {
    const { doc, root } = setup()
    const plain = ops.makeNode(doc, { type: 'frame', name: 'Plain' }, false)
    ops.insertNode(doc, plain, root)
    expect(makeStateProperty(doc, plain.id)).toEqual({ ok: false, reason: 'Select a component first' })
    expect(makeStateProperty(doc, 'nope')).toEqual({ ok: false, reason: 'Layer not found' })
  })
})

describe('drawnStateDeltas', () => {
  it('compares each drawn state with the default, layer by layer', () => {
    const { doc, main } = setup()
    makeStateProperty(doc, main.id)
    const setId = doc.nodes[main.id].component!.set!
    const hover = variants.variantsOf(doc, setId).find((m) => m.id !== main.id)!
    hover.style.backgroundColor = '#1D4ED8'
    doc.nodes[hover.children[0]].style.color = '#EEEEEE'
    const d = drawnStateDeltas(doc, setId)
    expect(d.map((x) => x.state)).toEqual(['default', 'hover'])
    expect(d[0].changes).toEqual([])
    expect(d[1].option).toBe('hover')
    expect(d[1].changes).toEqual([
      { layer: '', patch: { backgroundColor: '#1D4ED8' } },
      { layer: 'Label', patch: { color: '#EEEEEE' } }
    ])
  })

  it('is empty for a set without a State property and for a lone main', () => {
    const { doc, main } = setup()
    expect(drawnStateDeltas(doc, main.id)).toEqual([])
    variants.createVariant(doc, main.id)
    expect(drawnStateDeltas(doc, doc.nodes[main.id].component!.set!)).toEqual([])
  })

  it('a second option that names the same state is not listed twice', () => {
    const { doc, main } = setup()
    makeStateProperty(doc, main.id)
    const setId = doc.nodes[main.id].component!.set!
    const p = stateProp(doc, setId)!
    variants.createVariant(doc, main.id, { [p.id]: 'Hovered' })
    const states = drawnStateDeltas(doc, setId).map((x) => x.state)
    expect(states.filter((s) => s === 'hover')).toHaveLength(1)
  })
})
