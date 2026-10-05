import { beforeEach, describe, expect, it } from 'vitest'
import { getStore, useStore } from './store'

const S = getStore
let id: string

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true)
  id = S().createDoc('T', { open: false })
})

describe('typography change through the store', () => {
  const build = (): { outer: string; inner: string; text: string } => {
    const root = S().docs[id].pages[0].rootId
    const outer = S().createNode(id, { type: 'frame', name: 'outer' }, root)
    const inner = S().createNode(id, { type: 'frame', name: 'inner' }, outer)
    const text = S().createNode(id, { type: 'text', text: 'Hello' }, inner)
    S().addFlex(id, inner)
    S().addFlex(id, outer)
    return { outer, inner, text }
  }
  const st = (n: string) => S().docs[id].nodes[n].style

  it('font size via updateStyles keeps the unitless line height; one undo restores the size', () => {
    const { text } = build()
    S().updateStyles(id, [text], { fontSize: 48 })
    expect(st(text).fontSize).toBe(48)
    expect(st(text).lineHeight).toBe('1.25')
    S().undo(id)
    expect(st(text).fontSize).toBe(16)
  })

  it('leaves no fixed height on the text or on nested Fit frames, so every Fit parent can grow', () => {
    const { outer, inner, text } = build()
    S().updateStyles(id, [text], { fontSize: 48 })
    expect(st(text).height).toBeUndefined()
    expect(st(inner).height).toBe('fit-content')
    expect(st(outer).height).toBe('fit-content')
  })

  it('a Fixed-height frame stays Fixed', () => {
    const root = S().docs[id].pages[0].rootId
    const fixed = S().createNode(id, { type: 'frame', name: 'fixed', style: { height: 100 } }, root)
    const text = S().createNode(id, { type: 'text', text: 'Hello' }, fixed)
    S().updateStyles(id, [text], { fontSize: 48 })
    expect(st(fixed).height).toBe(100)
  })

  it('an explicit px line height (inspector or MCP) stays fixed when the font size changes', () => {
    const { text } = build()
    S().updateStyles(id, [text], { lineHeight: '24px' })
    S().updateStyles(id, [text], { fontSize: 48 })
    expect(st(text).lineHeight).toBe('24px')
  })
})
