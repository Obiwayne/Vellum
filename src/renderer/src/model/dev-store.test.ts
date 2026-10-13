import { beforeEach, describe, expect, it } from 'vitest'
import { getStore, useStore } from './store'
import { migrateDoc, DOC_VERSION } from './ops'
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

  it('a missing document is ignored quietly by setDev, setScreen and setReady', () => {
    expect(S().setScreen('missing', 'x', { name: 'Home', bp: 'Desktop' })).toBe(false)
    expect(S().setScreen('missing', 'x', null)).toBe(false)
    expect(() => S().setDev('missing', ['x'], { notes: 'n' })).not.toThrow()
    expect(() => S().setReady('missing', ['x'], 1)).not.toThrow()
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

describe('v5 documents (T61)', () => {
  it('a v5 doc with text styles, a component and an instance opens at v6 with everything else unchanged and no dev keys', () => {
    const f = S().createNode(id, { type: 'frame' }, root())
    const t = S().createNode(id, { type: 'text', text: 'Hi' }, f)
    S().createTextStyle(id, 'Heading/H1', t)
    const main = S().createComponent(id, [f])
    S().createInstance(id, main, root())
    const v5 = JSON.parse(JSON.stringify(doc())) as Doc
    v5.version = 5
    expect(Object.values(v5.nodes).some((n) => 'dev' in n)).toBe(false)
    const opened = migrateDoc(JSON.parse(JSON.stringify(v5)))
    expect(opened.version).toBe(DOC_VERSION)
    expect({ ...opened, version: 5 }).toEqual(v5)
    // and the store can take it
    useStore.getState().hydrate({ docs: { [v5.id]: opened }, recents: [v5.id], tabs: [v5.id], activeTab: v5.id, prefs: {}, scratchpadId: v5.id })
    expect(S().docs[v5.id].version).toBe(DOC_VERSION)
  })
})

describe('one undo step each, and dev info stays out of instances (T61)', () => {
  it('setScreen and setReady over several frames are one step each; a refused setScreen leaves no step', () => {
    const a = S().createNode(id, { type: 'frame' }, root())
    const b = S().createNode(id, { type: 'frame' }, root())
    const inner = S().createNode(id, { type: 'frame' }, a)
    S().setReady(id, [a, b], 3)
    expect(node(a).dev?.ready).toEqual({ at: 3 })
    expect(node(b).dev?.ready).toEqual({ at: 3 })
    S().undo(id)
    expect(node(a).dev).toBeUndefined()
    expect(node(b).dev).toBeUndefined()
    expect(S().setScreen(id, a, { name: 'Home', bp: 'Desktop' })).toBe(true)
    expect(S().setScreen(id, inner, { name: 'X', bp: 'Mobile' })).toBe(false) // refused: no history entry
    S().undo(id)
    expect(node(a).dev).toBeUndefined() // the single undo took back the screen, not an earlier step
    expect(S().setScreen(id, a, { name: 'Home', bp: 'Desktop' })).toBe(true)
    expect(S().setScreen(id, a, null)).toBe(true)
    expect(node(a).dev).toBeUndefined()
    S().undo(id)
    expect(node(a).dev?.screen).toEqual({ name: 'Home', bp: 'Desktop' })
  })

  it('dev info on an instance never lands in overrides, and style edits on the instance leave it alone', () => {
    const f = S().createNode(id, { type: 'frame' }, root())
    const t = S().createNode(id, { type: 'text', text: 'Hi' }, f)
    const main = S().createComponent(id, [f])
    const inst = S().createInstance(id, main, root())
    const twin = node(inst).children[0]
    S().setDev(id, [inst, twin], { notes: 'n', states: { hover: { opacity: 0.5 } } })
    S().updateStyles(id, [twin], { color: '#ff0000' })
    expect(node(inst).instance?.overrides?.[t]).not.toHaveProperty('dev')
    expect(JSON.stringify(node(inst).instance?.overrides ?? {})).not.toContain('notes')
    expect(node(twin).dev?.notes).toBe('n')
    S().setDev(id, [t], { notes: 'main child' })
    expect(node(twin).dev?.notes).toBe('n') // the main's dev info does not overwrite the instance's
    expect(node(main).dev).toBeUndefined()
  })
})
