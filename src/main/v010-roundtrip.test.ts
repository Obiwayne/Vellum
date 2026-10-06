// The whole path for a v0.1.0 userData folder, with a plain and a password-protected first profile: migration into
// the profile (storage IPC), the renderer's own startup (persist.initPersistence: load, migrateDoc, save) over the same
// IPC handlers, then loading the saved files again through the vault. Fixtures: real files saved by v0.1.0
// (model/fixtures/v1), plus a v4 variants doc and a Canvas-era doc.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ base: '', handlers: new Map<string, (...args: unknown[]) => unknown>() }))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'appData' ? h.base : name === 'userData' ? `${h.base}/Vellum` : h.base),
    on: () => undefined,
    quit: () => undefined
  },
  ipcMain: { handle: (ch: string, fn: (...args: unknown[]) => unknown) => void h.handlers.set(ch, fn), on: () => undefined },
  dialog: {},
  session: { defaultSession: { clearCache: async () => undefined } },
  BrowserWindow: { fromWebContents: () => null }
}))
vi.mock('./offscreen', () => ({ disposeRenderer: async () => undefined }))

import { IPC } from '@shared/api'

const models = join(__dirname, '../renderer/src/model/fixtures')
type Raw = Record<string, unknown> & { id: string; version?: number }
const read = (p: string): Raw => JSON.parse(readFileSync(p, 'utf8'))
const call = async <T>(channel: string, ...args: unknown[]): Promise<T> => (await h.handlers.get(channel)!({}, ...args)) as T

const originals = [
  read(join(models, 'v1/files/i1wL51Z8AV_4.json')),
  read(join(models, 'v1/files/d2_WyuDutjln.json')),
  read(join(models, 'v1/files/Ds7_k1U7cioJ.json')),
  read(join(models, 'v4/buttons-v4.json')),
  read(join(models, 'canvas-era/old-sketch-no-version.json'))
]

describe.each([
  { label: 'plain profile', password: undefined as string | undefined },
  { label: 'password-protected profile', password: 'correct horse' }
])('v0.1.0 userData through migration, startup and save ($label)', ({ password }) => {
  let storage: typeof import('./storage')
  let DOC_VERSION: number
  let migrateDoc: (d: never) => unknown
  let store: typeof import('../renderer/src/model/store')
  let persist: typeof import('../renderer/src/model/persist')

  beforeAll(async () => {
    h.base = mkdtempSync(join(tmpdir(), 'vellum-v010-roundtrip-'))
    const userData = join(h.base, 'Vellum')
    mkdirSync(join(userData, 'files'), { recursive: true })
    cpSync(join(models, 'v1/files'), join(userData, 'files'), { recursive: true })
    cpSync(join(models, 'v4/buttons-v4.json'), join(userData, 'files/v4variantsDoc.json'))
    cpSync(join(models, 'canvas-era/old-sketch-no-version.json'), join(userData, 'files/v010legacyV1.json'))
    cpSync(join(models, 'v1/index.json'), join(userData, 'index.json'))
    // fresh vault and persistence state for each run
    vi.resetModules()
    storage = await import('./storage')
    storage.registerStorageIpc()
    const ops = await import('../renderer/src/model/ops')
    DOC_VERSION = ops.DOC_VERSION
    migrateDoc = ops.migrateDoc as never
    store = await import('../renderer/src/model/store')
    persist = await import('../renderer/src/model/persist')
  })
  afterAll(async () => {
    await storage.getVault().close()
    rmSync(h.base, { recursive: true, force: true })
  })

  it('moves the legacy files into the first profile (encrypted on disk when it has a password)', async () => {
    const r = await call<{ ok: boolean; migrated?: number }>(IPC.profCreate, { name: 'Obi', ...(password ? { password } : {}) })
    expect(r.ok).toBe(true)
    expect(r.migrated).toBe(originals.length)
    const onDisk = readFileSync(join(storage.getVault().currentDir(), 'files', `${originals[0].id}.json`))
    expect(isEncrypted(onDisk)).toBe(Boolean(password))
  }, 60_000)

  it('the renderer startup loads and migrates every file, and writes the upgraded docs back', async () => {
    ;(globalThis as { window?: unknown }).window = {
      addEventListener: () => undefined,
      canvasApi: {
        loadIndex: () => call(IPC.loadIndex),
        saveIndex: (i: unknown) => call(IPC.saveIndex, i),
        listDocs: () => call(IPC.listDocs),
        loadDoc: (id: string) => call(IPC.loadDoc, id),
        saveDoc: (d: unknown) => call(IPC.saveDoc, d),
        deleteDoc: (id: string) => call(IPC.deleteDoc, id)
      }
    }
    await persist.initPersistence()
    expect(Object.keys(store.getStore().docs).sort()).toEqual(originals.map((d) => d.id).sort())
    await persist.flushAndStop()
  })

  it('every saved doc loads back at the current version, equals the original apart from the version bump, and re-migrating changes nothing', async () => {
    type N = { type: string; style: Record<string, unknown> }
    for (const original of originals) {
      const saved = await call<Raw & { nodes: Record<string, N> }>(IPC.loadDoc, original.id)
      expect(saved.version).toBe(DOC_VERSION)
      const expected = JSON.parse(JSON.stringify(original))
      expected.version = DOC_VERSION
      if (original.version === undefined) {
        // the Canvas-era doc: only text with no line height gains the old 20px
        for (const n of Object.values(expected.nodes as Record<string, N>)) {
          if (n.type === 'text' && n.style.lineHeight === undefined) n.style.lineHeight = '20px'
        }
      }
      // the Scratchpad is re-saved with its flags; nothing else may differ
      const { scratchpad, archived, ...rest } = saved as Record<string, unknown>
      expect(scratchpad === undefined || scratchpad === true).toBe(true)
      expect(archived === undefined || archived === false).toBe(true)
      const { scratchpad: _s, archived: _a, ...restExpected } = expected
      expect(rest).toEqual(restExpected)
      expect(migrateDoc(saved as never)).toBe(saved)
    }
  })

  it('the index survives: tabs, prefs and the scratchpad id', async () => {
    const index = await call<{ prefs: unknown; scratchpadId: string; tabs: string[] }>(IPC.loadIndex)
    const original = read(join(models, 'v1/index.json')) as unknown as typeof index
    expect(index.prefs).toEqual(original.prefs)
    expect(index.scratchpadId).toBe(original.scratchpadId)
    expect(index.tabs).toEqual(original.tabs)
  })
})
