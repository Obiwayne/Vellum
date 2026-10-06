// parseColor(oklch/oklab) against what the app's Chromium paints for the same strings: oklch-chromium.fixture.json holds the
// canvas pixel of 154 colours (the starter palette, a grid of lightness/chroma/hue including colours outside sRGB, units,
// oklab and alpha), dumped from the built app. A swatch or hex shown in a picker must be the colour the layer is drawn with.
import { describe, expect, it } from 'vitest'
import { parseColor } from './color'
import fixture from './oklch-chromium.fixture.json'

type Row = { value: string; rgba: [number, number, number, number] }
const rows = fixture as Row[]
const diff = (a: number[], b: number[]): number => Math.max(...a.map((v, i) => Math.abs(v - b[i])))

describe('parseColor oklch/oklab vs Chromium', () => {
  const stats = rows.map((r) => {
    const p = parseColor(r.value)
    const mine = p ? [p.r, p.g, p.b] : [NaN, NaN, NaN]
    return { value: r.value, mine, chrome: r.rgba.slice(0, 3), alphaMine: p ? Math.round(p.a * 255) : NaN, alphaChrome: r.rgba[3], d: p ? diff(mine, r.rgba.slice(0, 3)) : 999 }
  })

  it('every sample parses', () => {
    expect(stats.filter((s) => Number.isNaN(s.mine[0])).map((s) => s.value)).toEqual([])
  })

  it('the starter theme palette matches the colour Chromium paints, to within 1 per channel (blue-500 is 29,129,255)', () => {
    const starter = stats.slice(0, 22)
    expect(starter.length).toBe(22)
    expect(starter.filter((s) => s.d > 1).map((s) => `${s.value} mine=${s.mine} chrome=${s.chrome}`)).toEqual([])
    expect(parseColor('oklch(62.3% 0.214 258)')).toMatchObject({ r: 29, g: 129, b: 255 })
  })

  it('every sample, including colours outside sRGB, matches Chromium to within 1 (2 where alpha rounding enters)', () => {
    const bad = stats.filter((s) => s.d > (s.alphaChrome < 255 ? 2 : 1))
    expect(bad.map((s) => `${s.value} mine=${s.mine} chrome=${s.chrome}`)).toEqual([])
  })

  it('alpha matches Chromium', () => {
    const bad = stats.filter((s) => Math.abs(s.alphaMine - s.alphaChrome) > 1 && s.alphaChrome !== 0)
    expect(bad.map((s) => `${s.value} ${s.alphaMine} vs ${s.alphaChrome}`)).toEqual([])
  })
})
