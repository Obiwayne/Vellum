// Profile store + encryption (vault.ts). Runs in a temp dir under the OS temp folder, never userData.
// Complements mcp/test/profiles.mjs (the long scenario script, kept as is); these are the core cases.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  LOCKED_ERROR,
  Vault,
  WRONG_PASSWORD,
  decryptBytes,
  encryptBytes,
  formatRecoveryKey,
  isEncrypted,
  parseRecoveryKey
} from './vault'

const doc = (id: string, name: string, extra = {}) => ({ id, name, updatedAt: 1, pages: [], nodes: {}, ...extra })
const raw = (p: string): Buffer => readFileSync(p)

let root: string
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'vellum-vault-vitest-'))
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('primitives', () => {
  const dek = Buffer.alloc(32, 7)
  const plain = Buffer.from(JSON.stringify(doc('x', 'Secret design')))

  it('encrypt/decrypt round-trips and hides the plaintext', () => {
    const enc = encryptBytes(dek, plain)
    expect(isEncrypted(enc)).toBe(true)
    expect(enc.includes(Buffer.from('Secret design'))).toBe(false)
    expect(decryptBytes(dek, enc).equals(plain)).toBe(true)
  })

  it('rejects tampered, truncated and wrong-key ciphertext', () => {
    const enc = encryptBytes(dek, plain)
    const bad = Buffer.from(enc)
    bad[bad.length - 1] ^= 1
    expect(() => decryptBytes(dek, bad)).toThrow()
    expect(() => decryptBytes(dek, enc.subarray(0, enc.length - 20))).toThrow()
    expect(() => decryptBytes(Buffer.alloc(32, 8), enc)).toThrow()
  })

  it('formats and parses recovery keys', () => {
    const secret = Buffer.from('00112233445566778899aabbccddeeff', 'hex')
    const key = formatRecoveryKey(secret)
    expect(key).toMatch(/^([0-9A-Z]{4}-){6}[0-9A-Z]{2}$/)
    expect(parseRecoveryKey(key)!.equals(secret)).toBe(true)
    expect(parseRecoveryKey('nope')).toBeNull()
  })
})

describe('profile lifecycle (legacy migration, password, recovery)', () => {
  // scrypt uses 128 MiB per derivation, so these steps share one profile and run in order
  const T = 60_000
  const legacyA = doc('legacyA', 'Legacy A', { version: 1 })
  let v: Vault
  let id: string
  let dir: string
  let recoveryKey: string

  beforeAll(() => {
    mkdirSync(join(root, 'files'), { recursive: true })
    writeFileSync(join(root, 'files', 'legacyA.json'), JSON.stringify(legacyA))
    writeFileSync(join(root, 'files', 'legacyB.json'), JSON.stringify(doc('legacyB', 'Legacy B')))
    writeFileSync(join(root, 'index.json'), JSON.stringify({ recents: [], tabs: ['dashboard'], activeTab: 'dashboard', prefs: { userName: 'Old' } }))
    v = new Vault(root, { throttleBaseMs: 0 })
  })

  it('migrates legacy plaintext files into the first (encrypted) profile', async () => {
    expect(v.legacyFileCount()).toBe(2)
    const created = await v.create({ name: 'Alice', password: 'correct horse' })
    id = created.profile.id
    dir = v.profileDir(id)
    recoveryKey = created.recoveryKey!
    expect(created.migrated).toBe(2)
    expect(existsSync(join(root, 'files', 'legacyA.json'))).toBe(false)
    expect(v.legacyFileCount()).toBe(0)
    expect(isEncrypted(raw(join(dir, 'files', 'legacyA.json')))).toBe(true)
    expect(isEncrypted(raw(join(dir, 'index.json')))).toBe(true)
    expect(await v.readJson(join(dir, 'files', 'legacyA.json'))).toEqual(legacyA)
    expect(readFileSync(join(root, 'profiles.json'), 'utf8')).not.toContain('correct horse')
  }, T)

  it('saves encrypted and loads back (round-trip)', async () => {
    await v.writeJson(v.path('files', 'new.json'), JSON.stringify(doc('new', 'Top secret plan')))
    expect(isEncrypted(raw(join(dir, 'files', 'new.json')))).toBe(true)
    expect(raw(join(dir, 'files', 'new.json')).includes(Buffer.from('Top secret'))).toBe(false)
    expect(((await v.readJson(v.path('files', 'new.json'))) as { name: string }).name).toBe('Top secret plan')
  })

  it('locks, refuses a wrong or missing password, unlocks with the right one', async () => {
    await v.close()
    expect(v.isOpen()).toBe(false)
    expect(() => v.currentDir()).toThrow(LOCKED_ERROR)
    await expect(v.open(id, 'wrong')).rejects.toThrow(WRONG_PASSWORD)
    await expect(v.open(id)).rejects.toThrow(WRONG_PASSWORD)
    await v.open(id, 'correct horse')
    expect(v.isOpen()).toBe(true)
  }, T)

  it('recovery key unlocks and sets a new password; the old one stops working', async () => {
    await v.close()
    await expect(v.recover(id, 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AA')).rejects.toThrow('not valid')
    await v.recover(id, recoveryKey, 'new pass')
    expect(v.isOpen()).toBe(true)
    expect(((await v.readJson(v.path('files', 'new.json'))) as { name: string }).name).toBe('Top secret plan')
    await v.close()
    await expect(v.open(id, 'correct horse')).rejects.toThrow(WRONG_PASSWORD)
    await v.open(id, 'new pass')
    expect(v.isOpen()).toBe(true)
  }, T)

  it('removing the password converts files to plaintext, adding one encrypts them again', async () => {
    await expect(v.removePassword('nope')).rejects.toThrow(WRONG_PASSWORD)
    await v.removePassword('new pass')
    const names = readdirSync(join(dir, 'files'))
    expect(names.every((n) => !isEncrypted(raw(join(dir, 'files', n))))).toBe(true)
    expect(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).prefs.userName).toBe('Old')
    expect((await v.readProfiles()).find((p) => p.id === id)!.hasPassword).toBe(false)

    const added = await v.setPassword(undefined, 'again')
    expect(typeof added.recoveryKey).toBe('string')
    expect(readdirSync(join(dir, 'files')).every((n) => isEncrypted(raw(join(dir, 'files', n))))).toBe(true)
    await v.close()
    await v.open(id, 'again')
    expect(((await v.readJson(v.path('files', 'legacyA.json'))) as { name: string }).name).toBe('Legacy A')
  }, T)

  it('corrupt, truncated or foreign files read as null instead of throwing', async () => {
    const p = join(dir, 'files', 'corrupt.json')
    const good = encryptBytes(v['dek']!, Buffer.from('{"id":"c"}'), 'files/corrupt.json')
    writeFileSync(p, good.subarray(0, good.length - 5)) // truncated ciphertext
    expect(await v.readJson(p)).toBeNull()
    writeFileSync(p, Buffer.from('VLME')) // header only
    expect(await v.readJson(p)).toBeNull()
    writeFileSync(p, '{"id": "c", "na') // truncated JSON in a protected profile (plaintext)
    expect(await v.readJson(p)).toBeNull()
    expect(await v.readJson(join(dir, 'files', 'missing.json'))).toBeNull()
  }, T)

  it('refuses paths outside the open profile', () => {
    expect(() => v.writeJson(join(dir, '..', 'evil.json'), '{}')).toThrow('outside the profile')
  })
})

describe('unprotected profile', () => {
  it('writes plain JSON and survives a lock/open cycle without a password', async () => {
    const r = mkdtempSync(join(tmpdir(), 'vellum-vault-plain-'))
    try {
      const v = new Vault(r)
      const p = (await v.create({ name: 'Bob' })).profile
      await v.writeJson(v.path('files', 'b.json'), JSON.stringify(doc('b', 'Bob file')))
      expect(JSON.parse(readFileSync(join(v.profileDir(p.id), 'files', 'b.json'), 'utf8')).name).toBe('Bob file')
      await v.close()
      await v.open(p.id)
      expect(((await v.readJson(v.path('files', 'b.json'))) as { name: string }).name).toBe('Bob file')
    } finally {
      rmSync(r, { recursive: true, force: true })
    }
  })
})
