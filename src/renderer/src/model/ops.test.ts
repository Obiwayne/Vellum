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

import * as ops from '@renderer/model/ops'
import type { WorldRect } from '@renderer/model/types'

const rect = (x: number, y: number, width: number, height: number): WorldRect => ({ x, y, width, height })

/** Page root > artboard (flex or plain) > a, b. */
function setup(artboardStyle: Record<string, string | number> = {}) {
  const doc = ops.makeDoc('d', 'Doc')
  const root = doc.pages[0].rootId
  const board = ops.makeNode(doc, { type: 'frame', style: artboardStyle })
  ops.insertNode(doc, board, root)
  const a = ops.makeNode(doc, { type: 'rect' as never })
  const b = ops.makeNode(doc, { type: 'rect' as never })
  ops.insertNode(doc, a, board.id)
  ops.insertNode(doc, b, board.id)
  return { doc, board, a, b }
}

describe('wrapNodes', () => {
  it('groups siblings into an unclipped frame at the first one’s index', () => {
    const { doc, board, a, b } = setup()
    const rects = new Map([[a.id, rect(10, 20, 50, 50)], [b.id, rect(100, 40, 30, 30)]])
    const id = ops.wrapNodes(doc, [a.id, b.id], 'Group', rects, rect(10, 20, 120, 50), { x: 0, y: 0 })!
    const g = doc.nodes[id]
    expect(g.name).toBe('Group')
    expect(g.style.overflow).toBeUndefined()
    expect([g.x, g.y, g.style.width, g.style.height]).toEqual([10, 20, 120, 50])
    expect(board.children).toEqual([id])
    expect(g.children).toEqual([a.id, b.id])
    expect([doc.nodes[b.id].x, doc.nodes[b.id].y, doc.nodes[b.id].parent]).toEqual([90, 20, id])
  })

  it('frames clip, and strip position:absolute from the children', () => {
    const { doc, a, b } = setup()
    a.style.position = 'absolute'
    const rects = new Map([[a.id, rect(0, 0, 10, 10)], [b.id, rect(0, 20, 10, 10)]])
    const id = ops.wrapNodes(doc, [a.id, b.id], 'Frame', rects, rect(0, 0, 10, 30), { x: 0, y: 0 })!
    expect(doc.nodes[id].name).toBe('Frame')
    expect(doc.nodes[id].style.overflow).toBe('clip')
    expect(a.style.position).toBeUndefined()
  })

  it('offsets the wrapper by the parent origin', () => {
    const { doc, a, b } = setup()
    const rects = new Map([[a.id, rect(110, 120, 10, 10)], [b.id, rect(130, 120, 10, 10)]])
    const id = ops.wrapNodes(doc, [a.id, b.id], 'Group', rects, rect(110, 120, 30, 10), { x: 100, y: 100 })!
    expect([doc.nodes[id].x, doc.nodes[id].y]).toEqual([10, 20])
  })
})

describe('ungroupNodes', () => {
  it('round-trips group → ungroup, children keep their position and order', () => {
    const { doc, board, a, b } = setup()
    const rects = new Map([[a.id, rect(10, 20, 50, 50)], [b.id, rect(100, 40, 30, 30)]])
    const gid = ops.wrapNodes(doc, [a.id, b.id], 'Group', rects, rect(10, 20, 120, 50), { x: 0, y: 0 })!
    const freed = ops.ungroupNodes(doc, [gid], rects, new Map([[gid, { x: 0, y: 0 }]]))
    expect(freed).toEqual([a.id, b.id])
    expect(doc.nodes[gid]).toBeUndefined()
    expect(board.children).toEqual([a.id, b.id])
    expect([a.x, a.y, a.parent]).toEqual([10, 20, board.id])
    expect([b.x, b.y]).toEqual([100, 40])
  })

  it('keeps stacking order among the group’s siblings', () => {
    const { doc, board, a, b } = setup()
    const c = ops.makeNode(doc, { type: 'rect' as never })
    ops.insertNode(doc, c, board.id)
    const rects = new Map([[a.id, rect(0, 0, 5, 5)], [b.id, rect(5, 0, 5, 5)]])
    const gid = ops.wrapNodes(doc, [a.id, b.id], 'Group', rects, rect(0, 0, 10, 5), { x: 0, y: 0 })!
    ops.ungroupNodes(doc, [gid], rects, new Map([[gid, { x: 0, y: 0 }]]))
    expect(board.children).toEqual([a.id, b.id, c.id])
  })

  it('in a flex parent, children join the flow at the group’s index, in order, with x/y dropped', () => {
    const { doc, board, a, b } = setup({ display: 'flex' })
    const c = ops.makeNode(doc, { type: 'rect' as never })
    ops.insertNode(doc, c, board.id)
    const rects = new Map([[a.id, rect(0, 0, 5, 5)], [b.id, rect(5, 3, 5, 5)]])
    const gid = ops.wrapNodes(doc, [a.id, b.id], 'Group', rects, rect(0, 0, 10, 8), { x: 0, y: 0 })!
    b.style.position = 'absolute'
    ops.ungroupNodes(doc, [gid], rects, new Map([[gid, { x: 0, y: 0 }]]))
    expect(board.children).toEqual([a.id, b.id, c.id])
    expect(a.style.position).toBeUndefined()
    expect(b.style.position).toBeUndefined()
    expect([b.x, b.y]).toEqual([0, 0])
  })

  it('refuses page roots and empty frames, allows top-level frames', () => {
    const { doc, board } = setup()
    expect(ops.canUngroup(doc, board.id)).toBe(true)
    expect(ops.canUngroup(doc, doc.pages[0].rootId)).toBe(false)
    const empty = ops.makeNode(doc, { type: 'frame' })
    ops.insertNode(doc, empty, board.id)
    expect(ops.canUngroup(doc, empty.id)).toBe(false)
    expect(ops.ungroupNodes(doc, [doc.pages[0].rootId], new Map(), new Map())).toEqual([])
  })
})
