import { describe, expect, it } from 'vitest'
import * as ops from './ops'
import * as ts from './textStyles'
import type { CNode, Doc } from './types'

function setup(): { d: Doc; a: string; b: string } {
  const d = ops.makeDoc('d', 'D')
  const root = d.pages[0].rootId
  const mk = (type: 'text' | 'frame'): CNode => {
    const n = ops.makeNode(d, { type })
    ops.insertNode(d, n, root)
    return n
  }
  const a = mk('text')
  const b = mk('text')
  return { d, a: a.id, b: b.id }
}

describe('text styles', () => {
  it('create picks only style keys from a node', () => {
    const { d, a } = setup()
    d.nodes[a].style = { fontSize: 20, fontWeight: 700, color: 'red', textAlign: 'center', width: 50 }
    const id = ts.createTextStyle(d, 'Heading / H1', a)
    expect(d.textStyles![0]).toEqual({ id, name: 'Heading/H1', style: { fontSize: 20, fontWeight: 700 } })
    expect(d.nodes[a].textStyle).toBeUndefined()
  })

  it('names stay unique, case-insensitively, also on rename', () => {
    const { d } = setup()
    const x = ts.createTextStyle(d, 'Body', { fontSize: 14 })
    const y = ts.createTextStyle(d, 'body', { fontSize: 15 })
    expect(d.textStyles!.map((s) => s.name)).toEqual(['Body', 'body 2'])
    ts.renameTextStyle(d, y, 'BODY')
    expect(ts.getTextStyle(d, y)!.name).toBe('BODY 2')
    ts.renameTextStyle(d, x, 'Body')
    expect(ts.getTextStyle(d, x)!.name).toBe('Body')
    expect(ts.renameTextStyle(d, 'nope', 'x')).toBe(false)
  })

  it('apply writes exactly the style keys, removes unset ones, keeps the rest', () => {
    const { d, a } = setup()
    const id = ts.createTextStyle(d, 'S', { fontSize: 32, fontWeight: 600, fontFamily: 'var(--font-sans)' })
    d.nodes[a].style = { fontSize: 10, letterSpacing: '2px', lineHeight: '1.5', color: 'red', width: 'fit-content' }
    expect(ts.applyTextStyle(d, a, id)).toBe(true)
    expect(d.nodes[a].style).toEqual({ fontSize: 32, fontWeight: 600, fontFamily: 'var(--font-sans)', color: 'red', width: 'fit-content' })
    expect(d.nodes[a].textStyle).toBe(id)
  })

  it('apply refuses non-text nodes and unknown ids', () => {
    const { d, a } = setup()
    const id = ts.createTextStyle(d, 'S', { fontSize: 32 })
    const f = ops.makeNode(d, { type: 'frame' })
    ops.insertNode(d, f, d.pages[0].rootId)
    expect(ts.applyTextStyle(d, f.id, id)).toBe(false)
    expect(ts.applyTextStyle(d, a, 'nope')).toBe(false)
    expect(ts.applyTextStyle(d, 'nope', id)).toBe(false)
    expect(d.nodes[f.id].textStyle).toBeUndefined()
  })

  it('update syncs all linked nodes and leaves unlinked ones', () => {
    const { d, a, b } = setup()
    const id = ts.createTextStyle(d, 'S', { fontSize: 16, fontWeight: 400 })
    ts.applyTextStyle(d, a, id)
    const before = { ...d.nodes[b].style }
    expect(ts.updateTextStyle(d, id, { fontSize: 48, fontWeight: null, color: 'red' })).toBe(true)
    expect(d.nodes[a].style.fontSize).toBe(48)
    expect(d.nodes[a].style.fontWeight).toBeUndefined()
    expect(d.nodes[a].style.color).not.toBe('red')
    expect(ts.getTextStyle(d, id)!.style).toEqual({ fontSize: 48 })
    expect(d.nodes[b].style).toEqual(before)
    expect(ts.syncTextStyle(d, id)).toBe(1)
    expect(ts.updateTextStyle(d, 'nope', {})).toBe(false)
  })

  it('detach unlinks and keeps values; later style edits do not touch the node', () => {
    const { d, a } = setup()
    const id = ts.createTextStyle(d, 'S', { fontSize: 30 })
    ts.applyTextStyle(d, a, id)
    expect(ts.detachTextStyle(d, a)).toBe(true)
    expect(d.nodes[a].textStyle).toBeUndefined()
    ts.updateTextStyle(d, id, { fontSize: 99 })
    expect(d.nodes[a].style.fontSize).toBe(30)
    expect(ts.detachTextStyle(d, a)).toBe(false)
  })

  it('delete unlinks nodes and instance overrides, keeps values', () => {
    const { d, a, b } = setup()
    const id = ts.createTextStyle(d, 'S', { fontSize: 30 })
    ts.applyTextStyle(d, a, id)
    d.nodes[b].instance = { of: 'x', overrides: { '1-0': { textStyle: id } } }
    expect(ts.deleteTextStyle(d, id)).toBe(true)
    expect(d.textStyles).toEqual([])
    expect(d.nodes[a].textStyle).toBeUndefined()
    expect(d.nodes[a].style.fontSize).toBe(30)
    expect(d.nodes[b].instance!.overrides!['1-0'].textStyle).toBeUndefined()
    expect(ts.deleteTextStyle(d, id)).toBe(false)
  })

  it('var() values survive apply and sync verbatim', () => {
    const { d, a } = setup()
    const id = ts.createTextStyle(d, 'S', { fontSize: 'var(--text-lg)', letterSpacing: 'var(--ls)' })
    ts.applyTextStyle(d, a, id)
    expect(d.nodes[a].style.fontSize).toBe('var(--text-lg)')
    ts.updateTextStyle(d, id, { letterSpacing: 'var(--ls2)' })
    expect(d.nodes[a].style.letterSpacing).toBe('var(--ls2)')
  })
})

describe('edge cases', () => {
  it('does not mutate sibling styles or touch applyStylePatch behaviour', () => {
    const { d, a, b } = setup()
    const id = ts.createTextStyle(d, 'S', { fontSize: 20 })
    ts.applyTextStyle(d, a, id)
    ts.applyTextStyle(d, b, id)
    ts.updateTextStyle(d, id, { fontSize: 21 })
    expect(d.nodes[a].style).not.toBe(d.nodes[b].style)
    expect(d.nodes[b].style.fontSize).toBe(21)
  })

  it('linked nodes on another page are synced; a second style stays separate', () => {
    const { d, a } = setup()
    const p2 = ops.makePage(d, 'Page 2')
    const n = ops.makeNode(d, { type: 'text' })
    ops.insertNode(d, n, p2.rootId)
    const s1 = ts.createTextStyle(d, 'One', { fontSize: 10 })
    const s2 = ts.createTextStyle(d, 'Two', { fontSize: 99 })
    ts.applyTextStyle(d, a, s2)
    ts.applyTextStyle(d, n.id, s1)
    ts.updateTextStyle(d, s1, { fontSize: 11 })
    expect(d.nodes[n.id].style.fontSize).toBe(11)
    expect(d.nodes[a].style.fontSize).toBe(99)
    expect(ts.linkedNodes(d, s1).map((x) => x.id)).toEqual([n.id])
  })

  it('re-applying another style replaces the link and its keys', () => {
    const { d, a } = setup()
    const s1 = ts.createTextStyle(d, 'One', { fontSize: 10, fontWeight: 700 })
    const s2 = ts.createTextStyle(d, 'Two', { fontSize: 30 })
    ts.applyTextStyle(d, a, s1)
    ts.applyTextStyle(d, a, s2)
    expect(d.nodes[a].textStyle).toBe(s2)
    expect(d.nodes[a].style.fontSize).toBe(30)
    expect(d.nodes[a].style.fontWeight).toBeUndefined()
  })

  it('a doc without textStyles is safe for every read/delete path', () => {
    const { d, a } = setup()
    expect(ts.getTextStyle(d, 'x')).toBeUndefined()
    expect(ts.syncTextStyle(d, 'x')).toBe(0)
    expect(ts.deleteTextStyle(d, 'x')).toBe(false)
    expect(ts.applyTextStyle(d, a, 'x')).toBe(false)
  })
})

describe('applyStylePatch stays unaware of text styles', () => {
  it('patching a linked node keeps node.textStyle (detach-on-edit is store work)', () => {
    const { d, a } = setup()
    const id = ts.createTextStyle(d, 'S', { fontSize: 20 })
    ts.applyTextStyle(d, a, id)
    ops.applyStylePatch(d.nodes[a].style, { fontSize: 33 })
    expect(d.nodes[a].style.fontSize).toBe(33)
    expect(d.nodes[a].textStyle).toBe(id)
  })
})

describe('migration to v5', () => {
  it('DOC_VERSION is 5 (master is 4)', () => {
    expect(ops.DOC_VERSION).toBe(5)
  })

  it.each([1, 2, 3, 4])('v%i doc reaches v5 and gains no textStyles', (v) => {
    const { d, a } = setup()
    d.nodes[a].style = { fontSize: 12, lineHeight: '1.5' }
    d.version = v
    const m = ops.migrateDoc(d)
    expect(m.version).toBe(5)
    expect(m.textStyles).toBeUndefined()
    expect(m.nodes[a].textStyle).toBeUndefined()
    expect(d.version).toBe(v)
  })

  it('a v1 doc still gets the v2 line-height pin on unset text', () => {
    const { d, a } = setup()
    delete d.nodes[a].style.lineHeight
    d.version = 1
    expect(ops.migrateDoc(d).nodes[a].style.lineHeight).toBe('20px')
  })

  it('a v5 doc is returned as is', () => {
    const { d } = setup()
    expect(ops.migrateDoc(d)).toBe(d)
  })

  it('a doc with textStyles survives migration untouched', () => {
    const { d } = setup()
    ts.createTextStyle(d, 'S', { fontSize: 20 })
    d.version = 4
    expect(ops.migrateDoc(d).textStyles).toEqual(d.textStyles)
  })
})
