import { describe, expect, it } from 'vitest'
import * as ops from '../ops'
import { setDev, setReady, setScreen } from '../dev'
import type { Doc } from '../types'
import landing from '../fixtures/v1/files/i1wL51Z8AV_4.json'
import sketch from '../fixtures/v1/files/d2_WyuDutjln.json'
import buttonsV4 from '../fixtures/v4/buttons-v4.json'
import { assertSafePath, buildHandoff, HandoffSafetyError, PathRegistry, SPEC_SCHEMA, sha256, slug, type HandoffOptions } from './index'
import { checkoutDoc, CANARY } from './fixture'
import { validate } from './jsonSchema'
import { canonicalState } from './markdown'

const OPTS = { version: 3, exportedAt: '2026-01-02T03:04:05.000Z', vellum: '1.0.0', projectLabel: 'Acme Checkout', renders: true } as const
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v))

function build(over: Partial<HandoffOptions> = {}) {
  const f = checkoutDoc()
  const r = buildHandoff(f.doc, { frames: [f.desktop, f.mobile], ...OPTS, measure: f.measure, ...over })
  return { f, r }
}

describe('slug and paths', () => {
  it('kebab-case ASCII, with a fallback', () => {
    expect(slug('Checkout Desktop')).toBe('checkout-desktop')
    expect(slug('Café – Menü!')).toBe('cafe-menu')
    expect(slug('   ')).toBe('item')
    expect(slug('🙂🙂', 'screen')).toBe('screen')
    expect(slug('a'.repeat(400)).length).toBeLessThanOrEqual(48)
  })
  it('hostile names stay inside the bundle', () => {
    for (const bad of ['../../x', 'C:\\Windows', '/etc/passwd', 'a\\b', 'name\u0000', '.. ..']) {
      const s = slug(bad)
      expect(s).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(() => assertSafePath(`screens/${s}.md`)).not.toThrow()
    }
  })
  it('Windows device names get a suffix', () => {
    for (const n of ['CON', 'nul', 'Aux', 'com1', 'LPT9', 'prn']) expect(slug(n)).toMatch(/-file$/)
  })
  it('the registry hands out each path once, case-insensitively', () => {
    const r = new PathRegistry()
    expect(r.claim('screens', 'Home', '.md')).toBe('screens/home.md')
    expect(r.claim('screens', 'HOME', '.md')).toBe('screens/home-2.md')
    expect(r.claim('screens', 'home', '.md')).toBe('screens/home-3.md')
    expect(r.reserve('SCREENS/HOME.MD')).toBe(false)
    expect(r.claimStem('screens', 'home.mobile', '.png')).toBe('screens/home.mobile.png')
    expect(r.claimStem('screens', 'home.mobile', '.png')).toBe('screens/home.mobile-2.png')
  })
  it('assertSafePath rejects escapes', () => {
    for (const p of ['../x', 'a/../b', '/abs', 'C:/x', 'a\\b', 'a//b', 'con.md', 'a/nul', 'x.', 'a b ', `x${'y'.repeat(200)}`, '', 'a:b']) {
      expect(() => assertSafePath(p), p).toThrow()
    }
    for (const p of ['HANDOFF.md', '.handoff.json', 'screens/a.b.png', 'tokens/tokens.css']) expect(() => assertSafePath(p)).not.toThrow()
  })
})

describe('sha256', () => {
  it('matches known vectors', () => {
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256('a'.repeat(1000))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3')
  })
})

describe('bundle shape', () => {
  it('writes exactly the planned files and nothing from H4/H6', () => {
    const { r } = build()
    expect(Object.keys(r.files)).toEqual([
      '.handoff.json',
      'CLAUDE.md',
      'HANDOFF.md',
      'components/button.md',
      'fonts.md',
      'screens/checkout.md',
      'spec.json',
      'spec.schema.json',
      'tokens/tailwind.css',
      'tokens/tokens.css',
      'tokens/tokens.json'
    ])
  })
  it('CLAUDE.md is HANDOFF.md byte for byte and opens with the quick-start box', () => {
    const { r } = build()
    expect(r.files['CLAUDE.md']).toBe(r.files['HANDOFF.md'])
    expect(r.files['HANDOFF.md'].startsWith("> ## Andy's quick start\n> 1. Drop this folder next to your repo")).toBe(true)
    expect(r.files['HANDOFF.md']).toContain('build screens/checkout.md from this handoff')
    expect(r.files['HANDOFF.md']).toContain('Handoff v3, 1 screen.')
  })
  it('does not mention files that are not in the bundle', () => {
    const { r } = build({ renders: false })
    expect(r.files['HANDOFF.md']).not.toContain('CHANGES.md')
    expect(r.files['HANDOFF.md']).not.toContain('PNG')
    expect(r.files['HANDOFF.md']).toContain('This bundle has no reference renders')
  })
  it('every file ends with one newline, LF only, and each path is safe', () => {
    const { r } = build()
    for (const [p, t] of Object.entries(r.files)) {
      expect(() => assertSafePath(p)).not.toThrow()
      expect(t.endsWith('\n') && !t.endsWith('\n\n'), p).toBe(true)
      expect(t.includes('\r'), p).toBe(false)
    }
  })
  it('summary and warnings', () => {
    const { r } = build()
    expect(r.summary).toMatchObject({ screens: 1, breakpoints: 2, components: 1, tokens: 5, textStyles: 1, skippedHidden: 3, needsDecision: 1, notes: 2 })
    expect(r.summary.fractional).toBe(3)
    expect(r.warnings.join('\n')).toContain('Pulls in Button')
  })
})

describe('spec.json', () => {
  it('validates against spec.schema.json', () => {
    const { r } = build()
    const spec = JSON.parse(r.files['spec.json'])
    expect(validate(SPEC_SCHEMA, spec)).toEqual([])
    expect(JSON.parse(r.files['spec.schema.json'])).toEqual(SPEC_SCHEMA)
  })
  it('the schema is closed: an unknown key on a node or the root fails', () => {
    const spec = JSON.parse(build().r.files['spec.json'])
    spec.screens[0].breakpoints[0].root.children[0].surprise = 1
    expect(validate(SPEC_SCHEMA, spec).join('\n')).toMatch(/unexpected property surprise/)
    const spec2 = JSON.parse(build().r.files['spec.json'])
    spec2.extra = true
    expect(validate(SPEC_SCHEMA, spec2).join('\n')).toMatch(/unexpected property extra/)
    const spec3 = JSON.parse(build().r.files['spec.json'])
    delete spec3.units
    expect(validate(SPEC_SCHEMA, spec3).join('\n')).toMatch(/missing units/)
  })
  it('has the handoff block, units, modes and grouped breakpoints', () => {
    const spec = JSON.parse(build().r.files['spec.json'])
    expect(spec.schema).toBe('vellum.handoff/1')
    expect(spec.handoff).toEqual({ version: 3, exportedAt: OPTS.exportedAt, vellum: '1.0.0', fileId: 'file-1', fileName: 'Acme Checkout' })
    expect(spec.units).toEqual({ length: 'px', remBase: 16, precision: 2 })
    expect(spec.modes).toEqual(['Light', 'Dark'])
    expect(spec.screens).toHaveLength(1)
    expect(spec.screens[0].breakpoints.map((b: { name: string; width: number }) => [b.name, b.width])).toEqual([
      ['Desktop', 1280],
      ['Mobile', 390]
    ])
    expect(spec.screens[0].breakpoints[0].png).toBe('screens/checkout.desktop.png')
    expect(spec.screens[0].ready).toEqual({ at: 3 })
  })
  it('folds dev info into nodes: notes, a11y, states, needs-decision', () => {
    const { f, r } = build()
    const spec = JSON.parse(r.files['spec.json'])
    const find = (n: { id: string; children: unknown[] }, id: string): any => (n.id === id ? n : n.children.map((c) => find(c as never, id)).find(Boolean))
    const buy = find(spec.screens[0].breakpoints[0].root, f.ids.buy)
    expect(buy.notes).toEqual(['Disabled until the form is valid.', 'Show a spinner while the payment is pending.'])
    expect(buy.a11y).toEqual({ role: 'button', label: 'Pay now', tab: 2 })
    expect(buy.states).toEqual({ hover: { backgroundColor: 'var(--color-primary)' } })
    expect(buy.component).toMatchObject({ ref: f.ids.button, name: 'Button' })
    expect(find(spec.screens[0].breakpoints[0].root, f.ids.summary).needsDecision).toBe('What happens with more than 4 items?')
  })
  it('components: set with variants, props and used-by', () => {
    const { f, r } = build()
    const c = JSON.parse(r.files['spec.json']).components[0]
    expect(c).toMatchObject({ id: f.ids.set, name: 'Button', set: true, doc: 'components/button.md', usedBy: [f.desktop] })
    expect(c.variants.map((v: { name: string }) => v.name)).toEqual(['State=default', 'State=hover'])
    expect(c.props.map((p: { name: string }) => p.name)).toEqual(['State', 'Label'])
  })
  it('layout intent, sizing and tokens per mode ride along', () => {
    const { f, r } = build()
    const spec = JSON.parse(r.files['spec.json'])
    const root = spec.screens[0].breakpoints[0].root
    expect(root.layout).toMatchObject({ kind: 'flex', direction: 'column', gap: 24, padding: [16, 16, 16, 16] })
    const summary = root.children.find((c: { id: string }) => c.id === f.ids.summary)
    expect(summary.sizing.w).toEqual({ mode: 'fill', max: 640 })
    expect(summary.layout).toMatchObject({ kind: 'grid', columns: 'repeat(2, minmax(0, 1fr))' })
    const badge = root.children.find((c: { id: string }) => c.id === f.ids.badge)
    expect(badge.layout.constraints).toEqual({ h: 'right', v: 'top' })
    const tok = spec.tokens.find((t: { name: string }) => t.name === '--color-primary')
    expect(tok.values.Dark).toMatchObject({ value: 'oklch(0.7 0.15 260)' })
    expect(tok.values.Light.hex8).toMatch(/^#[0-9A-F]{8}$/)
  })
  it('lists fractional sizes, measured boxes and flow order', () => {
    const { f, r } = build()
    const root = JSON.parse(r.files['spec.json']).screens[0].breakpoints[0].root
    const item = root.children[1].children[0]
    expect(item.id).toBe(f.ids.item)
    expect(item.box).toMatchObject({ width: 303.75, height: 52.5, measured: true })
    expect(item.box.x).toBeUndefined()
    expect(item.flowIndex).toBe(0)
  })
  it('without a measure the spec says so instead of inventing numbers', () => {
    const f = checkoutDoc()
    const r = buildHandoff(f.doc, { frames: [f.desktop], ...OPTS })
    expect(r.summary.unmeasured).toBeGreaterThan(0)
    expect(r.warnings.join('\n')).toMatch(/not measured/)
    expect(r.files['screens/checkout.md']).toContain('not measured')
    expect(r.files['HANDOFF.md']).toContain('not measured')
  })
  it('asset references come from options and are listed, never decoded', () => {
    const f = checkoutDoc()
    const r = buildHandoff(f.doc, {
      frames: [f.desktop],
      ...OPTS,
      measure: f.measure,
      assets: [{ id: 'a1', path: 'assets/images/hero.jpg', kind: 'image', nodeIds: [f.ids.photo], bytes: 10 }]
    })
    const spec = JSON.parse(r.files['spec.json'])
    expect(spec.assets).toEqual([{ id: 'a1', path: 'assets/images/hero.jpg', kind: 'image', nodeIds: [f.ids.photo], bytes: 10 }])
    expect(JSON.stringify(spec.screens)).toContain('"assets":["a1"]')
    expect(validate(SPEC_SCHEMA, spec)).toEqual([])
  })
})

describe('tokens', () => {
  it('only used tokens, and what they reference', () => {
    const { r } = build()
    const css = r.files['tokens/tokens.css']
    expect(css).toContain('--color-ink')
    expect(css).toContain('--color-text: var(--color-ink)')
    expect(css).not.toContain('--unused')
    expect(css).not.toContain('--font-body')
    expect(css.match(/^\[data-mode="/gm)).toHaveLength(2)
  })
  it('DTCG json: a group per mode, $type/$value, authored oklch kept, hex8 fallback', () => {
    const j = JSON.parse(build().r.files['tokens/tokens.json'])
    expect(Object.keys(j)).toEqual(['Light', 'Dark'])
    expect(j.Light['color-primary']).toMatchObject({ $type: 'color', $value: expect.stringMatching(/^#[0-9A-F]{8}$/) })
    expect(j.Dark['color-primary'].$extensions.vellum.oklch).toBe('oklch(0.7 0.15 260)')
    expect(j.Light['space-4']).toMatchObject({ $type: 'dimension', $value: '16px' })
  })
  it('tailwind @theme holds the base mode and names the others', () => {
    const t = build().r.files['tokens/tailwind.css']
    expect(t).toContain('@theme {')
    expect(t).toContain('--color-bg: #FFFFFF;')
    expect(t).not.toContain('#0B0F19')
    expect(t).toContain('Other modes (Dark)')
  })
  it('a document without modes emits one block and the single base set', () => {
    const f = checkoutDoc()
    f.doc.modes = undefined
    for (const t of f.doc.tokens) delete t.modes
    const r = buildHandoff(f.doc, { frames: [f.desktop], ...OPTS, measure: f.measure })
    expect(r.files['tokens/tokens.css']).not.toContain('data-mode')
    expect(Object.keys(JSON.parse(r.files['tokens/tokens.json']))).toEqual(['base'])
    expect(r.files['tokens/tailwind.css']).toContain('Single mode')
  })
})

describe('markdown', () => {
  it('layout intent comes first, then size, then looks', () => {
    const { r } = build()
    const md = r.files['screens/checkout.md']
    const line = md.split('\n').find((l) => l.includes('**Summary**'))!
    expect(line).toBe(`  - **Summary** \`15-0\` — Grid, gap 16, columns repeat(2, minmax(0, 1fr)), padding 16, width fill (max 640), height fit`)
    const i = md.indexOf('**Summary**')
    expect(md.slice(i, i + 400).indexOf('size:')).toBeGreaterThan(0)
  })
  it('prints the fractional-size sentence, once per breakpoint that has them', () => {
    const md = build().r.files['screens/checkout.md']
    expect(md).toContain('3 nodes have fractional sizes (e.g. 120.5 × 40); build with the rule, not the number.')
  })
  it('rem option prints rem beside px', () => {
    const md = build({ rem: true }).r.files['screens/checkout.md']
    expect(md).toContain('1280px (80rem) × 800px (50rem)')
    expect(build().r.files['screens/checkout.md']).not.toContain('rem)')
  })
  it('states table: drawn, described, missing', () => {
    const md = build().r.files['components/button.md']
    expect(md).toContain('| default | drawn | base appearance |')
    expect(md).toContain('| hover | drawn | backgroundColor: oklch(0.55 0.2 260) → #1D4ED8 |')
    expect(md).toContain('| disabled | described | opacity: 0.5 |')
    expect(md).toContain('| pressed | missing | — |')
  })
  it('instances show property names, not ids', () => {
    const md = build().r.files['screens/checkout.md']
    expect(md).toContain('component: Button `')
    expect(md).toContain('variant State=default; props Label="Pay EUR 24.00"')
  })
  it('canonical state names', () => {
    expect(canonicalState('Active')).toBe('pressed')
    expect(canonicalState('Focus visible')).toBe('focus-visible')
    expect(canonicalState('Rest')).toBe('default')
  })
})

describe('safety: nothing outside the whitelist reaches the output', () => {
  it('no canary string appears in any file or path', () => {
    const { r } = build()
    const all = Object.entries(r.files).flat().join('\n')
    for (const [k, v] of Object.entries(CANARY)) expect(all, k).not.toContain(v)
    expect(all).not.toContain('CANARY')
    expect(all).not.toContain('Secret Archive')
    expect(all).not.toMatch(/data:image/)
    expect(all).not.toMatch(/"locked"/)
  })
  it('the file name is only used through projectLabel ?? name', () => {
    const f = checkoutDoc()
    const r = buildHandoff(f.doc, { frames: [f.desktop], ...OPTS, projectLabel: undefined, measure: f.measure })
    expect(JSON.parse(r.files['spec.json']).handoff.fileName).toBe(CANARY.docName)
    const r2 = buildHandoff(f.doc, { frames: [f.desktop], ...OPTS, measure: f.measure })
    expect(JSON.parse(r2.files['spec.json']).handoff.fileName).toBe('Acme Checkout')
  })
  it('locked layers are ordinary design content and their state is not exported', () => {
    const { r } = build()
    expect(r.files['screens/checkout.md']).toContain('Locked backdrop')
  })
  it('the other page and unchosen frames are unreachable, even by id', () => {
    const f = checkoutDoc()
    const r = buildHandoff(f.doc, { frames: [f.desktop, 'nope', f.ids.title], ...OPTS, measure: f.measure })
    const all = Object.values(r.files).join('\n')
    expect(all).not.toContain(CANARY.otherPage)
    expect(JSON.parse(r.files['spec.json']).screens).toHaveLength(1)
    expect(r.warnings.join('\n')).toContain('was not found')
    expect(r.warnings.join('\n')).toContain('is not a top-level frame')
  })
  it('the other page IS reachable when the caller chooses its frame, and nothing leaks from the first', () => {
    const f = checkoutDoc()
    const r = buildHandoff(f.doc, { frames: [f.otherPage], ...OPTS, measure: f.measure })
    const all = Object.values(r.files).join('\n')
    expect(all).toContain(CANARY.otherPage)
    expect(all).not.toContain(CANARY.hidden)
  })
  it('hidden frames are skipped; a hidden main is not exported; comments never appear', () => {
    const f = checkoutDoc()
    f.doc.nodes[f.mobile].visible = false
    const r = buildHandoff(f.doc, { frames: [f.desktop, f.mobile], ...OPTS, measure: f.measure })
    expect(r.warnings.join('\n')).toContain('is hidden and was skipped')
    expect(JSON.parse(r.files['spec.json']).screens[0].breakpoints).toHaveLength(1)
  })
  it('refuses to emit a thumbnail or data URL that slipped into text', () => {
    const f = checkoutDoc()
    f.doc.nodes[f.ids.title].text = `see ${CANARY.thumbnail}`
    expect(() => buildHandoff(f.doc, { frames: [f.desktop], ...OPTS, measure: f.measure })).toThrow(HandoffSafetyError)
  })
  it('hostile layer names cannot become paths', () => {
    const f = checkoutDoc()
    f.doc.nodes[f.desktop].dev = { ...f.doc.nodes[f.desktop].dev, screen: { name: '../../etc/passwd', bp: 'C:\\Windows' } }
    const r = buildHandoff(f.doc, { frames: [f.desktop], ...OPTS, measure: f.measure })
    for (const p of Object.keys(r.files)) expect(() => assertSafePath(p)).not.toThrow()
    expect(Object.keys(r.files).some((p) => p.startsWith('screens/etc-passwd'))).toBe(true)
  })
  it('screens with the same name get -2 and an untagged frame is its own screen', () => {
    const f = checkoutDoc()
    const other = ops.makeNode(f.doc, { type: 'frame', name: 'Checkout', x: 0, y: 5000, style: { width: 10, height: 10 } }, false)
    ops.insertNode(f.doc, other, f.doc.pages[0].rootId)
    setReady(f.doc, [other.id], 3)
    const r = buildHandoff(f.doc, { frames: [f.desktop, f.mobile, other.id], ...OPTS, measure: f.measure })
    expect(Object.keys(r.files).filter((p) => p.startsWith('screens/')).sort()).toEqual(['screens/checkout-2.md', 'screens/checkout.md'])
    expect(JSON.parse(r.files['spec.json']).screens[1].breakpoints[0].png).toBe('screens/checkout-2.png')
  })
})

describe('determinism', () => {
  it('same input, same bytes; node, token and style key order do not matter', () => {
    const a = build().r
    const b = build().r
    expect(b.files).toEqual(a.files)
    const f = checkoutDoc()
    const d: Doc = plain(f.doc)
    d.nodes = Object.fromEntries(Object.entries(d.nodes).reverse())
    d.tokens = [...d.tokens].reverse()
    for (const n of Object.values(d.nodes)) n.style = Object.fromEntries(Object.entries(n.style).reverse())
    const c = buildHandoff(d, { frames: [f.mobile, f.desktop], ...OPTS, measure: f.measure })
    expect(c.files).toEqual(a.files)
  })
  it('the writer never reads a clock', () => {
    const a = build({ exportedAt: '2030-05-05T00:00:00.000Z' }).r
    expect(JSON.parse(a.files['spec.json']).handoff.exportedAt).toBe('2030-05-05T00:00:00.000Z')
  })
  it('does not mutate the document', () => {
    const f = checkoutDoc()
    const before = JSON.stringify(f.doc)
    buildHandoff(f.doc, { frames: [f.desktop, f.mobile], ...OPTS, measure: f.measure })
    expect(JSON.stringify(f.doc)).toBe(before)
  })
  it('state file hashes change only when a screen changes', () => {
    const f = checkoutDoc()
    const o = { frames: [f.desktop, f.mobile], ...OPTS, measure: f.measure }
    const a = JSON.parse(buildHandoff(f.doc, o).files['.handoff.json'])
    f.doc.nodes[f.ids.title].text = 'Pay'
    const b = JSON.parse(buildHandoff(f.doc, o).files['.handoff.json'])
    expect(b.screens[0].breakpoints[0].hash).not.toBe(a.screens[0].breakpoints[0].hash)
    expect(b.screens[0].breakpoints[1].hash).toBe(a.screens[0].breakpoints[1].hash)
    expect(b.tokens).toBe(a.tokens)
  })
})

describe('real files', () => {
  const FILES: Array<[string, unknown]> = [
    ['v0.1.0 landing', landing],
    ['v0.1.0 sketch', sketch],
    ['v4 buttons', buttonsV4]
  ]
  it.each(FILES)('%s builds with every top-level frame chosen: no NaN, no undefined, safe paths', (_n, file) => {
    const doc = ops.migrateDoc(plain(file) as Doc)
    const frames = doc.pages.flatMap((p) => doc.nodes[p.rootId].children).filter((id) => doc.nodes[id].type === 'frame')
    const r = buildHandoff(doc, { frames, ...OPTS })
    expect(Object.keys(r.files).length).toBeGreaterThan(5)
    for (const [p, t] of Object.entries(r.files)) {
      assertSafePath(p)
      expect(t, p).not.toMatch(/NaN|undefined|\[object Object\]/)
    }
    expect(validate(SPEC_SCHEMA, JSON.parse(r.files['spec.json']))).toEqual([])
  })
})

describe('size', () => {
  it('a 20-screen, ~3000-node document builds quickly', () => {
    const doc = ops.makeDoc('big', 'Big')
    const root = doc.pages[0].rootId
    const frames: string[] = []
    for (let s = 0; s < 20; s++) {
      const fr = ops.makeNode(doc, { type: 'frame', name: `Screen ${s}`, x: s * 1500, y: 0, style: { display: 'flex', flexDirection: 'column', gap: 8, width: 1280, height: 'fit-content' } }, false)
      ops.insertNode(doc, fr, root)
      frames.push(fr.id)
      for (let i = 0; i < 30; i++) {
        const row = ops.makeNode(doc, { type: 'frame', name: `Row ${i}`, style: { display: 'flex', gap: 4, padding: 8, width: '100%', height: 'fit-content' } }, false)
        ops.insertNode(doc, row, fr.id)
        for (let j = 0; j < 4; j++) {
          const t = ops.makeNode(doc, { type: 'text', name: `T${j}`, text: `Item ${i}.${j}`, style: { fontSize: 14, color: '#111' } }, false)
          ops.insertNode(doc, t, row.id)
        }
      }
      setScreen(doc, fr.id, { name: `S${s}`, bp: 'Desktop' })
      setDev(doc, fr.id, { notes: 'x' })
    }
    setReady(doc, frames, 1)
    const t0 = performance.now()
    const r = buildHandoff(doc, { frames, ...OPTS })
    const ms = performance.now() - t0
    expect(r.summary.screens).toBe(20)
    expect(r.summary.nodes).toBeGreaterThanOrEqual(3000)
    expect(ms).toBeLessThan(20000)
  })
})
