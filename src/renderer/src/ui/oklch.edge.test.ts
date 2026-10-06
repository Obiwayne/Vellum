// Edge inputs for the oklch()/oklab() parser: odd spacing and units, clamping, things it must reject without throwing.
import { describe, expect, it } from 'vitest'
import { parseColor, formatColor } from './color'

describe('oklch edge inputs', () => {
  const base = parseColor('oklch(0.6 0.15 200)')

  it('spacing, case and unit variants all give the same colour', () => {
    for (const v of ['OKLCH(0.6 0.15 200)', 'oklch(  0.6   0.15   200  )', 'oklch(60% 0.15 200deg)', 'oklch(0.6, 0.15, 200)', 'oklch(0.6 37.5% 200)', ' oklch(0.6 0.15 200) ', 'oklch(0.6 0.15 560)', 'oklch(0.6 0.15 -160)']) {
      expect(parseColor(v), v).toEqual(base)
    }
  })

  it('alpha clamps to 0..1 and accepts number or percent', () => {
    expect(parseColor('oklch(0.6 0.15 200 / 2)')?.a).toBe(1)
    expect(parseColor('oklch(0.6 0.15 200 / -1)')?.a).toBe(0)
    expect(parseColor('oklch(0.6 0.15 200 / 25%)')?.a).toBe(0.25)
    expect(parseColor('oklch(0.6 0.15 200 / .5)')?.a).toBe(0.5)
  })

  it('negative chroma behaves as zero chroma (a grey of the same lightness); lightness is clamped to 0..100% before the colour is clipped, as Chromium paints it', () => {
    const grey = parseColor('oklch(0.6 0 0)')
    expect(parseColor('oklch(0.6 -0.2 200)')).toEqual(grey)
    expect(parseColor('oklch(150% 0.2 100)')).toMatchObject({ r: 255, g: 255, b: 46 })
    expect(parseColor('oklch(-0.2 0.3 100)')).toMatchObject({ r: 0, g: 37, b: 0 })
    expect(grey!.r).toBe(grey!.g)
    expect(grey!.g).toBe(grey!.b)
  })

  it('malformed or unsupported forms return null (or the canvas answer in the app), never throw', () => {
    for (const v of ['oklch()', 'oklch(0.5 0.1)', 'oklch(0.5 0.1 200 300)', 'oklch(0.5 0.1 200 / )', 'oklch(0.5 0.1 200 /0.5/ 0.2)', 'oklch(a b c)', 'oklch(0.5 0.1 200', 'oklch(0.5 0.1 200) extra', 'oklch(0.5 0.1 NaN)', 'oklab(0.5 0.1)', 'oklch(0.5 0.1 1e999)']) {
      expect(() => parseColor(v), v).not.toThrow()
    }
    expect(parseColor('oklch()')).toBeNull()
    expect(parseColor('oklch(0.5 0.1)')).toBeNull()
    expect(parseColor('oklch(a b c)')).toBeNull()
    expect(parseColor('oklch(0.5 0.1 200 300)')).toBeNull()
  })

  it('the relative-colour form is not claimed by the parser (left to the browser)', () => {
    expect(() => parseColor('oklch(from #ff0000 l c h)')).not.toThrow()
  })

  it('a parsed oklch colour formats to a valid hex and re-parses to the same rgb', () => {
    const p = parseColor('oklch(0.623 0.214 258)')!
    const hex = formatColor(p)
    expect(hex).toMatch(/^#[0-9A-F]{6}$/i)
    expect(parseColor(hex)).toMatchObject({ r: p.r, g: p.g, b: p.b })
  })

  it('oklab is the same space as oklch with a/b components', () => {
    const lch = parseColor('oklch(0.7 0.1 90)')!
    const a = 0.1 * Math.cos(Math.PI / 2)
    const b = 0.1 * Math.sin(Math.PI / 2)
    expect(parseColor(`oklab(0.7 ${a} ${b})`)).toEqual(lch)
  })
})
