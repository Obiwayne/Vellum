// Files saved by Vellum v0.1.0 (pre-profile layout: userData/files/*.json + index.json) move into the first profile,
// with and without a password, and read back identical. Fixtures: src/renderer/src/model/fixtures/v1 (real files saved by that build).
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { Vault, isEncrypted } from './vault'

const fixtures = join(__dirname, '../renderer/src/model/fixtures/v1')
const names = readdirSync(join(fixtures, 'files')).filter((n) => n.endsWith('.json'))
const fixture = (rel: string): unknown => JSON.parse(readFileSync(join(fixtures, rel), 'utf8'))
const roots: string[] = []

/** a userData folder laid out as v0.1.0 left it */
function legacyRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'vellum-v010-vitest-'))
  roots.push(root)
  mkdirSync(join(root, 'files'), { recursive: true })
  cpSync(join(fixtures, 'files'), join(root, 'files'), { recursive: true })
  cpSync(join(fixtures, 'index.json'), join(root, 'index.json'))
  return root
}
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

async function expectAllIntact(v: Vault, dir: string): Promise<void> {
  expect(readdirSync(join(dir, 'files')).sort()).toEqual([...names].sort())
  for (const n of names) expect(await v.readJson(join(dir, 'files', n))).toEqual(fixture(`files/${n}`))
  expect(await v.readJson(join(dir, 'index.json'))).toEqual(fixture('index.json'))
}

describe('v0.1.0 userData -> first profile', () => {
  it('without a password: every file and the index arrive unchanged, and the old copies are removed', async () => {
    const root = legacyRoot()
    const v = new Vault(root, { throttleBaseMs: 0 })
    expect(v.legacyFileCount()).toBe(names.length)
    const created = await v.create({ name: 'Obi' })
    expect(created.migrated).toBe(names.length)
    expect(v.legacyFileCount()).toBe(0)
    expect(existsSync(join(root, 'index.json'))).toBe(false)
    await expectAllIntact(v, v.profileDir(created.profile.id))
    await v.close()
  })

  it('with a password: encrypted on disk, identical once read back, and still there after closing and reopening the profile', async () => {
    const root = legacyRoot()
    const v = new Vault(root, { throttleBaseMs: 0 })
    const created = await v.create({ name: 'Obi', password: 'correct horse' })
    const dir = v.profileDir(created.profile.id)
    expect(created.migrated).toBe(names.length)
    for (const n of names) expect(isEncrypted(readFileSync(join(dir, 'files', n)))).toBe(true)
    await expectAllIntact(v, dir)
    await v.close()
    const again = new Vault(root, { throttleBaseMs: 0 })
    await again.open(created.profile.id, 'correct horse')
    await expectAllIntact(again, dir)
    await again.close()
  }, 90_000)
})
