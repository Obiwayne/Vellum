import { describe, expect, it } from 'vitest'
import { dataUrlToBytes, sha256Hex, sniff } from './bytes'
import { densities, targetSize } from './density'
import { dataUrl, gif, jpeg, png, svgText, u8, webp } from './testImages'

describe('dataUrlToBytes', () => {
  it('reads base64 and percent-encoded payloads and the declared type', () => {
    const p = png(2, 2)
    const r = dataUrlToBytes(dataUrl(p, 'image/png'))!
    expect(r.mime).toBe('image/png')
    expect([...r.bytes]).toEqual([...p])
    expect(new TextDecoder().decode(dataUrlToBytes('data:image/svg+xml;utf8,%3Csvg%2F%3E')!.bytes)).toBe('<svg/>')
  })
  it('refuses what is not a data URL or is broken', () => {
    for (const bad of ['', 'http://x/y.png', 'data:image/png;base64,@@@@', 'data:image/png', 'javascript:alert(1)']) expect(dataUrlToBytes(bad), bad).toBeNull()
  })
})

describe('sniff', () => {
  it.each([
    ['png', png(120, 60), 'image/png', 'png', 120, 60],
    ['jpeg', jpeg(300, 200), 'image/jpeg', 'jpg', 300, 200],
    ['gif', gif(16, 9), 'image/gif', 'gif', 16, 9],
    ['webp', webp(640, 480), 'image/webp', 'webp', 640, 480],
    ['svg', svgText(24, 12), 'image/svg+xml', 'svg', 24, 12]
  ] as const)('%s: type and size from the header', (_n, bytes, mime, ext, w, h) => {
    expect(sniff(bytes)).toMatchObject({ mime, ext, width: w, height: h, animated: false })
  })
  it('flags animated PNG and GIF', () => {
    expect(sniff(png(10, 10, { animated: true }))?.animated).toBe(true)
    expect(sniff(gif(10, 10, true))?.animated).toBe(true)
  })
  it('svg size falls back to the viewBox and is 0 when there is none', () => {
    const vb = new TextEncoder().encode('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 32"></svg>')
    expect(sniff(vb)).toMatchObject({ width: 48, height: 32 })
    expect(sniff(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toMatchObject({ width: 0, height: 0 })
  })
  it('returns null for everything else: html, text, truncated and empty files', () => {
    const html = new TextEncoder().encode('<html><body>hi</body></html>')
    for (const b of [html, u8(), u8(1, 2, 3), png(5, 5).subarray(0, 12), jpeg(5, 5).subarray(0, 6), new TextEncoder().encode('just text')]) expect(sniff(b)).toBeNull()
  })
  it('a PNG with a zero size is not an image', () => {
    expect(sniff(png(0, 10))).toBeNull()
  })
})

describe('sha256Hex', () => {
  it('matches the known vector for "abc" and differs by one byte', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(await sha256Hex(png(2, 2, { salt: 1 }))).not.toBe(await sha256Hex(png(2, 2, { salt: 2 })))
  })
})

describe('densities', () => {
  it.each([
    [100, 50, 100, 50, [1], 1],
    [100, 50, 200, 100, [1, 2], 2],
    [100, 50, 250, 125, [1, 2], 2.5],
    [100, 50, 300, 150, [1, 2, 3], 3],
    [100, 50, 1200, 600, [1, 2, 3], 12],
    [100, 50, 50, 25, [1], 0.5],
    [100, 50, 400, 60, [1], 1.2], // the short axis limits it
    [100, 50, 199.6, 99.8, [1, 2], 2]
  ])('box %i x %i with %i x %i pixels', (lw, lh, nw, nh, list, max) => {
    const d = densities(lw, lh, nw, nh)
    expect(d.list).toEqual(list)
    expect(d.maxDensity).toBe(max)
  })
  it('unknown sizes give the original only', () => {
    for (const a of [[0, 10, 100, 100], [10, 10, 0, 0], [NaN, 10, 100, 100], [-5, 10, 100, 100], [10, 10, Infinity, 5]] as Array<[number, number, number, number]>) {
      expect(densities(a[0], a[1], a[2], a[3])).toEqual({ list: [1], maxDensity: 1 })
    }
  })
  it('target sizes are whole pixels and at least 1', () => {
    expect(targetSize(100.4, 50.5, 2)).toEqual({ width: 201, height: 101 })
    expect(targetSize(0.1, 0.1, 2)).toEqual({ width: 1, height: 1 })
  })
})
