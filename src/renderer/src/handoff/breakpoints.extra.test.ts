// T71 test station: a three-breakpoint screen, no false positives, PNG per breakpoint, ordering and naming edge cases.
import { describe, expect, it } from 'vitest'
import * as ops from '../model/ops'
import { setDev } from '../model/dev'
import type { CNode, WorldRect } from '../model/types'
import { buildHandoff } from './index'
import { planScreenPngs } from './assets'

const OPTS = { version: 1, exportedAt: '2026-01-01T00:00:00.000Z', vellum: '1.0.0', projectLabel: 'Acme' }

function setup() {
  const doc = ops.makeDoc('d', 'File')
  const root = doc.pages[0].rootId
  const add = (partial: Parameters<typeof ops.makeNode>[1], parent: string): CNode => {
    const n = ops.makeNode(doc, partial, false)
    ops.insertNode(doc, n, parent)
    return n
  }
  /** a header + hero + footer page at one breakpoint; `over` changes things on purpose */
  const page = (bp: string, width: number, over: { dir?: 'row' | 'column'; gap?: number; title?: string; noFooter?: boolean; heroSize?: number; hideHero?: boolean } = {}, name = 'Home') => {
    const f = add({ type: 'frame', name: `${name} ${bp}`, x: 0, y: 0, style: { width, height: 600, display: 'flex', flexDirection: over.dir ?? 'row', gap: over.gap ?? 24, padding: 24, backgroundColor: '#FFFFFF' } }, root)
    const header = add({ type: 'frame', name: 'Header', style: { display: 'flex', width: '100%', height: 56, padding: 8, backgroundColor: '#111111' } }, f.id)
    add({ type: 'text', name: 'Logo', text: 'Acme', style: { fontSize: 18, fontWeight: 700, color: '#FFFFFF' } }, header.id)
    const hero = add({ type: 'frame', name: 'Hero', style: { width: '100%', height: over.heroSize ?? 240, backgroundColor: '#EEEEEE' } }, f.id)
    add({ type: 'text', name: 'Title', text: over.title ?? 'Welcome', style: { fontSize: 32, fontWeight: 700, color: '#111111' } }, hero.id)
    if (over.hideHero) hero.visible = false
    if (!over.noFooter) add({ type: 'frame', name: 'Footer', style: { width: '100%', height: 40, backgroundColor: '#DDDDDD' } }, f.id)
    setDev(doc, f.id, { screen: { name: 'Home', bp }, ready: { at: 1 } })
    return f
  }
  return { doc, root, add, page }
}

describe('three breakpoints', () => {
  it('lists exactly the intended changes and nothing else, per breakpoint', () => {
    const { doc, page } = setup()
    const desktop = page('Desktop', 1280)
    const tablet = page('Tablet', 768, { gap: 16 })
    const mobile = page('Mobile', 390, { dir: 'column', title: 'Hi', noFooter: true })
    const r = buildHandoff(doc, { frames: [desktop.id, tablet.id, mobile.id], ...OPTS })
    const spec = JSON.parse(r.files['spec.json'])
    expect(spec.screens).toHaveLength(1)
    const bps = spec.screens[0].breakpoints as Array<{ bp: string; delta?: { base: string; changes: Array<{ path: string; changes: Array<{ property: string }> }>; notHere: string[]; onlyHere: string[]; hiddenHere: string[] } }>
    expect(bps.map((b) => b.bp)).toEqual(['Desktop', 'Tablet', 'Mobile'])
    expect(bps[0].delta).toBeUndefined()
    // tablet: only the gap of the frame changed (layout summary), nothing is added or removed
    expect(bps[1].delta?.base).toBe('Desktop')
    expect(bps[1].delta?.changes.map((c) => [c.path, c.changes.map((p) => p.property)])).toEqual([['', ['layout']]])
    expect(bps[1].delta?.notHere).toEqual([])
    expect(bps[1].delta?.onlyHere).toEqual([])
    // mobile: direction (frame), the title text, no footer
    expect(bps[2].delta?.changes.map((c) => c.path).sort()).toEqual(['', 'Hero › Title'])
    expect(bps[2].delta?.changes.find((c) => c.path === 'Hero › Title')?.changes.map((p) => p.property)).toEqual(['text'])
    expect(bps[2].delta?.notHere).toEqual(['Footer'])
  })

  it('three identical breakpoints at different widths have empty deltas (no false positives)', () => {
    const { doc, page } = setup()
    const ids = [page('Desktop', 1280).id, page('Tablet', 768).id, page('Mobile', 390).id]
    const r = buildHandoff(doc, { frames: ids, ...OPTS })
    const bps = JSON.parse(r.files['spec.json']).screens[0].breakpoints as Array<{ delta?: { changes: unknown[]; notHere: unknown[]; onlyHere: unknown[]; hiddenHere: unknown[] } }>
    for (const b of bps.slice(1)) {
      expect(b.delta?.changes).toEqual([])
      expect(b.delta?.notHere).toEqual([])
      expect(b.delta?.onlyHere).toEqual([])
      expect(b.delta?.hiddenHere).toEqual([])
    }
  })

  it('measured sizes that differ because the layout is fluid are not reported', () => {
    const { doc, page } = setup()
    const d = page('Desktop', 1280)
    const m = page('Mobile', 390)
    const rects = (frame: CNode, w: number) => (id: string): WorldRect | null => {
      // every layer fills the frame width at its breakpoint
      const n = doc.nodes[id]
      if (!n) return null
      return { x: 0, y: 0, width: id === frame.id ? w : w - 48, height: 100 }
    }
    const measure = (id: string): WorldRect | null => (ops.topLevelOf(doc, id) === d.id ? rects(d, 1280)(id) : rects(m, 390)(id))
    const r = buildHandoff(doc, { frames: [d.id, m.id], measure, ...OPTS })
    const delta = JSON.parse(r.files['spec.json']).screens[0].breakpoints[1].delta
    expect(delta.changes).toEqual([])
  })

  it('a layer hidden at one breakpoint is "hidden", a removed one is "not here"', () => {
    const { doc, page } = setup()
    const d = page('Desktop', 1280)
    const m = page('Mobile', 390, { hideHero: true, noFooter: true })
    const r = buildHandoff(doc, { frames: [d.id, m.id], ...OPTS })
    const md = r.files['screens/home.md']
    // the hidden Hero never reaches the bundle; Footer was never drawn on mobile
    expect(md).toMatch(/Not at Mobile[^\n]*Footer/)
    expect(JSON.stringify(JSON.parse(r.files['spec.json']))).not.toContain('"hiddenHere":["Header"')
  })

  it('writes one PNG per breakpoint with distinct names, including a custom width', () => {
    const { doc, page } = setup()
    const d = page('Desktop', 1280)
    const t = page('Tablet', 768)
    const c = page('1024 wide', 1024)
    const m = page('Mobile', 390)
    const r = buildHandoff(doc, { frames: [m.id, c.id, d.id, t.id], ...OPTS })
    const pngs = planScreenPngs(r.files['spec.json']).map((j) => j.path)
    expect(pngs).toHaveLength(4)
    expect(new Set(pngs).size).toBe(4)
    for (const p of pngs) expect(p).toMatch(/^screens\/home\.[a-z0-9-]+\.png$/)
    // widest first, whatever order the frames were given in
    const order = JSON.parse(r.files['spec.json']).screens[0].breakpoints.map((b: { width: number }) => b.width)
    expect(order).toEqual([1280, 1024, 768, 390])
    // every PNG path is referenced from the markdown
    for (const p of pngs) expect(r.files['screens/home.md']).toContain(p)
  })

  it('output does not depend on the order frames are listed or created', () => {
    const a = setup()
    const ids1 = [a.page('Desktop', 1280).id, a.page('Mobile', 390, { dir: 'column' }).id]
    const b = setup()
    const m = b.page('Mobile', 390, { dir: 'column' })
    const d = b.page('Desktop', 1280)
    const r1 = buildHandoff(a.doc, { frames: ids1, ...OPTS })
    const r2 = buildHandoff(b.doc, { frames: [m.id, d.id], ...OPTS })
    const strip = (t: string): string => t.replace(/"id": "[^"]+"/g, '"id": "x"').replace(/`\d+-\d+`/g, '`x`').replace(/"(frameId|ref)": "[^"]+"/g, '"$1": "x"')
    expect(strip(r1.files['screens/home.md'])).toBe(strip(r2.files['screens/home.md']))
  })
})

describe('naming and matching', () => {
  it('the same layer name at two nesting levels is matched by path, not by name alone', () => {
    const { doc, page, add } = setup()
    const d = page('Desktop', 1280)
    const m = page('Mobile', 390)
    for (const f of [d, m]) {
      const group = add({ type: 'frame', name: 'Group', style: { width: 100, height: 100 } }, f.id)
      add({ type: 'text', name: 'Label', text: f === d ? 'Desk' : 'Mob', style: { fontSize: 12 } }, group.id)
      add({ type: 'text', name: 'Label', text: 'Same', style: { fontSize: 12 } }, f.id)
    }
    const r = buildHandoff(doc, { frames: [d.id, m.id], ...OPTS })
    const delta = JSON.parse(r.files['spec.json']).screens[0].breakpoints[1].delta
    const paths = delta.changes.map((c: { path: string }) => c.path)
    expect(paths).toContain('Group › Label')
    expect(paths).not.toContain('Label')
  })

  it('screens with different names stay separate screens', () => {
    const { doc, page } = setup()
    const home = page('Desktop', 1280)
    const other = page('Desktop', 1280, {}, 'Pricing')
    setDev(doc, other.id, { screen: { name: 'Pricing', bp: 'Desktop' } })
    const r = buildHandoff(doc, { frames: [home.id, other.id], ...OPTS })
    const spec = JSON.parse(r.files['spec.json'])
    expect(spec.screens.map((s: { name: string }) => s.name).sort()).toEqual(['Home', 'Pricing'])
    expect(Object.keys(r.files).filter((p) => p.startsWith('screens/') && p.endsWith('.md')).sort()).toEqual(['screens/home.md', 'screens/pricing.md'])
  })

  it('two frames with the same screen name and the same breakpoint do not overwrite each other', () => {
    const { doc, page } = setup()
    const a = page('Desktop', 1280)
    const b = page('Desktop', 1200)
    const r = buildHandoff(doc, { frames: [a.id, b.id], ...OPTS })
    const pngs = planScreenPngs(r.files['spec.json']).map((j) => j.path)
    expect(new Set(pngs).size).toBe(pngs.length)
  })
})
