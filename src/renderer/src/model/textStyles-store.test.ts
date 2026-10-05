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
const kids = (n: string): CNode[] => node(n).children.map(node)

/** Two text nodes on the page. */
function setup() {
  const a = S().createNode(id, { type: 'text', text: 'A' }, root())
  const b = S().createNode(id, { type: 'text', text: 'B' }, root())
  return { a, b }
}

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true)
  id = S().createDoc('T', { open: false })
})

/** One undo restores the doc exactly as it was before `fn` (key order inside a style does not matter). */
function oneUndo(fn: () => void): void {
  const snap = () => JSON.parse(JSON.stringify({ n: doc().nodes, t: doc().textStyles ?? null }))
  const before = snap()
  fn()
  expect(snap()).not.toEqual(before)
  S().undo(id)
  expect(snap()).toEqual(before)
}

describe('text style actions: one undo step each', () => {
  it('createTextStyle from a node', () => {
    const { a } = setup()
    S().updateStyles(id, [a], { fontSize: 30, fontWeight: 700 })
    let sid = ''
    oneUndo(() => {
      sid = S().createTextStyle(id, 'Heading/H1', a)
    })
    expect(sid).not.toBe('')
    expect(doc().textStyles ?? []).toEqual([])
    sid = S().createTextStyle(id, 'Heading/H1', a)
    expect(doc().textStyles![0].style).toMatchObject({ fontSize: 30, fontWeight: 700 })
  })

  it('updateTextStyle rewrites every linked node and one undo restores style and nodes', () => {
    const { a, b } = setup()
    const sid = S().createTextStyle(id, 'Body', { fontSize: 16 })
    S().applyTextStyle(id, [a, b], sid)
    oneUndo(() => S().updateTextStyle(id, sid, { fontSize: 48 }))
    S().updateTextStyle(id, sid, { fontSize: 48 })
    expect(node(a).style.fontSize).toBe(48)
    expect(node(b).style.fontSize).toBe(48)
  })

  it('applyTextStyle on several nodes is one step', () => {
    const { a, b } = setup()
    const sid = S().createTextStyle(id, 'Body', { fontSize: 22 })
    oneUndo(() => S().applyTextStyle(id, [a, b], sid))
    S().applyTextStyle(id, [a, b], sid)
    expect(node(a).textStyle).toBe(sid)
    expect(node(b).style.fontSize).toBe(22)
  })

  it('detachTextStyle and deleteTextStyle are one step and keep values', () => {
    const { a, b } = setup()
    const sid = S().createTextStyle(id, 'Body', { fontSize: 22 })
    S().applyTextStyle(id, [a, b], sid)
    oneUndo(() => S().detachTextStyle(id, [a]))
    oneUndo(() => S().deleteTextStyle(id, sid))
    S().deleteTextStyle(id, sid)
    expect(node(a).textStyle).toBeUndefined()
    expect(node(b).textStyle).toBeUndefined()
    expect(node(b).style.fontSize).toBe(22)
    expect(doc().textStyles).toEqual([])
  })

  it('renameTextStyle is one step and keeps names unique', () => {
    setup()
    S().createTextStyle(id, 'A', { fontSize: 1 })
    const b = S().createTextStyle(id, 'B', { fontSize: 2 })
    oneUndo(() => S().renameTextStyle(id, b, 'a'))
    S().renameTextStyle(id, b, 'a')
    expect(doc().textStyles!.map((s) => s.name)).toEqual(['A', 'a 2'])
  })
})

describe('detach on manual edit', () => {
  it('a typography key unlinks, keeps the values, and returns the toast text', () => {
    const { a } = setup()
    const sid = S().createTextStyle(id, 'Body', { fontSize: 16, fontWeight: 400 })
    S().applyTextStyle(id, [a], sid)
    const msg = S().updateStyles(id, [a], { fontSize: 20 })
    expect(msg).toBe('Detached from text style Body')
    expect(node(a).textStyle).toBeUndefined()
    expect(node(a).style).toMatchObject({ fontSize: 20, fontWeight: 400 })
    S().updateTextStyle(id, sid, { fontSize: 99 })
    expect(node(a).style.fontSize).toBe(20)
    S().undo(id) // the style edit
    S().undo(id) // the manual edit: relinks
    expect(node(a).textStyle).toBe(sid)
    expect(node(a).style.fontSize).toBe(16)
  })

  it('non-typography keys and an unchanged value keep the link', () => {
    const { a } = setup()
    const sid = S().createTextStyle(id, 'Body', { fontSize: 16 })
    S().applyTextStyle(id, [a], sid)
    expect(S().updateStyles(id, [a], { color: 'red', textAlign: 'center' })).toBeNull()
    expect(S().updateStyles(id, [a], { fontSize: 16 })).toBeNull()
    expect(node(a).textStyle).toBe(sid)
  })

  it('only the edited node detaches', () => {
    const { a, b } = setup()
    const sid = S().createTextStyle(id, 'Body', { fontSize: 16 })
    S().applyTextStyle(id, [a, b], sid)
    S().updateStyles(id, [a], { letterSpacing: '2px' })
    expect(node(a).textStyle).toBeUndefined()
    expect(node(b).textStyle).toBe(sid)
  })
})

describe('inside component instances', () => {
  function withInstance() {
    const main = S().createNode(id, { type: 'frame', name: 'Card' }, root())
    const label = S().createNode(id, { type: 'text', text: 'Hi' }, main)
    const stage = S().createNode(id, { type: 'frame', name: 'Stage' }, root())
    S().createComponent(id, [main])
    const inst = S().createInstance(id, main, stage)
    const twin = (): CNode => kids(inst).find((n) => n.srcId === label)!
    return { main, label, inst, twin }
  }

  it('applying a style to an instance layer becomes an override that follows the style', () => {
    const { main, label, inst, twin } = withInstance()
    const sid = S().createTextStyle(id, 'Big', { fontSize: 40 })
    S().applyTextStyle(id, [twin().id], sid)
    expect(node(inst).instance?.overrides?.[label]?.textStyle).toBe(sid)
    expect(node(inst).instance?.overrides?.[label]?.style?.fontSize).toBeUndefined() // not pinned
    expect(twin().style.fontSize).toBe(40)
    expect(node(label).textStyle).toBeUndefined() // the main is untouched
    expect(isAncestor(doc(), main, label)).toBe(true)
    S().updateTextStyle(id, sid, { fontSize: 64 })
    expect(twin().style.fontSize).toBe(64)
    S().undo(id)
    expect(twin().style.fontSize).toBe(40)
  })

  it('a main layer that follows a style updates its instances with one undo step', () => {
    const { label, twin } = withInstance()
    const sid = S().createTextStyle(id, 'Body', { fontSize: 16 })
    S().applyTextStyle(id, [label], sid)
    expect(twin().textStyle).toBe(sid)
    oneUndo(() => S().updateTextStyle(id, sid, { fontSize: 50 }))
    S().updateTextStyle(id, sid, { fontSize: 50 })
    expect(twin().style.fontSize).toBe(50)
    expect(node(label).style.fontSize).toBe(50)
  })

  it('a manual typography edit on a linked twin detaches it and pins the values', () => {
    const { label, inst, twin } = withInstance()
    const sid = S().createTextStyle(id, 'Body', { fontSize: 16 })
    S().applyTextStyle(id, [label], sid)
    S().updateStyles(id, [twin().id], { fontSize: 30 })
    expect(node(inst).instance?.overrides?.[label]?.textStyle).toBe('')
    expect(twin().textStyle).toBeUndefined()
    S().updateTextStyle(id, sid, { fontSize: 99 })
    expect(node(label).style.fontSize).toBe(99)
    expect(twin().style.fontSize).toBe(30)
  })

  it('detaching a linked twin keeps its values when the style changes later', () => {
    const { label, twin } = withInstance()
    const sid = S().createTextStyle(id, 'Body', { fontSize: 16 })
    S().applyTextStyle(id, [label], sid)
    S().detachTextStyle(id, [twin().id])
    S().updateTextStyle(id, sid, { fontSize: 77 })
    expect(twin().style.fontSize).toBe(16)
    expect(twin().textStyle).toBeUndefined()
  })

  it('deleting a style an override points at unlinks the layer and keeps its look', () => {
    const { inst, label, twin } = withInstance()
    const sid = S().createTextStyle(id, 'Big', { fontSize: 40 })
    S().applyTextStyle(id, [twin().id], sid)
    S().deleteTextStyle(id, sid)
    expect(twin().textStyle).toBeUndefined()
    expect(node(inst).instance?.overrides?.[label]?.textStyle).toBeUndefined()
  })
})

describe('docDiff', () => {
  it('a style edit lists the style once and each linked node once, derived twins never', () => {
    const { a, b } = setup()
    const sid = S().createTextStyle(id, 'Body', { fontSize: 16 })
    S().applyTextStyle(id, [a, b], sid)
    const before = JSON.parse(JSON.stringify(doc()))
    S().updateTextStyle(id, sid, { fontSize: 48 })
    const d = diffDocs(before, JSON.parse(JSON.stringify(doc())))
    expect(d.textStylesChanged).toEqual(['Body'])
    expect(d.changed.map((c) => c.id).sort()).toEqual([a, b].sort())
    expect(d.changed.every((c) => c.aspects?.includes('style'))).toBe(true)
  })

  it('create and delete list the style name; link-only changes list the node', () => {
    const { a } = setup()
    const empty = JSON.parse(JSON.stringify(doc()))
    const sid = S().createTextStyle(id, 'Body', { fontSize: 16 })
    const withStyle = JSON.parse(JSON.stringify(doc()))
    expect(diffDocs(empty, withStyle).textStylesAdded).toEqual(['Body'])
    S().applyTextStyle(id, [a], sid)
    const linked = JSON.parse(JSON.stringify(doc()))
    expect(diffDocs(withStyle, linked).changed.map((c) => c.id)).toEqual([a])
    S().deleteTextStyle(id, sid)
    expect(diffDocs(linked, JSON.parse(JSON.stringify(doc()))).textStylesRemoved).toEqual(['Body'])
  })
})
