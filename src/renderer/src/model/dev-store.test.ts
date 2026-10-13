import { beforeEach, describe, expect, it } from 'vitest'
import { getStore, useStore } from './store'
import type { CNode, Doc } from './types'

const S = getStore
let id: string
const doc = (): Doc => S().docs[id]
const root = (): string => doc().pages[0].rootId
const node = (n: string): CNode => doc().nodes[n]

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true)
  id = S().createDoc('T', { open: false })
})

describe('dev info store actions', () => {
  it('setDev is one undo step and redo brings it back', () => {
    const f = S().createNode(id, { type: 'frame' }, root())
    S().setDev(id, [f], { notes: 'Collapses under 640', role: 'region' })
    expect(node(f).dev).toEqual({ notes: 'Collapses under 640', role: 'region' })
    S().undo(id)
    expect(node(f).dev).toBeUndefined()
    S().redo(id)
    expect(node(f).dev?.notes).toBe('Collapses under 640')
  })

  it('applies one patch to several nodes in a single step', () => {
    const a = S().createNode(id, { type: 'frame' }, root())
    const b = S().createNode(id, { type: 'frame' }, root())
    S().setDev(id, [a, b], { needsDecision: 'Copy?' })
    expect(node(a).dev?.needsDecision).toBe('Copy?')
    expect(node(b).dev?.needsDecision).toBe('Copy?')
    S().undo(id)
    expect(node(a).dev).toBeUndefined()
    expect(node(b).dev).toBeUndefined()
  })

  it('typing notes with the same coalesce key is one undo step', () => {
    const f = S().createNode(id, { type: 'frame' }, root())
    for (const t of ['H', 'He', 'Hel', 'Hell', 'Hello']) S().setDev(id, [f], { notes: t }, { coalesce: `dev:${f}:notes` })
    expect(node(f).dev?.notes).toBe('Hello')
    S().undo(id)
    expect(node(f).dev).toBeUndefined()
  })

  it('a no-op setDev adds no history entry', () => {
    const f = S().createNode(id, { type: 'frame' }, root())
    S().setDev(id, [f], { notes: 'x' })
    S().setDev(id, [f], { notes: 'x' })
    S().undo(id)
    expect(node(f).dev).toBeUndefined()
  })

  it('setScreen refuses a nested frame and tags a top-level one', () => {
    const top = S().createNode(id, { type: 'frame' }, root())
    const inner = S().createNode(id, { type: 'frame' }, top)
    expect(S().setScreen(id, inner, { name: 'Home', bp: 'Mobile' })).toBe(false)
    expect(node(inner).dev).toBeUndefined()
    expect(S().setScreen(id, top, { name: 'Home', bp: 'Desktop' })).toBe(true)
    expect(node(top).dev?.screen).toEqual({ name: 'Home', bp: 'Desktop' })
    S().undo(id)
    expect(node(top).dev).toBeUndefined()
  })

  it('setReady marks and clears frames, one undo each', () => {
    const f = S().createNode(id, { type: 'frame' }, root())
    S().setReady(id, [f], 1)
    expect(node(f).dev?.ready).toEqual({ at: 1 })
    S().setReady(id, [f], null)
    expect(node(f).dev).toBeUndefined()
    S().undo(id)
    expect(node(f).dev?.ready).toEqual({ at: 1 })
  })

  it('does not touch updatedAt-independent content: style stays the same', () => {
    const f = S().createNode(id, { type: 'frame' }, root())
    const style = JSON.stringify(node(f).style)
    S().setDev(id, [f], { label: 'Hero' })
    expect(JSON.stringify(node(f).style)).toBe(style)
  })
})

describe('dev info and components', () => {
  it('dev info on an instance is kept, creates no override, and survives main edits', () => {
    const f = S().createNode(id, { type: 'frame' }, root())
    const t = S().createNode(id, { type: 'text', text: 'Hi' }, f)
    const main = S().createComponent(id, [f])
    const inst = S().createInstance(id, main, root())
    const twin = node(inst).children[0]
    expect(node(twin).srcId).toBe(t)
    S().setDev(id, [inst, twin], { notes: 'Primary CTA' })
    expect(node(inst).dev?.notes).toBe('Primary CTA')
    expect(node(inst).instance?.overrides).toBeUndefined()
    S().setText(id, t, 'Hello')
    expect(node(twin).text).toBe('Hello')
    expect(node(twin).dev?.notes).toBe('Primary CTA')
    expect(node(inst).instance?.overrides).toBeUndefined()
  })

  it('dev info on a main is not copied onto its instances', () => {
    const f = S().createNode(id, { type: 'frame' }, root())
    const main = S().createComponent(id, [f])
    S().setDev(id, [main], { notes: 'main only' })
    const inst = S().createInstance(id, main, root())
    expect(node(inst).dev).toBeUndefined()
    S().setDev(id, [main], { role: 'button' })
    expect(node(inst).dev).toBeUndefined()
  })

  it('detaching an instance keeps its dev info', () => {
    const f = S().createNode(id, { type: 'frame' }, root())
    const main = S().createComponent(id, [f])
    const inst = S().createInstance(id, main, root())
    S().setDev(id, [inst], { notes: 'keep' })
    S().detachInstance(id, inst)
    expect(node(inst).dev?.notes).toBe('keep')
  })
})
