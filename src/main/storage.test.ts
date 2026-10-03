// storage.ts with Electron mocked: userData and appData point into a temp dir under the OS temp folder.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  base: '',
  handlers: new Map<string, (...args: unknown[]) => unknown>()
}))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'appData' ? h.base : name === 'userData' ? `${h.base}/Vellum` : h.base),
    on: () => undefined,
    quit: () => undefined
  },
  ipcMain: { handle: (ch: string, fn: (...args: unknown[]) => unknown) => void h.handlers.set(ch, fn) },
  dialog: {},
  session: { defaultSession: { clearCache: async () => undefined } },
  BrowserWindow: { fromWebContents: () => null }
}))
vi.mock('./offscreen', () => ({ disposeRenderer: async () => undefined }))

import { IPC } from '@shared/api'
import { getVault, listDocs, migrateLegacyUserData, registerStorageIpc } from './storage'

const call = async <T>(channel: string, ...args: unknown[]): Promise<T> => (await h.handlers.get(channel)!({}, ...args)) as T
const doc = (id: string, name: string, extra = {}) => ({ id, name, updatedAt: Date.now(), pages: [], nodes: {}, ...extra })
let userData: string

beforeAll(() => {
  h.base = mkdtempSync(join(tmpdir(), 'vellum-storage-vitest-'))
  userData = join(h.base, 'Vellum')
  mkdirSync(userData, { recursive: true })
  registerStorageIpc()
})
afterAll(async () => {
  await getVault().close()
  rmSync(h.base, { recursive: true, force: true })
})

describe('legacy folder migration (Canvas -> Vellum)', () => {
  it('copies files and index.json, leaving the old folder untouched', () => {
    const old = join(h.base, 'Canvas')
    mkdirSync(join(old, 'files'), { recursive: true })
    writeFileSync(join(old, 'files', 'old1.json'), JSON.stringify(doc('old1', 'Old doc', { version: 1 })))
    writeFileSync(join(old, 'files', 'ignore.txt'), 'x')
    writeFileSync(join(old, 'index.json'), '{"recents":[]}')
    migrateLegacyUserData()
    expect(JSON.parse(readFileSync(join(userData, 'files', 'old1.json'), 'utf8')).name).toBe('Old doc')
    expect(existsSync(join(userData, 'files', 'ignore.txt'))).toBe(false)
    expect(existsSync(join(userData, 'index.json'))).toBe(true)
    expect(existsSync(join(old, 'files', 'old1.json'))).toBe(true)
  })

  it('does not run again once files exist', () => {
    writeFileSync(join(h.base, 'Canvas', 'files', 'old2.json'), JSON.stringify(doc('old2', 'Later')))
    migrateLegacyUserData()
    expect(existsSync(join(userData, 'files', 'old2.json'))).toBe(false)
  })
})

describe('saveDoc / loadDoc / listDocs over IPC', () => {
  it('moves the migrated files into the first profile', async () => {
    const r = await call<{ ok: boolean; migrated?: number }>(IPC.profCreate, { name: 'First', password: 'pw-storage' })
    expect(r.ok).toBe(true)
    expect(r.migrated).toBe(1)
    expect((await listDocs()).map((d) => d.id)).toEqual(['old1'])
  }, 60_000)

  it('saves and loads a doc round-trip, encrypted on disk', async () => {
    const d = doc('d1', 'Design one', { version: 2 })
    await call(IPC.saveDoc, d)
    expect(await call(IPC.loadDoc, 'd1')).toEqual(d)
    const onDisk = readFileSync(join(getVault().currentDir(), 'files', 'd1.json'))
    expect(onDisk.subarray(0, 4).toString()).toBe('VLME')
    expect(onDisk.includes(Buffer.from('Design one'))).toBe(false)
    expect((await listDocs()).map((x) => x.id).sort()).toEqual(['d1', 'old1'])
  })

  it('loads an old (v1) doc as stored; version migration happens in the renderer (ops.test.ts)', async () => {
    expect(((await call(IPC.loadDoc, 'old1')) as { version: number }).version).toBe(1)
  })

  it('returns null for a missing or corrupt doc', async () => {
    expect(await call(IPC.loadDoc, 'nope')).toBeNull()
    writeFileSync(join(getVault().currentDir(), 'files', 'bad.json'), '{"id":"bad", "na')
    expect(await call(IPC.loadDoc, 'bad')).toBeNull()
    expect((await listDocs()).some((x) => x.id === 'bad')).toBe(false)
  })

  it('rejects invalid ids and payloads', async () => {
    await expect(call(IPC.loadDoc, '../evil')).rejects.toThrow()
    await expect(call(IPC.saveDoc, null)).rejects.toThrow('Invalid document')
    await expect(call(IPC.saveDoc, doc('../x', 'x'))).rejects.toThrow()
  })

  it('deletes a doc', async () => {
    await call(IPC.deleteDoc, 'd1')
    expect(await call(IPC.loadDoc, 'd1')).toBeNull()
  })
})
