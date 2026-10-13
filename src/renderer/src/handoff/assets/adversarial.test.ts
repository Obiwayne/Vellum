// @vitest-environment jsdom
// T64 test station: cases the build station's tests do not cover (hostile SVG files used as images, implicit
// colours, svgo side effects, accounting, determinism, no network, fonts.md through the bundle).
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as ops from '../../model/ops'
import { setDev } from '../../model/dev'
import type { CNode } from '../../model/types'
import { buildHandoff } from '../index'
import { planAssets } from './plan'
import { optimiseSvg, unsafeSvg } from './svgIcon'
import { fontSourceFor } from './fonts'
import { dataUrl, png } from './testImages'

function fixture() {
  const doc = ops.makeDoc('f', 'File')
  const root = doc.pages[0].rootId
  const add = (partial: Parameters<typeof ops.makeNode>[1], parent: string): CNode => {
    const n = ops.makeNode(doc, partial, false)
    ops.insertNode(doc, n, parent)
    return n
  }
  const screen = add({ type: 'frame', name: 'Home', style: { width: 800, height: 600 } }, root)
  setDev(doc, screen.id, { ready: { at: 1 } })
  return { doc, root, screen, add }
}

const enc = (s: string): Uint8Array => new TextEncoder().encode(s)
const text = (v: string | Uint8Array | undefined): string => (typeof v === 'string' ? v : v ? new TextDecoder().decode(v) : '')

afterEach(() => vi.restoreAllMocks())

describe('hostile SVG files used as image layers', () => {
  it('an svg image with a script, a handler or an external reference is not written as is', async () => {
    const { doc, screen, add } = fixture()
    const evil =
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" onload="alert(1)"><script>alert(2)</script>' +
      '<image href="https://evil.example/x.png"/><rect width="10" height="10"/></svg>'
    add({ type: 'image', name: 'Evil', attrs: { src: dataUrl(enc(evil), 'image/svg+xml') }, style: { width: 10, height: 10 } }, screen.id)
    const plan = await planAssets(doc)
    for (const [path, content] of Object.entries(plan.files)) {
      expect(unsafeSvg(text(content)), `${path} would be written with: ${text(content).slice(0, 80)}`).toBeNull()
    }
  })
})

describe('icons: colours that are not written down', () => {
  it('a path with no paint (black by default) next to a red one is two colours, not one', () => {
    const r = optimiseSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h10v10z"/><path fill="#f00" d="M12 12h10v10z"/></svg>')!
    // recolouring would turn only the red path into currentColor and leave the other black
    expect(r.recoloured).toBe(false)
  })

  it('the title is kept for accessibility and the viewBox survives', () => {
    const r = optimiseSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><title>Close</title><path stroke="#000" d="M0 0L24 24"/></svg>')!
    expect(r.svg).toContain('viewBox="0 0 24 24"')
    expect(r.svg).toContain('<title>Close</title>')
  })

  it('stroke and fill of one colour become currentColor together; fill none stays none', () => {
    const r = optimiseSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="none" stroke="#111" d="M0 0h24"/><circle fill="#111" cx="5" cy="5" r="2"/></svg>')!
    expect(r.recoloured).toBe(true)
    expect(r.svg).toContain('stroke="currentColor"')
    expect(r.svg).toContain('fill="currentColor"')
    expect(r.svg).toContain('fill="none"')
  })
})

describe('more icon colours', () => {
  const svg = (inner: string, root = ''): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${root}>${inner}</svg>`

  it('a root fill is inherited: one colour on the root and plain children recolours', () => {
    const r = optimiseSvg(svg('<path d="M0 0h10v10z"/><circle cx="5" cy="5" r="2"/>', 'fill="#123456"'))!
    expect(r.recoloured).toBe(true)
    expect(r.was).toBe('#123456')
  })

  it('a group fill is inherited by its children; a sibling outside it is black by default', () => {
    const r = optimiseSvg(svg('<g fill="#f00"><path d="M0 0h5v5z"/></g><path d="M10 10h5v5z"/>'))!
    expect(r.recoloured).toBe(false)
    expect(r.multiColour).toBe(true)
  })

  it('shapes inside defs or clipPath are not painted where they are written', () => {
    const r = optimiseSvg(svg('<defs><clipPath id="c"><rect width="9" height="9"/></clipPath></defs><path clip-path="url(#c)" fill="#0a0" d="M0 0h20v20z"/>'))!
    expect(r.multiColour).toBe(false)
  })

  it('a <use> is not guessed at', () => {
    const r = optimiseSvg(svg('<defs><path id="p" fill="#f00" d="M0 0h5v5z"/></defs><use href="#p"/>'))!
    expect(r.recoloured).toBe(false)
  })

  it('inline style paints count like attributes', () => {
    const r = optimiseSvg(svg('<path style="fill:#f00" d="M0 0h5v5z"/><path style="fill:#00f" d="M9 9h5v5z"/>'))!
    expect(r.multiColour).toBe(true)
  })

  it('an unpainted-only icon stays as it is and is not called multi-colour', () => {
    const r = optimiseSvg(svg('<path d="M0 0h5v5z"/>'))!
    expect(r.recoloured).toBe(false)
    expect(r.multiColour).toBe(false)
  })
})

describe('safe SVG image layers', () => {
  it('keep their colours (no currentColor), lose scripts, and de-dup by the written bytes', async () => {
    const { doc, screen, add } = fixture()
    const body = (extra: string): string => `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">${extra}<rect width="20" height="20" fill="#336698"/></svg>`
    add({ type: 'image', name: 'A', attrs: { src: dataUrl(enc(body('')), 'image/svg+xml') }, style: { width: 20, height: 20 } }, screen.id)
    add({ type: 'image', name: 'B', attrs: { src: dataUrl(enc(body('<script>alert(1)</script>')), 'image/svg+xml') }, style: { width: 20, height: 20 } }, screen.id)
    const plan = await planAssets(doc)
    const files = Object.entries(plan.files)
    expect(files).toHaveLength(1) // the script was removed, so both are the same file
    expect(text(files[0][1])).toContain('#336698')
    expect(text(files[0][1])).not.toContain('currentColor')
    expect(unsafeSvg(text(files[0][1]))).toBeNull()
    expect(plan.records[0].nodeIds).toHaveLength(2)
  })

  it('an SVG with an external reference is skipped with a warning, not written', async () => {
    const { doc, screen, add } = fixture()
    const evil = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><image href="https://evil.example/x.png" width="10" height="10"/></svg>'
    add({ type: 'image', name: 'Tracker', attrs: { src: dataUrl(enc(evil), 'image/svg+xml') }, style: { width: 10, height: 10 } }, screen.id)
    const plan = await planAssets(doc)
    expect(plan.files).toEqual({})
    expect(plan.records).toEqual([])
    expect(plan.warnings.join(' ')).toMatch(/Tracker.*SVG/)
  })
})

describe('external records', () => {
  it('the same URL used twice is one record with both layers, and the markdown shows it as a link', async () => {
    const { doc, screen, add } = fixture()
    for (const name of ['One', 'Two']) add({ type: 'image', name, attrs: { src: 'https://example.com/a.png' }, style: { width: 10, height: 10 } }, screen.id)
    const plan = await planAssets(doc)
    expect(plan.records).toHaveLength(1)
    expect(plan.records[0].nodeIds).toHaveLength(2)
    const r = buildHandoff(doc, { frames: [screen.id], version: 1, exportedAt: '2026-01-01T00:00:00.000Z', vellum: '1.0.0', assets: plan.records, warnings: plan.warnings })
    expect(JSON.stringify(r.files)).toContain('linked image, not bundled')
  })
})

describe('accounting and limits', () => {
  it('resampled files count against the file limit and never push the plan over it', async () => {
    const { doc, screen, add } = fixture()
    for (let i = 0; i < 5; i++) add({ type: 'image', name: `Photo ${i}`, attrs: { src: dataUrl(png(1000, 1000, { salt: i }), 'image/png') }, style: { width: 100, height: 100 } }, screen.id)
    const plan = await planAssets(doc, { limits: { totalBytes: 1e9, files: 8 } })
    const written = Object.keys(plan.files).length + plan.jobs.length
    expect(written).toBeLessThanOrEqual(8)
    expect(plan.warnings.join('\n')).toMatch(/limit/i)
  })

  it('every variant path exists as a file or a job, and every record path is a file', async () => {
    const { doc, screen, add } = fixture()
    add({ type: 'image', name: 'Hero', attrs: { src: dataUrl(png(1200, 800), 'image/png') }, style: { width: 400, height: 267 } }, screen.id)
    const plan = await planAssets(doc)
    const produced = new Set([...Object.keys(plan.files), ...plan.jobs.map((j) => j.path)])
    for (const r of plan.records) {
      expect(produced.has(r.path), r.path).toBe(true)
      for (const v of r.variants ?? []) expect(produced.has(v.path), v.path).toBe(true)
    }
  })

  it('a record id is stable and unique per content', async () => {
    const { doc, screen, add } = fixture()
    add({ type: 'image', name: 'A', attrs: { src: dataUrl(png(50, 50, { salt: 1 }), 'image/png') }, style: { width: 50, height: 50 } }, screen.id)
    add({ type: 'image', name: 'B', attrs: { src: dataUrl(png(50, 50, { salt: 2 }), 'image/png') }, style: { width: 50, height: 50 } }, screen.id)
    const a = await planAssets(doc)
    const b = await planAssets(doc)
    expect(new Set(a.records.map((r) => r.id)).size).toBe(2)
    expect(a.records.map((r) => r.id)).toEqual(b.records.map((r) => r.id))
  })
})

describe('no network', () => {
  it('planning an image that is a link never calls fetch, XHR or an <img>', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const { doc, screen, add } = fixture()
    add({ type: 'image', name: 'Remote', attrs: { src: 'https://example.com/a.png' }, style: { width: 10, height: 10 } }, screen.id)
    add({ type: 'image', name: 'Proto relative', attrs: { src: '//example.com/b.png' }, style: { width: 10, height: 10 } }, screen.id)
    add({ type: 'rect', name: 'Bg', style: { width: 10, height: 10, backgroundImage: 'url(https://example.com/c.png)' } }, screen.id)
    const plan = await planAssets(doc)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(plan.records.every((r) => r.source === 'external')).toBe(true)
    expect(plan.records.map((r) => r.url).sort()).toEqual(['//example.com/b.png', 'https://example.com/a.png', 'https://example.com/c.png'])
    expect(plan.files).toEqual({})
    expect(plan.warnings.length).toBeGreaterThanOrEqual(2)
    vi.unstubAllGlobals()
  })

  it('a link is listed in spec.json as external, as the plan says', async () => {
    const { doc, screen, add } = fixture()
    add({ type: 'image', name: 'Remote', attrs: { src: 'https://example.com/a.png' }, style: { width: 10, height: 10 } }, screen.id)
    const plan = await planAssets(doc)
    expect(plan.records.some((r) => r.source === 'external' && r.url === 'https://example.com/a.png')).toBe(true)
  })
})

describe('fonts.md through the bundle', () => {
  it('lists family, weights and the licence line by source; no font file is in the plan', async () => {
    const { doc, screen, add } = fixture()
    add({ type: 'text', name: 'T1', text: 'Hello', style: { fontFamily: 'Inter', fontWeight: 600, fontSize: 16 } }, screen.id)
    add({ type: 'text', name: 'T2', text: 'World', style: { fontFamily: '"Segoe UI"', fontWeight: 400, fontSize: 16 } }, screen.id)
    add({ type: 'text', name: 'T3', text: 'Mono', style: { fontFamily: 'ui-monospace', fontWeight: 400, fontSize: 16 } }, screen.id)
    const fontSource = fontSourceFor({ google: ['Inter'], local: ['Segoe UI'] })
    const plan = await planAssets(doc)
    const r = buildHandoff(doc, { frames: [screen.id], version: 1, exportedAt: '2026-01-01T00:00:00.000Z', vellum: '1.0.0', assets: plan.records, fontSource })
    const fonts = r.files['fonts.md']
    expect(fonts).toBeDefined()
    expect(fonts).toMatch(/Inter/)
    expect(fonts).toMatch(/600/)
    expect(fonts).toMatch(/google/i)
    expect(fonts).toMatch(/Segoe UI/)
    expect(fonts).toMatch(/not bundled|not redistributable|license/i)
    expect(Object.keys(plan.files).some((p) => /\.(woff2?|ttf|otf)$/i.test(p))).toBe(false)
  })

  it('fontSourceFor handles quotes, case and unknown families', () => {
    const f = fontSourceFor({ google: ['Inter'], local: ['Calibri'] })
    expect(f('"inter"')).toBe('google')
    expect(f("'CALIBRI'")).toBe('local')
    expect(f('SF Pro')).toBe('unknown')
    expect(f('sans-serif')).toBe('system')
    expect(f('')).toBe('unknown')
  })
})
