// T5 test station: acceptance checks for group / frame selection / ungroup (pure ops level).
import { describe, expect, it } from 'vitest'
import * as ops from '@renderer/model/ops'
import type { WorldRect } from '@renderer/model/types'

const rect = (x: number, y: number, width: number, height: number): WorldRect => ({ x, y, width, height })

function page(parentStyle: Record<string, string | number> | null) {
  const doc = ops.makeDoc('d', 'Doc')
  const root = doc.pages[0].rootId
  let parent = root
  if (parentStyle) {
    const board = ops.makeNode(doc, { type: 'frame', style: parentStyle })
    ops.insertNode(doc, board, root)
    parent = board.id
  }
  const mk = () => {
    const n = ops.makeNode(doc, { type: 'frame', style: { width: 10, height: 10 } })
    ops.insertNode(doc, n, parent)
    return n
  }
  return { doc, root, parent, nodes: [mk(), mk(), mk()] }
}

describe('group / ungroup acceptance', () => {
  it('loose on an artboard: group then ungroup restores parent, order and positions', () => {
    const { doc, parent, nodes } = page({})
    const [a, b, c] = nodes
    const rects = new Map([[a.id, rect(10, 10, 10, 10)], [b.id, rect(40, 30, 10, 10)]])
    const g = ops.wrapNodes(doc, [a.id, b.id], 'Group', rects, rect(10, 10, 40, 30), { x: 0, y: 0 })!
    expect(doc.nodes[parent].children).toEqual([g, c.id])
    ops.ungroupNodes(doc, [g], rects, new Map([[g, { x: 0, y: 0 }]]))
    expect(doc.nodes[parent].children).toEqual([a.id, b.id, c.id])
    expect([a.x, a.y, b.x, b.y]).toEqual([10, 10, 40, 30])
  })

  it('ungroups several groups at once', () => {
    const { doc, parent, nodes } = page({})
    const [a, b, c] = nodes
    const r = new Map([[a.id, rect(0, 0, 10, 10)], [b.id, rect(20, 0, 10, 10)], [c.id, rect(40, 0, 10, 10)]])
    const g1 = ops.wrapNodes(doc, [a.id], 'Group', r, rect(0, 0, 10, 10), { x: 0, y: 0 })!
    const g2 = ops.wrapNodes(doc, [b.id], 'Group', r, rect(20, 0, 10, 10), { x: 0, y: 0 })!
    const freed = ops.ungroupNodes(doc, [g1, g2], r, new Map([[g1, { x: 0, y: 0 }], [g2, { x: 0, y: 0 }]]))
    expect(freed).toEqual([a.id, b.id])
    expect(doc.nodes[parent].children).toEqual([a.id, b.id, c.id])
  })

  it('group inside a flex parent takes the first child’s slot', () => {
    const { doc, parent, nodes } = page({ display: 'flex' })
    const [a, b, c] = nodes
    const r = new Map([[b.id, rect(10, 0, 10, 10)], [c.id, rect(20, 0, 10, 10)]])
    const g = ops.wrapNodes(doc, [b.id, c.id], 'Group', r, rect(10, 0, 20, 10), { x: 0, y: 0 })!
    expect(doc.nodes[parent].children).toEqual([a.id, g])
  })

  it('Group has no clip, Frame clips', () => {
    const { doc, nodes } = page({})
    const r = new Map([[nodes[0].id, rect(0, 0, 10, 10)]])
    const g = ops.wrapNodes(doc, [nodes[0].id], 'Group', r, rect(0, 0, 10, 10), { x: 0, y: 0 })!
    expect(doc.nodes[g].style.overflow).toBeUndefined()
    expect(doc.nodes[g].style.backgroundColor).toBeUndefined()
  })

  // Acceptance: "each action works ... at page level". A group of two artboards sits directly under the
  // page root, and canUngroup refuses any frame whose parent is a page root.
  it.fails('page level: a group made of top-level layers can be ungrouped', () => {
    const { doc, root, nodes } = page(null)
    const [a, b] = nodes
    const r = new Map([[a.id, rect(0, 0, 10, 10)], [b.id, rect(50, 0, 10, 10)]])
    const g = ops.wrapNodes(doc, [a.id, b.id], 'Group', r, rect(0, 0, 60, 10), { x: 0, y: 0 })!
    expect(doc.nodes[g].parent).toBe(root)
    expect(ops.canUngroup(doc, g)).toBe(true)
  })
})
