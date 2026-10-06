// Crash safety of the profile store (vault.ts): atomic writes survive a kill at any point, a damaged file is read from its
// .bak copy, and the .bak / recovery files follow the profile's encryption. Plain and password-protected profiles.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BAK, Vault, isEncrypted } from './vault'

const doc = (id: string, name: string, extra = {}) => ({ id, name, updatedAt: 1, pages: [], nodes: {}, ...extra })
const raw = (p: string): Buffer => readFileSync(p)
const T = 60_000

let base: string
beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'vellum-crash-vitest-'))
})
afterAll(() => rmSync(base, { recursive: true, force: true }))

/** overwrite a few bytes in the middle with zeros: still a file, no longer valid JSON / ciphertext (a bit flip alone can leave plain JSON parseable) */
const damage = (path: string): void => {
  const b = Buffer.from(raw(path))
  b.fill(0, Math.floor(b.length / 2), Math.floor(b.length / 2) + 6)
  writeFileSync(path, b)
}
const truncate = (path: string): void => writeFileSync(path, raw(path).subarray(0, Math.floor(raw(path).length / 2)))

function suite(label: string, password: string | undefined): void {
  describe(`${label}: atomic writes and .bak`, () => {
    let v: Vault
    let id: string
    const file = (...p: string[]): string => v.path(...p)

    beforeAll(async () => {
      v = new Vault(join(base, label.replace(/\W+/g, '-')), { throttleBaseMs: 0 })
      id = (await v.create({ name: 'P', ...(password ? { password } : {}) })).profile.id
    }, T)

    it('a kill between the temp write and the rename leaves the old file loading, and the next save cleans up', async () => {
      const path = file('files', 'k1.json')
      await v.writeJson(path, JSON.stringify(doc('k1', 'old')))
      // the process died after writing (part of) the new bytes to <path>.tmp, before renaming
      writeFileSync(`${path}.tmp`, '{"id":"k1","name":"half-writ')
      expect(((await v.readJson(path)) as { name: string }).name).toBe('old')
      await v.writeJson(path, JSON.stringify(doc('k1', 'new')))
      expect(existsSync(`${path}.tmp`)).toBe(false)
      expect(((await v.readJson(path)) as { name: string }).name).toBe('new')
    })

    it('a complete but never-renamed temp file does not replace the file either, and reopening deletes it', async () => {
      const path = file('files', 'k2.json')
      await v.writeJson(path, JSON.stringify(doc('k2', 'kept')))
      writeFileSync(`${path}.tmp`, JSON.stringify(doc('k2', 'never renamed')))
      expect(((await v.readJson(path)) as { name: string }).name).toBe('kept')
      await v.close()
      await v.open(id, password)
      expect(existsSync(`${path}.tmp`)).toBe(false)
      expect(((await v.readJson(file('files', 'k2.json'))) as { name: string }).name).toBe('kept')
    }, T)

    it('keeps the previous version as <file>.bak, sealed like the file itself', async () => {
      const path = file('files', 'b1.json')
      await v.writeJson(path, JSON.stringify(doc('b1', 'one')))
      expect(existsSync(BAK(path))).toBe(false) // nothing to back up yet
      await v.writeJson(path, JSON.stringify(doc('b1', 'two')))
      expect(isEncrypted(raw(BAK(path)))).toBe(Boolean(password))
      if (password) expect(raw(BAK(path)).includes(Buffer.from('"one"'))).toBe(false)
      else expect(raw(BAK(path)).toString()).toContain('"one"')
      await v.writeJson(path, JSON.stringify(doc('b1', 'three')))
      expect(((await v.readJson(BAK(path))) as { name: string }).name).toBe('two') // the backup trails the file by one save
      expect(raw(path).equals(raw(BAK(path)))).toBe(false)
    })

    for (const [name, hurt] of [['truncated', truncate], ['damaged', damage]] as const) {
      it(`a ${name} file is read from its .bak, once noted, and the next save keeps the good backup`, async () => {
        const path = file('files', `r-${name}.json`)
        await v.writeJson(path, JSON.stringify(doc('r', 'good')))
        await v.writeJson(path, JSON.stringify(doc('r', 'latest'))) // .bak now holds "good"
        hurt(path)
        v.takeRestored()
        const got = (await v.readJson(path)) as { name: string }
        expect(got.name).toBe('good') // the last good copy, i.e. what was there before the final save
        expect(v.takeRestored().map((r) => r.file)).toEqual([`files/r-${name}.json`])
        expect(v.takeRestored()).toEqual([]) // announced once
        await v.readJson(path)
        expect(v.takeRestored()).toHaveLength(1) // a later read of the still-damaged file notes it again
        // saving over the damaged file must not turn the good backup into the damaged one
        await v.writeJson(path, JSON.stringify(doc('r', 'after')))
        expect(((await v.readJson(path)) as { name: string }).name).toBe('after')
        expect(((await v.readJson(BAK(path))) as { name: string }).name).toBe('good') // still the last good copy
      })
    }

    it('with the file and its backup both damaged, reading gives null (and nothing throws)', async () => {
      const path = file('files', 'both.json')
      await v.writeJson(path, JSON.stringify(doc('both', 'a')))
      await v.writeJson(path, JSON.stringify(doc('both', 'b')))
      damage(path)
      damage(BAK(path))
      expect(await v.readJson(path)).toBeNull()
    })

    it('a missing file is simply missing: no fallback to a leftover backup', async () => {
      const path = file('files', 'gone.json')
      await v.writeJson(path, JSON.stringify(doc('gone', 'a')))
      await v.writeJson(path, JSON.stringify(doc('gone', 'b')))
      await v.remove(path)
      expect(existsSync(BAK(path))).toBe(false) // removing a file removes its backup too
      expect(await v.readJson(path)).toBeNull()
    })

    it('the file index (index.json) has the same protection', async () => {
      const path = file('index.json')
      await v.writeJson(path, JSON.stringify({ recents: ['a'], tabs: [], activeTab: 'dashboard', prefs: {} }))
      await v.writeJson(path, JSON.stringify({ recents: ['a', 'b'], tabs: [], activeTab: 'dashboard', prefs: {} }))
      truncate(path)
      v.takeRestored()
      expect(((await v.readJson(path)) as { recents: string[] }).recents).toEqual(['a'])
      expect(v.takeRestored().map((r) => r.file)).toEqual(['index.json'])
    })

    it('a recovery copy written without a backup leaves no .bak behind', async () => {
      const path = file('files', 'rec1.recovery')
      await v.writeJson(path, JSON.stringify(doc('rec1', 'unsaved 1')), { backup: false })
      await v.writeJson(path, JSON.stringify(doc('rec1', 'unsaved 2')), { backup: false })
      expect(existsSync(BAK(path))).toBe(false)
      expect(((await v.readJson(path)) as { name: string }).name).toBe('unsaved 2')
      expect(isEncrypted(raw(path))).toBe(Boolean(password))
    })

    it('a damaged profiles.json is read from its backup', async () => {
      await v.update({ name: 'Renamed' }) // a second write of profiles.json: the first becomes profiles.json.bak
      truncate(v.profilesPath)
      v.takeRestored()
      const list = await v.readProfiles()
      expect(list.map((p) => p.id)).toEqual([id])
      expect(v.takeRestored().map((r) => r.file)).toEqual(['profiles.json'])
      // an undamaged one is untouched, and a damaged one without any backup still reports the error
      writeFileSync(v.profilesPath, '{"version":1,"profiles":[')
      writeFileSync(BAK(v.profilesPath), 'not json either')
      await expect(v.readProfiles()).rejects.toThrow()
    })
  })
}

suite('plain profile', undefined)
suite('password-protected profile', 'crash-safe pw')

describe('.bak and recovery files follow a password change', () => {
  it('setting a password seals them, removing it unseals them, and the backup still works after both', async () => {
    const v = new Vault(join(base, 'convert'), { throttleBaseMs: 0 })
    const id = (await v.create({ name: 'Conv' })).profile.id
    const path = v.path('files', 'c1.json')
    await v.writeJson(path, JSON.stringify(doc('c1', 'first version')))
    await v.writeJson(path, JSON.stringify(doc('c1', 'second version')))
    const rec = v.path('files', 'c1.recovery')
    await v.writeJson(rec, JSON.stringify(doc('c1', 'unsaved edit')), { backup: false })
    expect(raw(BAK(path)).toString()).toContain('first version')

    await v.setPassword(undefined, 'pw for conversion')
    for (const p of [path, BAK(path), rec]) {
      expect(isEncrypted(raw(p))).toBe(true)
      expect(raw(p).includes(Buffer.from('version'))).toBe(false)
    }
    truncate(path)
    expect(((await v.readJson(path)) as { name: string }).name).toBe('first version') // sealed .bak still reads
    await v.writeJson(path, JSON.stringify(doc('c1', 'third version')))

    await v.removePassword('pw for conversion')
    for (const p of [path, BAK(path), rec]) expect(isEncrypted(raw(p))).toBe(false)
    expect(raw(rec).toString()).toContain('unsaved edit')
    await v.close()
    await v.open(id)
    expect(((await v.readJson(path)) as { name: string }).name).toBe('third version')
  }, T)
})

describe('adversarial: what the session remembers about a file', () => {
  it('a file damaged while the profile was closed never replaces the good backup after reopening', async () => {
    const v = new Vault(join(base, 'reopen'), { throttleBaseMs: 0 })
    const id = (await v.create({ name: 'Re' })).profile.id
    const path = v.path('files', 'ro.json')
    await v.writeJson(path, JSON.stringify(doc('ro', 'one')))
    await v.writeJson(path, JSON.stringify(doc('ro', 'two'))) // main = two, .bak = one
    await v.close()
    truncate(path) // damaged on disk while nothing had it open (a crash during a previous run, a disk fault)
    await v.open(id)
    await v.writeJson(path, JSON.stringify(doc('ro', 'three')))
    expect(((await v.readJson(path)) as { name: string }).name).toBe('three')
    expect(((await v.readJson(BAK(path))) as { name: string }).name).toBe('one') // not the truncated file
  })

  it('opening a second profile does not carry the first one\'s notes over', async () => {
    const v = new Vault(join(base, 'two-profiles'), { throttleBaseMs: 0 })
    const a = (await v.create({ name: 'A' })).profile.id
    const path = v.path('files', 'x.json')
    await v.writeJson(path, JSON.stringify(doc('x', '1')))
    await v.writeJson(path, JSON.stringify(doc('x', '2')))
    truncate(path)
    await v.readJson(path)
    await v.close()
    const b = (await v.create({ name: 'B' })).profile.id
    expect(b).not.toBe(a)
    expect(v.takeRestored()).toEqual([]) // A's damaged file is not announced in B's session
  })
})
