// Export a sample document to a temp folder and assert the file tree (T65): the renderer-side flow (exportFlow.ts,
// built on the H3 writer and the H4 assets pipeline) with the main process's real writer, a fake image engine and no
// window. This is the "export a sample doc" test of the task.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HandoffExportArgs, HandoffExportResult } from '@shared/api'
import { getStore, useStore } from '../renderer/src/model/store'
import { folderNameFor, previewExport, runExport, type ExportDeps, type ExportRequest } from '../renderer/src/handoff/exportFlow'
import { frameHash, readyStatus } from '../renderer/src/handoff/ready'
import { writeFolder, writeZip } from './bundleWrite'
import { SCHEMA_ID } from '../renderer/src/handoff'

const S = getStore
let dir: string
let id: string
const doc = () => S().docs[id]
const root = () => doc().pages[0].rootId

// a 1x1 PNG
const PNG = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vellum-export-'))
  useStore.setState(useStore.getInitialState(), true)
  id = S().createDoc('Acme Checkout', { open: false })
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function sample() {
  const screen = S().createNode(id, { type: 'frame', name: 'Checkout', style: { display: 'flex', flexDirection: 'column', gap: 12, padding: 16, width: 400, height: 300 } }, root())
  S().createNode(id, { type: 'text', name: 'Title', text: 'Pay now', style: { fontSize: 20 } }, screen)
  const card = S().createNode(id, { type: 'frame', name: 'Card', style: { width: 200, height: 50 } }, screen)
  S().setDev(id, [card], { notes: 'Secret internal note' })
  const scratch = S().createNode(id, { type: 'frame', name: 'Scratch', style: { width: 50, height: 50 } }, root())
  return { screen, card, scratch }
}

function deps(over: Partial<ExportDeps> = {}, target?: { path: string; kind?: 'folder' | 'zip' }): ExportDeps & { saved: string[]; writes: HandoffExportArgs[] } {
  const saved: string[] = []
  const writes: HandoffExportArgs[] = []
  const d: ExportDeps = {
    engine: { resize: async () => PNG, renderPng: async () => PNG },
    write: async (args): Promise<HandoffExportResult> => {
      writes.push(args)
      const path = target?.path ?? join(dir, args.name)
      const r = args.kind === 'zip' ? await writeZip(path, args.files, args.name) : await writeFolder(path, args.files)
      return { ok: true, path: r.path, files: r.files, bytes: r.bytes, kind: args.kind }
    },
    saveVersion: async (name) => void saved.push(name),
    listVersions: async () => [],
    now: () => '2026-10-13T12:00:00.000Z',
    vellum: '1.0.0',
    ...over
  }
  return Object.assign(d, { saved, writes })
}

const req = (frames: string[], over: Partial<ExportRequest> = {}): ExportRequest => ({ frames, retina: false, rem: false, devNotes: true, kind: 'folder', ...over })

function tree(root: string, base = ''): string[] {
  return readdirSync(join(root, base), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? tree(root, `${base}${e.name}/`) : [`${base}${e.name}`]))
    .sort()
}

describe('export a sample document to a folder', () => {
  it('writes the bundle tree: docs, spec, tokens, screens, components, fonts, the PNG reference', async () => {
    const { screen } = sample()
    const d = deps()
    const out = await runExport(doc(), req([screen]), d)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.version).toBe(1)
    expect(out.path).toBe(join(dir, 'acme-checkout-handoff-v1'))
    expect(tree(out.path)).toEqual([
      '.handoff.json',
      'CLAUDE.md',
      'HANDOFF.md',
      'fonts.md',
      'screens/checkout.md',
      'screens/checkout.png',
      'spec.json',
      'spec.schema.json',
      'tokens/tailwind.css',
      'tokens/tokens.css',
      'tokens/tokens.json'
    ])
    expect(JSON.parse(readFileSync(join(out.path, 'spec.json'), 'utf8')).schema).toBe(SCHEMA_ID)
    expect(readFileSync(join(out.path, 'CLAUDE.md'), 'utf8')).toBe(readFileSync(join(out.path, 'HANDOFF.md'), 'utf8'))
    expect([...readFileSync(join(out.path, 'screens/checkout.png'))]).toEqual([...PNG])
    // the frame that was not chosen is not in it
    expect(JSON.stringify(readdirSync(out.path))).not.toContain('scratch')
    expect(readFileSync(join(out.path, 'spec.json'), 'utf8')).not.toContain('Scratch')
    // the version is recorded after the files are on disk
    expect(d.saved).toEqual(['Handoff v1'])
    expect(out.summary.screens).toBe(1)
  })

  it('numbers the next export from the history, and adds the 2x PNG when asked', async () => {
    const { screen } = sample()
    const d = deps({ listVersions: async () => [{ name: 'Handoff v1' }, { name: 'Handoff v4' }, { name: 'Before launch' }] })
    const out = await runExport(doc(), req([screen], { retina: true }), d)
    expect(out.ok && out.version).toBe(5)
    if (!out.ok) return
    expect(tree(out.path)).toEqual(expect.arrayContaining(['screens/checkout.png', 'screens/checkout@2x.png']))
    expect(d.saved).toEqual(['Handoff v5'])
    expect(JSON.parse(readFileSync(join(out.path, 'spec.json'), 'utf8')).handoff.version).toBe(5)
  })

  it('drops dev notes when the option is off and keeps them when on', async () => {
    const { screen } = sample()
    const on = await runExport(doc(), req([screen]), deps({}, { path: join(dir, 'with') }))
    const off = await runExport(doc(), req([screen], { devNotes: false }), deps({}, { path: join(dir, 'without') }))
    if (!on.ok || !off.ok) throw new Error('export failed')
    expect(readFileSync(join(on.path, 'screens/checkout.md'), 'utf8')).toContain('Secret internal note')
    expect(readFileSync(join(off.path, 'screens/checkout.md'), 'utf8')).not.toContain('Secret internal note')
    expect(readFileSync(join(off.path, 'spec.json'), 'utf8')).not.toContain('Secret internal note')
    // the document itself still has the note
    expect(JSON.stringify(doc().nodes)).toContain('Secret internal note')
  })

  it('a zip has the same files under one top folder', async () => {
    const { screen } = sample()
    const out = await runExport(doc(), req([screen], { kind: 'zip' }), deps({}, { path: join(dir, 'out.zip') }))
    expect(out.ok && out.kind).toBe('zip')
    const zip = readFileSync(join(dir, 'out.zip'))
    expect(zip.readUInt32LE(0)).toBe(0x04034b50)
    expect(zip.includes(Buffer.from('acme-checkout-handoff-v1/HANDOFF.md'))).toBe(true)
  })
})

describe('failures and cancels write nothing and record nothing', () => {
  it('a failed write is reported with its reason and no version is saved', async () => {
    const { screen } = sample()
    const d = deps({ write: async () => ({ ok: false, error: 'The folder is read-only or the disk is full.' }) })
    const out = await runExport(doc(), req([screen]), d)
    expect(out).toEqual({ ok: false, error: 'The folder is read-only or the disk is full.' })
    expect(d.saved).toEqual([])
    expect(readdirSync(dir)).toEqual([])
  })

  it('cancelling the save dialog is a cancel, not an error', async () => {
    const { screen } = sample()
    const d = deps({ write: async () => ({ ok: false, canceled: true }) })
    const out = await runExport(doc(), req([screen]), d)
    expect(out).toEqual({ ok: false, canceled: true, stage: 'save-dialog' })
    expect(d.saved).toEqual([])
  })

  it('an aborted export writes nothing', async () => {
    const { screen } = sample()
    const ctl = new AbortController()
    ctl.abort()
    const d = deps()
    const out = await runExport(doc(), req([screen]), d, { signal: ctl.signal })
    expect(out).toEqual({ ok: false, canceled: true, stage: 'building' })
    expect(d.writes).toEqual([])
  })

  it('no chosen frames is an error, and an engine failure still writes the rest with a warning', async () => {
    const { screen } = sample()
    expect((await runExport(doc(), req([]), deps())).ok).toBe(false)
    const d = deps({ engine: { resize: async () => PNG, renderPng: vi.fn().mockRejectedValue(new Error('renderer gone')) } })
    const out = await runExport(doc(), req([screen]), d)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(tree(out.path)).not.toContain('screens/checkout.png')
    expect(out.warnings.join('\n')).toMatch(/could not be produced/)
  })
})

describe('preview', () => {
  it('counts, folder name, planned paths (PNG references included) and what a page pulls in', async () => {
    const { screen } = sample()
    const p = await previewExport(doc(), req([screen], { retina: true }), deps())
    expect(p).toMatchObject({ version: 1, folderName: 'acme-checkout-handoff-v1', screens: 1, components: 0, hidden: 0 })
    expect(p.files).toEqual(expect.arrayContaining(['HANDOFF.md', 'screens/checkout.md', 'screens/checkout.png', 'screens/checkout@2x.png', 'tokens/tokens.css']))
    expect(folderNameFor(doc(), 7)).toBe('acme-checkout-handoff-v7')
  })

  it('lists components from another page', async () => {
    const { screen } = sample()
    const page2 = S().addPage(id, 'Library')
    void page2
    const lib = doc().pages[1].rootId
    const btn = S().createNode(id, { type: 'frame', name: 'Button', style: { width: 80, height: 30 } }, lib)
    const main = S().createComponent(id, [btn])
    S().createInstance(id, main, screen)
    const p = await previewExport(doc(), req([screen]), deps())
    expect(p.components).toBe(1)
    expect(p.pulls).toEqual([{ page: 'Library', names: ['Button'] }])
  })
})

describe('ready marks drive the default scope', () => {
  it('marking records the hash; export keeps the mark; an edit shows as changed', async () => {
    const { screen, card } = sample()
    S().setReady(id, [screen], 3, { [screen]: frameHash(doc(), screen) as string })
    expect(readyStatus(doc(), screen)).toBe('ready')
    S().setText(id, doc().nodes[screen].children[0], 'Pay later')
    expect(readyStatus(doc(), screen)).toBe('changed')
    void card
  })
})

describe('second export: CHANGES.md against the previous Handoff vN (T72)', () => {
  /** a history that remembers the document at each saved version, like version history does */
  function history() {
    const saved: Array<{ id: string; name: string; doc: ReturnType<typeof doc> }> = []
    return {
      deps: (target: string): ExportDeps => ({
        ...deps({}, { path: target }),
        saveVersion: async (name: string) => void saved.push({ id: `v${saved.length + 1}`, name, doc: JSON.parse(JSON.stringify(doc())) }),
        listVersions: async () => saved.map((s) => ({ id: s.id, name: s.name })),
        loadVersion: async (versionId: string) => saved.find((s) => s.id === versionId)?.doc ?? null
      }),
      saved
    }
  }

  it('the first export has no CHANGES.md; the second lists exactly what was edited', async () => {
    const { screen, scratch } = sample()
    S().setReady(id, [screen, scratch], 1)
    const h = history()
    const first = await runExport(doc(), req([screen, scratch]), h.deps(join(dir, 'one')))
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(readdirSync(first.path)).not.toContain('CHANGES.md')
    expect(JSON.parse(readFileSync(join(first.path, 'spec.json'), 'utf8')).changes).toBeUndefined()

    // edit the title of one screen only
    const title = doc().nodes[screen].children[0]
    S().setText(id, title, 'Pay later')
    const second = await runExport(doc(), req([screen, scratch]), h.deps(join(dir, 'two')))
    expect(second.ok && second.version).toBe(2)
    if (!second.ok) return
    const md = readFileSync(join(second.path, 'CHANGES.md'), 'utf8')
    expect(md.split('\n')[0]).toBe('# Changes since handoff v1')
    expect(md).toContain('**Rebuild only these:** Checkout.')
    expect(md).toContain('**Unchanged:** Scratch.')
    expect(md).toContain('- Checkout › Title')
    expect(md).toContain('  - text: "Pay now" → "Pay later"')
    const spec = JSON.parse(readFileSync(join(second.path, 'spec.json'), 'utf8'))
    expect(spec.changes.counts).toEqual({ added: 0, removed: 0, changed: 1, unchanged: 1 })
    expect(readFileSync(join(second.path, 'HANDOFF.md'), 'utf8')).toMatch(/Read `CHANGES\.md` first/)
    expect(h.saved.map((s) => s.name)).toEqual(['Handoff v1', 'Handoff v2'])
  })

  it('the preview shows the same counts the file will carry, and nothing without an earlier export', async () => {
    const { screen } = sample()
    S().setReady(id, [screen], 1)
    const h = history()
    const none = await previewExport(doc(), req([screen]), h.deps(join(dir, 'x')))
    expect(none.changes).toBeUndefined()
    await runExport(doc(), req([screen]), h.deps(join(dir, 'one')))
    S().setText(id, doc().nodes[screen].children[0], 'Later')
    const p = await previewExport(doc(), req([screen]), h.deps(join(dir, 'x')))
    expect(p.changes).toMatchObject({ previous: 1, counts: { changed: 1, unchanged: 0 }, rebuild: ['Checkout'] })
    expect(p.files).toContain('CHANGES.md')
  })

  it('an unreadable earlier version means no CHANGES.md rather than a failed export', async () => {
    const { screen } = sample()
    S().setReady(id, [screen], 1)
    const h = history()
    await runExport(doc(), req([screen]), h.deps(join(dir, 'one')))
    const d = { ...h.deps(join(dir, 'two')), loadVersion: async () => null }
    const out = await runExport(doc(), req([screen]), d)
    expect(out.ok).toBe(true)
    if (out.ok) expect(readdirSync(out.path)).not.toContain('CHANGES.md')
  })
})
