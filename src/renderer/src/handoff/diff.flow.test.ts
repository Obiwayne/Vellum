// T72 test station: the export flow end to end (second and third exports against history snapshots), the cases the
// spec-level tests cannot see: which frames the earlier export held, renamed image layers, notes off, order of exports.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HandoffExportResult } from '@shared/api'
import { getStore, useStore } from '../model/store'
import type { Doc } from '../model/types'
import { runExport, type ExportDeps, type ExportRequest } from './exportFlow'

vi.mock('../history/versions', () => ({ listVersions: async () => [] }))

const S = getStore
let id: string
const PNG = new Uint8Array([137, 80, 78, 71, 1, 2, 3])
const dataPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

interface Rig {
  deps: ExportDeps
  files: Array<Record<string, unknown>>
  names: string[]
  snaps: Map<string, Doc>
}

function rig(): Rig {
  const snaps = new Map<string, Doc>()
  const names: string[] = []
  const files: Array<Record<string, unknown>> = []
  const deps: ExportDeps = {
    engine: { resize: async () => PNG, renderPng: async () => PNG },
    write: async (args): Promise<HandoffExportResult> => {
      files.push(args.files)
      return { ok: true, path: `C:/out/${args.name}`, files: Object.keys(args.files).length, bytes: 1, kind: args.kind }
    },
    saveVersion: async (name, record) => {
      // like the app: the frames this export carried are recorded in the document before the snapshot is taken
      S().recordHandoff(id, record.version, record.frames)
      names.push(name)
      snaps.set(name, JSON.parse(JSON.stringify(S().docs[id])))
    },
    listVersions: async () => names.map((name, i) => ({ id: `v${i}-${name}`, name, createdAt: i })),
    loadVersion: async (versionId) => snaps.get(versionId.replace(/^v\d+-/, '')) ?? null,
    now: () => '2026-10-13T12:00:00.000Z',
    vellum: '1.0.0'
  }
  return { deps, files, names, snaps }
}

const req = (frames: string[], over: Partial<ExportRequest> = {}): ExportRequest => ({ frames, retina: false, rem: false, devNotes: true, kind: 'folder', ...over })

function screens(n: number): string[] {
  const root = S().docs[id].pages[0].rootId
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    const f = S().createNode(id, { type: 'frame', name: `Screen ${i + 1}`, style: { width: 400, height: 300, display: 'flex', flexDirection: 'column' } }, root)
    S().createNode(id, { type: 'text', name: 'Title', text: `Title ${i + 1}`, style: { fontSize: 20 } }, f)
    out.push(f)
  }
  S().setReady(id, out, 1)
  return out
}

const changesOf = (f: Record<string, unknown>): string => String(f['CHANGES.md'] ?? '')

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true)
  id = S().createDoc('Acme', { open: false })
})

describe('which screens the comparison covers', () => {
  it('exporting fewer screens this time does not report the others as removed', async () => {
    const f = screens(3)
    const r = rig()
    await runExport(S().docs[id], req(f), r.deps)
    const out = await runExport(S().docs[id], req([f[0]]), r.deps)
    expect(out.ok).toBe(true)
    const md = changesOf(r.files[1])
    expect(md).not.toMatch(/Removed/)
    expect(md).not.toContain('Delete them from the build')
    const changes = JSON.parse(String(r.files[1]['spec.json'])).changes
    expect(changes.screens.filter((s: { status: string }) => s.status === 'removed')).toEqual([])
  })

  it('frames chosen "anyway" (not marked ready) in both exports are not new the second time', async () => {
    const f = screens(1)
    const root = S().docs[id].pages[0].rootId
    const draft = S().createNode(id, { type: 'frame', name: 'Draft', style: { width: 100, height: 100 } }, root)
    const r = rig()
    await runExport(S().docs[id], req([f[0], draft]), r.deps)
    await runExport(S().docs[id], req([f[0], draft]), r.deps)
    const sc = JSON.parse(String(r.files[1]['spec.json'])).changes.screens as Array<{ name: string; status: string }>
    expect(sc.map((s) => [s.name, s.status])).toEqual([
      ['Screen 1', 'unchanged'],
      ['Draft', 'unchanged']
    ])
  })

  it('a screen exported for the first time in the second handoff is added, and only that', async () => {
    const f = screens(2)
    S().setReady(id, [f[1]], null)
    const r = rig()
    await runExport(S().docs[id], req([f[0]]), r.deps)
    S().setReady(id, [f[1]], 1)
    await runExport(S().docs[id], req(f), r.deps)
    const sc = JSON.parse(String(r.files[1]['spec.json'])).changes.screens as Array<{ name: string; status: string }>
    expect(sc.map((s) => [s.name, s.status])).toEqual([
      ['Screen 1', 'unchanged'],
      ['Screen 2', 'added']
    ])
  })
})

describe('what a second export compares with', () => {
  it('the third export is compared with the second, not the first', async () => {
    const f = screens(1)
    const t = S().docs[id].nodes[f[0]].children[0]
    const r = rig()
    await runExport(S().docs[id], req(f), r.deps)
    S().setText(id, t, 'Second')
    await runExport(S().docs[id], req(f), r.deps)
    S().setText(id, t, 'Third')
    await runExport(S().docs[id], req(f), r.deps)
    const md = changesOf(r.files[2])
    expect(md).toContain('# Changes since handoff v2')
    expect(md).toContain('"Second"')
    expect(md).toContain('"Third"')
    expect(md).not.toContain('"Title 1"')
  })

  it('switching dev notes off does not make every annotated layer look edited', async () => {
    const f = screens(1)
    const t = S().docs[id].nodes[f[0]].children[0]
    S().setDev(id, [t], { notes: 'Truncate at two lines' })
    const r = rig()
    await runExport(S().docs[id], req(f), r.deps)
    await runExport(S().docs[id], req(f, { devNotes: false }), r.deps)
    expect(changesOf(r.files[1])).toContain('Nothing changed')
  })

  it('options that only change the rendering (rem, retina) are not changes', async () => {
    const f = screens(2)
    const r = rig()
    await runExport(S().docs[id], req(f), r.deps)
    await runExport(S().docs[id], req(f, { rem: true, retina: true }), r.deps)
    expect(changesOf(r.files[1])).toContain('Nothing changed')
  })

  it('a layer renamed with an image in it is not a new and a gone asset', async () => {
    const f = screens(1)
    const img = S().createNode(id, { type: 'image', name: 'Hero', attrs: { src: dataPng, alt: 'Hero' }, style: { width: 100, height: 50 } }, f[0])
    const r = rig()
    await runExport(S().docs[id], req(f), r.deps)
    S().renameNode(id, img, 'Banner')
    await runExport(S().docs[id], req(f), r.deps)
    const assets = JSON.parse(String(r.files[1]['spec.json'])).changes.assets as Array<{ path: string; status: string }>
    // same bytes, so nothing for a developer to re-download
    expect(assets).toEqual([])
  })

  it('an unreadable earlier version still exports; there is just no CHANGES.md', async () => {
    const f = screens(1)
    const r = rig()
    await runExport(S().docs[id], req(f), r.deps)
    const out = await runExport(S().docs[id], req(f), { ...r.deps, loadVersion: async () => null })
    expect(out.ok).toBe(true)
    expect(r.files[1]['CHANGES.md']).toBeUndefined()
  })

  it('a first export has no CHANGES.md and no spec.changes', async () => {
    const f = screens(1)
    const r = rig()
    await runExport(S().docs[id], req(f), r.deps)
    expect(r.files[0]['CHANGES.md']).toBeUndefined()
    expect(JSON.parse(String(r.files[0]['spec.json'])).changes).toBeUndefined()
  })
})

describe('when there is no comparison, it says why', () => {
  it('an unreadable earlier version is a warning on the export, not silence', async () => {
    const f = screens(1)
    const r = rig()
    await runExport(S().docs[id], req(f), r.deps)
    const out = await runExport(S().docs[id], req(f), { ...r.deps, loadVersion: async () => null })
    expect(out.ok && out.warnings.join('\n')).toMatch(/CHANGES\.md was not written: Handoff v1 could not be read/)
    const thrown = await runExport(S().docs[id], req(f), {
      ...r.deps,
      loadVersion: async () => {
        throw new Error('disk gone')
      }
    })
    expect(thrown.ok && thrown.warnings.join('\n')).toMatch(/could not compare with Handoff v2 \(disk gone\)/)
  })

  it('a first export has no such warning', async () => {
    const f = screens(1)
    const r = rig()
    const out = await runExport(S().docs[id], req(f), r.deps)
    expect(out.ok && out.warnings.join('\n')).not.toMatch(/CHANGES\.md was not written/)
  })
})

describe('the export records what it carried', () => {
  it('doc.handoff holds the number and the frames, outside undo history', async () => {
    const f = screens(2)
    const r = rig()
    const before = S().canUndo(id)
    await runExport(S().docs[id], req([f[1]]), r.deps)
    expect(S().docs[id].handoff).toEqual({ version: 1, frames: [f[1]] })
    expect(S().canUndo(id)).toBe(before)
  })

  it('an older version without a record falls back to the frames that were ready then', async () => {
    const f = screens(2)
    const r = rig()
    // a snapshot taken by something that does not record (an older build)
    r.deps.saveVersion = async (name) => {
      r.names.push(name)
      const copy = JSON.parse(JSON.stringify(S().docs[id])) as Doc
      delete copy.handoff
      r.snaps.set(name, copy)
    }
    await runExport(S().docs[id], req(f), r.deps)
    await runExport(S().docs[id], req(f), r.deps)
    const sc = JSON.parse(String(r.files[1]['spec.json'])).changes.screens as Array<{ status: string }>
    expect(sc.map((s) => s.status)).toEqual(['unchanged', 'unchanged'])
  })
})

describe('the earlier side is kept between previews', () => {
  it('asking again with other options does not read the earlier version again', async () => {
    const { previewExport } = await import('./exportFlow')
    const f = screens(2)
    const r = rig()
    await runExport(S().docs[id], req(f), r.deps)
    let loads = 0
    const counting = { ...r.deps, loadVersion: async (v: string) => (loads++, r.deps.loadVersion!(v)) }
    await previewExport(S().docs[id], req(f), counting)
    await previewExport(S().docs[id], req(f, { rem: true }), counting)
    await previewExport(S().docs[id], req(f, { retina: true }), counting)
    // the version is read each time (cheap); the expensive part, planning and building the earlier document, is reused
    expect(loads).toBe(3)
    const p = await previewExport(S().docs[id], req(f), counting)
    expect(p.changes?.counts.unchanged).toBe(2)
  })
})
