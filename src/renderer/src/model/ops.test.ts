import { describe, expect, it } from 'vitest'
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

  it('in a flex parent, a plain group’s children become absolute at measured offsets', () => {
    const { doc, board, a, b } = setup({ display: 'flex' })
    const gid = ops.wrapNodes(doc, [a.id, b.id], 'Group', new Map([[a.id, rect(0, 0, 5, 5)], [b.id, rect(5, 0, 5, 5)]]), rect(0, 0, 10, 5), { x: 0, y: 0 })!
    // group sits in a flex parent (flow child); its children are positioned inside it
    const rects = new Map([[a.id, rect(0, 0, 5, 5)], [b.id, rect(5, 0, 5, 5)]])
    ops.ungroupNodes(doc, [gid], rects, new Map([[gid, { x: 0, y: 0 }]]))
    expect(board.children).toEqual([a.id, b.id])
    expect(a.style.position).toBe('absolute')
    expect([b.x, b.y]).toEqual([5, 0])
  })

  it('refuses artboards and empty frames', () => {
    const { doc, board } = setup()
    expect(ops.canUngroup(doc, board.id)).toBe(false)
    const empty = ops.makeNode(doc, { type: 'frame' })
    ops.insertNode(doc, empty, board.id)
    expect(ops.canUngroup(doc, empty.id)).toBe(false)
    expect(ops.ungroupNodes(doc, [board.id], new Map(), new Map())).toEqual([])
  })
})
