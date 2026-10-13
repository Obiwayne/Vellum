import { describe, expect, it } from 'vitest'
import { diffDocs } from '@shared/docDiff'
import { DOC_VERSION, cloneSubtree, makeDoc, makeNode, migrateDoc } from './ops'
import { hasDev, isTopLevelFrame, setDev, setReady, setScreen } from './dev'
import v4 from './fixtures/v4/buttons-v4.json'
import type { Doc } from './types'

function setup() {
  const d = makeDoc('d', 'D')
  const root = d.pages[0].rootId
  const frame = makeNode(d, { type: 'frame', name: 'Home' })
  d.nodes[frame.id] = frame
  frame.parent = root
  d.nodes[root].children.push(frame.id)
  const inner = makeNode(d, { type: 'frame', name: 'Card' })
  d.nodes[inner.id] = inner
  inner.parent = frame.id
  frame.children.push(inner.id)
  return { d, root, frame: frame.id, inner: inner.id }
}

describe('setDev', () => {
  it('sets fields and drops empty ones; an emptied dev is removed from the node', () => {
    const { d, frame } = setup()
    expect(setDev(d, frame, { notes: 'Sticky header', role: ' navigation ', label: '' })).toBe(true)
    expect(d.nodes[frame].dev).toEqual({ notes: 'Sticky header', role: 'navigation' })
    expect(setDev(d, frame, { notes: null, role: null })).toBe(true)
    expect(d.nodes[frame].dev).toBeUndefined()
    expect('dev' in d.nodes[frame]).toBe(false)
  })

  it('reports no change for a no-op patch and for a missing node', () => {
    const { d, frame } = setup()
    expect(setDev(d, frame, { notes: '   ' })).toBe(false)
    expect(d.nodes[frame].dev).toBeUndefined()
    setDev(d, frame, { notes: 'x' })
    expect(setDev(d, frame, { notes: 'x' })).toBe(false)
    expect(setDev(d, 'nope', { notes: 'x' })).toBe(false)
  })

  it('merges states per state name and removes one with null', () => {
    const { d, inner } = setup()
    setDev(d, inner, { states: { hover: { background: 'var(--c)' } } })
    setDev(d, inner, { states: { focus: { outline: '2px solid red' } } })
    expect(Object.keys(d.nodes[inner].dev?.states ?? {})).toEqual(['hover', 'focus'])
    setDev(d, inner, { states: { hover: null } })
    expect(d.nodes[inner].dev?.states).toEqual({ focus: { outline: '2px solid red' } })
    setDev(d, inner, { states: { focus: null } })
    expect(d.nodes[inner].dev).toBeUndefined()
  })

  it('rejects malformed values instead of storing them', () => {
    const { d, frame } = setup()
    setDev(d, frame, { tab: 0, ready: { at: -1 }, screen: { name: 'Home', bp: '' } })
    expect(d.nodes[frame].dev).toBeUndefined()
    setDev(d, frame, { tab: 3 })
    expect(d.nodes[frame].dev).toEqual({ tab: 3 })
  })

  it('keeps unrelated style and structure untouched', () => {
    const { d, frame } = setup()
    const before = JSON.stringify({ ...d.nodes[frame], dev: undefined })
    setDev(d, frame, { notes: 'n', needsDecision: 'Which font?' })
    expect(JSON.stringify({ ...d.nodes[frame], dev: undefined })).toBe(before)
    expect(hasDev(d.nodes[frame])).toBe(true)
  })
})

describe('screens and ready', () => {
  it('only top-level frames can be screens', () => {
    const { d, frame, inner } = setup()
    expect(isTopLevelFrame(d, frame)).toBe(true)
    expect(isTopLevelFrame(d, inner)).toBe(false)
    expect(setScreen(d, inner, { name: 'Home', bp: 'Mobile' })).toBe(false)
    expect(d.nodes[inner].dev).toBeUndefined()
    expect(setScreen(d, frame, { name: ' Home ', bp: 'Desktop' })).toBe(true)
    expect(d.nodes[frame].dev?.screen).toEqual({ name: 'Home', bp: 'Desktop' })
    setScreen(d, frame, null)
    expect(d.nodes[frame].dev).toBeUndefined()
  })

  it('marks frames ready and ignores non-frames', () => {
    const { d, frame } = setup()
    const t = makeNode(d, { type: 'text', name: 'T' })
    d.nodes[t.id] = t
    expect(setReady(d, [frame, t.id], 2)).toBe(1)
    expect(d.nodes[frame].dev?.ready).toEqual({ at: 2 })
    expect(d.nodes[t.id].dev).toBeUndefined()
    expect(setReady(d, [frame], null)).toBe(1)
    expect(d.nodes[frame].dev).toBeUndefined()
  })

  it('a duplicate is not ready but keeps its notes', () => {
    const { d, frame } = setup()
    setDev(d, frame, { notes: 'keep', ready: { at: 1 } })
    const copy = cloneSubtree(d, frame)
    expect(d.nodes[copy].dev).toEqual({ notes: 'keep' })
    expect(d.nodes[frame].dev?.ready).toEqual({ at: 1 })
    setDev(d, frame, { notes: null })
    const c2 = cloneSubtree(d, frame)
    expect('dev' in d.nodes[c2]).toBe(false)
  })
})

describe('migration to v6', () => {
  it('DOC_VERSION is 6', () => expect(DOC_VERSION).toBe(6))

  it.each([2, 3, 4, 5])('a v%i doc only gets a new version number; no dev keys appear', (v) => {
    const { d } = setup()
    d.version = v
    const m = migrateDoc(d)
    expect(m.version).toBe(6)
    expect(m.nodes).toBe(d.nodes)
    expect(Object.values(m.nodes).some((n) => 'dev' in n)).toBe(false)
  })

  it('the v4 fixture opens at v6 with every node unchanged', () => {
    const src = v4 as unknown as Doc
    const m = migrateDoc(JSON.parse(JSON.stringify(src)))
    expect(m.version).toBe(6)
    expect(m.nodes).toEqual(src.nodes)
  })

  it('dev info survives a JSON round trip and migrating a v6 doc is a no-op', () => {
    const { d, frame } = setup()
    setDev(d, frame, { notes: 'n', states: { hover: { opacity: 0.8 } }, screen: { name: 'Home', bp: 'Desktop' }, ready: { at: 1 } })
    const back = JSON.parse(JSON.stringify(d)) as Doc
    expect(migrateDoc(back)).toBe(back)
    expect(back.nodes[frame].dev).toEqual(d.nodes[frame].dev)
  })
})

describe('docDiff dev aspect', () => {
  it('reports dev as its own aspect and nothing else', () => {
    const { d, frame } = setup()
    const before = JSON.parse(JSON.stringify(d)) as Doc
    setDev(d, frame, { notes: 'hello' })
    const diff = diffDocs(before, d)
    expect(diff.changed).toHaveLength(1)
    expect(diff.changed[0].id).toBe(frame)
    expect(diff.changed[0].aspects).toEqual(['dev'])
  })

  it('an unchanged dev field is not a change', () => {
    const { d, frame } = setup()
    setDev(d, frame, { notes: 'hello' })
    const before = JSON.parse(JSON.stringify(d)) as Doc
    setDev(d, frame, { notes: 'hello' })
    expect(diffDocs(before, d).changed).toHaveLength(0)
  })
})
