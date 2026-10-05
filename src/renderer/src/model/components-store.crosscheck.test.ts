// Cross-check from the T13 rebuild (88d9f2b): cases ported to run against this branch's store hooks.
// Slice 2: store hooks. Instances follow their main inside the edit's own undo step; edits inside an
// instance become overrides; structure edits inside one are refused; deleting a main detaches.
import { beforeEach, describe, expect, it } from 'vitest'
import { getStore, useStore } from './store'

import { isAncestor } from './ops'
import type { CNode, Doc } from './types'

const S = getStore
let id: string
const doc = (): Doc => S().docs[id]
const root = (): string => doc().pages[0].rootId
const node = (n: string): CNode => doc().nodes[n]
const frame = (name: string, parent = root(), style = {}): string => S().createNode(id, { type: 'frame', name, style }, parent)
const text = (t: string, parent: string): string => S().createNode(id, { type: 'text', text: t }, parent)
/** The materialised copy of main-side node `srcId` (the first one when several instances exist). */
const twin = (srcId: string): CNode => {
  const t = Object.values(doc().nodes).find((n) => n.srcId === srcId && n.id !== srcId)
  if (!t) throw new Error('no twin')
  return t
}

/** Card (main: title text + box) and a Stage holding one instance of it. */
function setup() {
  const card = frame('Card', root(), { width: 200, height: 100, background: 'white' })
  const title = text('Title', card)
  const box = frame('Box', card, { width: 20 })
  const stage = frame('Stage')
  S().createComponent(id, [card])
  const inst = S().createInstance(id, card, stage)
  return { card, title, box, stage, inst }
}

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true)
  id = S().createDoc('T', { open: false })
})

describe('instances follow the main', () => {
  it('a main edit updates instances in one undo step; undo/redo move both together', () => {
    const { card, title, inst } = setup()
    const before = JSON.stringify(doc().nodes)
    S().setText(id, title, 'Changed')
    expect(twin(title).text).toBe('Changed')
    S().updateStyles(id, [card], { background: 'red' })
    expect(node(inst).style.background).toBe('red')
    S().undo(id)
    expect(node(inst).style.background).toBe('white')
    expect(twin(title).text).toBe('Changed')
    S().undo(id)
    expect(JSON.stringify(doc().nodes)).toBe(before)
    S().redo(id)
    S().redo(id)
    expect(node(inst).style.background).toBe('red')
    expect(twin(title).text).toBe('Changed')
  })

  it('add / remove / reorder children in the main reach the instance', () => {
    const { card, title, box, inst } = setup()
    const extra = text('Extra', card)
    expect(node(inst).children.map((c) => node(c).srcId)).toEqual([title, box, extra])
    S().moveNodes(id, [extra], card, 0)
    expect(node(inst).children.map((c) => node(c).srcId)).toEqual([extra, title, box])
    S().deleteNodes(id, [box])
    expect(node(inst).children.map((c) => node(c).srcId)).toEqual([extra, title])
    S().undo(id)
    expect(node(inst).children).toHaveLength(3)
  })

  it('an edit that touches no main leaves instances untouched (same object)', () => {
    const { inst } = setup()
    const other = frame('Other')
    const snapshot = node(inst)
    S().updateStyles(id, [other], { color: 'red' })
    expect(node(inst)).toBe(snapshot)
    S().undo(id)
    expect(node(other).style.color).toBeUndefined()
  })
})

describe('overrides through the store', () => {
  it('text and style edits on an instance child become overrides, main stays', () => {
    const { title, inst } = setup()
    const t = twin(title).id
    S().setText(id, t, 'Mine')
    S().updateStyles(id, [t], { color: 'blue' })
    expect(twin(title)).toMatchObject({ text: 'Mine', style: { color: 'blue' } })
    expect(node(title).text).toBe('Title')
    expect(node(inst).instance!.overrides![title]).toMatchObject({ text: 'Mine', style: { color: 'blue' } })
  })

  it('overrides survive main edits, and undo/redo step through them', () => {
    const { title } = setup()
    S().setText(id, twin(title).id, 'Mine')
    S().updateStyles(id, [title], { fontSize: 30 })
    expect(twin(title)).toMatchObject({ text: 'Mine', style: { fontSize: 30 } })
    S().undo(id) // main edit
    S().undo(id) // override
    expect(twin(title).text).toBe('Title')
    S().redo(id)
    expect(twin(title).text).toBe('Mine')
  })

  it('updateNode and renameNode route to overrides for instance children', () => {
    const { title } = setup()
    const t = twin(title).id
    S().updateNode(id, t, { text: 'Via node', visible: false, x: 7 })
    expect(twin(title)).toMatchObject({ text: 'Via node', visible: false, x: 7 })
    expect(node(title)).toMatchObject({ text: 'Title', visible: true })
    S().renameNode(id, t, 'Renamed')
    expect(twin(title).name).toBe('Renamed')
    expect(node(title).name).not.toBe('Renamed')
  })

  it('instance root: size and name are its own, other style keys are overrides', () => {
    const { card, inst } = setup()
    S().updateStyles(id, [inst], { width: 300, background: 'green' })
    expect(node(inst).style).toMatchObject({ width: 300, background: 'green' })
    expect(node(inst).instance!.overrides!['']).toEqual({ style: { background: 'green' } })
    S().updateStyles(id, [card], { background: 'red', width: 250 })
    expect(node(inst).style).toMatchObject({ width: 300, background: 'green' })
    S().renameNode(id, inst, 'My card')
    expect(node(inst).name).toBe('My card')
  })

  it('resetOverrides restores the main look and is undoable', () => {
    const { title, inst } = setup()
    S().setText(id, twin(title).id, 'Mine')
    S().resetOverrides(id, inst)
    expect(twin(title).text).toBe('Title')
    S().undo(id)
    expect(twin(title).text).toBe('Mine')
  })
})

describe('structure inside an instance is refused', () => {
  it('the instance root itself can be duplicated, moved and deleted like any node', () => {
    const { inst, stage, card } = setup()
    const [copy] = S().duplicateNodes(id, [inst])
    expect(node(copy).instance).toEqual({ of: card })
    expect(node(copy).children).toHaveLength(2)
    S().moveNodes(id, [copy], root())
    expect(node(copy).parent).toBe(root())
    S().deleteNodes(id, [inst])
    expect(doc().nodes[inst]).toBeUndefined()
    expect(node(stage).children).toEqual([])
  })
})

describe('deleting and duplicating a main', () => {
  it('deleting a main detaches its instances in the same undo step', () => {
    const { card, title, inst } = setup()
    S().deleteNodes(id, [card])
    expect(node(inst).instance).toBeUndefined()
    expect(node(inst).children).toHaveLength(2)
    expect(Object.values(doc().nodes).some((n) => n.srcId)).toBe(false)
    S().undo(id)
    expect(node(card).component).toBeDefined()
    expect(node(inst).instance).toEqual({ of: card })
    expect(Object.values(doc().nodes).filter((n) => n.srcId === title)).toHaveLength(1)
  })

  it('deleting the page that holds a main also detaches its instances', () => {
    const { inst } = setup()
    const p2 = S().addPage(id, 'Two')
    const p2root = doc().pages.find((p) => p.id === p2)!.rootId
    const m2 = frame('Main2', p2root)
    S().createComponent(id, [m2])
    const i2 = S().createInstance(id, m2, root())
    S().deletePage(id, p2)
    expect(node(i2).instance).toBeUndefined()
    expect(node(inst).instance).toBeDefined()
  })

  it('duplicating a main gives a plain frame; its instances are unaffected', () => {
    const { card, inst } = setup()
    const [copy] = S().duplicateNodes(id, [card])
    expect(node(copy).component).toBeUndefined()
    expect(node(inst).instance).toEqual({ of: card })
  })
})

describe('nested instances through the store', () => {
  it('an edit of the innermost main reaches the outermost instance in one undo step', () => {
    const { card, title } = setup()
    const page = frame('Page')
    S().createComponent(id, [page])
    S().createInstance(id, card, page)
    const outer = S().createInstance(id, page, root())
    S().setText(id, title, 'Deep')
    const deep = Object.values(doc().nodes).filter((n) => n.text === 'Deep')
    // main, instance on the stage, instance inside Page, copy inside the outer instance
    expect(deep).toHaveLength(4)
    expect(deep.filter((n) => isAncestor(doc(), outer, n.id))).toHaveLength(1)
    S().undo(id)
    expect(Object.values(doc().nodes).filter((n) => n.text === 'Deep')).toHaveLength(0)
  })

  it('creating an instance inside its own main is refused', () => {
    const { card } = setup()
    expect(() => S().createInstance(id, card, card)).toThrow()
  })
})
