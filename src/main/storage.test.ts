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

  it('keeps text styles and node links through save and load', async () => {
    const d = doc('d2', 'Styled', {
      version: 5,
      textStyles: [{ id: '9-0', name: 'Heading/H1', style: { fontSize: 'var(--text-lg)', fontWeight: 700 } }],
      nodes: { '1-0': { id: '1-0', type: 'text', textStyle: '9-0', style: { fontSize: 'var(--text-lg)' } } }
    })
    await call(IPC.saveDoc, d)
    expect(await call(IPC.loadDoc, 'd2')).toEqual(d)
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

describe('recovery copies and backups over IPC', () => {
  const dir = (): string => join(getVault().currentDir(), 'files')

  it('saveRecovery writes an encrypted <id>.recovery; listRecoveries returns it; a clean saveDoc deletes it', async () => {
    const d = doc('rx', 'Unsaved plan', { updatedAt: 5 })
    await call(IPC.saveRecovery, d)
    const onDisk = readFileSync(join(dir(), 'rx.recovery'))
    expect(onDisk.subarray(0, 4).toString()).toBe('VLME')
    expect(onDisk.includes(Buffer.from('Unsaved plan'))).toBe(false)
    expect(existsSync(join(dir(), 'rx.recovery.bak'))).toBe(false)
    expect(((await call(IPC.listRecoveries)) as { id: string }[]).map((r) => r.id)).toEqual(['rx'])
    expect((await listDocs()).some((x) => x.id === 'rx')).toBe(false) // a recovery copy is not a file in the list
    await call(IPC.saveDoc, d)
    expect(existsSync(join(dir(), 'rx.recovery'))).toBe(false)
    expect(await call(IPC.listRecoveries)).toEqual([])
  })

  it('a newer recovery copy replaces an older one; discardRecovery removes it', async () => {
    await call(IPC.saveRecovery, doc('ry', 'v1', { updatedAt: 1 }))
    await call(IPC.saveRecovery, doc('ry', 'v2', { updatedAt: 2 }))
    expect(((await call(IPC.listRecoveries)) as { name: string }[]).map((r) => r.name)).toEqual(['v2'])
    await call(IPC.discardRecovery, 'ry')
    expect(await call(IPC.listRecoveries)).toEqual([])
    await call(IPC.discardRecovery, 'ry') // nothing left: fine
  })

  it('unreadable, foreign and empty recovery files are dropped instead of offered', async () => {
    writeFileSync(join(dir(), 'zz.recovery'), 'garbage')
    await call(IPC.saveRecovery, doc('other', 'Other'))
    // a copy whose content belongs to another id (renamed by hand) is refused
    writeFileSync(join(dir(), 'liar.recovery'), readFileSync(join(dir(), 'other.recovery')))
    const got = (await call(IPC.listRecoveries)) as { id: string }[]
    expect(got.map((r) => r.id)).toEqual(['other'])
    expect(existsSync(join(dir(), 'zz.recovery'))).toBe(false)
    expect(existsSync(join(dir(), 'liar.recovery'))).toBe(false)
    await call(IPC.discardRecovery, 'other')
  })

  it('rejects invalid recovery payloads and ids', async () => {
    await expect(call(IPC.saveRecovery, null)).rejects.toThrow('Invalid document')
    await expect(call(IPC.saveRecovery, doc('../x', 'x'))).rejects.toThrow()
    await expect(call(IPC.discardRecovery, '../x')).rejects.toThrow()
  })

  it('a damaged design loads from its .bak, and takeRestored names it once', async () => {
    const d1 = doc('bk', 'First', { updatedAt: 1 })
    const d2 = doc('bk', 'Second', { updatedAt: 2 })
    await call(IPC.saveDoc, d1)
    await call(IPC.saveDoc, d2) // .bak = First
    await call(IPC.takeRestored)
    const file = join(dir(), 'bk.json')
    writeFileSync(file, readFileSync(file).subarray(0, 30)) // truncated: the kind of file a crash leaves
    expect(await call(IPC.loadDoc, 'bk')).toEqual(d1)
    expect((await listDocs()).some((x) => x.id === 'bk' && x.name === 'First')).toBe(true)
    expect(await call(IPC.takeRestored)).toEqual(['files/bk.json'])
    expect(await call(IPC.takeRestored)).toEqual([])
    // the next save heals the file; the backup stays the last good copy until then
    await call(IPC.saveDoc, doc('bk', 'Third', { updatedAt: 3 }))
    expect(((await call(IPC.loadDoc, 'bk')) as { name: string }).name).toBe('Third')
  })

  it('the file index falls back to its .bak', async () => {
    await call(IPC.saveIndex, { recents: ['a'], tabs: ['dashboard'], activeTab: 'dashboard', prefs: {} })
    await call(IPC.saveIndex, { recents: ['a', 'b'], tabs: ['dashboard'], activeTab: 'dashboard', prefs: {} })
    await call(IPC.takeRestored)
    writeFileSync(join(getVault().currentDir(), 'index.json'), 'xx')
    expect(((await call(IPC.loadIndex)) as { recents: string[] }).recents).toEqual(['a'])
    expect(await call(IPC.takeRestored)).toEqual(['index.json'])
  })

  it('deleting a design removes its recovery copy and its backup', async () => {
    await call(IPC.saveDoc, doc('del', 'One', { updatedAt: 1 }))
    await call(IPC.saveDoc, doc('del', 'Two', { updatedAt: 2 }))
    await call(IPC.saveRecovery, doc('del', 'Three', { updatedAt: 3 }))
    expect(existsSync(join(dir(), 'del.json.bak'))).toBe(true)
    await call(IPC.deleteDoc, 'del')
    for (const n of ['del.json', 'del.json.bak', 'del.recovery']) expect(existsSync(join(dir(), n))).toBe(false)
  })
})

describe('closing while saves are on their way', () => {
  it('a save that has arrived but not yet reached the write queue still lands before the profile locks', async () => {
    const { lockProfile } = await import('./storage')
    const id = getVault().currentProfile!.id
    const d = doc('late', 'Sent while closing', { updatedAt: 9 })
    const pending = call(IPC.saveDoc, d) // not awaited: the window is closing and its last save is still in the handler
    const lock = lockProfile()
    await Promise.all([pending, lock])
    expect(getVault().isOpen()).toBe(false)
    const r = await call<{ ok: boolean }>(IPC.profOpen, id, 'pw-storage')
    expect(r.ok).toBe(true)
    expect(await call(IPC.loadDoc, 'late')).toEqual(d)
  }, 60_000)
})
