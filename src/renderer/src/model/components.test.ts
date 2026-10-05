import { describe, expect, it } from 'vitest'
import { produce } from 'immer'
import * as ops from './ops'
import * as c from './components'
import type { CNode, Doc } from './types'

/** A page with a "Card" frame holding a title text and a rect. */
function setup() {
  const doc = ops.makeDoc('d', 'Doc')
  const root = doc.pages[0].rootId
  const add = (n: Parameters<typeof ops.makeNode>[1], parent: string): CNode => {
    const node = ops.makeNode(doc, n)
    ops.insertNode(doc, node, parent)
    return node
  }
  const card = add({ type: 'frame', name: 'Card', style: { width: 200, height: 100, background: 'white' } }, root)
  const title = add({ type: 'text', text: 'Title', style: { color: 'black' } }, card.id)
  const box = add({ type: 'rect', style: { width: 20, height: 20 } }, card.id)
  const stage = add({ type: 'frame', name: 'Stage', style: { width: 800, height: 600 } }, root)
  c.createComponent(doc, card.id)
  return { doc, root, card, title, box, stage }
}

const twin = (doc: Doc, inst: string, srcId: string): CNode => {
  const t = Object.values(doc.nodes).find((n) => n.srcId === srcId && ops.isAncestor(doc, inst, n.id))
  if (!t) throw new Error(`no twin of ${srcId}`)
  return t
}

describe('createComponent', () => {
  it('marks a frame as a main and defaults the name', () => {
    const { doc, card } = setup()
    expect(doc.nodes[card.id].component).toEqual({ name: 'Card' })
  })
  it('refuses non-frames, page roots, existing mains and instances', () => {
    const { doc, root, title, card, stage } = setup()
    expect(() => c.createComponent(doc, title.id)).toThrow()
    expect(() => c.createComponent(doc, root)).toThrow()
    expect(() => c.createComponent(doc, card.id)).toThrow(/Already/)
    const i = c.createInstance(doc, card.id, stage.id)
    expect(() => c.createComponent(doc, i)).toThrow()
  })
})

describe('createComponentFrom', () => {
  const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height })
  it('uses a single frame as is', () => {
    const { doc, stage } = setup()
    const id = c.createComponentFrom(doc, [stage.id], new Map(), rect(0, 0, 1, 1), { x: 0, y: 0 })
    expect(id).toBe(stage.id)
    expect(doc.nodes[id].component).toBeDefined()
  })
  it('wraps a non-frame or a multi selection in a frame first', () => {
    const { doc, title, box, card } = setup()
    const rects = new Map([[title.id, rect(0, 0, 10, 10)], [box.id, rect(20, 0, 20, 20)]])
    const id = c.createComponentFrom(doc, [title.id, box.id], rects, rect(0, 0, 40, 20), { x: 0, y: 0 })
    expect(id).not.toBe(card.id)
    expect(doc.nodes[id]).toMatchObject({ type: 'frame', parent: card.id, children: [title.id, box.id] })
    expect(doc.nodes[id].component).toBeDefined()
    const one = c.createComponentFrom(doc, [title.id], new Map(), rect(0, 0, 10, 10), { x: 0, y: 0 })
    expect(doc.nodes[one].children).toEqual([title.id])
  })
  it('rejects mixed parents and instance content', () => {
    const { doc, title, stage } = setup()
    expect(() => c.createComponentFrom(doc, [title.id, stage.id], new Map(), rect(0, 0, 1, 1), { x: 0, y: 0 })).toThrow()
    const i = c.createInstance(doc, doc.nodes[title.id].parent!, stage.id)
    const inner = doc.nodes[i].children[0]
    expect(() => c.createComponentFrom(doc, [inner], new Map(), rect(0, 0, 1, 1), { x: 0, y: 0 })).toThrow()
  })
})

describe('createInstance', () => {
  it('mirrors the main subtree with fresh ids and srcId links', () => {
    const { doc, card, title, stage } = setup()
    const i = c.createInstance(doc, card.id, stage.id)
    const inst = doc.nodes[i]
    expect(inst.instance).toEqual({ of: card.id })
    expect(inst.parent).toBe(stage.id)
    expect(inst.children).toHaveLength(2)
    expect(inst.style.width).toBe(200)
    expect(inst.style.background).toBe('white')
    const t = twin(doc, i, title.id)
    expect(t.id).not.toBe(title.id)
    expect(t.text).toBe('Title')
    expect(t.style.color).toBe('black')
  })
  it('rejects a non-component, a missing parent and a parent inside an instance', () => {
    const { doc, title, card, stage } = setup()
    expect(() => c.createInstance(doc, title.id, stage.id)).toThrow()
    expect(() => c.createInstance(doc, card.id, 'nope')).toThrow()
    const i = c.createInstance(doc, card.id, stage.id)
    expect(() => c.createInstance(doc, card.id, i)).toThrow(/structure/)
  })
  it('rejects cycles: inside its own main, or via a nested instance', () => {
    const { doc, card, stage } = setup()
    expect(() => c.createInstance(doc, card.id, card.id)).toThrow(/itself/)
    // Page main holds an instance of Card; Card must not then hold an instance of Page
    const page = ops.makeNode(doc, { type: 'frame', name: 'Page' })
    ops.insertNode(doc, page, stage.id)
    c.createComponent(doc, page.id)
    c.createInstance(doc, card.id, page.id)
    expect(() => c.createInstance(doc, page.id, card.id)).toThrow(/itself/)
  })
})

describe('syncInstances', () => {
  it('follows main edits: style, text, added, removed and reordered children', () => {
    const { doc, card, title, box, stage } = setup()
    const i = c.createInstance(doc, card.id, stage.id)
    doc.nodes[title.id].text = 'New'
    doc.nodes[card.id].style.background = 'red'
    const extra = ops.makeNode(doc, { type: 'rect', name: 'Extra' })
    ops.insertNode(doc, extra, card.id, 0)
    ops.removeNode(doc, box.id)
    c.syncInstances(doc, card.id)
    const inst = doc.nodes[i]
    expect(inst.style.background).toBe('red')
    expect(twin(doc, i, title.id).text).toBe('New')
    expect(inst.children.map((x) => doc.nodes[x].srcId)).toEqual([extra.id, title.id])
    expect(Object.values(doc.nodes).some((n) => n.srcId === box.id)).toBe(false)
  })
  it('keeps the instance box, position and name', () => {
    const { doc, card, stage } = setup()
    const i = c.createInstance(doc, card.id, stage.id, undefined, { x: 5, y: 6 })
    doc.nodes[i].style.width = 300
    doc.nodes[i].name = 'Mine'
    doc.nodes[card.id].style.width = 250
    doc.nodes[card.id].name = 'Renamed'
    c.syncInstances(doc)
    expect(doc.nodes[i]).toMatchObject({ x: 5, y: 6, name: 'Mine' })
    expect(doc.nodes[i].style.width).toBe(300)
  })
  it('is stable: a second sync changes nothing', () => {
    const { doc, card, stage } = setup()
    c.createInstance(doc, card.id, stage.id)
    const before = JSON.stringify(doc)
    c.syncInstances(doc)
    expect(JSON.stringify(doc)).toBe(before)
  })
  it('syncs nested instances depth-first', () => {
    const { doc, card, title, stage } = setup()
    const page = ops.makeNode(doc, { type: 'frame', name: 'Page' })
    ops.insertNode(doc, page, stage.id)
    c.createComponent(doc, page.id)
    c.createInstance(doc, card.id, page.id)
    const outer = c.createInstance(doc, page.id, stage.id)
    doc.nodes[title.id].text = 'Deep'
    c.syncInstances(doc, card.id)
    const deep = Object.values(doc.nodes).filter((n) => n.text === 'Deep' && ops.isAncestor(doc, outer, n.id))
    expect(deep).toHaveLength(1)
  })
})

describe('overrides', () => {
  it('apply over the main and survive main edits', () => {
    const { doc, card, title, stage } = setup()
    const i = c.createInstance(doc, card.id, stage.id)
    c.setOverride(doc, i, title.id, { text: 'Mine', style: { color: 'blue' } })
    expect(twin(doc, i, title.id)).toMatchObject({ text: 'Mine', style: { color: 'blue' } })
    doc.nodes[title.id].style.fontSize = 30
    doc.nodes[title.id].text = 'Main changed'
    c.syncInstances(doc, card.id)
    const t = twin(doc, i, title.id)
    expect(t.text).toBe('Mine')
    expect(t.style).toMatchObject({ color: 'blue', fontSize: 30 })
  })
  it('a null style patch removes the main key; root overrides use the main id', () => {
    const { doc, card, stage } = setup()
    const i = c.createInstance(doc, card.id, stage.id)
    c.setOverride(doc, i, card.id, { style: { background: null } })
    expect(doc.nodes[i].style.background).toBeUndefined()
    expect(doc.nodes[i].instance!.overrides).toHaveProperty([''])
  })
  it('reset one or all', () => {
    const { doc, card, title, box, stage } = setup()
    const i = c.createInstance(doc, card.id, stage.id)
    c.setOverride(doc, i, title.id, { text: 'A' })
    c.setOverride(doc, i, box.id, { visible: false })
    c.resetOverrides(doc, i, title.id)
    expect(twin(doc, i, title.id).text).toBe('Title')
    expect(twin(doc, i, box.id).visible).toBe(false)
    c.resetOverrides(doc, i)
    expect(twin(doc, i, box.id).visible).toBe(true)
    expect(doc.nodes[i].instance!.overrides).toBeUndefined()
  })
  it('overrides of a removed main node are dropped', () => {
    const { doc, card, box, stage } = setup()
    const i = c.createInstance(doc, card.id, stage.id)
    c.setOverride(doc, i, box.id, { name: 'X' })
    ops.removeNode(doc, box.id)
    c.syncInstances(doc, card.id)
    expect(doc.nodes[i].instance!.overrides).toBeUndefined()
  })
})

describe('detach and clone', () => {
  it('detach keeps the shown content as plain nodes', () => {
    const { doc, card, title, stage } = setup()
    const i = c.createInstance(doc, card.id, stage.id)
    c.setOverride(doc, i, title.id, { text: 'Kept' })
    c.detachInstance(doc, i)
    expect(Object.values(doc.nodes).some((n) => n.instance || (n.srcId && n.id !== card.id && ops.isAncestor(doc, i, n.id)))).toBe(false)
    c.syncInstances(doc)
    expect(Object.values(doc.nodes).some((n) => n.text === 'Kept')).toBe(true)
    expect(() => c.detachInstance(doc, i)).toThrow()
  })
  it('detachInstancesOf frees every instance of a main', () => {
    const { doc, card, stage } = setup()
    const a = c.createInstance(doc, card.id, stage.id)
    const b = c.createInstance(doc, card.id, stage.id)
    c.detachInstancesOf(doc, card.id)
    expect(doc.nodes[a].instance).toBeUndefined()
    expect(doc.nodes[b].instance).toBeUndefined()
  })
  it('duplicating a main gives a plain frame; duplicating an instance stays an instance', () => {
    const { doc, card, stage } = setup()
    const i = c.createInstance(doc, card.id, stage.id)
    const mainCopy = ops.duplicate(doc, card.id)
    expect(doc.nodes[mainCopy].component).toBeUndefined()
    const instCopy = ops.duplicate(doc, i)
    expect(doc.nodes[instCopy].instance).toEqual({ of: card.id })
    expect(c.instancesOf(doc, card.id)).toHaveLength(2)
  })
})

describe('as an immer recipe (store usage)', () => {
  it('one produce covers the main edit and the sync, and the base is untouched', () => {
    const { doc, card, title, stage } = setup()
    const i = c.createInstance(doc, card.id, stage.id)
    const next = produce(doc, (d) => {
      d.nodes[title.id].text = 'Via recipe'
      c.syncInstances(d, card.id)
    })
    expect(twin(next, i, title.id).text).toBe('Via recipe')
    expect(twin(doc, i, title.id).text).toBe('Title')
  })
})

describe('migrateDoc v2 -> v3', () => {
  it('only bumps the version', () => {
    const d = ops.makeDoc('d', 'Old')
    d.version = 2
    const m = ops.migrateDoc(d)
    expect(m.version).toBe(3)
    expect(m.nodes).toBe(d.nodes)
  })
})
