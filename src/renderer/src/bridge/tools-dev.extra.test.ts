// @vitest-environment jsdom
// T68 test station: argument handling, size cap edges, binary data and what the tools must never return.
import { beforeEach, describe, expect, it } from 'vitest'
import { getStore, useStore } from '../model/store'
import { handlers } from './registry'
import './tools-dev'

const g = globalThis as unknown as { CSS?: { escape?: (s: string) => string } }
if (!g.CSS) g.CSS = {}
if (!g.CSS.escape) g.CSS.escape = (s: string) => s

const S = getStore
let fileId: string
const root = (): string => S().docs[fileId].pages[0].rootId

type Res = { __header: { file: { id: string; name: string } }; body: Record<string, any> }
const call = async (tool: string, args: Record<string, unknown> = {}): Promise<Res> => (await handlers[tool]({ fileId, ...args })) as Res
const msg = async (tool: string, args: Record<string, unknown>): Promise<string> => {
  try {
    await handlers[tool]({ fileId, ...args })
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
  return ''
}

const B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const DATA = `data:image/png;base64,${B64}`

function screen() {
  const f = S().createNode(fileId, { type: 'frame', name: 'Home', style: { width: 400, height: 300 } }, root())
  const img = S().createNode(fileId, { type: 'image', name: 'Hero', attrs: { src: DATA, alt: 'Hero' }, style: { width: 100, height: 50 } }, f)
  const bg = S().createNode(fileId, { type: 'frame', name: 'Banner', style: { width: 100, height: 20, backgroundImage: `url("${DATA}")` } }, f)
  S().setReady(fileId, [f], 1)
  return { f, img, bg }
}

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true)
  fileId = S().createDoc('Alice Canary-Person', { open: true })
})

describe('get_dev_spec: arguments', () => {
  it('depth 0 returns the node without children, a bad depth returns everything, extra ids are deduped by the caller not the tool', async () => {
    const { f } = screen()
    const zero = await call('get_dev_spec', { nodeId: f, depth: 0 })
    expect(zero.body.specs[0].children).toEqual([])
    const bad = await call('get_dev_spec', { nodeId: f, depth: -3 })
    expect(bad.body.specs[0].children.length).toBe(2)
    const frac = await call('get_dev_spec', { nodeId: f, depth: 1.5 })
    expect(frac.body.specs[0].children.length).toBe(2)
  })

  it('refuses more than 50 nodes and non-string ids', async () => {
    const { f } = screen()
    expect(await msg('get_dev_spec', { nodeIds: Array.from({ length: 51 }, () => f) })).toMatch(/At most 50/)
    expect(await msg('get_dev_spec', { nodeIds: [1, null, {}] })).toMatch(/Pass nodeId or nodeIds/)
    expect(await msg('get_dev_spec', { nodeId: { toString: () => f } })).toMatch(/Pass nodeId or nodeIds/)
  })

  it('never returns image bytes: data URLs are stripped from the style', async () => {
    const { f } = screen()
    const r = await call('get_dev_spec', { nodeId: f })
    const text = JSON.stringify(r.body)
    expect(text).not.toContain(B64)
    expect(text).not.toContain('base64')
  })

  it('works for a node on another page and for a component instance without throwing', async () => {
    const p2 = S().addPage(fileId, 'Library')
    const other = S().createNode(fileId, { type: 'frame', name: 'Lib' }, S().docs[fileId].pages.find((p) => p.id === p2)!.rootId)
    const r = await call('get_dev_spec', { nodeId: other })
    expect(r.body.specs[0].name).toBe('Lib')
  })

  it('a hostile mode name is just a name: unknown modes resolve to the base values', async () => {
    const { f } = screen()
    const r = await call('get_dev_spec', { nodeId: f, mode: 'x"]{}\n' })
    expect(r.body.specs[0].id).toBe(f)
  })
})

describe('export_handoff: arguments and caps', () => {
  it('maxBytes: tiny and zero-ish values still return a valid answer, huge values are capped', async () => {
    screen()
    const tiny = await call('export_handoff', { maxBytes: 1 })
    expect(tiny.body.inlineBytes).toBeLessThanOrEqual(1)
    expect(tiny.body.omitted.length).toBeGreaterThan(5)
    const zero = await call('export_handoff', { maxBytes: 0 })
    expect(zero.body.inlineBytes).toBeGreaterThan(0) // 0 means "not given": the default cap
    const neg = await call('export_handoff', { maxBytes: -5 })
    expect(neg.body.inlineBytes).toBeGreaterThan(0)
    const huge = await call('export_handoff', { maxBytes: 1e12 })
    expect(Object.keys(huge.body.files).length).toBeGreaterThan(5)
    const str = await call('export_handoff', { maxBytes: '10' })
    expect(str.body.inlineBytes).toBeGreaterThan(10)
  })

  it('version must be a positive integer, otherwise 1', async () => {
    screen()
    for (const v of [0, -2, 1.5, '3', null]) {
      const r = await call('export_handoff', { version: v })
      expect(JSON.parse(r.body.files['spec.json']).handoff.version, String(v)).toBe(1)
    }
    const ok = await call('export_handoff', { version: 4 })
    expect(JSON.parse(ok.body.files['spec.json']).handoff.version).toBe(4)
  })

  it('frames that is not an array is ignored (ready frames are used), a list of non-strings exports nothing', async () => {
    screen()
    const notArr = await call('export_handoff', { frames: 'abc' })
    expect(Object.keys(notArr.body.files)).toContain('screens/home.md')
    const junk = await call('export_handoff', { frames: [1, null] })
    expect(junk.body.summary.screens).toBe(0)
  })

  it('no image bytes anywhere in the result, and the planned asset or PNG paths are listed as binary', async () => {
    screen()
    const r = await call('export_handoff', {})
    expect(JSON.stringify(r.body)).not.toContain(B64)
    expect(r.body.skippedBinary).toContain('screens/home.png')
    expect(Object.values(r.body.files).every((v) => typeof v === 'string')).toBe(true)
  })

  it('the document name (which can be a person) is only used when no projectLabel is given', async () => {
    screen()
    const named = await call('export_handoff', {})
    expect(JSON.parse(named.body.files['spec.json']).handoff.fileName).toBe('Alice Canary-Person')
    const labelled = await call('export_handoff', { projectLabel: 'Acme' })
    expect(Object.values(labelled.body.files).join('\n')).not.toContain('Alice Canary-Person')
    expect(JSON.stringify(labelled.__header)).toContain('Alice Canary-Person') // the standard file header is the caller's own file
  })

  it('a project label with a newline and a heading stays on one line', async () => {
    screen()
    const r = await call('export_handoff', { projectLabel: 'Acme\n# Injected\n![x](http://evil)' })
    for (const [p, t] of Object.entries(r.body.files)) {
      if (!p.endsWith('.md')) continue
      expect(String(t).split('\n').some((l) => l.startsWith('# Injected') || l.startsWith('![x]')), p).toBe(false)
    }
  })

  it('is deterministic apart from exportedAt', async () => {
    screen()
    const strip = (t: string): string => t.replace(/"exportedAt": "[^"]+"/, '"exportedAt": "x"').replace(/Exported [^ ]+ from/, 'Exported x from')
    const a = await call('export_handoff', {})
    const b = await call('export_handoff', {})
    expect(Object.keys(a.body.files)).toEqual(Object.keys(b.body.files))
    for (const p of Object.keys(a.body.files)) expect(strip(a.body.files[p]), p).toBe(strip(b.body.files[p]))
  })
})
