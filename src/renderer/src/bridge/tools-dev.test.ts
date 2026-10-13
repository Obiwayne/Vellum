// @vitest-environment jsdom
// get_dev_spec and export_handoff, called through the bridge handler registry (T68 / H11).
import { beforeEach, describe, expect, it } from 'vitest'
import { getStore, useStore } from '../model/store'
import { handlers } from './registry'
import { nodeSpec } from '../model/devSpec'
import { buildHandoff } from '../handoff'
import './tools-dev'

// jsdom has no CSS.escape (the offscreen measure uses it); nothing is laid out there, so measures fall back to the
// authored style, which is what these tests compare
const g = globalThis as unknown as { CSS?: { escape?: (s: string) => string } }
if (!g.CSS) g.CSS = {}
if (!g.CSS.escape) g.CSS.escape = (s: string) => s

const S = getStore
let fileId: string
const doc = () => S().docs[fileId]
const root = (): string => doc().pages[0].rootId

type Res = { __header: { file: { id: string } }; body: Record<string, any> }
const call = async (tool: string, args: Record<string, unknown> = {}): Promise<Res> => (await handlers[tool]({ fileId, ...args })) as Res
const fails = async (tool: string, args: Record<string, unknown>): Promise<string> => {
  try {
    await handlers[tool]({ fileId, ...args })
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
  throw new Error(`${tool} did not throw`)
}

/** A ready screen "Checkout" with a title text and a card, a hidden layer, and an unmarked frame. */
function build() {
  const screen = S().createNode(fileId, { type: 'frame', name: 'Checkout', style: { display: 'flex', flexDirection: 'column', gap: 16, padding: 24, width: 400, height: 300, backgroundColor: 'var(--c)' } }, root())
  const title = S().createNode(fileId, { type: 'text', name: 'Title', text: 'Pay now', style: { fontSize: 20, fontWeight: 700 } }, screen)
  const card = S().createNode(fileId, { type: 'frame', name: 'Card', style: { width: 347.5, height: 52 } }, screen)
  const hidden = S().createNode(fileId, { type: 'text', name: 'Secret', text: 'CANARY_HIDDEN', style: {} }, screen)
  S().updateNode(fileId, hidden, { visible: false })
  const other = S().createNode(fileId, { type: 'frame', name: 'Scratch', style: { width: 100, height: 100 } }, root())
  S().setTokens(fileId, [{ name: '--c', value: '#2563EB' }])
  S().setDev(fileId, [card], { notes: 'Collapses under 640', needsDecision: 'Tappable?' })
  S().setReady(fileId, [screen], 1)
  return { screen, title, card, hidden, other }
}

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true)
  fileId = S().createDoc('Handoff', { open: true })
})

describe('get_dev_spec', () => {
  it('returns the NodeSpec of a layer with the standard header', async () => {
    const { screen } = build()
    const r = await call('get_dev_spec', { nodeId: screen })
    expect(r.__header.file.id).toBe(fileId)
    const spec = r.body.specs[0]
    expect(spec.id).toBe(screen)
    expect(spec.layout.summary).toContain('Column, gap 16, padding 24')
    expect(spec.sizing.w).toMatchObject({ mode: 'fixed', value: 400 })
    expect(spec.children.map((c: { name: string }) => c.name)).toEqual(['Title', 'Card'])
    expect(spec.tokens[0].name).toBe('--c')
  })

  it('matches nodeSpec for depth and for several nodes', async () => {
    const { screen, card } = build()
    const r = await call('get_dev_spec', { nodeIds: [screen, card], depth: 0 })
    expect(r.body.specs).toHaveLength(2)
    expect(r.body.specs[0].children).toEqual([])
    const direct = nodeSpec(doc(), card, { depth: 0 })!
    expect(r.body.specs[1].layout).toEqual(direct.layout)
    expect(r.body.specs[1].sizing).toEqual(direct.sizing)
    expect(r.body.specs[1].id).toBe(card)
  })

  it('refuses a hidden layer, an unknown id and a call with no node', async () => {
    const { hidden } = build()
    expect(await fails('get_dev_spec', { nodeId: hidden })).toMatch(/hidden/)
    expect(await fails('get_dev_spec', { nodeId: 'nope' })).toMatch(/not found/)
    expect(await fails('get_dev_spec', {})).toMatch(/nodeId or nodeIds/)
    expect(await fails('get_dev_spec', { nodeIds: Array.from({ length: 51 }, (_, i) => `x${i}`) })).toMatch(/At most 50/)
  })

  it('does not change the document and works in Dev Mode', async () => {
    const { screen } = build()
    S().setDevMode(fileId, true)
    const before = JSON.stringify(doc())
    const r = await call('get_dev_spec', { nodeId: screen })
    expect(r.body.specs).toHaveLength(1)
    expect(JSON.stringify(doc())).toBe(before)
  })
})

describe('export_handoff', () => {
  it('returns the bundle file map for the ready frames, equal to buildHandoff', async () => {
    const { screen } = build()
    const r = await call('export_handoff', { version: 3, projectLabel: 'Acme' })
    const direct = buildHandoff(doc(), { frames: [screen], version: 3, exportedAt: 'x', vellum: 'x', projectLabel: 'Acme' })
    expect(Object.keys(r.body.files).sort()).toEqual(Object.keys(direct.files).sort())
    // the clock and the app version are the only inputs that differ
    expect(r.body.files['screens/checkout.md']).toBe(direct.files['screens/checkout.md'])
    expect(r.body.files['tokens/tokens.css']).toBe(direct.files['tokens/tokens.css'])
    expect(JSON.parse(r.body.files['spec.json']).handoff).toMatchObject({ version: 3, fileName: 'Acme', fileId })
    expect(r.body.summary).toMatchObject({ screens: 1 })
    expect(r.body.omitted).toEqual([])
  })

  it('exports an explicit frame list, warns about a nested id, and never includes hidden layers', async () => {
    const { other, card } = build()
    const r = await call('export_handoff', { frames: [other, card] })
    expect(Object.keys(r.body.files)).toContain('screens/scratch.md')
    expect(r.body.warnings.join('\n')).toMatch(/"Card" is not a top-level frame/)
    expect(JSON.stringify(r.body.files)).not.toContain('CANARY_HIDDEN')
  })

  it('says so when nothing is ready', async () => {
    const { screen } = build()
    S().setReady(fileId, [screen], null)
    const r = await call('export_handoff', {})
    expect(r.body.warnings.join(' ')).toMatch(/marked ready/)
    expect(r.body.summary.screens).toBe(0)
  })

  it('applies the size cap: files past it are listed, with the pointer to the app', async () => {
    build()
    const small = await call('export_handoff', { maxBytes: 3000 })
    expect(small.body.inlineBytes).toBeLessThanOrEqual(3000)
    expect(small.body.omitted.length).toBeGreaterThan(0)
    expect(Object.keys(small.body.files)).toContain('HANDOFF.md')
    expect(small.body.warnings.join(' ')).toMatch(/Use Export handoff in the app/)
    // CLAUDE.md is the identical copy and goes last, so it is the first to be left out
    expect(small.body.omitted).toContain('CLAUDE.md')
  })

  it('lists the PNG references as skipped binary paths and never returns bytes for them', async () => {
    build()
    const r = await call('export_handoff', {})
    expect(r.body.skippedBinary).toEqual(['screens/checkout.png'])
    expect(Object.keys(r.body.files).some((p) => p.endsWith('.png'))).toBe(false)
    expect(r.body.warnings.join(' ')).toMatch(/not included \(binary\)/)
  })

  it('does not change the document and works in Dev Mode', async () => {
    build()
    S().setDevMode(fileId, true)
    const before = JSON.stringify(doc())
    const r = await call('export_handoff', {})
    expect(Object.keys(r.body.files)).toContain('HANDOFF.md')
    expect(JSON.stringify(doc())).toBe(before)
  })

  it('keeps hostile text on one line (layer name with a heading and an image)', async () => {
    const { screen } = build()
    S().renameNode(fileId, screen, 'Hero\n# Injected\n![x](http://evil)')
    const r = await call('export_handoff', {})
    const md = Object.entries(r.body.files)
      .filter(([p]) => p.startsWith('screens/'))
      .map(([, t]) => String(t))
      .join('\n')
    expect(md.split('\n').some((l) => l.startsWith('# Injected'))).toBe(false)
    expect(md).not.toMatch(/(^|[^\\])!\[x\]/m)
  })
})
