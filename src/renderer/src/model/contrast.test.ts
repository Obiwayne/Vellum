import { describe, expect, it } from 'vitest'
import * as ops from './ops'
import { composite, contrastRatio, isLargeText, relativeLuminance, textContrast, wcag } from './contrast'
import type { CNode } from './types'

const rgb = (r: number, g: number, b: number) => ({ r, g, b })

describe('contrast maths', () => {
  it('luminance and ratio match the WCAG reference values', () => {
    expect(relativeLuminance(rgb(0, 0, 0))).toBe(0)
    expect(relativeLuminance(rgb(255, 255, 255))).toBeCloseTo(1, 6)
    expect(contrastRatio(rgb(0, 0, 0), rgb(255, 255, 255))).toBeCloseTo(21, 6)
    expect(contrastRatio(rgb(255, 255, 255), rgb(255, 255, 255))).toBe(1)
    // #767676 on white is the classic AA edge (4.54); #777777 just misses (4.48)
    expect(contrastRatio(rgb(0x76, 0x76, 0x76), rgb(255, 255, 255))).toBeCloseTo(4.54, 2)
    expect(contrastRatio(rgb(0x77, 0x77, 0x77), rgb(255, 255, 255))).toBeCloseTo(4.48, 2)
  })
  it('is symmetric', () => {
    expect(contrastRatio(rgb(10, 20, 30), rgb(200, 210, 220))).toBe(contrastRatio(rgb(200, 210, 220), rgb(10, 20, 30)))
  })
  it('AA/AAA thresholds depend on text size', () => {
    expect(wcag(4.5, false)).toEqual({ aa: true, aaa: false })
    expect(wcag(4.49, false)).toEqual({ aa: false, aaa: false })
    expect(wcag(3, true)).toEqual({ aa: true, aaa: false })
    expect(wcag(7, false)).toEqual({ aa: true, aaa: true })
    expect(wcag(4.5, true)).toEqual({ aa: true, aaa: true })
  })
  it('large text is 24px, or 18.66px and bold', () => {
    expect(isLargeText(24, 400)).toBe(true)
    expect(isLargeText(23.9, 400)).toBe(false)
    expect(isLargeText(18.66, 700)).toBe(true)
    expect(isLargeText(18.66, 600)).toBe(false)
  })
  it('composite blends by alpha', () => {
    expect(composite({ r: 0, g: 0, b: 0, a: 0.5 }, { r: 255, g: 255, b: 255, a: 1 })).toEqual({ r: 128, g: 128, b: 128, a: 1 })
    expect(composite({ r: 9, g: 9, b: 9, a: 1 }, { r: 255, g: 255, b: 255, a: 1 })).toEqual({ r: 9, g: 9, b: 9, a: 1 })
    expect(composite({ r: 9, g: 9, b: 9, a: 0 }, { r: 1, g: 2, b: 3, a: 1 })).toEqual({ r: 1, g: 2, b: 3, a: 1 })
  })
})

function setup() {
  const doc = ops.makeDoc('d', 'D')
  const root = doc.pages[0].rootId
  const add = (partial: Parameters<typeof ops.makeNode>[1], parent: string): CNode => {
    const n = ops.makeNode(doc, partial, false)
    ops.insertNode(doc, n, parent)
    return n
  }
  return { doc, root, add }
}

describe('textContrast', () => {
  it('reads colour and background up the tree, with large-text and flags', () => {
    const { doc, root, add } = setup()
    const f = add({ type: 'frame', style: { width: 100, height: 100, backgroundColor: '#FFFFFF' } }, root)
    const t = add({ type: 'text', text: 'x', style: { color: '#777777', fontSize: 16 } }, f.id)
    const r = textContrast(doc, t.id)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.results).toHaveLength(1)
      expect(r.results[0]).toMatchObject({ mode: 'base', ratio: 4.48, aa: false, aaa: false, large: false, fg: '#777777', bg: '#FFFFFF' })
    }
    doc.nodes[t.id].style.fontSize = 28
    const big = textContrast(doc, t.id)
    expect(big.ok && big.results[0]).toMatchObject({ large: true, aa: true })
  })

  it('resolves tokens per mode and reports each mode', () => {
    const { doc, root, add } = setup()
    doc.modes = ['Light', 'Dark']
    doc.tokens = [
      { name: '--bg', value: '#FFFFFF', modes: { Dark: '#000000' } },
      { name: '--fg', value: '#111111', modes: { Dark: '#222222' } }
    ]
    const f = add({ type: 'frame', style: { width: 100, height: 100, backgroundColor: 'var(--bg)' } }, root)
    const t = add({ type: 'text', text: 'x', style: { color: 'var(--fg)' } }, f.id)
    const r = textContrast(doc, t.id)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.results.map((x) => x.mode)).toEqual(['Light', 'Dark'])
    expect(r.results[0]).toMatchObject({ aa: true, aaa: true })
    expect(r.results[1]).toMatchObject({ aa: false }) // #222 on black
    expect(r.results[1].ratio).toBeLessThan(1.5)
  })

  it('a frame that pins a mode is judged in that mode only', () => {
    const { doc, root, add } = setup()
    doc.modes = ['Light', 'Dark']
    doc.tokens = [{ name: '--bg', value: '#FFFFFF', modes: { Dark: '#000000' } }]
    const f = add({ type: 'frame', attrs: { 'data-mode': 'Dark' }, style: { width: 10, height: 10, backgroundColor: 'var(--bg)' } }, root)
    const t = add({ type: 'text', text: 'x', style: { color: '#FFFFFF' } }, f.id)
    const r = textContrast(doc, t.id)
    expect(r.ok && r.results.map((x) => x.mode)).toEqual(['Dark'])
    expect(r.ok && r.results[0].ratio).toBe(21)
  })

  it('composites a translucent layer over the opaque one behind it, and the text alpha over that', () => {
    const { doc, root, add } = setup()
    const f = add({ type: 'frame', style: { width: 10, height: 10, backgroundColor: '#FFFFFF' } }, root)
    const g = add({ type: 'frame', style: { width: 10, height: 10, backgroundColor: '#00000080' } }, f.id)
    const t = add({ type: 'text', text: 'x', style: { color: '#FFFFFF' } }, g.id)
    const r = textContrast(doc, t.id)
    expect(r.ok && r.results[0].bg).toBe('#7F7F7F')
    const t2 = add({ type: 'text', text: 'y', style: { color: '#FFFFFF80' } }, g.id)
    const r2 = textContrast(doc, t2.id)
    expect(r2.ok && r2.results[0].fg).toBe('#BFBFBF')
  })

  it('falls back to the page background when nothing opaque is behind the text', () => {
    const { doc, root, add } = setup()
    doc.pages[0].background = '#000000'
    const f = add({ type: 'frame', style: { width: 10, height: 10 } }, root)
    const t = add({ type: 'text', text: 'x', style: { color: '#FFFFFF' } }, f.id)
    const r = textContrast(doc, t.id)
    expect(r.ok && r.results[0]).toMatchObject({ bg: '#000000', ratio: 21 })
  })

  it('says not computed for gradients, images, unreadable colours, hidden and non-text', () => {
    const { doc, root, add } = setup()
    const g = add({ type: 'frame', style: { width: 10, height: 10, backgroundImage: 'linear-gradient(#000, #fff)' } }, root)
    const t = add({ type: 'text', text: 'x', style: { color: '#fff' } }, g.id)
    expect(textContrast(doc, t.id)).toEqual({ ok: false, reason: 'the background is a gradient or an image' })
    const bad = add({ type: 'frame', style: { width: 10, height: 10, backgroundColor: 'notacolour' } }, root)
    const t2 = add({ type: 'text', text: 'x', style: { color: '#fff' } }, bad.id)
    expect(textContrast(doc, t2.id).ok).toBe(false)
    expect(textContrast(doc, bad.id)).toEqual({ ok: false, reason: 'not a text layer' })
    doc.nodes[t.id].visible = false
    expect(textContrast(doc, t.id)).toEqual({ ok: false, reason: 'hidden' })
  })

  it('oklch colours are read without a browser', () => {
    const { doc, root, add } = setup()
    const f = add({ type: 'frame', style: { width: 10, height: 10, backgroundColor: 'oklch(1 0 0)' } }, root)
    const t = add({ type: 'text', text: 'x', style: { color: 'oklch(0 0 0)' } }, f.id)
    const r = textContrast(doc, t.id)
    expect(r.ok && r.results[0].ratio).toBeGreaterThan(20)
  })
})
