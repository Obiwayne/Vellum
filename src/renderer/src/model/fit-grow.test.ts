import { describe, expect, it } from 'vitest'
import { addFlex, applyStylePatch, makeDoc, makeNode, wrapInFlex } from './ops'

describe('text size and Fit containers', () => {
  it('scales the default 20px line height with the font size, so a Fit box can grow', () => {
    const d = makeDoc('d', 'T')
    const t = makeNode(d, { type: 'text', text: 'Hello' })
    expect(t.style.fontSize).toBe(16)
    expect(t.style.lineHeight).toBe('20px')
    applyStylePatch(t.style, { fontSize: 48 })
    expect(t.style.lineHeight).toBe('60px')
    applyStylePatch(t.style, { fontSize: 16 })
    expect(t.style.lineHeight).toBe('20px')
  })

  it('leaves a line height the user chose (or an explicit patch) alone', () => {
    const d = makeDoc('d', 'T')
    const custom = makeNode(d, { type: 'text', text: 'a', style: { lineHeight: '30px' } })
    applyStylePatch(custom.style, { fontSize: 48 })
    expect(custom.style.lineHeight).toBe('30px')
    const both = makeNode(d, { type: 'text', text: 'b' })
    applyStylePatch(both.style, { fontSize: 48, lineHeight: '52px' })
    expect(both.style.lineHeight).toBe('52px')
    const auto = makeNode(d, { type: 'text', text: 'c', style: { lineHeight: 'normal' } })
    applyStylePatch(auto.style, { fontSize: 48 })
    expect(auto.style.lineHeight).toBe('normal')
  })

  it('Add flex and Wrap in flex make Fit-height frames; the text itself has no fixed height', () => {
    const d = makeDoc('d', 'T')
    const root = d.pages[0].rootId
    const frame = makeNode(d, { type: 'frame' })
    const t = makeNode(d, { type: 'text', text: 'Hello' })
    for (const n of [frame, t]) d.nodes[n.id] = n
    frame.parent = root
    d.nodes[root].children.push(frame.id)
    t.parent = frame.id
    frame.children.push(t.id)
    addFlex(d, frame.id)
    expect(frame.style.height).toBe('fit-content')
    expect(t.style.height).toBeUndefined()
    const w = wrapInFlex(d, [t.id])
    expect(d.nodes[w as string].style.height).toBe('fit-content')
  })
})
