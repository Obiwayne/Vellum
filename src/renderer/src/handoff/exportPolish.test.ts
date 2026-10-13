// T65 follow-ups: the copy-prompt only names files in the tree, the previous handoff is read from history,
// a version that cannot be recorded is reported, and Dev Mode refuses the ready marks with the read-only toast.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HandoffExportResult } from '@shared/api'
import { getStore, onEditRefused, useStore } from '../model/store'
import { runExport, type ExportDeps, type ExportRequest } from './exportFlow'
import { promptFor } from './exportPrompt'
import { previousHandoff } from './ready'
import { clearReady, markReady, toggleReady } from './readyActions'

vi.mock('../history/versions', () => ({ listVersions: async () => [] }))

const S = getStore
let id: string
const PNG = new Uint8Array([137, 80, 78, 71, 1, 2, 3])

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true)
  id = S().createDoc('Acme', { open: false })
})

function frame(): string {
  return S().createNode(id, { type: 'frame', name: 'Home', style: { width: 400, height: 300 } }, S().docs[id].pages[0].rootId)
}

function deps(over: Partial<ExportDeps> = {}): ExportDeps {
  return {
    engine: { resize: async () => PNG, renderPng: async () => PNG },
    write: async (args): Promise<HandoffExportResult> => ({ ok: true, path: `C:/out/${args.name}`, files: Object.keys(args.files).length, bytes: 10, kind: args.kind }),
    saveVersion: async () => undefined,
    listVersions: async () => [],
    now: () => '2026-10-13T12:00:00.000Z',
    vellum: '1.0.0',
    ...over
  }
}

const req = (frames: string[]): ExportRequest => ({ frames, retina: false, rem: false, devNotes: true, kind: 'folder' })

describe('promptFor: the sentence names only files that are in the tree', () => {
  it('a first handoff has no CHANGES.md in the prompt', () => {
    const p = promptFor(['HANDOFF.md', 'CLAUDE.md', 'spec.json', 'screens/home.md', 'screens/home.png'])
    expect(p).toBe('Read HANDOFF.md first; build and verify against screens/*.png')
    expect(p).not.toContain('CHANGES.md')
  })
  it('names CHANGES.md when the tree has it', () => {
    expect(promptFor(['HANDOFF.md', 'CHANGES.md', 'screens/home.png'])).toBe('Read HANDOFF.md first, then CHANGES.md; build and verify against screens/*.png')
  })
  it('without PNG references it points at the markdown specs instead', () => {
    expect(promptFor(['HANDOFF.md', 'screens/home.md'])).toBe('Read HANDOFF.md first; build from screens/*.md')
  })
  it('every file the prompt names is in the tree it was made from (property over several trees)', () => {
    const trees = [
      ['HANDOFF.md'],
      ['HANDOFF.md', 'CHANGES.md'],
      ['HANDOFF.md', 'screens/a.png', 'screens/a@2x.png'],
      ['HANDOFF.md', 'CHANGES.md', 'screens/a.md', 'screens/a.png'],
      ['spec.json']
    ]
    for (const t of trees) {
      const named = [...promptFor(t).matchAll(/\b([A-Za-z]+\.md)\b/g)].map((m) => m[1])
      for (const n of named) expect(t.some((p) => p === n || p.endsWith(`/${n}`)), `${n} in ${JSON.stringify(t)}`).toBe(true)
      if (/screens\/\*\.png/.test(promptFor(t))) expect(t.some((p) => /^screens\/[^/]+\.png$/.test(p))).toBe(true)
    }
  })
})

describe('what an export reports', () => {
  it('returns the written paths, so the prompt can be made from them', async () => {
    const f = frame()
    const out = await runExport(S().docs[id], req([f]), deps())
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.paths).toContain('HANDOFF.md')
    expect(out.paths.some((p) => /^screens\/.+\.png$/.test(p))).toBe(true)
    expect(out.paths).not.toContain('CHANGES.md')
    expect(promptFor(out.paths)).not.toContain('CHANGES.md')
    expect(out.versionSaved).toBe(true)
  })

  it('a version that cannot be recorded is a warning, the files stay, and the done screen does not claim it', async () => {
    const f = frame()
    const out = await runExport(S().docs[id], req([f]), deps({ saveVersion: async () => Promise.reject(new Error('disk full')) }))
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.versionSaved).toBe(false)
    expect(out.warnings[0]).toMatch(/could not be saved in version history \(disk full\)/)
  })
})

describe('previousHandoff', () => {
  it('is the highest numbered export with its date, ignoring other names', () => {
    expect(previousHandoff([{ name: 'Before restore', createdAt: 9 }, { name: 'Handoff v2', createdAt: 200 }, { name: 'Handoff v10', createdAt: 100 }, { createdAt: 5 }])).toEqual({ version: 10, at: 100 })
    expect(previousHandoff([])).toBeUndefined()
    expect(previousHandoff([{ name: 'Handoff v1' }])).toEqual({ version: 1, at: 0 })
  })
})

describe('ready marks in Dev Mode', () => {
  it('say the file is read-only instead of doing nothing', async () => {
    const f = frame()
    S().setDevMode(id, true)
    const refused = vi.fn()
    const off = onEditRefused(refused)
    expect(await markReady(id, [f])).toBe(0)
    clearReady(id, [f])
    await toggleReady(id, [f])
    off()
    expect(refused).toHaveBeenCalledTimes(3) // mark, clear, and the toggle (which is a mark)
    expect(S().docs[id].nodes[f].dev).toBeUndefined()
  })
})
