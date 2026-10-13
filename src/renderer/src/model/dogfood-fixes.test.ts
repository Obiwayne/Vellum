// Found by the T73 dogfood run: a developer's Claude read the bundle and caught two wrong numbers.
//  1. a text layer that carries its own background (a button label) was judged against the page behind it
//  2. a measured `line-height: normal` included the layer's own padding and border
import { describe, expect, it } from 'vitest'
import * as ops from './ops'
import { textContrast } from './contrast'
import { nodeSpec } from './devSpec'
import type { CNode, WorldRect } from './types'

function setup() {
  const doc = ops.makeDoc('d', 'D')
  const root = doc.pages[0].rootId
  const page = ops.makeNode(doc, { type: 'frame', name: 'Page', style: { width: 400, height: 300, backgroundColor: '#F8FAFC' } }, false)
  ops.insertNode(doc, page, root)
  const add = (partial: Parameters<typeof ops.makeNode>[1], parent: string): CNode => {
    const n = ops.makeNode(doc, partial, false)
    ops.insertNode(doc, n, parent)
    return n
  }
  return { doc, page, add }
}

describe('contrast of a text layer with its own background', () => {
  it('white on its own #2563EB passes AA, it is not judged against the light page', () => {
    const { doc, page, add } = setup()
    const t = add({ type: 'text', name: 'Pay', text: 'Pay $105.00', style: { color: '#FFFFFF', background: '#2563EB', padding: '14px 28px', fontSize: 16, fontWeight: 600 } }, page.id)
    const r = textContrast(doc, t.id)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.results[0].bg).toBe('#2563EB')
      expect(r.results[0].ratio).toBeGreaterThan(5)
      expect(r.results[0].aa).toBe(true)
    }
  })

  it('backgroundColor on the layer works too, and a translucent own background composites over the parent', () => {
    const { doc, page, add } = setup()
    const a = add({ type: 'text', text: 'x', style: { color: '#000000', backgroundColor: '#FFFF00' } }, page.id)
    const ra = textContrast(doc, a.id)
    expect(ra.ok && ra.results[0].bg).toBe('#FFFF00')
    const b = add({ type: 'text', text: 'y', style: { color: '#000000', backgroundColor: 'rgba(0, 0, 0, 0.5)' } }, page.id)
    const rb = textContrast(doc, b.id)
    expect(rb.ok && rb.results[0].bg).not.toBe('#F8FAFC')
  })

  it('a text layer with no background of its own still uses the nearest ancestor', () => {
    const { doc, page, add } = setup()
    const t = add({ type: 'text', text: 'z', style: { color: '#777777' } }, page.id)
    const r = textContrast(doc, t.id)
    expect(r.ok && r.results[0].bg).toBe('#F8FAFC')
  })

  it('a gradient on the layer itself is "not computed"', () => {
    const { doc, page, add } = setup()
    const t = add({ type: 'text', text: 'g', style: { color: '#fff', backgroundImage: 'linear-gradient(#000, #fff)' } }, page.id)
    const r = textContrast(doc, t.id)
    expect(r.ok).toBe(false)
  })
})

describe('line-height normal with padding and border', () => {
  const rect = (h: number): ((id: string) => WorldRect | null) => () => ({ x: 0, y: 0, width: 143, height: h })

  it('subtracts the layer\'s own vertical padding: a 49px button label is a 21px line', () => {
    const { doc, page, add } = setup()
    const t = add({ type: 'text', text: 'Pay', style: { fontSize: 16, padding: '14px 28px' } }, page.id)
    const s = nodeSpec(doc, t.id, { measure: rect(49) })!
    expect(s.text?.lineHeightPx).toBe(21)
    expect(s.text?.lineHeightSource).toBe('estimated')
  })

  it('subtracts border widths from longhands and shorthands, and a padding-top with a border-top', () => {
    const { doc, page, add } = setup()
    const a = add({ type: 'text', text: 'Total', style: { fontSize: 18, paddingTop: 12, borderTop: '1px solid #E2E8F0' } }, page.id)
    expect(nodeSpec(doc, a.id, { measure: rect(37) })!.text?.lineHeightPx).toBe(24)
    const b = add({ type: 'text', text: 'Box', style: { fontSize: 16, borderTopWidth: 2, borderBottomWidth: 2, borderStyle: 'solid', paddingBottom: 6 } }, page.id)
    expect(nodeSpec(doc, b.id, { measure: rect(30) })!.text?.lineHeightPx).toBe(20)
    const c = add({ type: 'text', text: 'None', style: { fontSize: 16, border: 'none' } }, page.id)
    expect(nodeSpec(doc, c.id, { measure: rect(20) })!.text?.lineHeightPx).toBe(20)
  })

  it('multi-line text divides what is left by the line count; an authored line height is untouched', () => {
    const { doc, page, add } = setup()
    const t = add({ type: 'text', text: 'a\nb', style: { fontSize: 16, padding: 10 } }, page.id)
    expect(nodeSpec(doc, t.id, { measure: rect(60) })!.text?.lineHeightPx).toBe(20)
    const u = add({ type: 'text', text: 'c', style: { fontSize: 16, padding: 10, lineHeight: '24px' } }, page.id)
    const su = nodeSpec(doc, u.id, { measure: rect(44) })!
    expect(su.text?.lineHeightPx).toBe(24)
    expect(su.text?.lineHeightSource).toBe('authored')
  })
})

describe('exports lay text out like the canvas', () => {
  it('the exported HTML document and SVG wrapper use line-height normal, not 20px', async () => {
    const { htmlDocument, svgDocument } = await import('../editor/inspector/exporting')
    const { doc, page, add } = setup()
    add({ type: 'text', text: 'hello', style: { fontSize: 20 } }, page.id)
    expect(htmlDocument(doc, page.id)).toContain('line-height:normal')
    expect(htmlDocument(doc, page.id)).not.toContain('line-height:20px')
    expect(svgDocument(doc, page.id)).toContain('line-height:normal')
  })
})
