// @vitest-environment jsdom
// MCP tools for text styles, called through the bridge handler registry.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getStore, useStore } from '../model/store'
import { handlers } from './registry'
import './tools-read'
import './tools-write'
import './tools-styles'

vi.mock('../editor/canvas/toast', () => ({ toast: vi.fn() }))

const S = getStore
let fileId: string
const doc = () => S().docs[fileId]
const root = (): string => doc().pages[0].rootId
const call = async (tool: string, args: Record<string, unknown> = {}): Promise<Record<string, any>> => ((await handlers[tool]({ fileId, ...args })) as { body: Record<string, any> }).body
const fails = async (tool: string, args: Record<string, unknown>): Promise<string> => {
  try {
    await handlers[tool]({ fileId, ...args })
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
  throw new Error(`${tool} did not throw`)
}
const text = (t = 'Hello', style: Record<string, string | number> = {}, parent?: string): string => S().createNode(fileId, { type: 'text', text: t, style }, parent ?? root())

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true)
  fileId = S().createDoc('T', { open: true })
})

describe('create / list', () => {
  it('create from explicit values; list shows it with the linked count; px strings become numbers', async () => {
    const made = await call('create_text_style', { name: 'Heading/H1', style: { fontSize: '32px', fontWeight: 700, lineHeight: '1.25' } })
    expect(made.name).toBe('Heading/H1')
    expect(made.style).toEqual({ fontSize: 32, fontWeight: 700, lineHeight: 1.25 }) // unitless line height stays unitless
    const list = await call('get_text_styles')
    expect(list.count).toBe(1)
    expect(list.styles[0]).toMatchObject({ id: made.id, linkedNodeCount: 0 })
    expect(list.keys).toContain('fontFamily')
  })

  it('create from a text node copies its typography; duplicate names get a number; bad input is refused', async () => {
    const t = text('A', { fontSize: 18, fontWeight: 600, color: '#ff0000', width: 'fit-content' })
    const a = await call('create_text_style', { name: 'Body', fromNodeId: t })
    expect(a.style).toMatchObject({ fontSize: 18, fontWeight: 600 })
    expect(a.style).not.toHaveProperty('color') // colour and width are not typography
    expect(a.style).not.toHaveProperty('width')
    const b = await call('create_text_style', { name: 'body', fromNodeId: t })
    expect(b.name).toBe('body 2')
    expect(await fails('create_text_style', { name: 'X' })).toMatch(/at least one of/)
    expect(await fails('create_text_style', { name: 'X', style: { color: 'red' } })).toMatch(/at least one of/)
    expect(await fails('create_text_style', { name: 'X', fromNodeId: t, style: { fontSize: 1 } })).toMatch(/not both/)
    expect(await fails('create_text_style', { style: { fontSize: 1 } })).toMatch(/name/)
    const frame = S().createNode(fileId, { type: 'frame' }, root())
    expect(await fails('create_text_style', { name: 'X', fromNodeId: frame })).toMatch(/not a text node/)
    expect((await call('create_text_style', { name: 'Y', style: { fontSize: 12, color: 'red' } })).ignoredKeys).toEqual(['color'])
  })
})

describe('apply / follow / detach', () => {
  it('apply copies the typography and links; editing the style rewrites linked nodes; one undo each', async () => {
    const a = text('A', { fontSize: 16, lineHeight: 'normal' })
    const b = text('B')
    const s = await call('create_text_style', { name: 'Body', style: { fontSize: 20, fontWeight: 500 } })
    const applied = await call('apply_text_style', { nodeIds: [a, b], styleId: 'body' }) // by name, case-insensitive
    expect(applied.appliedNodeIds).toEqual([a, b])
    expect(doc().nodes[a].style.fontSize).toBe(20)
    expect(doc().nodes[a].style).not.toHaveProperty('lineHeight') // keys the style leaves unset are removed
    expect(doc().nodes[b].textStyle).toBe(s.id)
    expect((await call('get_node_info', { nodeId: a })).textStyle).toEqual({ id: s.id, name: 'Body' })
    // edit the style: both follow
    const upd = await call('update_text_style', { styleId: s.id, style: { fontSize: '48px' } })
    expect(upd.updatedNodeIds).toEqual(expect.arrayContaining([a, b]))
    expect(doc().nodes[a].style.fontSize).toBe(48)
    expect(doc().nodes[b].style.fontSize).toBe(48)
    expect(doc().nodes[b].style.fontWeight).toBe(500)
    S().undo(fileId)
    expect(doc().nodes[a].style.fontSize).toBe(20)
    S().undo(fileId)
    expect(doc().nodes[a].textStyle).toBeUndefined() // the apply was one undo step for both nodes
    expect(doc().nodes[b].textStyle).toBeUndefined()
  })

  it('null detaches and keeps the values; non-text nodes and unknown ids are skipped and listed', async () => {
    const a = text('A')
    const frame = S().createNode(fileId, { type: 'frame' }, root())
    const s = await call('create_text_style', { name: 'Body', style: { fontSize: 22 } })
    const res = await call('apply_text_style', { nodeIds: [a, frame, 'nope'], styleId: s.id })
    expect(res.appliedNodeIds).toEqual([a])
    expect(res.skipped.map((x: any) => x.nodeId)).toEqual([frame, 'nope'])
    const d = await call('apply_text_style', { nodeIds: [a], styleId: null })
    expect(d.detachedNodeIds).toEqual([a])
    expect(doc().nodes[a].textStyle).toBeUndefined()
    expect(doc().nodes[a].style.fontSize).toBe(22)
  })

  it('a manual typography edit through update_styles detaches (reported); delete_text_style unlinks and keeps values', async () => {
    const a = text('A')
    const b = text('B')
    const s = await call('create_text_style', { name: 'Body', style: { fontSize: 22 } })
    await call('apply_text_style', { nodeIds: [a, b], styleId: s.id })
    const edit = (await handlers.update_styles({ fileId, updates: [{ nodeIds: [a], styles: { fontSize: '30px' } }] })) as { body: Record<string, any> }
    expect(edit.body.detachedTextStyles).toEqual(['Body'])
    expect(doc().nodes[a].textStyle).toBeUndefined()
    const del = await call('delete_text_style', { styleId: 'Body' })
    expect(del.unlinkedNodeIds).toEqual([b])
    expect(doc().nodes[b].style.fontSize).toBe(22)
    expect((await call('get_text_styles')).count).toBe(0)
  })

  it('a style edit grows a Fit container: bigger fontSize reaches the nodes (model view of the T10 case)', async () => {
    const frame = S().createNode(fileId, { type: 'frame', style: { display: 'flex', height: 'fit-content' } }, root())
    const t = text('Hi', {}, frame)
    const s = await call('create_text_style', { name: 'Body', style: { fontSize: 16, lineHeight: '1.25' } })
    await call('apply_text_style', { nodeIds: [t], styleId: s.id })
    await call('update_text_style', { styleId: s.id, style: { fontSize: 48 } })
    expect(doc().nodes[t].style).toMatchObject({ fontSize: 48, lineHeight: 1.25 }) // unitless: the line box scales with it
    expect(doc().nodes[frame].style.height).toBe('fit-content')
  })
})

describe('refusals', () => {
  it('unknown style ids list the available names; empty updates are refused; rename works', async () => {
    const s = await call('create_text_style', { name: 'Body', style: { fontSize: 22 } })
    expect(await fails('apply_text_style', { nodeIds: [text()], styleId: 'Nope' })).toMatch(/Available: Body/)
    expect(await fails('update_text_style', { styleId: 'Nope', name: 'x' })).toMatch(/not found/)
    expect(await fails('update_text_style', { styleId: s.id })).toMatch(/style .*and\/or name/)
    expect(await fails('delete_text_style', {})).toMatch(/styleId is required/)
    expect(await fails('apply_text_style', { styleId: s.id })).toMatch(/nodeIds/)
    const renamed = await call('update_text_style', { styleId: s.id, name: 'Paragraph/M' })
    expect(renamed.name).toBe('Paragraph/M')
  })

  it('applying inside a component instance goes through the override path and the main stays plain', async () => {
    const frame = S().createNode(fileId, { type: 'frame', name: 'Card', style: { width: 100, height: 40 } }, root())
    const t = text('Hi', { fontSize: 14 }, frame)
    S().createComponent(fileId, [frame])
    const inst = S().createInstance(fileId, frame, root())
    const twin = doc().nodes[inst].children.find((c) => doc().nodes[c].srcId === t) as string
    const s = await call('create_text_style', { name: 'Big', style: { fontSize: 40 } })
    await call('apply_text_style', { nodeIds: [twin], styleId: s.id })
    expect(doc().nodes[twin].style.fontSize).toBe(40)
    expect(doc().nodes[t].style.fontSize).toBe(14) // the main keeps its own typography
  })
})
