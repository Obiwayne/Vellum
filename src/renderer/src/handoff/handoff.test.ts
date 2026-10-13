import { describe, expect, it } from 'vitest'
import { buildHandoff, SCHEMA_ID, SPEC_SCHEMA, selectFrames, topLevelFrames, type HandoffOptions } from './index'
import { CANARY, checkoutFixture } from './fixture'
import { migrateDoc } from '../model/ops'
import * as ops from '../model/ops'
import { setDev } from '../model/dev'
import type { CNode, Doc, WorldRect } from '../model/types'
import landing from '../model/fixtures/v1/files/i1wL51Z8AV_4.json'
import sketch from '../model/fixtures/v1/files/d2_WyuDutjln.json'
import buttonsV4 from '../model/fixtures/v4/buttons-v4.json'
import canvasEra from '../model/fixtures/canvas-era/old-sketch-no-version.json'

const base: HandoffOptions = { version: 1, exportedAt: '2026-10-13T12:00:00Z', vellum: '1.0.0', projectLabel: 'Acme checkout' }
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v))
const build = (doc: Doc, over: Partial<HandoffOptions> = {}) => buildHandoff(doc, { ...base, ...over })

// ---- a small JSON Schema checker for the vocabulary spec.schema.json uses
type Schema = Record<string, unknown>
function check(value: unknown, schema: Schema, root: Schema, path = '$'): string[] {
  if (typeof schema.$ref === 'string') {
    const name = schema.$ref.replace('#/$defs/', '')
    return check(value, (root.$defs as Record<string, Schema>)[name], root, path)
  }
  if (Array.isArray(schema.anyOf)) {
    const tries = (schema.anyOf as Schema[]).map((s) => check(value, s, root, path))
    return tries.some((t) => !t.length) ? [] : [`${path}: matches none of anyOf (${tries.map((t) => t[0]).join(' | ')})`]
  }
  if ('const' in schema) return value === schema.const ? [] : [`${path}: expected ${String(schema.const)}`]
  if (Array.isArray(schema.enum)) return schema.enum.includes(value) ? [] : [`${path}: ${String(value)} not in enum`]
  const errors: string[] = []
  const type = schema.type as string | undefined
  const kind = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
  if (type === 'integer') {
    if (!Number.isInteger(value)) errors.push(`${path}: expected integer, got ${String(value)}`)
    return errors
  }
  if (type === 'number' ? kind !== 'number' : type && type !== kind) return [`${path}: expected ${type}, got ${kind}`]
  if (type === 'array') {
    ;(value as unknown[]).forEach((v, i) => errors.push(...check(v, schema.items as Schema, root, `${path}[${i}]`)))
  }
  if (type === 'object') {
    const o = value as Record<string, unknown>
    const props = (schema.properties ?? {}) as Record<string, Schema>
    for (const k of (schema.required ?? []) as string[]) if (!(k in o)) errors.push(`${path}: missing ${k}`)
    for (const [k, v] of Object.entries(o)) {
      if (k in props) errors.push(...check(v, props[k], root, `${path}.${k}`))
      else if (schema.additionalProperties === false) errors.push(`${path}: unexpected key ${k}`)
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') errors.push(...check(v, schema.additionalProperties as Schema, root, `${path}.${k}`))
    }
  }
  return errors
}

describe('frame selection', () => {
  it('defaults to the visible top-level frames marked ready, in document order', () => {
    const { doc, ids } = checkoutFixture()
    expect(selectFrames(doc).ids).toEqual([ids.desktop, ids.mobile])
    expect(topLevelFrames(doc)).toContain(ids.unchosen)
  })

  it('says so when nothing is ready', () => {
    const { doc } = checkoutFixture()
    for (const n of Object.values(doc.nodes)) if (n.dev?.ready) setDev(doc, n.id, { ready: null })
    const r = selectFrames(doc)
    expect(r.ids).toEqual([])
    expect(r.warnings.join(' ')).toMatch(/marked ready/)
  })

  it('refuses nested, missing, hidden and non-frame ids with a warning each, and exports the rest', () => {
    const { doc, ids } = checkoutFixture()
    const hiddenTop = ops.makeNode(doc, { type: 'frame', name: 'Hidden top', visible: false })
    ops.insertNode(doc, hiddenTop, doc.pages[0].rootId)
    const r = selectFrames(doc, [ids.card, 'nope', hiddenTop.id, ids.mobile, ids.desktop, ids.heading])
    expect(r.ids).toEqual([ids.desktop, ids.mobile])
    expect(r.warnings).toHaveLength(4)
    expect(r.warnings.join('\n')).toMatch(/"Card" is not a top-level frame/)
  })

  it('an explicit list exports unmarked frames too', () => {
    const { doc, ids } = checkoutFixture()
    const r = build(doc, { frames: [ids.unchosen] })
    expect(Object.keys(r.files)).toContain('screens/scratch.md')
    expect(r.files['screens/scratch.md']).toContain(CANARY.unchosen)
  })
})

describe('the bundle', () => {
  const { doc, ids } = checkoutFixture()
  const r = build(doc)

  it('has exactly the planned files, sorted, with CLAUDE.md identical to HANDOFF.md', () => {
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
    expect(r.files['CLAUDE.md']).toBe(r.files['HANDOFF.md'])
    expect(r.files['HANDOFF.md'].split('\n').slice(0, 6).join('\n')).toContain("Andy's quick start")
    expect(r.files['HANDOFF.md']).not.toContain('CHANGES.md')
  })

  it('summarises what it exported', () => {
    expect(r.summary).toMatchObject({ screens: 1, breakpoints: 2, components: 1, notes: 3, needsDecision: 1, fractional: 1, skippedHidden: 2, textStyles: 1, assets: 0 })
    expect(r.warnings.join('\n')).toMatch(/fractional size/)
  })

  it('writes every file in LF with one trailing newline and no undefined or NaN', () => {
    for (const [p, text] of Object.entries(r.files)) {
      expect(text, p).not.toMatch(/\r/)
      expect(text.endsWith('\n') && !text.endsWith('\n\n'), p).toBe(true)
      expect(text, p).not.toMatch(/undefined|NaN/)
    }
  })

  it('prints the layout rule before the numbers for every layer', () => {
    const md = r.files['screens/checkout.md']
    const lines = md.split('\n')
    lines.forEach((line, i) => {
      if (/^\s*- \*\*.* — .*\*\* `/.test(line)) expect(lines[i + 1], line).toMatch(/^\s+- size /)
    })
    expect(md).toContain('Card — Row, gap 16, width 347.5, height 52')
    expect(md).toContain('fractional sizes (e.g. 347.5 × 52 for "Card")')
    expect(md).toContain(`reference \`screens/checkout.desktop.png\``)
    expect(md).toContain('**needs decision:** Is the card tappable?')
  })

  it('names variant props and the component on an instance', () => {
    expect(r.files['screens/checkout.md']).toContain('component Button (Variant=Default)')
  })

  it('component markdown has props, variants and a state table with drawn/described/missing', () => {
    const md = r.files['components/button.md']
    expect(md).toContain('| Variant | variant | Default | Default, Variant 2 |')
    expect(md).toContain('| hover | described')
    expect(md).toContain('| pressed | missing')
    expect(r.files['HANDOFF.md']).toContain('Button: pressed, focus, disabled')
  })

  it('writes only the tokens the frames use, and the tokens they reference', () => {
    const css = r.files['tokens/tokens.css']
    expect(css).toContain('--color-brand')
    expect(css).toContain('--color-brand-hover')
    expect(css).toContain('--text-xl')
    expect(css).not.toContain(CANARY.unusedToken)
    const dtcg = JSON.parse(r.files['tokens/tokens.json'])
    expect(Object.keys(dtcg)).toEqual(['Light', 'Dark'])
    // --color-brand is also the prefix of --color-brand-hover, so its value sits under $root
    expect(dtcg.Light.color.brand.$root.$value).toBe('#2563EBFF')
    expect(dtcg.Light.color.brand.$root.$type).toBe('color')
    expect(dtcg.Dark.color.brand.$root.$value).toBe('#60A5FAFF')
    expect(dtcg.Dark.color.brand.hover.$value).toBe('#93C5FDFF')
    expect(dtcg.Light.text.xl).toEqual({ $type: 'dimension', $value: '28px' })
    expect(dtcg.Light.color.text.$extensions.vellum.authored).toMatch(/^oklch\(/)
    const tw = r.files['tokens/tailwind.css']
    expect(tw).toContain('@theme {')
    expect(tw).toContain('--color-brand: #2563EB;')
    expect(tw).toContain('--color-text: oklch(0.2 0.02 250);')
    expect(tw).toContain('[data-mode="Dark"] {')
  })

  it('keeps a token that is also the prefix of others under $root', () => {
    const d = plain(doc)
    d.tokens = [
      { name: '--color-brand', value: '#111111' },
      { name: '--color-brand-500', value: '#222222' }
    ]
    d.modes = undefined
    for (const n of Object.values(d.nodes)) if (n.style.backgroundColor === 'var(--color-brand)') n.style.backgroundColor = 'var(--color-brand-500)'
    d.nodes[ids.card].style.color = 'var(--color-brand)'
    const out = build(d)
    const t = JSON.parse(out.files['tokens/tokens.json'])
    expect(Object.keys(t)).toEqual(['base'])
    expect(t.base.color.brand.$root.$value).toBe('#111111FF')
    expect(t.base.color.brand['500'].$value).toBe('#222222FF')
  })

  it('fonts.md lists families, weights and a licence line', () => {
    expect(r.files['fonts.md']).toContain('| Inter | 400, 600, 700 | no | unknown |')
    const g = build(doc, { fontSource: (f) => (f === 'Inter' ? 'google' : 'local') }).files['fonts.md']
    expect(g).toContain('Google Fonts (SIL OFL or Apache 2.0')
    expect(g).toContain('https://fonts.google.com/specimen/Inter')
  })

  it('.handoff.json keeps one hash per exported frame and changes only for the frame that changed', () => {
    const a = JSON.parse(r.files['.handoff.json'])
    expect(Object.keys(a.screens.checkout).sort()).toEqual([ids.desktop, ids.mobile].sort())
    const d = plain(doc)
    d.nodes[ids.mobile].children.forEach((c) => (d.nodes[c].text = 'Pay today'))
    const b = JSON.parse(build(d).files['.handoff.json'])
    expect(b.screens.checkout[ids.desktop]).toBe(a.screens.checkout[ids.desktop])
    expect(b.screens.checkout[ids.mobile]).not.toBe(a.screens.checkout[ids.mobile])
    expect(b.components).toEqual(a.components)
  })

  it('lists planned assets and PNG paths without producing them', () => {
    const out = build(doc, { assets: [{ id: 'a1', path: 'assets/images/hero.jpg', kind: 'image', nodeIds: [ids.card], layerName: 'Card' }] })
    expect(out.files['screens/checkout.md']).toContain('assets/images/hero.jpg')
    expect(JSON.parse(out.files['spec.json']).assets).toHaveLength(1)
    expect(Object.keys(out.files).some((p) => p.endsWith('.png') || p.startsWith('assets/'))).toBe(false)
    expect(() => build(doc, { assets: [{ id: 'x', path: '../evil.png', kind: 'png', nodeIds: [] }] })).toThrow(/Unsafe bundle path/)
  })

  it('prints rem beside px when asked', () => {
    const md = build(doc, { rem: true }).files['screens/checkout.md']
    expect(md).toContain('1280px (80rem)')
    expect(md).toContain('28px (1.75rem)')
    expect(r.files['screens/checkout.md']).not.toContain('rem)')
  })

  it('uses measured rects when given, and says so', () => {
    const rects: Record<string, WorldRect> = {
      [ids.desktop]: { x: 0, y: 0, width: 1280, height: 800 },
      [ids.card]: { x: 24, y: 76, width: 347.5, height: 52 }
    }
    const m = build(doc, { measure: (id) => rects[id] ?? null })
    const spec = JSON.parse(m.files['spec.json'])
    const root = spec.screens[0].breakpoints[0].root
    expect(root.box.measured).toBe(true)
    expect(m.summary.unmeasured).toBeLessThan(r.summary.unmeasured)
  })
})

describe('snapshots of every file for the fixture', () => {
  const { doc } = checkoutFixture()
  const r = build(doc)
  it.each(Object.keys(r.files))('%s', (path) => {
    expect(r.files[path]).toMatchSnapshot()
  })
  it('with measured rects and rem on, the markdown changes in the places it should', () => {
    const rects: Record<string, WorldRect> = {}
    const measured = build(doc, { rem: true, measure: (id) => rects[id] ?? { x: 0, y: 0, width: 100.25, height: 40 } })
    expect(measured.files['screens/checkout.md']).toMatchSnapshot()
  })
})

describe('spec.json and its schema', () => {
  const { doc } = checkoutFixture()
  const r = build(doc)
  const schema = JSON.parse(r.files['spec.schema.json']) as Schema

  it('is vellum.handoff/1 and ships next to spec.json unchanged', () => {
    expect(JSON.parse(r.files['spec.json']).schema).toBe(SCHEMA_ID)
    expect(schema).toEqual(JSON.parse(JSON.stringify(SPEC_SCHEMA)))
    expect(schema.$id).toBe(SCHEMA_ID)
  })

  it('validates the fixture output', () => {
    expect(check(JSON.parse(r.files['spec.json']), schema, schema)).toEqual([])
  })

  it('validates a bundle from every older fixture too', () => {
    for (const d of oldDocs()) {
      const out = build(d, { frames: topLevelFrames(d) })
      const s = JSON.parse(out.files['spec.schema.json']) as Schema
      expect(check(JSON.parse(out.files['spec.json']), s, s), d.name).toEqual([])
    }
  })

  it('rejects what it should (the checker is not a rubber stamp)', () => {
    const spec = JSON.parse(r.files['spec.json'])
    spec.screens[0].breakpoints[0].root.box.width = 'wide'
    expect(check(spec, schema, schema).length).toBeGreaterThan(0)
    const bad = JSON.parse(r.files['spec.json'])
    bad.schema = 'other'
    expect(check(bad, schema, schema).length).toBeGreaterThan(0)
    const extra = JSON.parse(r.files['spec.json'])
    extra.thumbnail = 'x'
    expect(check(extra, schema, schema).length).toBeGreaterThan(0)
  })

  it('carries dev info per node: notes, a11y, states, needs-decision', () => {
    const spec = JSON.parse(r.files['spec.json'])
    const find = (n: { id: string; children: unknown[] }, id: string): Record<string, unknown> | null =>
      n.id === id ? (n as unknown as Record<string, unknown>) : (n.children as Array<{ id: string; children: unknown[] }>).map((c) => find(c, id)).find(Boolean) ?? null
    const card = find(spec.screens[0].breakpoints[0].root, '11-0')!
    expect(card.notes).toEqual(['Collapses to a single column under 640px.'])
    expect(card.a11y).toEqual({ role: 'region', label: 'Order total' })
    expect(card.needsDecision).toBe('Is the card tappable?')
    const tokens = (find(spec.screens[0].breakpoints[0].root, '10-0') as { tokens: string[] }).tokens
    expect(tokens).toEqual(['--text-xl', '--color-text'])
    expect(spec.components[0].variants[0].root.states.hover).toEqual({ backgroundColor: 'var(--color-brand-hover)' })
  })
})

describe('safety: what must never be in a bundle', () => {
  const { doc, ids } = checkoutFixture()
  const r = build(doc)
  const all = Object.entries(r.files)

  it('has none of the canaries in any file or path', () => {
    for (const [p, text] of all) {
      for (const [name, value] of Object.entries(CANARY)) {
        expect(text, `${p} contains ${name}`).not.toContain(value)
        expect(p, `path contains ${name}`).not.toContain(value)
      }
    }
  })

  it('drops hidden layers (and their children) but counts them', () => {
    expect(r.summary.skippedHidden).toBe(2)
    expect(r.files['spec.json']).not.toContain('Hidden group')
    expect(r.files['screens/checkout.md']).not.toContain(ids.hidden)
  })

  it('exports a locked layer as a normal layer and never writes lock state', () => {
    expect(r.files['screens/checkout.md']).toContain('Locked divider')
    expect(r.files['spec.json']).not.toMatch(/"locked"/)
    expect(r.files['screens/checkout.md']).not.toMatch(/locked state|🔒/)
  })

  it('does not read another page, comments, the thumbnail or the document name', () => {
    expect(r.files['spec.json']).not.toMatch(/Secret page|"comments"|"thumbnail"|data:image/)
    expect(JSON.parse(r.files['spec.json']).handoff.fileName).toBe('Acme checkout')
  })

  it('uses the document name only when no project label is given', () => {
    const named = build(doc, { projectLabel: undefined })
    expect(JSON.parse(named.files['spec.json']).handoff.fileName).toBe(CANARY.profile)
    const blank = build(doc, { projectLabel: '   ' })
    expect(JSON.parse(blank.files['spec.json']).handoff.fileName).toBe('Untitled')
  })

  it('strips image bytes from styles', () => {
    const d = plain(doc)
    d.nodes[ids.card].style.backgroundImage = 'url("data:image/png;base64,AAAA")'
    const out = build(d)
    expect(JSON.stringify(out.files)).not.toContain('base64')
  })

  it('every path of every bundle is safe, even with hostile layer names', () => {
    const d = plain(doc)
    const names = ['../../evil', 'C:\\Windows\\win', 'CON', 'a'.repeat(400), '???', '/abs']
    names.forEach((name, i) => {
      const f = ops.makeNode(d, { type: 'frame', name, style: { width: 100, height: 100 }, x: 0, y: 5000 + i * 200 }, false)
      ops.insertNode(d, f, d.pages[0].rootId)
      setDev(d, f.id, { ready: { at: 1 } })
    })
    const out = build(d)
    for (const p of Object.keys(out.files)) expect(p).toMatch(/^[A-Za-z0-9._@/-]+$/)
    expect(Object.keys(out.files).filter((p) => p.startsWith('screens/')).length).toBe(1 + names.length)
  })
})

describe('determinism', () => {
  it('gives the same bytes twice', () => {
    const { doc } = checkoutFixture()
    expect(build(doc)).toEqual(build(doc))
  })

  it('does not depend on the order of the document\'s node map or tokens', () => {
    const { doc } = checkoutFixture()
    const shuffled = plain(doc)
    shuffled.nodes = Object.fromEntries(Object.entries(shuffled.nodes).reverse())
    shuffled.tokens = [...shuffled.tokens].reverse()
    expect(build(shuffled)).toEqual(build(doc))
  })

  it('does not change the document it is given', () => {
    const { doc } = checkoutFixture()
    const before = JSON.stringify(doc)
    build(doc)
    expect(JSON.stringify(doc)).toBe(before)
  })
})

// ---- older files and a big one
function oldDocs(): Doc[] {
  return [landing, sketch, buttonsV4, canvasEra].map((f) => migrateDoc(plain(f) as unknown as Doc))
}

describe('existing files', () => {
  it('v0.1.0, v4 and Canvas-era files build with every top-level frame chosen: no throw, no NaN, safe paths', () => {
    for (const d of oldDocs()) {
      const out = build(d, { frames: topLevelFrames(d) })
      expect(Object.keys(out.files).length, d.name).toBeGreaterThan(8)
      for (const [p, text] of Object.entries(out.files)) expect(text, `${d.name}: ${p}`).not.toMatch(/undefined|NaN/)
    }
  })
})

describe('size', () => {
  it('builds a 20-screen, ~3000-layer file well inside a second or two', () => {
    const d = ops.makeDoc('big', 'Big')
    const root = d.pages[0].rootId
    let count = 0
    for (let s = 0; s < 20; s++) {
      const f = ops.makeNode(d, { type: 'frame', name: `Screen ${s}`, style: { display: 'flex', flexDirection: 'column', width: 1280, height: 900 }, x: 0, y: s * 1000 }, false)
      ops.insertNode(d, f, root)
      setDev(d, f.id, { ready: { at: 1 } })
      for (let r = 0; r < 15; r++) {
        const row = ops.makeNode(d, { type: 'frame', name: `Row ${r}`, style: { display: 'flex', flexDirection: 'row', gap: 8, width: '100%', height: 40 } }, false)
        ops.insertNode(d, row, f.id)
        count++
        for (let c = 0; c < 9; c++) {
          const t: CNode = ops.makeNode(d, { type: 'text', name: `Cell ${c}`, text: `Value ${s}-${r}-${c}`, style: { fontSize: 14, color: '#111111' } }, false)
          ops.insertNode(d, t, row.id)
          count++
        }
      }
    }
    expect(count).toBeGreaterThan(2500)
    const t0 = Date.now()
    const out = build(d)
    const ms = Date.now() - t0
    expect(out.summary.screens).toBe(20)
    expect(out.summary.nodes).toBeGreaterThan(2800)
    expect(ms).toBeLessThan(5000)
  })
})
