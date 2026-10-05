// T26 test station: a v4 doc must reach v5 without being rewritten (only v1 docs get the line-height pin).
import { describe, expect, it } from 'vitest'
import * as ops from './ops'

function textDoc(version: number) {
  const d = ops.makeDoc('d', 'Doc')
  const t = ops.makeNode(d, { type: 'text', text: 'hi' }, false) // no lineHeight anywhere
  ops.insertNode(d, t, d.pages[0].rootId)
  d.version = version
  return { d, t }
}

describe('migrateDoc to the current version leaves v2-v4 docs alone', () => {
  for (const v of [2, 3, 4]) {
    // v4 is a known defect (reported to the builder): drop `.fails` once migrateDoc only pins line heights for v1 docs
    const run = v === 4 ? it.fails : it
    run(`v${v} -> v${ops.DOC_VERSION}: nodes untouched, only the version changes`, () => {
      const { d, t } = textDoc(v)
      const before = JSON.stringify(d.nodes)
      const m = ops.migrateDoc(d)
      expect(m.version).toBe(ops.DOC_VERSION)
      expect(JSON.stringify(m.nodes)).toBe(before)
      expect(m.nodes[t.id].style.lineHeight).toBeUndefined()
    })
  }
  it('a v1 doc still gets the explicit 20px line height', () => {
    const { d, t } = textDoc(1)
    expect(ops.migrateDoc(d).nodes[t.id].style.lineHeight).toBe('20px')
  })
})
