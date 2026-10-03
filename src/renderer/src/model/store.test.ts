import { beforeEach, describe, expect, it } from 'vitest'
import { diffDocs } from '@shared/docDiff'
import { getStore, useStore } from './store'
import type { Doc } from './types'

const S = getStore
let id: string
const doc = (): Doc => S().docs[id]
const root = (): string => doc().pages[0].rootId
const kids = (parent: string): string[] => doc().nodes[parent].children
const frame = (name: string, parent = root(), extra = {}): string => S().createNode(id, { type: 'frame', name, ...extra }, parent)

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true)
  id = S().createDoc('T', { open: false })
})

describe('insert', () => {
  it('adds a node under its parent, at an index, and undo/redo round-trips', () => {
    const a = frame('A')
    const b = frame('B')
    const c = S().createNode(id, { type: 'frame', name: 'C' }, root(), 1)
    expect(kids(root())).toEqual([a, c, b])
    expect(doc().nodes[c].parent).toBe(root())
    S().undo(id)
    expect(kids(root())).toEqual([a, b])
    expect(doc().nodes[c]).toBeUndefined()
    S().redo(id)
    expect(kids(root())).toEqual([a, c, b])
  })

  it('throws for a missing parent', () => {
    expect(() => S().createNode(id, { type: 'frame' }, 'nope')).toThrow()
  })
})

describe('delete', () => {
  it('removes a node and its descendants; undo restores them', () => {
    const a = frame('A')
    const child = frame('child', a)
    S().deleteNodes(id, [a])
    expect(doc().nodes[a]).toBeUndefined()
    expect(doc().nodes[child]).toBeUndefined()
    expect(kids(root())).toEqual([])
    S().undo(id)
    expect(kids(root())).toEqual([a])
    expect(kids(a)).toEqual([child])
    S().redo(id)
    expect(doc().nodes[a]).toBeUndefined()
  })

  it('never deletes a page root', () => {
    S().deleteNodes(id, [root()])
    expect(doc().nodes[root()]).toBeDefined()
  })

  it('drops deleted nodes from the selection', () => {
    const a = frame('A')
    S().select(id, [a])
    S().deleteNodes(id, [a])
    expect(S().editors[id].selection).toEqual([])
  })
})

describe('move / reparent', () => {
  it('moves a node into another parent and undoes', () => {
    const a = frame('A')
    const b = frame('B')
    S().moveNodes(id, [b], a)
    expect(kids(root())).toEqual([a])
    expect(kids(a)).toEqual([b])
    expect(doc().nodes[b].parent).toBe(a)
    S().undo(id)
    expect(kids(root())).toEqual([a, b])
    expect(doc().nodes[b].parent).toBe(root())
    S().redo(id)
    expect(kids(a)).toEqual([b])
  })

  it('moves to an index within the same parent (reorder)', () => {
    const a = frame('A')
    const b = frame('B')
    const c = frame('C')
    S().moveNodes(id, [c], root(), 0)
    expect(kids(root())).toEqual([c, a, b])
    S().moveNodes(id, [c], root(), 3)
    expect(kids(root())).toEqual([a, b, c])
    S().undo(id)
    expect(kids(root())).toEqual([c, a, b])
  })

  it('only moves the topmost of a nested selection', () => {
    const a = frame('A')
    const inner = frame('inner', a)
    const b = frame('B')
    S().moveNodes(id, [a, inner], b)
    expect(kids(b)).toEqual([a])
    expect(kids(a)).toEqual([inner])
  })
})

describe('duplicate', () => {
  it('copies a subtree with new ids and undoes', () => {
    const a = frame('A')
    const child = frame('child', a)
    const [copy] = S().duplicateNodes(id, [a])
    expect(copy).not.toBe(a)
    expect(kids(root())).toContain(copy)
    expect(kids(copy)).toHaveLength(1)
    expect(kids(copy)[0]).not.toBe(child)
    expect(doc().nodes[kids(copy)[0]].parent).toBe(copy)
    S().undo(id)
    expect(doc().nodes[copy]).toBeUndefined()
    expect(kids(root())).toEqual([a])
    S().redo(id)
    expect(doc().nodes[copy]).toBeDefined()
  })

  it('does not duplicate a page root', () => {
    expect(S().duplicateNodes(id, [root()])).toEqual([])
  })
})

describe('update styles / node', () => {
  it('patches styles and undo/redo restores them', () => {
    const a = frame('A', root(), { style: { width: 10 } })
    S().updateStyles(id, [a], { width: 50, backgroundColor: 'red' })
    expect(doc().nodes[a].style).toMatchObject({ width: 50, backgroundColor: 'red' })
    S().undo(id)
    expect(doc().nodes[a].style.width).toBe(10)
    expect(doc().nodes[a].style.backgroundColor).not.toBe('red')
    S().redo(id)
    expect(doc().nodes[a].style.width).toBe(50)
  })

  it('coalesces consecutive same-key updates into one undo step', () => {
    const a = frame('A', root(), { style: { width: 10 } })
    S().updateStyles(id, [a], { width: 20 }, { coalesce: 'w' })
    S().updateStyles(id, [a], { width: 30 }, { coalesce: 'w' })
    S().undo(id)
    expect(doc().nodes[a].style.width).toBe(10)
  })

  it('renames a layer, ignoring blank names', () => {
    const a = frame('A')
    S().renameNode(id, a, '  New  ')
    expect(doc().nodes[a].name).toBe('New')
    S().renameNode(id, a, '   ')
    expect(doc().nodes[a].name).toBe('New')
    S().undo(id)
    expect(doc().nodes[a].name).toBe('A')
  })

  it('setText edits text and undoes', () => {
    const t = S().createNode(id, { type: 'text', text: 'hi' }, root())
    S().setText(id, t, 'bye')
    expect(doc().nodes[t].text).toBe('bye')
    S().undo(id)
    expect(doc().nodes[t].text).toBe('hi')
  })
})

describe('pages', () => {
  it('adds a page with a root node, makes it active, and undoes', () => {
    const p = S().addPage(id, 'Second')
    expect(doc().pages.map((x) => x.name)).toEqual([doc().pages[0].name, 'Second'])
    expect(S().editors[id].pageId).toBe(p)
    const rootId = doc().pages[1].rootId
    expect(doc().nodes[rootId]).toBeDefined()
    S().undo(id)
    expect(doc().pages).toHaveLength(1)
    expect(doc().nodes[rootId]).toBeUndefined()
    S().redo(id)
    expect(doc().pages).toHaveLength(2)
  })

  it('reorders pages and undoes', () => {
    const p1 = doc().pages[0].id
    const p2 = S().addPage(id, 'B')
    const p3 = S().addPage(id, 'C')
    S().movePage(id, p3, 0)
    expect(doc().pages.map((p) => p.id)).toEqual([p3, p1, p2])
    S().undo(id)
    expect(doc().pages.map((p) => p.id)).toEqual([p1, p2, p3])
    S().redo(id)
    expect(doc().pages.map((p) => p.id)).toEqual([p3, p1, p2])
  })

  it('keeps at least one page', () => {
    S().deletePage(id, doc().pages[0].id)
    expect(doc().pages).toHaveLength(1)
  })
})

describe('undo / redo state', () => {
  it('reports canUndo/canRedo and clears redo on a new edit', () => {
    expect(S().canUndo(id)).toBe(false)
    frame('A')
    expect(S().canUndo(id)).toBe(true)
    S().undo(id)
    expect(S().canRedo(id)).toBe(true)
    frame('B')
    expect(S().canRedo(id)).toBe(false)
    expect(kids(root())).toHaveLength(1)
    expect(doc().nodes[kids(root())[0]].name).toBe('B')
  })

  it('keeps separate histories per doc', () => {
    const other = S().createDoc('O', { open: false })
    frame('A')
    expect(S().canUndo(other)).toBe(false)
  })
})

describe('docDiff over store edits', () => {
  it('reports added, edited and removed layers', () => {
    const a = frame('A', root(), { style: { width: 10 } })
    const b = frame('B')
    const v1 = structuredClone(doc())
    S().updateStyles(id, [a], { width: 99 })
    const c = frame('C')
    S().deleteNodes(id, [b])
    const d = diffDocs(v1, structuredClone(doc()))
    expect(d.added.map((n) => n.id)).toContain(c)
    expect(d.removed.map((n) => n.id)).toContain(b)
    expect(d.changed.map((n) => n.id)).toContain(a)
    expect(d.changed.find((n) => n.id === a)?.aspects).toContain('style')
  })

  it('reports nothing for identical docs', () => {
    frame('A')
    const d = diffDocs(structuredClone(doc()), structuredClone(doc()))
    expect([d.added, d.removed, d.changed].every((l) => l.length === 0)).toBe(true)
  })
})
