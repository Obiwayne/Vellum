// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getStore, useStore } from '../model/store'
import { handlers } from './registry'
import './tools-write'

vi.mock('../editor/canvas/toast', () => ({ toast: vi.fn() }))

const S = getStore

describe('MCP update_styles and text styles', () => {
  beforeEach(() => useStore.setState(useStore.getInitialState(), true))

  it('a typography key detaches the node, reports it, and keeps the values', async () => {
    const id = S().createDoc('T', { open: false })
    const root = S().docs[id].pages[0].rootId
    const t = S().createNode(id, { type: 'text', text: 'A' }, root)
    const sid = S().createTextStyle(id, 'Body', { fontSize: 16, fontWeight: 400 })
    S().applyTextStyle(id, [t], sid)
    const res = (await handlers.update_styles({ fileId: id, docId: id, updates: [{ nodeIds: [t], styles: { fontSize: '30px' } }] })) as Record<string, unknown>
    expect((res.body as Record<string, unknown>).detachedTextStyles).toEqual(['Body'])
    const n = S().docs[id].nodes[t]
    expect(n.textStyle).toBeUndefined()
    expect(n.style.fontWeight).toBe(400)
    S().undo(id)
    expect(S().docs[id].nodes[t].textStyle).toBe(sid)
  })
})
