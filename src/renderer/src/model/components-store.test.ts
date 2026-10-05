import { beforeEach, describe, expect, it } from 'vitest'
import { getStore, useStore } from './store'
import { mainOf } from './components'
import type { CNode, Doc } from './types'

const S = getStore
let id: string
const doc = (): Doc => S().docs[id]
const root = (): string => doc().pages[0].rootId
const twin = (inst: string, src: string): CNode => {
  const t = Object.values(doc().nodes).find((n) => n.srcId === src && n.id !== inst)
  if (!t) throw new Error('no twin')
  return t
}
function ancestorsOf(nid: string): string[] {
  const out: string[] = []
  for (let p = doc().nodes[nid]?.parent; p; p = doc().nodes[p]?.parent ?? null) out.push(p)
  return out
}

/** Card (main) with a title text and a rect, plus a Stage frame holding one instance. */
function setup() {
  const card = S().createNode(id, { type: 'frame', name: 'Card', style: { width: 200, height: 100 } }, root())
  const title = S().createNode(id, { type: 'text', text: 'Title', style: { color: 'black' } }, card)
  const box = S().createNode(id, { type: 'rect', style: { width: 20, height: 20 } }, card)
  const stage = S().createNode(id, { type: 'frame', name: 'Stage' }, root())
  S().createComponent(id, [card])
  const inst = S().createInstance(id, card, stage)
  return { card, title, box, stage, inst }
}

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true)
  id = S().createDoc('T', { open: false })
})

describe('store: main edits reach instances in the same undo step', () => {
  it('style, text, add and remove child follow the main; one undo reverts main and instance', () => {
    const { card, title, box, inst } = setup()
    S().updateStyles(id, [title], { color: 'red' })
    expect(twin(inst, title).style.color).toBe('red')
    S().setText(id, title, 'Hello')
    expect(twin(inst, title).text).toBe('Hello')
    const extra = S().createNode(id, { type: 'rect' }, card)
    expect(doc().nodes[inst].children).toHaveLength(3)
    S().deleteNodes(id, [box])
    expect(doc().nodes[inst].children).toHaveLength(2)

    S().undo(id) // delete
    expect(doc().nodes[box]).toBeDefined()
    expect(doc().nodes[inst].children).toHaveLength(3)
    S().undo(id) // add child
    expect(doc().nodes[extra]).toBeUndefined()
    expect(doc().nodes[inst].children).toHaveLength(2)
    S().undo(id) // text
    S().undo(id) // colour
    expect(twin(inst, title).style.color).toBe('black')
    expect(twin(inst, title).text).toBe('Title')
    S().redo(id)
    expect(twin(inst, title).style.color).toBe('red')
  })

  it('creating an instance is one undo step', () => {
    const { stage, inst } = setup()
    S().undo(id)
    expect(doc().nodes[inst]).toBeUndefined()
    expect(doc().nodes[stage].children).toEqual([])
    expect(Object.values(doc().nodes).some((n) => n.srcId)).toBe(false)
  })
})

describe('store: edits inside an instance are overrides', () => {
  it('a style or text edit on an instance node survives main edits and resets', () => {
    const { title, inst } = setup()
    const t = twin(inst, title)
    S().updateStyles(id, [t.id], { color: 'blue' })
    S().setText(id, t.id, 'Mine')
    expect(doc().nodes[inst].instance?.overrides?.[title]).toMatchObject({ style: { color: 'blue' }, text: 'Mine' })
    expect(doc().nodes[title].style.color).toBe('black') // main untouched
    S().updateStyles(id, [title], { fontSize: 30 })
    const after = twin(inst, title)
    expect(after.style).toMatchObject({ color: 'blue', fontSize: 30 })
    expect(after.text).toBe('Mine')
    S().resetOverrides(id, inst, title)
    expect(twin(inst, title).style.color).toBe('black')
    expect(twin(inst, title).text).toBe('Title')
    expect(doc().nodes[inst].instance?.overrides).toBeUndefined()
    S().undo(id)
    expect(twin(inst, title).style.color).toBe('blue')
  })

  it('moving a child is an override; the instance root keeps its own size and position', () => {
    const { box, inst } = setup()
    S().updateNode(id, twin(inst, box).id, { x: 7, y: 9 })
    expect(doc().nodes[inst].instance?.overrides?.[box]).toEqual({ x: 7, y: 9 })
    S().updateStyles(id, [inst], { width: 300 })
    S().updateNode(id, inst, { x: 55 })
    expect(doc().nodes[inst].style.width).toBe(300)
    expect(doc().nodes[inst].x).toBe(55)
    expect(doc().nodes[inst].instance?.overrides?.['']).toBeUndefined()
    S().updateStyles(id, [inst], { backgroundColor: 'red' })
    expect(doc().nodes[inst].instance?.overrides?.['']).toEqual({ style: { backgroundColor: 'red' } })
  })

  it('structural edits inside an instance throw and change nothing', () => {
    const { box, inst, stage } = setup()
    const t = twin(inst, box).id
    const before = doc()
    expect(() => S().deleteNodes(id, [t])).toThrow(/Detach/)
    expect(() => S().createNode(id, { type: 'rect' }, inst)).toThrow(/Detach/)
    expect(() => S().moveNodes(id, [t], stage)).toThrow(/Detach/)
    expect(() => S().duplicateNodes(id, [t])).toThrow(/Detach/)
    expect(doc()).toBe(before)
  })
})

describe('store: detach, delete, duplicate', () => {
  it('detach turns an instance into plain nodes, keeping overrides applied; undo re-links it', () => {
    const { title, inst } = setup()
    S().updateStyles(id, [twin(inst, title).id], { color: 'blue' })
    const copy = twin(inst, title).id
    S().detachInstance(id, inst)
    expect(doc().nodes[inst].instance).toBeUndefined()
    expect(doc().nodes[copy].srcId).toBeUndefined()
    expect(doc().nodes[copy].style.color).toBe('blue')
    S().updateStyles(id, [title], { color: 'green' })
    expect(doc().nodes[copy].style.color).toBe('blue')
    S().undo(id)
    S().undo(id)
    expect(doc().nodes[inst].instance?.of).toBeDefined()
  })

  it('deleting a main detaches its instances in the same step', () => {
    const { card, title, inst } = setup()
    const copy = twin(inst, title).id
    S().deleteNodes(id, [card])
    expect(doc().nodes[card]).toBeUndefined()
    expect(doc().nodes[inst].instance).toBeUndefined()
    expect(doc().nodes[copy].srcId).toBeUndefined()
    expect(doc().nodes[copy].text).toBe('Title')
    S().undo(id)
    expect(doc().nodes[card].component).toBeDefined()
    expect(doc().nodes[inst].instance?.of).toBe(card)
  })

  it('duplicating a main gives a plain frame; duplicating an instance gives an instance', () => {
    const { card, inst } = setup()
    const [mainCopy] = S().duplicateNodes(id, [card])
    expect(doc().nodes[mainCopy].component).toBeUndefined()
    const [instCopy] = S().duplicateNodes(id, [inst])
    expect(doc().nodes[instCopy].instance?.of).toBe(card)
    expect(doc().nodes[instCopy].children).toHaveLength(2)
    expect(mainOf(doc(), instCopy)).toBeNull()
  })

  it('createComponent wraps a non-frame selection in a frame', () => {
    const r = S().createNode(id, { type: 'rect', style: { width: 10, height: 10 } }, root())
    const main = S().createComponent(id, [r])
    expect(doc().nodes[main].component).toBeDefined()
    expect(doc().nodes[r].parent).toBe(main)
    S().undo(id)
    expect(doc().nodes[main]).toBeUndefined()
  })
})

describe('store: nested instances and cycles', () => {
  it('an instance inside another main updates both levels', () => {
    const { card, title, stage } = setup()
    const page = S().createNode(id, { type: 'frame', name: 'Page' }, root())
    S().createComponent(id, [page])
    S().createInstance(id, card, page) // card instance inside Page
    const outer = S().createInstance(id, page, stage)
    S().updateStyles(id, [title], { color: 'pink' })
    const inTwin = Object.values(doc().nodes).filter((n) => n.text === 'Title' && ancestorsOf(n.id).includes(outer))
    expect(inTwin).toHaveLength(1)
    expect(inTwin[0].style.color).toBe('pink')
  })

  it('refuses a component containing an instance of itself', () => {
    const { card } = setup()
    expect(() => S().createInstance(id, card, card)).toThrow()
  })
})
