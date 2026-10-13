// @vitest-environment jsdom
// T77: the MCP export_handoff tool and the Export handoff dialog build the same bundle. The same document and options
// go through the dialog path (runExport) and through the bridge handler; every text file must be byte for byte the same
// apart from exportedAt. Covers the first export, a second one with CHANGES.md, rem, and dev notes.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HandoffExportResult } from '@shared/api'
import { getStore, useStore } from '../model/store'
import type { Doc } from '../model/types'
import { runExport, type ExportDeps } from '../handoff/exportFlow'
import { fontSourceFor } from '../handoff/assets/fonts'
import { GOOGLE_FONTS } from '../editor/inspector/fonts'
import { measureOffscreen } from './measure'
import { handlers } from './registry'
import './tools-dev'

const history = vi.hoisted(() => ({ names: [] as string[], snaps: new Map<string, unknown>() }))
vi.mock('../history/versions', () => ({
  listVersions: async () => history.names.map((name, i) => ({ id: `v${i}-${name}`, name, createdAt: i })),
  loadVersionDoc: async (_doc: string, versionId: string) => history.snaps.get(versionId.replace(/^v\d+-/, '')) ?? null
}))

const g = globalThis as unknown as { CSS?: { escape?: (s: string) => string } }
if (!g.CSS) g.CSS = {}
if (!g.CSS.escape) g.CSS.escape = (s: string) => s
// jsdom has no FontFaceSet; the offscreen measure asks it whether a family is loaded
if (!('fonts' in document)) Object.defineProperty(document, 'fonts', { value: { check: () => true, [Symbol.iterator]: function* () {}, ready: Promise.resolve() } })

const S = getStore
let id: string
const NL = String.fromCharCode(10)
const AT = '2026-10-13T12:00:00.000Z'
const dataPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const PNG = new Uint8Array([137, 80, 78, 71])

function build(): { screen: string; title: string } {
  const root = S().docs[id].pages[0].rootId
  const screen = S().createNode(id, { type: 'frame', name: 'Checkout', style: { display: 'flex', flexDirection: 'column', gap: 16, padding: 24, width: 400, height: 300, backgroundColor: 'var(--c)' } }, root)
  const title = S().createNode(id, { type: 'text', name: 'Title', text: 'Pay now', style: { fontSize: 20, fontWeight: 700, fontFamily: 'Inter' } }, screen)
  S().createNode(id, { type: 'image', name: 'Hero', attrs: { src: dataPng, alt: 'Hero' }, style: { width: 100, height: 50 } }, screen)
  const card = S().createNode(id, { type: 'frame', name: 'Card', style: { width: 347.5, height: 52 } }, screen)
  const secret = S().createNode(id, { type: 'text', name: 'Secret', text: 'CANARY_HIDDEN', style: {} }, screen)
  S().updateNode(id, secret, { visible: false })
  S().setTokens(id, [{ name: '--c', value: '#2563EB' }])
  S().setDev(id, [card], { notes: 'Collapses under 640', needsDecision: 'Tappable?' })
  S().setReady(id, [screen], 1)
  return { screen, title }
}

function dialogDeps(written: Array<Record<string, unknown>>): ExportDeps {
  return {
    measure: (x) => measureOffscreen(S().docs[id], x),
    engine: { resize: async () => PNG, renderPng: async () => PNG },
    write: async (args): Promise<HandoffExportResult> => {
      written.push(args.files)
      return { ok: true, path: `C:/out/${args.name}`, files: Object.keys(args.files).length, bytes: 1, kind: args.kind }
    },
    saveVersion: async (name, record) => {
      S().recordHandoff(id, record.version, record.frames)
      history.names.push(name)
      history.snaps.set(name, JSON.parse(JSON.stringify(S().docs[id])) as Doc)
    },
    listVersions: async () => history.names.map((name, i) => ({ id: `v${i}-${name}`, name, createdAt: i })),
    loadVersion: async (v) => (history.snaps.get(v.replace(/^v\d+-/, '')) as Doc | undefined) ?? null,
    now: () => new Date().toISOString(),
    vellum: (await_pkg as { version: string }).version,
    fontSource: fontSourceFor({ google: GOOGLE_FONTS })
  }
}
// the app version both paths print
import pkg from '../../../../package.json'
const await_pkg = pkg

const withoutTime = (s: string): string => s.split(AT).join('<exportedAt>')

async function mcp(args: Record<string, unknown> = {}): Promise<Record<string, string>> {
  const r = (await handlers['export_handoff']({ fileId: id, ...args })) as { body: { files: Record<string, string> } }
  return r.body.files
}

function sameText(dialog: Record<string, unknown>, tool: Record<string, string>): void {
  const text = Object.entries(dialog).filter(([, v]) => typeof v === 'string') as Array<[string, string]>
  // every non-asset text file the dialog writes is returned by the tool, and byte-identical
  const expected = text.filter(([p]) => !p.startsWith('assets/')).map(([p]) => p).sort()
  expect(Object.keys(tool).sort()).toEqual(expected)
  for (const [p, v] of text) if (!p.startsWith('assets/')) expect(withoutTime(tool[p]), p).toBe(withoutTime(v))
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(AT))
  history.names.length = 0
  history.snaps.clear()
  useStore.setState(useStore.getInitialState(), true)
  id = S().createDoc('Acme', { open: false })
})

describe('export_handoff and the Export dialog build the same files', () => {
  it('a first export with notes, an image and a token', async () => {
    const { screen } = build()
    const tool = await mcp()
    const written: Array<Record<string, unknown>> = []
    const out = await runExport(S().docs[id], { frames: [screen], retina: false, rem: false, devNotes: true, kind: 'folder' }, dialogDeps(written))
    expect(out.ok).toBe(true)
    sameText(written[0], tool)
    // the quick start is the first box under the title
    expect(tool['HANDOFF.md'].split(NL).slice(1).join(NL).trimStart().startsWith("> ## Andy's quick start")).toBe(true)
    expect(JSON.stringify(tool)).not.toContain('CANARY_HIDDEN')
  })

  it('the second export carries the same CHANGES.md and the same number', async () => {
    const { screen, title } = build()
    const written: Array<Record<string, unknown>> = []
    const deps = dialogDeps(written)
    await runExport(S().docs[id], { frames: [screen], retina: false, rem: false, devNotes: true, kind: 'folder' }, deps)
    S().setText(id, title, 'Pay later')
    const tool = await mcp()
    await runExport(S().docs[id], { frames: [screen], retina: false, rem: false, devNotes: true, kind: 'folder' }, deps)
    expect(tool['CHANGES.md']).toContain('Pay later')
    expect(JSON.parse(tool['spec.json']).handoff.version).toBe(2)
    sameText(written[1], tool)
  })

  it('rem on is the same too', async () => {
    const { screen } = build()
    const tool = await mcp({ rem: true })
    const written: Array<Record<string, unknown>> = []
    await runExport(S().docs[id], { frames: [screen], retina: false, rem: true, devNotes: true, kind: 'folder' }, dialogDeps(written))
    sameText(written[0], tool)
  })
})
