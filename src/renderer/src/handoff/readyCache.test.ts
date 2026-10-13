// Ready status is read while Layers renders after every edit: an edit outside a frame must not rebuild its spec.
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../model/devSpec', async (orig) => {
  const real = await orig<typeof import('../model/devSpec')>()
  return { ...real, nodeSpec: vi.fn(real.nodeSpec) }
})

import * as devSpec from '../model/devSpec'
import { getStore, useStore } from '../model/store'
import { frameHash, readyStatus } from './ready'

const S = getStore
let id: string
let a: string
let b: string
let child: string
const calls = (): number => vi.mocked(devSpec.nodeSpec).mock.calls.length

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true)
  id = S().createDoc('D', { open: false })
  const root = S().docs[id].pages[0].rootId
  a = S().createNode(id, { type: 'frame', name: 'A', style: { width: 100, height: 100 } }, root)
  b = S().createNode(id, { type: 'frame', name: 'B', style: { width: 100, height: 100 } }, root)
  child = S().createNode(id, { type: 'rect', name: 'R', style: { width: 10, height: 10, backgroundColor: '#f00' } }, a)
  vi.mocked(devSpec.nodeSpec).mockClear()
})

describe('frameHash reuse', () => {
  it('an edit in another frame does not rebuild this frame', () => {
    const h = frameHash(S().docs[id], a)
    const n = calls()
    S().updateStyles(id, [b], { width: 120 })
    expect(frameHash(S().docs[id], a)).toBe(h)
    expect(calls()).toBe(n)
  })

  it('moving the frame itself, renaming a sibling and selecting do not rebuild it either', () => {
    const h = frameHash(S().docs[id], a)
    const n = calls()
    S().renameNode(id, b, 'Renamed')
    S().select(id, [a])
    expect(frameHash(S().docs[id], a)).toBe(h)
    expect(calls()).toBe(n)
  })

  it('an edit inside the frame rebuilds it and changes the hash; undo returns to the first hash', () => {
    const h = frameHash(S().docs[id], a)
    const n = calls()
    S().updateStyles(id, [child], { backgroundColor: '#00f' })
    const h2 = frameHash(S().docs[id], a)
    expect(h2).not.toBe(h)
    expect(calls()).toBe(n + 1)
    S().undo(id)
    expect(frameHash(S().docs[id], a)).toBe(h)
  })

  it('a token change rebuilds frames that read tokens', () => {
    S().updateStyles(id, [child], { backgroundColor: 'var(--c)' })
    S().setTokens(id, [{ name: '--c', value: '#111111' }])
    const h = frameHash(S().docs[id], a)
    S().setTokens(id, [{ name: '--c', value: '#222222' }])
    expect(frameHash(S().docs[id], a)).not.toBe(h)
  })

  it('a ready mark keeps its status through unrelated edits', () => {
    S().setReady(id, [a], 1, { [a]: frameHash(S().docs[id], a) as string })
    expect(readyStatus(S().docs[id], a)).toBe('ready')
    S().updateStyles(id, [b], { width: 300 })
    expect(readyStatus(S().docs[id], a)).toBe('ready')
    S().updateStyles(id, [child], { width: 11 })
    expect(readyStatus(S().docs[id], a)).toBe('changed')
  })
})
