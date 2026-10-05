import { describe, expect, it } from 'vitest'
import { addFlex, applyStylePatch, makeDoc, makeNode, wrapInFlex } from './ops'

describe('text size and Fit containers', () => {
  it('new text gets a unitless line height, so it scales with the font size', () => {
    const d = makeDoc('d', 'T')
    const t = makeNode(d, { type: 'text', text: 'Hello' })
    expect(t.style.fontSize).toBe(16)
    expect(t.style.lineHeight).toBe('1.25')
    applyStylePatch(t.style, { fontSize: 48 })
    expect(t.style.lineHeight).toBe('1.25') // 48 × 1.25 = 60px of line box
  })

  it('applyStylePatch never rewrites a line height (px or otherwise) on a font-size change', () => {
    const d = makeDoc('d', 'T')
    const px = makeNode(d, { type: 'text', text: 'a', style: { fontSize: 16, lineHeight: '20px' } })
    applyStylePatch(px.style, { fontSize: 48 })
    expect(px.style.lineHeight).toBe('20px')
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
