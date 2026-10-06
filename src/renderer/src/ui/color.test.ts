// T38: oklch() colours (the whole starter theme uses them) must parse, so pickers can list and preview them.
import { describe, expect, it } from 'vitest'
import { parseColor } from './color'

describe('parseColor with oklch()', () => {
  it('reads oklch() without needing a browser canvas', () => {
    const c = parseColor('oklch(62.3% 0.214 258)')
    expect(c).not.toBeNull()
    // a saturated blue: blue channel dominant, fully opaque
    expect(c!.b).toBeGreaterThan(c!.r)
    expect(c!.b).toBeGreaterThan(c!.g)
    expect(c!.a).toBe(1)
  })
})

import { STARTER_THEME } from '../editor/left/starterTheme'
import { formatColor } from './color'

const hex = (s: string): string | null => {
  const c = parseColor(s)
  return c ? formatColor(c) : null
}
// reference values: the CSS Color 4 definitions of sRGB red / white / black / Tailwind's neutral-500
describe('oklch() / oklab() values', () => {
  it('matches known sRGB colours', () => {
    expect(hex('oklch(1 0 0)')).toBe('#FFFFFF')
    expect(hex('oklch(0 0 0)')).toBe('#000000')
    expect(hex('oklch(100% 0 0)')).toBe('#FFFFFF')
    expect(hex('oklch(0.628 0.2577 29.23)')).toBe('#FF0000') // sRGB red
    expect(hex('oklab(0.628 0.2249 0.1258)')).toBe('#FF0000')
    expect(hex('oklch(55.6% 0 0)')).toBe('#737373') // Tailwind neutral-500
    expect(hex('oklch(0.452 0.313 264.05)')).toBe('#0000FF') // sRGB blue
  })

  it('reads alpha (number, percent) and none components', () => {
    expect(parseColor('oklch(0.7 0.1 200 / 0.5)')!.a).toBe(0.5)
    expect(parseColor('oklch(0.7 0.1 200 / 25%)')!.a).toBe(0.25)
    expect(parseColor('oklch(0.7 0.1 200)')!.a).toBe(1)
    expect(parseColor('oklch(0.7 0.1 200 / 3)')!.a).toBe(1) // clamped
    expect(hex('oklch(none none none)')).toBe('#000000')
    expect(hex('oklch(1 none none)')).toBe('#FFFFFF')
  })

  it('reads hue units, commas, case and extra spaces', () => {
    const deg = hex('oklch(0.7 0.1 180)')
    expect(hex('oklch(0.7 0.1 180deg)')).toBe(deg)
    expect(hex('oklch(0.7 0.1 0.5turn)')).toBe(deg)
    expect(hex('oklch(0.7 0.1 3.14159265rad)')).toBe(deg)
    expect(hex('oklch(0.7 0.1 200grad)')).toBe(deg)
    expect(hex('  OKLCH( 0.7,  0.1,  180 )  ')).toBe(deg)
    expect(hex('oklch(70% 25% 180)')).toBe(hex('oklch(0.7 0.1 180)')) // 25% chroma = 0.1
  })

  it('an out-of-gamut colour is clipped per channel, like the browser paints it (see oklch.chromium.test.ts for the reference data)', () => {
    const c = parseColor('oklch(0.7 0.4 150)')!
    expect(c.g).toBeGreaterThan(c.r)
    expect(c.g).toBeGreaterThan(c.b)
    for (const v of [c.r, c.g, c.b]) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(255)
    }
    // it sits on the sRGB edge (a channel at 0 or 255), and a colour that already fits is untouched
    expect([c.r, c.g, c.b].some((v) => v === 0 || v === 255)).toBe(true)
    expect(hex('oklch(0.7 0.1 150)')).toBe(formatColor(parseColor('oklch(0.7 0.1 150)')!))
    const mild = parseColor('oklch(0.7 0.1 150)')!
    expect(mild.r).toBeGreaterThan(0)
    expect(mild.g).toBeLessThan(255)
    // the starter theme's blue-500 is slightly outside sRGB: its blue channel clips at 255
    expect(parseColor('oklch(62.3% 0.214 258)')).toMatchObject({ r: 29, g: 129, b: 255 })
    // extreme lightness is clamped, never NaN
    expect(hex('oklch(1.5 0.3 100)')).toBe('#FFFD00') // Chromium: lightness is clamped to 100%, then the colour is clipped
    expect(hex('oklch(-0.2 0.3 100)')).toBe('#002500')
  })

  it('rejects malformed values (null, no exception)', () => {
    for (const bad of ['oklch()', 'oklch(1 0)', 'oklch(1 0 0 0)', 'oklch(a b c)', 'oklch(1 0 0 / )', 'oklch(1 0 0 / 1 / 1)', 'oklch(1 0 0', 'oklab(1 0)', 'oklch(1 0 0deg deg)']) {
      expect(parseColor(bad)).toBeNull()
    }
  })

  it('every colour of the starter theme parses, light to dark in a sane order for the grays', () => {
    const colors = STARTER_THEME.filter((t) => t.value.startsWith('oklch'))
    expect(colors.length).toBeGreaterThan(15)
    for (const t of colors) expect(parseColor(t.value), `${t.name} = ${t.value}`).not.toBeNull()
    const gray = (n: number): number => parseColor(STARTER_THEME.find((t) => t.name === `--color-gray-${n}`)!.value)!.r
    expect(gray(50)).toBeGreaterThan(gray(500))
    expect(gray(500)).toBeGreaterThan(gray(900))
  })
})
