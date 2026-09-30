// Tests for the profile store and its encryption (src/main/vault.ts). No app needed:
//   node --experimental-strip-types mcp/test/profiles.mjs
// Works in a fresh temp folder that is deleted at the end.
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const V = await import(join(here, '..', '..', 'src', 'main', 'vault.ts').replace(/\\/g, '/').replace(/^([A-Za-z]):/, 'file:///$1:'))
const { Vault, isEncrypted, encryptBytes, decryptBytes, formatRecoveryKey, parseRecoveryKey, WRONG_PASSWORD, LOCKED_ERROR } = V

let passed = 0
let failed = 0
function check(label, cond, detail) {
  if (cond) {
    passed++
    console.log(`  ok   ${label}`)
  } else {
    failed++
    console.log(`  FAIL ${label}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`)
  }
}
async function rejects(label, p, msg) {
  try {
    await p
    check(label, false, 'did not throw')
  } catch (e) {
    check(label, msg ? String(e.message).includes(msg) : true, e.message)
  }
}

const root = mkdtempSync(join(tmpdir(), 'vellum-profiles-test-'))
const doc = (id, name, extra = {}) => ({ id, name, updatedAt: Date.now(), pages: [{ id: 'p1', name: 'Page 1' }], nodes: { a: { id: 'a' } }, ...extra })
const raw = (p) => readFileSync(p)

try {
  console.log('primitives')
  {
    const dek = Buffer.alloc(32, 7)
    const plain = Buffer.from(JSON.stringify(doc('x', 'Secret design')))
    const enc = encryptBytes(dek, plain)
    check('ciphertext has the VLME header', isEncrypted(enc))
    check('ciphertext does not contain the plaintext', !enc.includes(Buffer.from('Secret design')))
    check('roundtrip', decryptBytes(dek, enc).equals(plain))
    check('fresh IV per write', !encryptBytes(dek, plain).equals(enc))
    const bad = Buffer.from(enc)
    bad[bad.length - 1] ^= 1
    let threw = false
    try {
      decryptBytes(dek, bad)
    } catch {
      threw = true
    }
    check('tampered ciphertext is rejected', threw)
    const secret = Buffer.from('00112233445566778899aabbccddeeff', 'hex')
    const key = formatRecoveryKey(secret)
    check('recovery key format XXXX-…', /^([0-9A-Z]{4}-){6}[0-9A-Z]{2}$/.test(key), key)
    check('recovery key parses back', parseRecoveryKey(key).equals(secret))
    check('recovery key parse forgives case/spaces', parseRecoveryKey(key.toLowerCase().replace(/-/g, ' ')).equals(secret))
    check('garbage recovery key → null', parseRecoveryKey('nope') === null)
  }

  console.log('failed migration keeps the legacy files')
  {
    const r2 = mkdtempSync(join(tmpdir(), 'vellum-profiles-fail-'))
    try {
      mkdirSync(join(r2, 'files'))
      writeFileSync(join(r2, 'files', 'keep.json'), JSON.stringify(doc('keep', 'Keep me')))
      writeFileSync(join(r2, 'profiles'), 'not a folder') // makes creating the profile folder fail
      const v2 = new Vault(r2)
      await rejects('create reports the failure', v2.create({ name: 'X', password: 'pw' }), 'existing files were left')
      check('legacy file still there', JSON.parse(readFileSync(join(r2, 'files', 'keep.json'), 'utf8')).name === 'Keep me')
      check('no profiles.json written', !existsSync(join(r2, 'profiles.json')))
      check('nothing opened', !v2.isOpen())
    } finally {
      rmSync(r2, { recursive: true, force: true })
    }
  }

  console.log('migration of legacy files into a protected profile')
  mkdirSync(join(root, 'files'), { recursive: true })
  const legacyA = doc('legacyA', 'Legacy A', { big: 'x'.repeat(200000) })
  writeFileSync(join(root, 'files', 'legacyA.json'), JSON.stringify(legacyA))
  writeFileSync(join(root, 'files', 'legacyB.json'), JSON.stringify(doc('legacyB', 'Legacy B')))
  writeFileSync(join(root, 'index.json'), JSON.stringify({ recents: ['legacyA'], tabs: ['dashboard'], activeTab: 'dashboard', prefs: { userName: 'Old' } }))
  const v = new Vault(root)
  check('legacy count', v.legacyFileCount() === 2, v.legacyFileCount())
  const created = await v.create({ name: 'Alice', password: 'correct horse' })
  const alice = created.profile
  check('migrated 2 files', created.migrated === 2, created.migrated)
  check('recovery key returned', typeof created.recoveryKey === 'string')
  check('legacy files removed', !existsSync(join(root, 'files', 'legacyA.json')) && !existsSync(join(root, 'index.json')))
  check('no legacy count after migration', v.legacyFileCount() === 0)
  const aDir = v.profileDir(alice.id)
  check('migrated doc is ciphertext on disk', isEncrypted(raw(join(aDir, 'files', 'legacyA.json'))))
  check('migrated index is ciphertext on disk', isEncrypted(raw(join(aDir, 'index.json'))))
  check('profile is open after create', v.currentProfile?.id === alice.id)
  const readA = await v.readJson(join(aDir, 'files', 'legacyA.json'))
  check('migrated doc reads back identical', JSON.stringify(readA) === JSON.stringify(legacyA))
  const pj = readFileSync(join(root, 'profiles.json'), 'utf8')
  check('profiles.json holds no plaintext key/password', !pj.includes('correct horse') && !pj.includes(created.recoveryKey))

  console.log('write, lock, wrong password, unlock')
  await v.writeJson(v.path('files', 'new.json'), JSON.stringify(doc('new', 'Top secret plan')))
  check('new doc encrypted on disk', isEncrypted(raw(join(aDir, 'files', 'new.json'))))
  check('plaintext not visible on disk', !raw(join(aDir, 'files', 'new.json')).includes(Buffer.from('Top secret')))
  await v.close()
  check('locked after close', !v.isOpen())
  let lockedErr = ''
  try {
    v.currentDir()
  } catch (e) {
    lockedErr = e.message
  }
  check('locked error message', lockedErr === LOCKED_ERROR, lockedErr)
  await rejects('wrong password rejected', v.open(alice.id, 'wrong'), WRONG_PASSWORD)
  await rejects('missing password rejected', v.open(alice.id), WRONG_PASSWORD)
  await v.open(alice.id, 'correct horse')
  check('unlock works', (await v.readJson(v.path('files', 'new.json')))?.name === 'Top secret plan')

  console.log('recovery key')
  await v.close()
  await rejects('bad recovery key rejected', v.recover(alice.id, 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AA'), 'not valid')
  await v.recover(alice.id, created.recoveryKey) // verify only
  check('verify-only recovery keeps it locked', !v.isOpen())
  await v.recover(alice.id, created.recoveryKey, 'new pass 1')
  check('recovery opens the profile', v.isOpen() && (await v.readJson(v.path('files', 'new.json')))?.name === 'Top secret plan')
  await v.close()
  await rejects('old password no longer works', v.open(alice.id, 'correct horse'), WRONG_PASSWORD)
  await v.open(alice.id, 'new pass 1')
  check('new password works', v.isOpen())

  console.log('password change')
  await rejects('change needs the current password', v.setPassword('bad', 'x'), WRONG_PASSWORD)
  await v.setPassword('new pass 1', 'new pass 2')
  await v.close()
  await rejects('previous password rejected', v.open(alice.id, 'new pass 1'), WRONG_PASSWORD)
  await v.open(alice.id, 'new pass 2')
  check('changed password opens', (await v.readJson(v.path('files', 'legacyB.json')))?.name === 'Legacy B')
  await v.close()
  await v.recover(alice.id, created.recoveryKey)
  check('recovery key survives a password change', true)
  await v.open(alice.id, 'new pass 2')
  const rk2 = await v.newRecoveryKey('new pass 2')
  await rejects('old recovery key revoked', v.recover(alice.id, created.recoveryKey), 'not valid')
  await v.recover(alice.id, rk2)
  check('new recovery key works', true)

  console.log('remove password → plaintext, add password → ciphertext')
  await rejects('remove needs the password', v.removePassword('nope'), WRONG_PASSWORD)
  await v.removePassword('new pass 2')
  const files = readdirSync(join(aDir, 'files'))
  check('all docs are plaintext JSON', files.every((n) => !isEncrypted(raw(join(aDir, 'files', n)))), files)
  check('index is plaintext JSON', JSON.parse(readFileSync(join(aDir, 'index.json'), 'utf8')).prefs.userName === 'Old')
  check('profile marked without password', !(await v.readProfiles()).find((p) => p.id === alice.id).hasPassword)
  check('doc parses as plain JSON', JSON.parse(readFileSync(join(aDir, 'files', 'new.json'), 'utf8')).name === 'Top secret plan')
  await v.close()
  await v.open(alice.id)
  check('opens without password', v.isOpen())
  const added = await v.setPassword(undefined, 'again')
  check('adding a password returns a recovery key', typeof added.recoveryKey === 'string')
  check('all files encrypted after adding a password', readdirSync(join(aDir, 'files')).every((n) => isEncrypted(raw(join(aDir, 'files', n)))))
  await v.close()
  await v.open(alice.id, 'again')
  check('reopens with the added password', (await v.readJson(v.path('files', 'legacyA.json')))?.big?.length === 200000)

  console.log('second profile, plaintext, isolation, delete')
  const bob = (await v.create({ name: 'Bob' })).profile
  check('second profile does not migrate', !existsSync(join(v.profileDir(bob.id), 'index.json')))
  check('switching profile locks the first', v.currentProfile.id === bob.id)
  await v.writeJson(v.path('files', 'b.json'), JSON.stringify(doc('b', 'Bob file')))
  check('unprotected profile writes plain JSON', JSON.parse(readFileSync(join(v.profileDir(bob.id), 'files', 'b.json'), 'utf8')).name === 'Bob file')
  let outside = false
  try {
    await v.writeJson(join(aDir, 'files', 'evil.json'), '{}')
  } catch {
    outside = true
  }
  check('cannot write into another profile', outside)
  await rejects('delete protected profile needs its password', v.deleteProfile(alice.id, 'wrong'), WRONG_PASSWORD)
  await v.deleteProfile(alice.id, 'again')
  check('deleted profile folder is gone', !existsSync(aDir))
  check('profiles.json lists one profile', (await v.readProfiles()).length === 1)
  await v.deleteProfile(bob.id)
  check('deleting the open profile locks', !v.isOpen())
} finally {
  rmSync(root, { recursive: true, force: true })
}
console.log(`\n${passed} passed, ${failed} failed`)
process.exitCode = failed ? 1 : 0
