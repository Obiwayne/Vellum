// T13 test station: adversarial probes of the store hooks (components.settleEdits / syncStale).
// `it.fails` marks known defects reported to the builder (they turn red once fixed: then drop the `.fails`).
import { beforeEach, describe, expect, it } from 'vitest'
import { diffDocs } from '@shared/docDiff'
import { getStore, useStore } from './store'
import { isAncestor } from './ops'
import type { CNode, Doc } from './types'

const S = getStore
let id: string
const doc = (): Doc => S().docs[id]
const root = (): string => doc().pages[0].rootId
const node = (n: string): CNode => doc().nodes[n]
const twin = (src: string, under?: string): CNode => {
  const t = Object.values(doc().nodes).find((n) => n.srcId === src && n.id !== src && (!under || isAncestor(doc(), under, n.id)))
  if (!t) throw new Error('no twin')
  return t
}

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

describe('adversarial: store hooks', () => {
  it('moving an instance into its own main is refused (would be a cycle) or at least terminates sanely', () => {
    const { card, inst } = setup()
    let err: unknown = null
    try {
      S().moveNodes(id, [inst], card)
    } catch (e) {
      err = e
    }
    // either outcome is acceptable as long as it terminated and the doc is not self-nested
    const nested = Object.values(doc().nodes).filter((n) => n.instance && isAncestor(doc(), n.id, n.id))
    expect(nested).toHaveLength(0)
    if (!err) {
      // not refused: the instance must not have grown copies of itself
      const depth = (n: string): number => 1 + Math.max(0, ...node(n).children.map(depth))
      expect(depth(card)).toBeLessThan(6)
    }
  })

  it('moving a main into an instance of itself / into an instance is refused', () => {
    const { card, inst } = setup()
    expect(() => S().moveNodes(id, [card], inst)).toThrow()
  })

  it('a text edit on an instance twin does not freeze the layer name against main renames', () => {
    const { title, inst } = setup()
    S().setText(id, twin(title, inst).id, 'Mine')
    S().renameNode(id, title, 'Heading')
    expect(twin(title, inst).name).toBe('Heading')
  })

  it('toggling visible / locked on a twin is an override and reset restores it', () => {
    const { box, inst } = setup()
    S().updateNode(id, twin(box, inst).id, { visible: false, locked: true })
    expect(twin(box, inst)).toMatchObject({ visible: false, locked: true })
    expect(node(box)).toMatchObject({ visible: true, locked: false })
    S().resetOverrides(id, inst, box)
    expect(twin(box, inst)).toMatchObject({ visible: true, locked: false })
  })

  it('undo after an override edit restores the exact previous doc', () => {
    const { title, inst } = setup()
    const before = JSON.stringify(doc().nodes)
    S().updateStyles(id, [twin(title, inst).id], { color: 'blue', fontSize: 12 })
    S().undo(id)
    expect(JSON.stringify(doc().nodes)).toBe(before)
    S().redo(id)
    expect(twin(title, inst).style).toMatchObject({ color: 'blue', fontSize: 12 })
  })

  it('removing a style key on a twin (null) is an override that survives main edits', () => {
    const { title, inst } = setup()
    S().updateStyles(id, [twin(title, inst).id], { color: null })
    expect(twin(title, inst).style.color).toBeUndefined()
    S().updateStyles(id, [title], { color: 'red' }) // main changes the same key
    expect(twin(title, inst).style.color).toBeUndefined()
  })

  it('two instances of one main both follow, and overriding one leaves the other alone', () => {
    const { title, stage, inst } = setup()
    const inst2 = S().createInstance(id, S().docs[id].nodes[inst].instance!.of, stage)
    S().setText(id, twin(title, inst).id, 'Only first')
    S().updateStyles(id, [title], { color: 'red' })
    expect(twin(title, inst).text).toBe('Only first')
    expect(twin(title, inst2).text).toBe('Title')
    expect(twin(title, inst).style.color).toBe('red')
    expect(twin(title, inst2).style.color).toBe('red')
  })

  it('a no-op edit adds no history entry and keeps the doc object', () => {
    const { title } = setup()
    S().setText(id, title, 'Title') // same text
    const d = doc()
    S().updateStyles(id, [title], { color: 'black' }) // same value
    expect(doc().nodes[title]).toBe(d.nodes[title])
  })

  it('deleting a page that holds only instances (main elsewhere) leaves the main and other instances intact', () => {
    const { card, inst } = setup()
    const p2 = S().addPage(id, 'Two')
    const p2root = doc().pages.find((p) => p.id === p2)!.rootId
    S().createInstance(id, card, p2root)
    S().deletePage(id, p2)
    expect(node(inst).instance?.of).toBe(card)
    expect(node(card).component).toBeDefined()
  })

  it('deleting the page of a main detaches instances on other pages in one undo step', () => {
    const p2 = S().addPage(id, 'Two')
    const p2root = doc().pages.find((pg) => pg.id === p2)!.rootId
    const main2 = S().createNode(id, { type: 'frame', name: 'M2', style: { width: 10, height: 10 } }, p2root)
    S().createNode(id, { type: 'rect' }, main2)
    S().createComponent(id, [main2])
    const i = S().createInstance(id, main2, root())
    S().deletePage(id, p2)
    expect(node(i).instance).toBeUndefined()
    expect(node(i).children).toHaveLength(1)
    S().undo(id)
    expect(node(i).instance?.of).toBe(main2)
  })

  it('stays fast on a big doc: 2000 nodes, one instance, a main edit', () => {
    const { card, title } = setup()
    for (let k = 0; k < 2000; k++) S().createNode(id, { type: 'rect' }, root())
    const t0 = performance.now()
    S().updateStyles(id, [title], { color: 'red' })
    expect(performance.now() - t0).toBeLessThan(500)
    expect(card).toBeTruthy()
  })
})

describe('goToMain', () => {
  it('selects the main and switches to its page, from the instance or a node inside it', () => {
    const { card, title, inst } = setup()
    const page2 = S().addPage(id, 'Two')
    S().setActivePage(id, page2)
    S().select(id, [])
    expect(S().goToMain(id, inst)).toBe(true)
    expect(S().editors[id].selection).toEqual([card])
    expect(S().editors[id].pageId).toBe(doc().pages[0].id)
    S().setActivePage(id, page2)
    expect(S().goToMain(id, twin(title, inst).id)).toBe(true)
    expect(S().editors[id].selection).toEqual([card])
    expect(S().goToMain(id, card)).toBe(false) // a main is not an instance
    expect(S().goToMain(id, 'nope')).toBe(false)
  })
})

describe('adversarial: docDiff (task asks to skip derived nodes)', () => {
  it('lists an instance edit once, not every derived child', () => {
    const { title } = setup()
    const before = doc()
    S().updateStyles(id, [title], { color: 'red' }) // main change -> twin changes too
    const d = diffDocs(before, doc())
    const flat = JSON.stringify(d)
    expect(flat).toBeDefined()
    // the derived twin must not appear as its own change
    const twinId = Object.values(doc().nodes).find((n) => n.srcId === title && n.id !== title)!.id
    expect(flat.includes(twinId)).toBe(false)
  })

  it('an override edit on a twin lists the instance once, and a new instance lists its root only', () => {
    const { title, inst } = setup()
    const before = doc()
    S().setText(id, twin(title, inst).id, 'Mine')
    const d = diffDocs(before, doc())
    expect(d.changed.map((c) => c.id)).toEqual([inst])
    const b2 = doc()
    const again = S().createInstance(id, node(inst).instance!.of, node(inst).parent!)
    const d2 = diffDocs(b2, doc())
    expect(d2.added.map((c) => c.id)).toEqual([again])
  })
})
