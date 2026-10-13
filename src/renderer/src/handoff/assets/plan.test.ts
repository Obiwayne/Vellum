// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import * as ops from '../../model/ops'
import { setDev } from '../../model/dev'
import type { CNode } from '../../model/types'
import { buildHandoff } from '../index'
import { assertSafePaths } from '../paths'
import { planAssets } from './plan'
import { dataUrl, gif, jpeg, png, svgText, webp } from './testImages'

const CANARY_HIDDEN = 'CANARY_HIDDEN_IMAGE'
const CANARY_OTHER = 'CANARY_OTHER_PAGE_IMAGE'

function fixture() {
  const doc = ops.makeDoc('f', 'File')
  const page2 = ops.makePage(doc, 'Secret page')
  const root = doc.pages[0].rootId
  const add = (partial: Parameters<typeof ops.makeNode>[1], parent: string): CNode => {
    const n = ops.makeNode(doc, partial, false)
    ops.insertNode(doc, n, parent)
    return n
  }
  const screen = add({ type: 'frame', name: 'Home', style: { width: 800, height: 600 } }, root)
  setDev(doc, screen.id, { ready: { at: 1 } })
  const img = (name: string, bytes: Uint8Array, mime: string, w: number, h: number, parent = screen.id): CNode =>
    add({ type: 'image', name, attrs: { src: dataUrl(bytes, mime), alt: name }, style: { width: w, height: h } }, parent)
  return { doc, root, page2, screen, add, img }
}

const names = (plan: { records: Array<{ path: string }> }): string[] => plan.records.map((r) => r.path)

describe('images: densities and files', () => {
  it('keeps the original and adds @2x only where the pixels exist', async () => {
    const { doc, img } = fixture()
    img('Hero', png(1200, 600), 'image/png', 300, 150) // 4x of its box
    img('Thumb', jpeg(200, 100), 'image/jpeg', 100, 50) // exactly 2x
    img('Tiny', png(40, 20), 'image/png', 100, 50) // smaller than its box
    const plan = await planAssets(doc)
    expect(names(plan)).toEqual(['assets/images/home-hero.png', 'assets/images/home-thumb.jpg', 'assets/images/home-tiny.png'])
    const [hero, thumb, tiny] = plan.records
    expect(hero.maxDensity).toBe(4)
    expect(hero.variants?.map((v) => [v.path, v.density, v.width, v.height])).toEqual([
      ['assets/images/home-hero@2x.png', 2, 600, 300],
      ['assets/images/home-hero@3x.png', 3, 900, 450]
    ])
    expect(plan.jobs.map((j) => [j.path, j.width, j.height])).toEqual([
      ['assets/images/home-hero@2x.png', 600, 300],
      ['assets/images/home-hero@3x.png', 900, 450]
    ])
    // the 2x of an image that already has exactly 2x pixels is the original file
    expect(thumb.variants).toEqual([{ path: 'assets/images/home-thumb.jpg', density: 2, width: 200, height: 100 }])
    expect(plan.jobs.some((j) => j.path.includes('thumb'))).toBe(false)
    expect(tiny.maxDensity).toBe(0.4)
    expect(tiny.variants).toBeUndefined()
    expect(plan.warnings.join('\n')).toContain('do not scale it up')
    // original bytes untouched and present
    expect(plan.files['assets/images/home-hero.png']).toBeInstanceOf(Uint8Array)
    expect((plan.files['assets/images/home-hero.png'] as Uint8Array).length).toBe(png(1200, 600).length)
  })

  it('never resamples to a size above the original', async () => {
    const { doc, img } = fixture()
    img('A', png(500, 500), 'image/png', 100, 100)
    img('B', png(299, 299), 'image/png', 100, 100)
    const plan = await planAssets(doc)
    for (const j of plan.jobs) {
      const rec = plan.records.find((r) => r.variants?.some((v) => v.path === j.path))!
      expect(j.width).toBeLessThanOrEqual(rec.width!)
      expect(j.height).toBeLessThanOrEqual(rec.height!)
    }
  })

  it('the same bytes used twice are one file with both layers, sized for the larger use', async () => {
    const { doc, img } = fixture()
    const bytes = png(600, 300)
    const a = img('Logo', bytes, 'image/png', 100, 50)
    const b = img('Logo copy', bytes, 'image/png', 300, 150)
    const plan = await planAssets(doc)
    expect(plan.records).toHaveLength(1)
    expect(plan.records[0].nodeIds).toEqual([a.id, b.id])
    expect(plan.records[0].maxDensity).toBe(2)
    expect(Object.keys(plan.files).filter((p) => p.endsWith('.png'))).toHaveLength(1)
  })

  it('different bytes with the same layer name get -2, never overwrite', async () => {
    const { doc, img } = fixture()
    img('Photo', png(10, 10, { salt: 1 }), 'image/png', 10, 10)
    img('Photo', png(10, 10, { salt: 2 }), 'image/png', 10, 10)
    const plan = await planAssets(doc)
    expect(names(plan)).toEqual(['assets/images/home-photo.png', 'assets/images/home-photo-2.png'])
  })

  it('the real type wins over the declared one, and unknown bytes are skipped with a warning', async () => {
    const { doc, img } = fixture()
    img('Wrong', webp(64, 64), 'image/png', 64, 64)
    img('Junk', new TextEncoder().encode('<html>not an image</html>'), 'image/png', 10, 10)
    const plan = await planAssets(doc)
    expect(names(plan)).toEqual(['assets/images/home-wrong.webp'])
    expect(plan.warnings.join('\n')).toMatch(/says image\/png but is image\/webp/)
    expect(plan.warnings.join('\n')).toMatch(/"Junk" is not a PNG/)
  })

  it('animated files are exported as is and never resampled', async () => {
    const { doc, img } = fixture()
    img('Spinner', gif(400, 400, true), 'image/gif', 100, 100)
    const plan = await planAssets(doc)
    expect(plan.records[0].animated).toBe(true)
    expect(plan.jobs).toEqual([])
    expect(plan.records[0].variants).toBeUndefined()
  })

  it('a link is listed in the warnings and never fetched or bundled', async () => {
    const { doc, add, screen } = fixture()
    add({ type: 'image', name: 'Remote', attrs: { src: 'https://example.com/a.png' }, style: { width: 10, height: 10 } }, screen.id)
    const plan = await planAssets(doc)
    expect(plan.records).toEqual([])
    expect(plan.warnings[0]).toMatch(/is a link/)
  })

  it('a background-image fill is an image asset too, a gradient is not', async () => {
    const { doc, add, screen } = fixture()
    add({ type: 'frame', name: 'Banner', style: { width: 400, height: 100, backgroundImage: `url("${dataUrl(png(800, 200), 'image/png')}")` } }, screen.id)
    add({ type: 'frame', name: 'Grad', style: { width: 10, height: 10, backgroundImage: 'linear-gradient(red, blue)' } }, screen.id)
    const plan = await planAssets(doc)
    expect(names(plan)).toEqual(['assets/images/home-banner.png'])
    expect(plan.records[0].variants?.[0]).toMatchObject({ density: 2, width: 800 })
  })

  it('uses a measured rect over the authored size', async () => {
    const { doc, img } = fixture()
    const n = img('Fluid', png(600, 300), 'image/png', 100, 50)
    delete n.style.width
    const plan = await planAssets(doc, { measure: (id) => (id === n.id ? { x: 0, y: 0, width: 300, height: 150 } : null) })
    expect(plan.records[0].maxDensity).toBe(2)
  })
})

describe('icons', () => {
  it('an svg layer becomes an optimised icon, named after the picker name, recoloured when single colour', async () => {
    const { doc, add, screen } = fixture()
    add(
      { type: 'svg', name: 'Arrow', svg: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>', attrs: { viewBox: '0 0 24 24', fill: 'none', stroke: '#111111', 'stroke-width': '2', 'data-name': 'arrow-right' }, style: { width: 24, height: 24 } },
      screen.id
    )
    add({ type: 'svg', name: 'Logo', svg: '<rect width="10" height="10" fill="#ff0000"/><circle r="4" cx="5" cy="5" fill="#0000ff"/>', attrs: { viewBox: '0 0 10 10' }, style: { width: 40, height: 40 } }, screen.id)
    const plan = await planAssets(doc)
    expect(names(plan)).toEqual(['assets/icons/icon-arrow-right.svg', 'assets/icons/icon-logo.svg'])
    expect(plan.records[0]).toMatchObject({ kind: 'icon', recoloured: true, was: '#111111' })
    expect(plan.records[1]).toMatchObject({ kind: 'icon', multiColour: true })
    expect(plan.files['assets/icons/icon-arrow-right.svg']).toContain('currentColor')
    expect(plan.files['assets/icons/icon-logo.svg']).not.toContain('currentColor')
  })

  it('the same icon twice is one file', async () => {
    const { doc, add, screen } = fixture()
    const mk = (name: string): void => {
      add({ type: 'svg', name, svg: '<path d="M0 0h5v5H0z"/>', attrs: { viewBox: '0 0 5 5', fill: '#000' }, style: { width: 5, height: 5 } }, screen.id)
    }
    mk('Dot')
    mk('Dot again')
    const plan = await planAssets(doc)
    expect(plan.records).toHaveLength(1)
    expect(plan.records[0].nodeIds).toHaveLength(2)
  })

  it('an svg that is unsafe is skipped, not written', async () => {
    const { doc, add, screen } = fixture()
    add({ type: 'svg', name: 'Evil', svg: '<rect width="5" height="5" onclick="alert(1)"/><image href="https://evil/x.png"/>', attrs: { viewBox: '0 0 5 5' }, style: { width: 5, height: 5 } }, screen.id)
    const plan = await planAssets(doc)
    const all = JSON.stringify(plan.files)
    expect(all).not.toMatch(/onclick|evil/i)
  })
})

describe('scope and safety', () => {
  it('hidden layers, other pages and unchosen frames never produce an asset', async () => {
    const { doc, root, page2, screen, add, img } = fixture()
    img('Visible', png(20, 20, { salt: 1 }), 'image/png', 20, 20)
    const hidden = img(CANARY_HIDDEN, png(20, 20, { salt: 2 }), 'image/png', 20, 20)
    hidden.visible = false
    const group = add({ type: 'frame', name: 'Hidden group', style: { width: 50, height: 50 }, visible: false }, screen.id)
    img('Inside hidden', png(20, 20, { salt: 3 }), 'image/png', 20, 20, group.id)
    const other = add({ type: 'frame', name: 'Other', style: { width: 50, height: 50 } }, page2.rootId)
    img(CANARY_OTHER, png(20, 20, { salt: 4 }), 'image/png', 20, 20, other.id)
    const unchosen = add({ type: 'frame', name: 'Scratch', style: { width: 50, height: 50 } }, root)
    img('Scratch image', png(20, 20, { salt: 5 }), 'image/png', 20, 20, unchosen.id)
    const plan = await planAssets(doc)
    expect(names(plan)).toEqual(['assets/images/home-visible.png'])
    const dump = JSON.stringify(plan.records) + Object.keys(plan.files).join()
    for (const c of [CANARY_HIDDEN, CANARY_OTHER, 'Inside hidden', 'Scratch image']) expect(dump).not.toContain(c)
  })

  it('layer names that are hostile still make safe, unique paths', async () => {
    const { doc, img } = fixture()
    for (const [i, name] of ['../../evil', 'C:\\Windows\\x', 'CON', 'a'.repeat(300), '???', '/abs', 'x\n# y'].entries()) img(name, png(10 + i, 10), 'image/png', 10, 10)
    const plan = await planAssets(doc)
    expect(() => assertSafePaths(Object.keys(plan.files))).not.toThrow()
    for (const p of Object.keys(plan.files)) expect(p).toMatch(/^assets\/(images|icons)\/[a-z0-9-]+\.(png|svg)$/)
  })

  it('limits stop the plan and say so', async () => {
    const { doc, img } = fixture()
    for (let i = 0; i < 5; i++) img(`I${i}`, png(10, 10 + i), 'image/png', 10, 10)
    const plan = await planAssets(doc, { limits: { totalBytes: 1e9, files: 3 } })
    expect(plan.records).toHaveLength(3)
    expect(plan.warnings.filter((w) => w.includes('limit reached'))).toHaveLength(2)
  })

  it('is deterministic', async () => {
    const make = async (): Promise<string> => {
      const { doc, img, add, screen } = fixture()
      img('A', png(400, 200), 'image/png', 100, 50)
      add({ type: 'svg', name: 'I', svg: '<path d="M0 0h5v5z"/>', attrs: { viewBox: '0 0 5 5', fill: '#123' }, style: { width: 5, height: 5 } }, screen.id)
      const p = await planAssets(doc)
      return JSON.stringify([p.records, Object.entries(p.files).map(([k, v]) => [k, typeof v === 'string' ? v : [...v]]), p.jobs.map((j) => [j.path, j.width, j.height])])
    }
    expect(await make()).toBe(await make())
  })
})

describe('through the bundle', () => {
  it('records land in spec.json (valid paths), the markdown lists them, and nothing else changes', async () => {
    const { doc, img, add, screen } = fixture()
    img('Hero', png(1200, 600), 'image/png', 300, 150)
    add({ type: 'svg', name: 'Check', svg: '<path d="M0 0l5 5"/>', attrs: { viewBox: '0 0 5 5', stroke: '#222', fill: 'none' }, style: { width: 16, height: 16 } }, screen.id)
    const plan = await planAssets(doc)
    const base = { version: 1, exportedAt: '2026-10-13T12:00:00Z', vellum: '1.0.0', projectLabel: 'Acme' }
    const before = buildHandoff(doc, base)
    const r = buildHandoff(doc, { ...base, assets: plan.records, warnings: plan.warnings })
    const spec = JSON.parse(r.files['spec.json'])
    expect(spec.assets.map((a: { path: string }) => a.path)).toEqual(['assets/icons/icon-check.svg', 'assets/images/home-hero.png'])
    const md = r.files['screens/home.md']
    expect(md).toContain('assets/images/home-hero.png (layer "Hero"; also assets/images/home-hero@2x.png (2x), assets/images/home-hero@3x.png (3x); 1200 × 600 px)')
    expect(md).toContain('single colour: uses currentColor')
    expect(r.summary.assets).toBe(2)
    // text files that are not about assets are untouched
    expect(r.files['tokens/tokens.css']).toBe(before.files['tokens/tokens.css'])
    // every path the bundle and the assets will contain is safe and unique together
    const all = [...Object.keys(r.files), ...Object.keys(plan.files), ...plan.jobs.map((j) => j.path), ...JSON.parse(r.files['spec.json']).screens.flatMap((s: { breakpoints: Array<{ png: string }> }) => s.breakpoints.map((b) => b.png))]
    expect(() => assertSafePaths(all)).not.toThrow()
  })

  it('a canary in an asset name or layer name is escaped in the markdown', async () => {
    const { doc, img } = fixture()
    img('Bad [x](http://evil) `y`', png(10, 10), 'image/png', 10, 10)
    const plan = await planAssets(doc)
    const r = buildHandoff(doc, { version: 1, exportedAt: 'x', vellum: '1', projectLabel: 'A', assets: plan.records })
    const md = r.files['screens/home.md']
    expect(md).not.toMatch(/[^\\]\[x\]\(http/)
  })
})

describe('svg as an image layer', () => {
  it('an svg file used as an img is exported as is, without densities', async () => {
    const { doc, img } = fixture()
    img('Illustration', svgText(100, 50), 'image/svg+xml', 200, 100)
    const plan = await planAssets(doc)
    expect(plan.records[0]).toMatchObject({ path: 'assets/images/home-illustration.svg', mime: 'image/svg+xml' })
    expect(plan.records[0].variants).toBeUndefined()
    expect(plan.jobs).toEqual([])
  })
})
