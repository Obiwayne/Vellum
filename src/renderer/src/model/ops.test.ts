import { describe, expect, it } from 'vitest'
import { DOC_VERSION, makeDoc, makeNode, migrateDoc } from './ops'
import type { Doc } from './types'

const v1Doc = (): Doc => {
  const d = makeDoc('d', 'Old')
  const root = d.pages[0].rootId
  const frame = makeNode(d, { type: 'frame', style: { lineHeight: '1.5' } })
  const inherits = makeNode(d, { type: 'text', text: 'inherits' }, false)
  const bare = makeNode(d, { type: 'text', text: 'bare' }, false)
  for (const n of [frame, inherits, bare]) d.nodes[n.id] = n
  frame.parent = root
  d.nodes[root].children.push(frame.id, bare.id)
  inherits.parent = frame.id
  frame.children.push(inherits.id)
  bare.parent = root
  d.version = 1
  return d
}

describe('migrateDoc (v1 -> v2 line-height)', () => {
  it('pins lineHeight 20px on text that relied on the old default', () => {
    const d = v1Doc()
    const bare = Object.values(d.nodes).find((n) => n.text === 'bare')!
    const m = migrateDoc(d)
    expect(m.version).toBe(DOC_VERSION)
    expect(m.nodes[bare.id].style.lineHeight).toBe('20px')
  })

  it('leaves text that already has (or inherits) a line-height alone', () => {
    const d = v1Doc()
    const inherits = Object.values(d.nodes).find((n) => n.text === 'inherits')!
    expect(migrateDoc(d).nodes[inherits.id].style.lineHeight).toBeUndefined()
  })

  it('treats a missing version as v1 and does not mutate the input', () => {
    const d = v1Doc()
    delete d.version
    const before = JSON.stringify(d)
    expect(migrateDoc(d).version).toBe(DOC_VERSION)
    expect(JSON.stringify(d)).toBe(before)
  })

  it('returns the same object for a current doc', () => {
    const d = makeDoc('x', 'New')
    expect(d.version).toBe(DOC_VERSION)
    expect(migrateDoc(d)).toBe(d)
  })
})
