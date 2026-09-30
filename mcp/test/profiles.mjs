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

  console.log('ids and paths (traversal)')
  {
    const bad = ['', '..', '../x', '..\\x', 'a/b', 'a\\b', 'C:', 'C:\\Windows', '\\\\server\\share', '//server/share', 'CON', 'nul', 'Com1', 'LPT9', 'a.b', 'x'.repeat(129), 'a\0b', 'é']
    check('isSafeId rejects traversal, drive, UNC, device and odd names', bad.every((s) => !V.isSafeId(s)), bad.filter((s) => V.isSafeId(s)))
    check('isSafeId rejects non-strings', [null, undefined, 1, {}, ['a']].every((s) => !V.isSafeId(s)))
    check('isSafeId accepts normal ids', ['abc', 'A-b_9', 'x'.repeat(128), 'CONSOLE', 'nul1x'].every((s) => V.isSafeId(s)))
    check('isInside: child', V.isInside(join(root, 'p'), join(root, 'p', 'files', 'a.json')))
    check('isInside: .. escapes', !V.isInside(join(root, 'p'), join(root, 'p', '..', 'q', 'a.json')))
    check('isInside: the folder itself is not inside', !V.isInside(join(root, 'p'), join(root, 'p')))
    check('isInside: sibling with same prefix', !V.isInside(join(root, 'p'), join(root, 'p2', 'a.json')))
    if (process.platform === 'win32') {
      check('isInside: other drive', !V.isInside('C:\\a', 'D:\\a\\b'))
      check('isInside: UNC', !V.isInside('C:\\a', '\\\\server\\share\\a'))
    }
    const v3 = new Vault(root)
    await rejects('open("../x") rejected', v3.open('../x'), 'Invalid id')
    await rejects('open("CON") rejected', v3.open('CON'), 'Invalid id')
    await rejects('delete("..") rejected', v3.deleteProfile('..'), 'Invalid id')
    await rejects('recover("..\\\\x") rejected', v3.recover('..\\x', 'k'), 'Invalid id')
    await rejects('reading while locked', (async () => v3.readJson(join(root, 'x.json')))(), LOCKED_ERROR)
    const p3 = (await v3.create({ name: 'Paths' })).profile
    const d3 = v3.profileDir(p3.id)
    let threw = 0
    for (const f of [
      () => v3.readJson(join(d3, '..', 'x.json')),
      () => v3.writeJson(join(d3, '..', '..', 'evil.json'), '{}'),
      () => v3.remove(join(root, 'profiles.json')),
      () => v3.path('..', 'x.json'),
      () => v3.path('files', '..', '..', 'y.json')
    ]) {
      try {
        await f()
      } catch (e) {
        if (String(e.message).includes('outside the profile')) threw++
      }
    }
    check('read/write/remove/path outside the open profile are refused', threw === 5, threw)
    check('profiles.json untouched by the refused remove', existsSync(join(root, 'profiles.json')))
    check('profileDir refuses a bad id', (() => {
      try {
        v3.profileDir('..')
        return false
      } catch {
        return true
      }
    })())
    await v3.deleteProfile(p3.id)
  }

  console.log('format v2 binds a file to its name; v1 still reads')
  {
    const v4 = new Vault(root, { throttleBaseMs: 200 })
    const c4 = await v4.create({ name: 'Format', password: 'pw-format' })
    const d4 = v4.profileDir(c4.profile.id)
    await v4.writeJson(v4.path('files', 'one.json'), JSON.stringify(doc('one', 'One')))
    await v4.writeJson(v4.path('files', 'two.json'), JSON.stringify(doc('two', 'Two')))
    const oneBytes = raw(join(d4, 'files', 'one.json'))
    check('new files are format v2', oneBytes[4] === 2, oneBytes[4])
    writeFileSync(join(d4, 'files', 'two.json'), oneBytes) // swap: one's ciphertext under two's name
    check('swapped ciphertext is rejected (AAD = file name)', (await v4.readJson(v4.path('files', 'two.json'))) === null)
    check('the original still reads', (await v4.readJson(v4.path('files', 'one.json')))?.name === 'One')
    // v1 file (AAD = magic only), as written before this change
    const dek = v4['dek']
    const { createCipheriv, randomBytes } = await import('node:crypto')
    const iv = randomBytes(12)
    const c = createCipheriv('aes-256-gcm', dek, iv)
    c.setAAD(Buffer.from('VLME'))
    const ct = Buffer.concat([c.update(Buffer.from(JSON.stringify(doc('old', 'Old v1')))), c.final()])
    writeFileSync(join(d4, 'files', 'old.json'), Buffer.concat([Buffer.from('VLME'), Buffer.from([1]), iv, c.getAuthTag(), ct]))
    check('v1 file still reads', (await v4.readJson(v4.path('files', 'old.json')))?.name === 'Old v1')
    await v4.writeJson(v4.path('files', 'old.json'), JSON.stringify(doc('old', 'Old v1')))
    check('rewritten as v2', raw(join(d4, 'files', 'old.json'))[4] === 2)
    check('unknown version is rejected', (() => {
      const b = Buffer.from(raw(join(d4, 'files', 'old.json')))
      b[4] = 9
      try {
        decryptBytes(dek, b)
        return false
      } catch (e) {
        return /version/.test(e.message)
      }
    })())

    console.log('lock wipes the key; stale temp files; heal')
    const keyRef = v4['dek']
    await v4.close()
    check('close() zeroes the data key in memory', keyRef.length === 32 && keyRef.every((b) => b === 0))
    check('no key kept after close', v4['dek'] === null && v4.currentProfile === null)
    writeFileSync(join(d4, 'files', 'one.json.tmp'), JSON.stringify(doc('one', 'PLAINTEXT LEFTOVER')))
    writeFileSync(join(d4, 'index.json.tmp'), '{"prefs":{}}')
    writeFileSync(join(d4, 'files', 'planted.json'), JSON.stringify(doc('planted', 'Plain file')))
    await v4.open(c4.profile.id, 'pw-format')
    check('stale .tmp files removed on unlock', !existsSync(join(d4, 'files', 'one.json.tmp')) && !existsSync(join(d4, 'index.json.tmp')))
    check('plaintext file in a protected profile is encrypted on unlock', isEncrypted(raw(join(d4, 'files', 'planted.json'))))
    check('temp write leaves no .tmp behind', readdirSync(join(d4, 'files')).every((n) => !n.endsWith('.tmp')))

    console.log('input limits')
    await rejects('overlong new password refused', v4.setPassword('pw-format', 'x'.repeat(1025)), 'at most')
    await v4.update({ autoLockMinutes: 1e9 })
    check('auto-lock minutes clamped', v4.currentProfile.autoLockMinutes === 1440, v4.currentProfile.autoLockMinutes)
    await v4.update({ autoLockMinutes: Infinity })
    check('non-finite auto-lock ignored', v4.currentProfile.autoLockMinutes === 1440)

    console.log('brute-force throttle')
    await v4.close()
    await rejects('wrong 1', v4.open(c4.profile.id, 'a'), WRONG_PASSWORD)
    await rejects('wrong 2', v4.open(c4.profile.id, 'b'), WRONG_PASSWORD)
    await rejects('wrong 3', v4.open(c4.profile.id, 'c'), WRONG_PASSWORD)
    await rejects('4th attempt is throttled, even with the right password', v4.open(c4.profile.id, 'pw-format'), V.TOO_MANY_ATTEMPTS)
    await rejects('delete is throttled too', v4.deleteProfile(c4.profile.id, 'pw-format'), V.TOO_MANY_ATTEMPTS)
    await rejects('recovery is throttled too', v4.recover(c4.profile.id, c4.recoveryKey), V.TOO_MANY_ATTEMPTS)
    await new Promise((r) => setTimeout(r, 250))
    await rejects('wrong 4 (after the wait)', v4.open(c4.profile.id, 'd'), WRONG_PASSWORD)
    await rejects('delay doubles', v4.open(c4.profile.id, 'pw-format'), V.TOO_MANY_ATTEMPTS)
    check('throttleDelay grows and is capped', V.throttleDelay(2, 1000) === 0 && V.throttleDelay(3, 1000) === 1000 && V.throttleDelay(5, 1000) === 4000 && V.throttleDelay(50, 1000) === 60000)
    await new Promise((r) => setTimeout(r, 450))
    await v4.open(c4.profile.id, 'pw-format')
    check('correct password after the wait opens and resets the count', v4.isOpen())
    await v4.close()
    await rejects('count was reset (1 wrong is not throttled)', v4.open(c4.profile.id, 'z'), WRONG_PASSWORD)
    await v4.open(c4.profile.id, 'pw-format')

    console.log('tampered profiles.json')
    await v4.close()
    const pjPath = join(root, 'profiles.json')
    const saved = readFileSync(pjPath, 'utf8')
    const pjData = JSON.parse(saved)
    pjData.profiles.find((p) => p.id === c4.profile.id).crypto.kdf.N = 2
    writeFileSync(pjPath, JSON.stringify(pjData))
    await rejects('weak KDF params in profiles.json are refused', v4.open(c4.profile.id, 'pw-format'), 'invalid')
    const pj2 = JSON.parse(saved)
    pj2.profiles.find((p) => p.id === c4.profile.id).crypto.byPassword.ct = 'AAAA'
    writeFileSync(pjPath, JSON.stringify(pj2))
    await rejects('malformed wrapped key is refused', v4.open(c4.profile.id, 'pw-format'))
    const pj3 = JSON.parse(saved)
    pj3.profiles.push({ ...pj3.profiles[0], id: '..' })
    writeFileSync(pjPath, JSON.stringify(pj3))
    check('profiles with unusable ids are ignored', (await v4.readProfiles()).every((p) => p.id !== '..'))
    writeFileSync(pjPath, saved)
    await v4.open(c4.profile.id, 'pw-format')
    check('restored profiles.json opens again', v4.isOpen())
    check('profiles.json never holds key material in clear', !readFileSync(pjPath, 'utf8').includes(c4.recoveryKey) && !readFileSync(pjPath, 'utf8').includes('pw-format'))
    await v4.deleteProfile(c4.profile.id, 'pw-format')
  }
} finally {
  rmSync(root, { recursive: true, force: true })
}
console.log(`\n${passed} passed, ${failed} failed`)
process.exitCode = failed ? 1 : 0
