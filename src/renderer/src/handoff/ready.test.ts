import { beforeEach, describe, expect, it } from 'vitest'
import { getStore, useStore } from '../model/store'
import { canMark, frameHash, handoffVersionName, nextHandoffNumber, readyStatus } from './ready'
import { setReady } from '../model/dev'

const S = getStore
let id: string
const doc = () => S().docs[id]
const root = (): string => doc().pages[0].rootId

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true)
  id = S().createDoc('Ready', { open: false })
})

function screen() {
  const f = S().createNode(id, { type: 'frame', name: 'Home', style: { width: 400, height: 300, backgroundColor: '#ffffff' } }, root())
  const t = S().createNode(id, { type: 'text', text: 'Hi', style: { fontSize: 16 } }, f)
  const inner = S().createNode(id, { type: 'frame', name: 'Inner', style: { width: 50, height: 50 } }, f)
  return { f, t, inner }
}
const mark = (f: string): void => {
  S().setReady(id, [f], 4, { [f]: frameHash(doc(), f) as string })
}

describe('ready status', () => {
  it('is null when not marked, ready when marked, changed after an edit inside the frame', () => {
    const { f, t } = screen()
    expect(readyStatus(doc(), f)).toBeNull()
    mark(f)
    expect(doc().nodes[f].dev?.ready).toMatchObject({ at: 4 })
    expect(readyStatus(doc(), f)).toBe('ready')
    S().setText(id, t, 'Hello')
    expect(readyStatus(doc(), f)).toBe('changed')
  })

  it('a style edit, a new child and a hidden layer change it; a hidden layer does not leak into the hash', () => {
    const { f, inner } = screen()
    mark(f)
    S().updateStyles(id, [f], { backgroundColor: '#000000' })
    expect(readyStatus(doc(), f)).toBe('changed')
    mark(f)
    expect(readyStatus(doc(), f)).toBe('ready')
    S().createNode(id, { type: 'rect', name: 'New' }, f)
    expect(readyStatus(doc(), f)).toBe('changed')
    mark(f)
    // hiding a layer removes it from the spec: that is a change of what is exported
    S().updateNode(id, inner, { visible: false })
    expect(readyStatus(doc(), f)).toBe('changed')
  })

  it('moving the frame, renaming other frames and dev notes on other layers do not change it', () => {
    const { f } = screen()
    const other = S().createNode(id, { type: 'frame', name: 'Other', style: { width: 10, height: 10 } }, root())
    mark(f)
    S().updateNode(id, f, { x: 500, y: 40 })
    S().renameNode(id, other, 'Renamed')
    S().setDev(id, [other], { notes: 'x' })
    expect(readyStatus(doc(), f)).toBe('ready')
  })

  it('undo of the edit returns to ready', () => {
    const { f, t } = screen()
    mark(f)
    S().setText(id, t, 'Changed')
    expect(readyStatus(doc(), f)).toBe('changed')
    S().undo(id)
    expect(readyStatus(doc(), f)).toBe('ready')
  })

  it('a mark without a hash (older marks) is ready, never changed', () => {
    const { f, t } = screen()
    S().setReady(id, [f], 2)
    S().setText(id, t, 'Edited')
    expect(readyStatus(doc(), f)).toBe('ready')
  })

  it('keeps the hash through a save and load, and drops malformed hashes', () => {
    const { f } = screen()
    mark(f)
    const back = JSON.parse(JSON.stringify(doc()))
    expect(back.nodes[f].dev.ready.hash).toMatch(/^[0-9a-f]{16}$/)
    const d = JSON.parse(JSON.stringify(doc()))
    setReady(d, [f], 3, { [f]: 'not a hash!' })
    expect(d.nodes[f].dev?.ready).toEqual({ at: 3 })
  })
})

describe('what can be marked', () => {
  it('only top-level frames', () => {
    const { f, t, inner } = screen()
    const rect = S().createNode(id, { type: 'rect', name: 'Loose' }, root())
    expect(canMark(doc(), f)).toBe(true)
    expect(canMark(doc(), inner)).toBe(false)
    expect(canMark(doc(), t)).toBe(false)
    expect(canMark(doc(), rect)).toBe(false)
    expect(canMark(doc(), root())).toBe(false)
  })
})

describe('handoff numbers', () => {
  it('next = highest "Handoff vN" + 1, ignoring other names', () => {
    expect(nextHandoffNumber([])).toBe(1)
    expect(nextHandoffNumber([{ name: 'Before launch' }, { name: null }, {}])).toBe(1)
    expect(nextHandoffNumber([{ name: 'Handoff v1' }, { name: 'Handoff v3' }, { name: 'Handoff v2' }])).toBe(4)
    expect(nextHandoffNumber([{ name: 'Handoff v12' }, { name: 'Handoff v2 draft' }, { name: 'handoff v40' }])).toBe(13)
    expect(handoffVersionName(5)).toBe('Handoff v5')
  })
})
