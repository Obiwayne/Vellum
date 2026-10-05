// @vitest-environment jsdom
// Test-station checks for the text style MCP tools (T31): lookups, null removal, tokens, instances, odd input.
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
const text = (t = 'Hello', parent?: string): string => S().createNode(fileId, { type: 'text', text: t }, parent ?? root())

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true)
  fileId = S().createDoc('T', { open: true })
})

describe('lookups', () => {
  it('a name written with spaces around the slash finds the style (names are stored normalised)', async () => {
    const s = await call('create_text_style', { name: 'Heading / H1', style: { fontSize: 32 } })
    expect(s.name).toBe('Heading/H1')
    const a = text()
    expect((await call('apply_text_style', { nodeIds: [a], styleId: 'Heading / H1' })).styleId).toBe(s.id)
    expect((await call('apply_text_style', { nodeIds: [a], styleId: 'heading/h1' })).styleId).toBe(s.id)
    expect((await call('update_text_style', { styleId: '  HEADING /h1 ', style: { fontSize: 40 } })).style.fontSize).toBe(40)
  })

  it('an id wins over a name; a whitespace-only name is refused', async () => {
    const a = await call('create_text_style', { name: 'A', style: { fontSize: 10 } })
    await call('create_text_style', { name: a.id, style: { fontSize: 20 } }) // a style NAMED like the first style's id
    const t = text()
    const res = await call('apply_text_style', { nodeIds: [t], styleId: a.id })
    expect(res.name).toBe('A')
    expect(await fails('create_text_style', { name: '   ', style: { fontSize: 1 } })).toMatch(/name/)
  })
})

describe('values', () => {
  it('tokens and font stacks pass through; null removes a key from the style and from the nodes; objects are ignored', async () => {
    const s = await call('create_text_style', { name: 'T', style: { fontFamily: 'var(--font-sans)', fontSize: 'var(--text-lg)', fontWeight: 600, letterSpacing: '0.02em', textTransform: 'uppercase' } })
    expect(s.style).toMatchObject({ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-lg)', letterSpacing: '0.02em', textTransform: 'uppercase' })
    const a = text()
    await call('apply_text_style', { nodeIds: [a], styleId: s.id })
    expect(doc().nodes[a].style.fontSize).toBe('var(--text-lg)')
    await call('update_text_style', { styleId: s.id, style: { textTransform: null, letterSpacing: null } })
    expect(doc().nodes[a].style).not.toHaveProperty('textTransform')
    expect(doc().nodes[a].style).not.toHaveProperty('letterSpacing')
    expect((await call('get_text_styles')).styles[0].style).not.toHaveProperty('textTransform')
    expect(await fails('create_text_style', { name: 'X', style: { fontSize: { a: 1 } } })).toMatch(/at least one/)
    const ign = await call('create_text_style', { name: 'Y', style: { fontSize: 12, ['__proto__']: 'x', constructor: 'y', width: 5 } })
    expect(ign.ignoredKeys.sort()).toEqual(['constructor', 'width'])
    expect(Object.keys(ign.style)).toEqual(['fontSize'])
  })

  it('a style may end up empty: applying it clears typography keys; the name keeps working', async () => {
    const s = await call('create_text_style', { name: 'E', style: { fontSize: 10 } })
    await call('update_text_style', { styleId: s.id, style: { fontSize: null } })
    const t = text()
    S().updateStyles(fileId, [t], { fontSize: 99 })
    await call('apply_text_style', { nodeIds: [t], styleId: s.id })
    expect(doc().nodes[t].style).not.toHaveProperty('fontSize')
    expect(doc().nodes[t].textStyle).toBe(s.id)
  })
})

describe('instances and many nodes', () => {
  async function inst() {
    const frame = S().createNode(fileId, { type: 'frame', name: 'Card', style: { width: 100, height: 40 } }, root())
    const t = text('Hi', frame)
    S().createComponent(fileId, [frame])
    const i = S().createInstance(fileId, frame, root())
    const twin = doc().nodes[i].children.find((c) => doc().nodes[c].srcId === t) as string
    return { frame, t, i, twin }
  }

  it('a style applied inside an instance keeps following the style; deleting it keeps the values; linked count ignores twins', async () => {
    const { t, twin } = await inst()
    const s = await call('create_text_style', { name: 'Big', style: { fontSize: 40 } })
    await call('apply_text_style', { nodeIds: [twin], styleId: s.id })
    expect(doc().nodes[twin].style.fontSize).toBe(40)
    await call('update_text_style', { styleId: s.id, style: { fontSize: 64 } })
    expect(doc().nodes[twin].style.fontSize).toBe(64) // the override follows the style
    expect(doc().nodes[t].style.fontSize).not.toBe(64) // the main is untouched
    expect((await call('get_text_styles')).styles[0].linkedNodeCount).toBe(0) // twins are rebuilt from their main
    await call('delete_text_style', { styleId: s.id })
    expect(doc().nodes[twin].style.fontSize).toBe(64)
    S().undo(fileId)
    expect((await call('get_text_styles')).count).toBe(1)
  })

  it('a main text that follows a style flows to its instances when the style changes', async () => {
    const { t, twin } = await inst()
    const s = await call('create_text_style', { name: 'Body', style: { fontSize: 20 } })
    await call('apply_text_style', { nodeIds: [t], styleId: s.id })
    expect(doc().nodes[twin].style.fontSize).toBe(20)
    await call('update_text_style', { styleId: s.id, style: { fontSize: 30 } })
    expect(doc().nodes[twin].style.fontSize).toBe(30)
    S().undo(fileId)
    expect(doc().nodes[twin].style.fontSize).toBe(20)
  })

  it('applying to 200 nodes is one undo step and one call', async () => {
    const ids = Array.from({ length: 200 }, (_, i) => text(`t${i}`))
    const s = await call('create_text_style', { name: 'Bulk', style: { fontSize: 33 } })
    const res = await call('apply_text_style', { nodeIds: ids, styleId: s.id })
    expect(res.appliedNodeIds.length).toBe(200)
    expect((await call('get_text_styles')).styles[0].linkedNodeCount).toBe(200)
    S().undo(fileId)
    expect(ids.every((id) => doc().nodes[id].textStyle === undefined)).toBe(true)
  })

  it('detaching twice, detaching an unlinked node, and applying the same style twice are harmless', async () => {
    const t = text()
    const s = await call('create_text_style', { name: 'S', style: { fontSize: 21 } })
    await call('apply_text_style', { nodeIds: [t], styleId: s.id })
    await call('apply_text_style', { nodeIds: [t], styleId: s.id })
    await call('apply_text_style', { nodeIds: [t], styleId: null })
    await call('apply_text_style', { nodeIds: [t], styleId: null })
    expect(doc().nodes[t].textStyle).toBeUndefined()
    expect(doc().nodes[t].style.fontSize).toBe(21)
  })
})

describe('update_styles interplay', () => {
  it('non-typography edits keep the link; a no-op typography edit (same value) keeps it too', async () => {
    const t = text()
    const s = await call('create_text_style', { name: 'S', style: { fontSize: 21 } })
    await call('apply_text_style', { nodeIds: [t], styleId: s.id })
    const r1 = (await handlers.update_styles({ fileId, updates: [{ nodeIds: [t], styles: { color: '#ff0000' } }] })) as { body: Record<string, any> }
    expect(r1.body.detachedTextStyles).toBeUndefined()
    expect(doc().nodes[t].textStyle).toBe(s.id)
    const r2 = (await handlers.update_styles({ fileId, updates: [{ nodeIds: [t], styles: { fontSize: 21 } }] })) as { body: Record<string, any> }
    expect(r2.body.detachedTextStyles).toBeUndefined()
    expect(doc().nodes[t].textStyle).toBe(s.id)
  })
})

describe('deleting a style an instance override follows (found at the test station)', () => {
  it('keeps the look when the main has no style, and stays detached when the main follows another one', async () => {
    const frame = S().createNode(fileId, { type: 'frame', name: 'Card', style: { width: 100, height: 40 } }, root())
    const t = text('Hi', frame)
    S().createComponent(fileId, [frame])
    const inst = S().createInstance(fileId, frame, root())
    const twin = doc().nodes[inst].children.find((c) => doc().nodes[c].srcId === t) as string
    const s0 = await call('create_text_style', { name: 'Main', style: { fontSize: 14, fontWeight: 400 } })
    const s1 = await call('create_text_style', { name: 'Override', style: { fontSize: 40, fontWeight: 700 } })
    await call('apply_text_style', { nodeIds: [twin], styleId: s1.id })
    await call('delete_text_style', { styleId: s1.id })
    expect(doc().nodes[twin].style).toMatchObject({ fontSize: 40, fontWeight: 700 }) // values stay after the style is gone
    expect(doc().nodes[twin].textStyle).toBeUndefined()
    // now the main follows s0: the twin must not fall back to it
    const s2 = await call('create_text_style', { name: 'Again', style: { fontSize: 50 } })
    await call('apply_text_style', { nodeIds: [t], styleId: s0.id })
    await call('apply_text_style', { nodeIds: [twin], styleId: s2.id })
    await call('delete_text_style', { styleId: s2.id })
    expect(doc().nodes[twin].style.fontSize).toBe(50)
    expect(doc().nodes[twin].textStyle).toBeUndefined()
    await call('update_text_style', { styleId: s0.id, style: { fontWeight: 300 } })
    expect(doc().nodes[twin].style.fontSize).toBe(50) // the main's style change does not drag the detached twin back
  })
})
