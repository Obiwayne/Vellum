// Local profiles and at-rest encryption. Main process only; imports nothing but Node built-ins so
// the crypto layer can be tested directly with `node --experimental-strip-types` (mcp/test/profiles.mjs).
//
// Layout under `root` (the app's userData folder, %APPDATA%\Vellum):
//   profiles.json                 list of profiles (name, avatar, KDF params, wrapped data keys)
//   profiles/<id>/index.json      that profile's index + prefs
//   profiles/<id>/files/<doc>.json
//
// A profile without a password stores plain JSON, exactly like before profiles existed. A profile
// with a password has a random 256-bit data key (DEK); every file is AES-256-GCM encrypted with it
// (VLME magic, version byte, 12-byte IV, 16-byte tag, ciphertext). Version 2 binds each file to its
// name inside the profile (AAD = magic + version + "files/<id>.json"), so ciphertexts can't be
// swapped between files; version 1 (AAD = magic) is still read and becomes v2 on the next save.
// The DEK is stored twice, wrapped by a scrypt key derived from the password and by a random
// recovery key. It lives only in this process's memory while the profile is open, and is zeroed on
// lock. See docs/SECURITY.md ("Profiles, storage and dependencies").
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, scrypt as scryptCb } from 'node:crypto'
import { promises as fs, existsSync, readdirSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'

// ------------------------------------------------------------------------------------------------
// types (mirrored as plain data in src/shared/api.ts for the renderer)

export interface WrappedKey {
  iv: string
  tag: string
  ct: string
}

export interface ProfileCrypto {
  kdf: { alg: 'scrypt'; N: number; r: number; p: number; salt: string }
  /** DEK wrapped with the password-derived key */
  byPassword: WrappedKey
  /** DEK wrapped with the recovery key (HKDF of the 128-bit recovery secret) */
  byRecovery: WrappedKey
  recoverySalt: string
}

export interface ProfileRecord {
  id: string
  name: string
  /** small data URL (≤256px), kept unencrypted so the picker can show it */
  avatar?: string
  /** background for the initial when there is no picture */
  color: string
  hasPassword: boolean
  crypto?: ProfileCrypto
  /** idle minutes before a protected profile locks itself (0 = never) */
  autoLockMinutes?: number
  createdAt: number
  lastUsedAt: number
}

interface ProfilesFile {
  version: 1
  profiles: ProfileRecord[]
}

export const LOCKED_ERROR = 'Vellum is locked — open your profile in the app first'
export const WRONG_PASSWORD = 'Wrong password'
export const BAD_RECOVERY_KEY = 'That recovery key is not valid for this profile'
export const TOO_MANY_ATTEMPTS = 'Too many wrong attempts'

export const PROFILE_COLORS = ['#6E56CF', '#3E63DD', '#0090FF', '#12A594', '#30A46C', '#E5484D', '#F76B15', '#D6409F', '#8E4EC6', '#455A64']

// ------------------------------------------------------------------------------------------------
// crypto primitives

const MAGIC = Buffer.from('VLME', 'ascii')
/** written by encryptBytes; version 1 is still accepted by decryptBytes */
const FORMAT_VERSION = 2
const HEADER = MAGIC.length + 1 + 12 + 16

/** scrypt N=2^17, r=8, p=1 → 128 MiB of memory; maxmem must be raised above Node's 32 MiB default. */
export const SCRYPT = { N: 1 << 17, r: 8, p: 1 }
const SCRYPT_MAXMEM = 256 * 1024 * 1024
/** longest accepted password (bounds the work per attempt; scrypt pre-hashes it anyway) */
export const MAX_PASSWORD_LENGTH = 1024

/** KDF params come from profiles.json: accept only sane ones (a tampered file can't pick N=2 or N=2^30). */
function checkKdf(k: ProfileCrypto['kdf'] | undefined): { N: number; r: number; p: number; salt: Buffer } {
  const ok =
    !!k &&
    k.alg === 'scrypt' &&
    Number.isInteger(k.N) &&
    k.N >= 1 << 14 &&
    k.N <= 1 << 20 &&
    (k.N & (k.N - 1)) === 0 &&
    Number.isInteger(k.r) &&
    k.r >= 8 &&
    k.r <= 16 &&
    Number.isInteger(k.p) &&
    k.p >= 1 &&
    k.p <= 4 &&
    typeof k.salt === 'string'
  const salt = ok ? Buffer.from(k.salt, 'base64') : Buffer.alloc(0)
  if (!ok || salt.length < 16) throw new Error('Profile key parameters are invalid')
  return { N: k.N, r: k.r, p: k.p, salt }
}

export function deriveKey(password: string, salt: Buffer, params = SCRYPT): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password.normalize('NFC'), salt, 32, { N: params.N, r: params.r, p: params.p, maxmem: SCRYPT_MAXMEM }, (err, key) =>
      err ? reject(err) : resolve(key)
    )
  )
}

function recoveryKek(secret: Buffer, salt: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, salt, 'vellum-recovery-v1', 32))
}

function wrap(kek: Buffer, dek: Buffer, aad: string): WrappedKey {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', kek, iv)
  c.setAAD(Buffer.from(aad, 'utf8'))
  const ct = Buffer.concat([c.update(dek), c.final()])
  return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') }
}

/** Throws on a wrong key (GCM authentication failure). Returns a non-pooled buffer the caller zeroes. */
function unwrap(kek: Buffer, w: WrappedKey, aad: string): Buffer {
  const iv = Buffer.from(String(w?.iv ?? ''), 'base64')
  const tag = Buffer.from(String(w?.tag ?? ''), 'base64')
  const ct = Buffer.from(String(w?.ct ?? ''), 'base64')
  if (iv.length !== 12 || tag.length !== 16 || ct.length !== 32) throw new Error('Malformed wrapped key')
  const d = createDecipheriv('aes-256-gcm', kek, iv, { authTagLength: 16 })
  d.setAAD(Buffer.from(aad, 'utf8'))
  d.setAuthTag(tag)
  const parts = [d.update(ct), d.final()]
  // copy into a dedicated (non-pooled) buffer and wipe the intermediates
  const out = Buffer.alloc(32)
  let o = 0
  for (const part of parts) {
    part.copy(out, o)
    o += part.length
    part.fill(0)
  }
  return out
}

const dekAad = (profileId: string): string => `vellum-dek:v1:${profileId}`

export function isEncrypted(buf: Buffer): boolean {
  return buf.length >= HEADER && buf.subarray(0, MAGIC.length).equals(MAGIC)
}

/** AAD: v1 = magic; v2 = magic + version byte + the file's name inside the profile ("files/x.json"). */
function fileAad(version: number, context: string): Buffer {
  return version === 1 ? MAGIC : Buffer.concat([MAGIC, Buffer.from([version]), Buffer.from(context, 'utf8')])
}

/**
 * AES-256-GCM with a fresh random 96-bit IV per call. `context` is the file's name inside the
 * profile; decryptBytes must be given the same one.
 */
export function encryptBytes(dek: Buffer, plain: Buffer, context = ''): Buffer {
  if (dek.length !== 32) throw new Error('Invalid data key')
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', dek, iv, { authTagLength: 16 })
  c.setAAD(fileAad(FORMAT_VERSION, context))
  const ct = Buffer.concat([c.update(plain), c.final()])
  return Buffer.concat([MAGIC, Buffer.from([FORMAT_VERSION]), iv, c.getAuthTag(), ct])
}

export function decryptBytes(dek: Buffer, buf: Buffer, context = ''): Buffer {
  if (!isEncrypted(buf)) throw new Error('Not an encrypted Vellum file')
  const version = buf[MAGIC.length]
  if (version !== 1 && version !== 2) throw new Error(`Unsupported encrypted file version ${version}`)
  const o = MAGIC.length + 1
  const d = createDecipheriv('aes-256-gcm', dek, buf.subarray(o, o + 12), { authTagLength: 16 })
  d.setAAD(fileAad(version, context))
  d.setAuthTag(buf.subarray(o + 12, o + 28))
  return Buffer.concat([d.update(buf.subarray(HEADER)), d.final()])
}

// recovery key: 128 random bits as Crockford base32, shown as XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XX
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export function formatRecoveryKey(secret: Buffer): string {
  let bits = ''
  for (const b of secret) bits += b.toString(2).padStart(8, '0')
  bits = bits.padEnd(Math.ceil(bits.length / 5) * 5, '0')
  let out = ''
  for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)]
  return out.match(/.{1,4}/g)!.join('-')
}

/** Parse a typed recovery key (case, dashes, spaces and O/I/L look-alikes are forgiven). */
export function parseRecoveryKey(text: string): Buffer | null {
  const s = text
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
  if (s.length !== 26) return null
  let bits = ''
  for (const ch of s) {
    const v = B32.indexOf(ch)
    if (v < 0) return null
    bits += v.toString(2).padStart(5, '0')
  }
  const out = Buffer.alloc(16)
  for (let i = 0; i < 16; i++) out[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2)
  return out
}

/** A fresh DEK plus both wrappers. Returns the recovery key to show once. */
async function sealNewKey(profileId: string, password: string, dek: Buffer): Promise<{ crypto: ProfileCrypto; recoveryKey: string }> {
  const salt = randomBytes(16)
  const kek = await deriveKey(password, salt)
  const recovery = randomBytes(16)
  const recoverySalt = randomBytes(16)
  const rk = recoveryKek(recovery, recoverySalt)
  const out: ProfileCrypto = {
    kdf: { alg: 'scrypt', ...SCRYPT, salt: salt.toString('base64') },
    byPassword: wrap(kek, dek, dekAad(profileId)),
    byRecovery: wrap(rk, dek, dekAad(profileId)),
    recoverySalt: recoverySalt.toString('base64')
  }
  const recoveryKey = formatRecoveryKey(recovery)
  kek.fill(0)
  rk.fill(0)
  recovery.fill(0)
  return { crypto: out, recoveryKey }
}

async function unwrapWithPassword(p: ProfileRecord, password: string): Promise<Buffer> {
  if (!p.crypto) throw new Error('Profile has no password')
  if (typeof password !== 'string' || !password || password.length > MAX_PASSWORD_LENGTH) throw new Error(WRONG_PASSWORD)
  const k = checkKdf(p.crypto.kdf)
  const kek = await deriveKey(password, k.salt, k)
  try {
    return unwrap(kek, p.crypto.byPassword, dekAad(p.id))
  } catch {
    throw new Error(WRONG_PASSWORD)
  } finally {
    kek.fill(0)
  }
}

function unwrapWithRecovery(p: ProfileRecord, recoveryKey: string): Buffer {
  if (!p.crypto) throw new Error('Profile has no password')
  const secret = typeof recoveryKey === 'string' && recoveryKey.length <= 200 ? parseRecoveryKey(recoveryKey) : null
  if (!secret) throw new Error(BAD_RECOVERY_KEY)
  const rk = recoveryKek(secret, Buffer.from(p.crypto.recoverySalt, 'base64'))
  try {
    return unwrap(rk, p.crypto.byRecovery, dekAad(p.id))
  } catch {
    throw new Error(BAD_RECOVERY_KEY)
  } finally {
    rk.fill(0)
    secret.fill(0)
  }
}

// ------------------------------------------------------------------------------------------------
// files

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Crash-safe write: data goes to `<path>.tmp`, is flushed to disk (fsync), then renamed over the
 * target, so a crash leaves either the old or the new file, never a truncated one. The rename is
 * retried briefly because Windows refuses it while a scanner/indexer holds the target open.
 */
export async function writeAtomic(path: string, data: Buffer | string): Promise<void> {
  const tmp = `${path}.tmp`
  const fh = await fs.open(tmp, 'w')
  try {
    await fh.writeFile(data)
    await fh.sync()
  } finally {
    await fh.close()
  }
  for (let i = 0; ; i++) {
    try {
      await fs.rename(tmp, path)
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (i >= 5 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) {
        await fs.rm(tmp, { force: true }).catch(() => undefined)
        throw err
      }
      await sleep(50 * (i + 1))
    }
  }
}

const newId = (): string => randomBytes(9).toString('base64url')

/** Windows device names ("CON", "nul", "COM1"…) must never become a file or folder name. */
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i

/** True for a profile/doc id that is safe as a single path segment on every OS. */
export function isSafeId(id: unknown): id is string {
  return typeof id === 'string' && id.length >= 1 && id.length <= 128 && /^[A-Za-z0-9_-]+$/.test(id) && !RESERVED.test(id)
}

/** Validate an id from the renderer / MCP / profiles.json: no separators, dots, drive letters or device names. */
export function safeId(id: unknown): string {
  if (!isSafeId(id)) throw new Error('Invalid id')
  return id
}

/** true when `child` is strictly inside `dir` (after resolving `..`); other drives and UNC paths are outside. */
export function isInside(dir: string, child: string): boolean {
  const rel = relative(resolve(dir), resolve(child))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * Brute-force throttle for password / recovery-key checks (per profile, in memory): after
 * THROTTLE_FREE wrong answers, the next attempt must wait base·2^(n−THROTTLE_FREE) ms (max 60 s).
 */
const THROTTLE_FREE = 3
const THROTTLE_MAX_MS = 60_000
export function throttleDelay(failures: number, baseMs: number): number {
  if (failures < THROTTLE_FREE) return 0
  return Math.min(THROTTLE_MAX_MS, baseMs * 2 ** (failures - THROTTLE_FREE))
}

export interface ProfileInput {
  name: string
  avatar?: string
  password?: string
}

export interface CreateResult {
  profile: ProfileRecord
  recoveryKey?: string
  migrated: number
}

function checkAvatar(a: unknown): string | undefined {
  if (a === undefined || a === null || a === '') return undefined
  if (typeof a !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(a)) throw new Error('Invalid picture')
  if (a.length > 400_000) throw new Error('Picture is too large')
  return a
}

function checkName(n: unknown): string {
  const s = typeof n === 'string' ? n.trim() : ''
  if (!s) throw new Error('Name is required')
  return s.slice(0, 60)
}

function checkPassword(p: unknown): string | undefined {
  if (p === undefined || p === null || p === '') return undefined
  if (typeof p !== 'string') throw new Error('Invalid password')
  if (p.length > MAX_PASSWORD_LENGTH) throw new Error(`Passwords can be at most ${MAX_PASSWORD_LENGTH} characters`)
  return p
}

/**
 * The profile store. One instance per userData folder. At most one profile is open at a time;
 * every file operation goes through the open profile (and its DEK when it has a password).
 */
export class Vault {
  readonly root: string
  private current: ProfileRecord | null = null
  private dek: Buffer | null = null
  /** serialise writes per path so a slow write never lands after a newer one */
  private queues = new Map<string, Promise<unknown>>()
  /** wrong-answer bookkeeping per profile id (see throttleDelay) */
  private failures = new Map<string, { count: number; until: number }>()
  /** password checks run one at a time per profile, so parallel guesses can't skip the delay */
  private gates = new Map<string, Promise<unknown>>()
  private readonly throttleBaseMs: number

  constructor(root: string, opts: { throttleBaseMs?: number } = {}) {
    this.root = root
    this.throttleBaseMs = opts.throttleBaseMs ?? 1000
  }

  /**
   * Run a password / recovery-key check for profile `id` under the brute-force throttle. Wrong
   * answers (WRONG_PASSWORD / BAD_RECOVERY_KEY) count; a correct one resets the count.
   */
  private guarded<T>(id: string, check: () => Promise<T> | T): Promise<T> {
    const run = async (): Promise<T> => {
      const f = this.failures.get(id)
      const wait = f ? f.until - Date.now() : 0
      if (wait > 0) throw new Error(`${TOO_MANY_ATTEMPTS}. Try again in ${Math.ceil(wait / 1000)} s.`)
      try {
        const r = await check()
        this.failures.delete(id)
        return r
      } catch (err) {
        const msg = err instanceof Error ? err.message : ''
        if (msg === WRONG_PASSWORD || msg === BAD_RECOVERY_KEY) {
          const count = (f?.count ?? 0) + 1
          this.failures.set(id, { count, until: Date.now() + throttleDelay(count, this.throttleBaseMs) })
        }
        throw err
      }
    }
    const next = (this.gates.get(id) ?? Promise.resolve()).catch(() => undefined).then(run)
    this.gates.set(id, next)
    return next
  }

  private passwordKey(p: ProfileRecord, password: unknown): Promise<Buffer> {
    return this.guarded(p.id, () => unwrapWithPassword(p, password as string))
  }

  // ------------------------------------------------------------------ paths
  get profilesPath(): string {
    return join(this.root, 'profiles.json')
  }
  profileDir(id: string): string {
    return join(this.root, 'profiles', safeId(id))
  }
  private get legacyFilesDir(): string {
    return join(this.root, 'files')
  }
  private get legacyIndexPath(): string {
    return join(this.root, 'index.json')
  }

  // ------------------------------------------------------------------ profiles.json
  async readProfiles(): Promise<ProfileRecord[]> {
    try {
      const f = JSON.parse(await fs.readFile(this.profilesPath, 'utf8')) as ProfilesFile
      // an entry whose id can't be a folder name is unusable; skip it rather than fail everything
      return Array.isArray(f.profiles) ? f.profiles.filter((p) => p && isSafeId(p.id)) : []
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw err
    }
  }

  private async writeProfiles(list: ProfileRecord[]): Promise<void> {
    await fs.mkdir(this.root, { recursive: true })
    const data: ProfilesFile = { version: 1, profiles: list }
    await this.enqueue(this.profilesPath, () => writeAtomic(this.profilesPath, JSON.stringify(data, null, 2)))
  }

  private async patchProfile(id: string, fn: (p: ProfileRecord) => void): Promise<ProfileRecord> {
    const list = await this.readProfiles()
    const p = list.find((x) => x.id === id)
    if (!p) throw new Error('Profile not found')
    fn(p)
    await this.writeProfiles(list)
    if (this.current?.id === id) this.current = p
    return p
  }

  /** Legacy (pre-profiles) doc count; only meaningful while no profiles.json exists. */
  legacyFileCount(): number {
    if (existsSync(this.profilesPath)) return 0
    try {
      return readdirSync(this.legacyFilesDir).filter((n) => n.endsWith('.json')).length
    } catch {
      return 0
    }
  }

  // ------------------------------------------------------------------ session
  get currentProfile(): ProfileRecord | null {
    return this.current
  }
  isOpen(): boolean {
    return this.current !== null
  }
  /** folder of the open profile; throws the "locked" error otherwise */
  currentDir(): string {
    if (!this.current) throw new Error(LOCKED_ERROR)
    return this.profileDir(this.current.id)
  }

  private async setSession(p: ProfileRecord, dek: Buffer | null): Promise<void> {
    await this.close() // drains queued writes, then zeroes the previous key
    this.current = p
    this.dek = dek
    await this.patchProfile(p.id, (x) => {
      x.lastUsedAt = Date.now()
    })
    // leftovers of a write interrupted by a crash (may hold plaintext from a password removal)
    await this.removeStaleTemp()
    // heal: a protected profile must not hold plaintext (e.g. after an interrupted conversion)
    if (dek) await this.convertAll('encrypt')
  }

  /** Delete `*.tmp` files of the open profile. Only called at session start, with no writes queued. */
  private async removeStaleTemp(): Promise<void> {
    const dir = this.currentDir()
    for (const d of [dir, join(dir, 'files')]) {
      let names: string[] = []
      try {
        names = await fs.readdir(d)
      } catch {
        continue
      }
      for (const n of names) if (n.endsWith('.tmp')) await fs.rm(join(d, n), { force: true }).catch(() => undefined)
    }
  }

  /** Lock: wait for pending writes, then forget the profile and zero the DEK. */
  async close(): Promise<void> {
    await this.drain()
    if (this.dek) this.dek.fill(0)
    this.dek = null
    this.current = null
  }

  async open(id: string, password?: string): Promise<ProfileRecord> {
    safeId(id)
    const p = (await this.readProfiles()).find((x) => x.id === id)
    if (!p) throw new Error('Profile not found')
    if (!p.hasPassword) {
      await this.setSession(p, null)
      return p
    }
    const dek = await this.passwordKey(p, password)
    await this.setSession(p, dek)
    return p
  }

  /** Check a recovery key; with `newPassword`, set that password and open the profile. */
  async recover(id: string, recoveryKey: string, newPassword?: string): Promise<ProfileRecord> {
    safeId(id)
    const pw = checkPassword(newPassword)
    const p = (await this.readProfiles()).find((x) => x.id === id)
    if (!p || !p.crypto) throw new Error('Profile not found')
    const dek = await this.guarded(p.id, () => unwrapWithRecovery(p, recoveryKey))
    if (!pw) {
      dek.fill(0)
      return p
    }
    const salt = randomBytes(16)
    const kek = await deriveKey(pw, salt)
    const updated = await this.patchProfile(id, (x) => {
      x.crypto = { ...x.crypto!, kdf: { alg: 'scrypt', ...SCRYPT, salt: salt.toString('base64') }, byPassword: wrap(kek, dek, dekAad(id)) }
    })
    kek.fill(0)
    await this.setSession(updated, dek)
    return updated
  }

  // ------------------------------------------------------------------ create / edit / delete
  async create(input: ProfileInput): Promise<CreateResult> {
    const name = checkName(input.name)
    const avatar = checkAvatar(input.avatar)
    const password = checkPassword(input.password)
    const existing = await this.readProfiles()
    const migrate = existing.length === 0 && this.legacyFileCount() > 0
    const id = newId()
    const now = Date.now()
    const profile: ProfileRecord = {
      id,
      name,
      ...(avatar ? { avatar } : {}),
      color: PROFILE_COLORS[existing.length % PROFILE_COLORS.length],
      hasPassword: Boolean(password),
      createdAt: now,
      lastUsedAt: now
    }
    let dek: Buffer | null = null
    let recoveryKey: string | undefined
    if (password) {
      dek = randomBytes(32)
      const sealed = await sealNewKey(id, password, dek)
      profile.crypto = sealed.crypto
      profile.autoLockMinutes = 15
      recoveryKey = sealed.recoveryKey
    }
    const dir = this.profileDir(id)
    let migrated = 0
    try {
      await fs.mkdir(join(dir, 'files'), { recursive: true })
      if (migrate) migrated = await this.copyLegacyInto(dir, dek)
      await this.writeProfiles([...existing, profile])
    } catch (err) {
      // roll back: the legacy files are untouched until everything above succeeded
      dek?.fill(0)
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
      throw new Error(
        `Couldn’t create the profile${migrate ? ' (your existing files were left where they were)' : ''}: ${(err as Error).message}`
      )
    }
    if (migrate) await this.removeLegacy()
    await this.setSession(profile, dek)
    return { profile, recoveryKey, migrated }
  }

  /** Copy legacy files/*.json + index.json into `dir` (encrypted when `dek`), verifying each by reading it back. */
  private async copyLegacyInto(dir: string, dek: Buffer | null): Promise<number> {
    const names = (await fs.readdir(this.legacyFilesDir)).filter((n) => n.endsWith('.json'))
    const jobs: Array<{ from: string; to: string; context: string }> = names.map((n) => ({
      from: join(this.legacyFilesDir, n),
      to: join(dir, 'files', n),
      context: `files/${n}`
    }))
    if (existsSync(this.legacyIndexPath)) jobs.push({ from: this.legacyIndexPath, to: join(dir, 'index.json'), context: 'index.json' })
    for (const j of jobs) {
      const raw = await fs.readFile(j.from)
      await writeAtomic(j.to, dek ? encryptBytes(dek, raw, j.context) : raw)
      const back = await fs.readFile(j.to)
      const plain = dek ? decryptBytes(dek, back, j.context) : back
      let same: boolean
      try {
        same = isDeepStrictEqual(JSON.parse(raw.toString('utf8')), JSON.parse(plain.toString('utf8')))
      } catch {
        same = raw.equals(plain) // not valid JSON: compare bytes
      }
      if (!same) throw new Error(`verification failed for ${j.from}`)
    }
    return names.length
  }

  private async removeLegacy(): Promise<void> {
    try {
      for (const n of await fs.readdir(this.legacyFilesDir)) {
        if (n.endsWith('.json') || n.endsWith('.json.tmp')) await fs.rm(join(this.legacyFilesDir, n), { force: true })
      }
      if ((await fs.readdir(this.legacyFilesDir)).length === 0) await fs.rmdir(this.legacyFilesDir)
      await fs.rm(this.legacyIndexPath, { force: true })
      await fs.rm(`${this.legacyIndexPath}.tmp`, { force: true })
    } catch (err) {
      console.error('[vault] could not remove legacy files after migration:', err)
    }
  }

  /** Name / picture / auto-lock of the open profile. */
  async update(patch: { name?: string; avatar?: string | null; autoLockMinutes?: number }): Promise<ProfileRecord> {
    const cur = this.requireCurrent()
    const name = patch.name !== undefined ? checkName(patch.name) : undefined
    const clearAvatar = patch.avatar === null || patch.avatar === ''
    const avatar = !clearAvatar && patch.avatar !== undefined ? checkAvatar(patch.avatar) : undefined
    return this.patchProfile(cur.id, (p) => {
      if (name !== undefined) p.name = name
      if (clearAvatar) delete p.avatar
      else if (avatar) p.avatar = avatar
      const m = patch.autoLockMinutes
      if (typeof m === 'number' && Number.isFinite(m) && m >= 0) p.autoLockMinutes = Math.min(24 * 60, Math.round(m))
    })
  }

  /**
   * Add a password (encrypts every file; returns a new recovery key) or change it (re-wraps the
   * DEK; files are untouched and the recovery key stays valid).
   */
  async setPassword(currentPassword: string | undefined, newPassword: string): Promise<{ recoveryKey?: string }> {
    const cur = this.requireCurrent()
    const pw = checkPassword(newPassword)
    if (!pw) throw new Error('Enter a new password')
    if (cur.hasPassword) {
      const dek = await this.passwordKey(cur, currentPassword)
      const salt = randomBytes(16)
      const kek = await deriveKey(pw, salt)
      await this.patchProfile(cur.id, (p) => {
        p.crypto = {
          ...p.crypto!,
          kdf: { alg: 'scrypt', ...SCRYPT, salt: salt.toString('base64') },
          byPassword: wrap(kek, dek, dekAad(cur.id))
        }
      })
      kek.fill(0)
      dek.fill(0)
      return {}
    }
    const dek = randomBytes(32)
    const sealed = await sealNewKey(cur.id, pw, dek)
    // record first: if we crash mid-way the password still opens the profile and unlock re-encrypts the rest
    await this.patchProfile(cur.id, (p) => {
      p.hasPassword = true
      p.crypto = sealed.crypto
      if (p.autoLockMinutes === undefined) p.autoLockMinutes = 15
    })
    await this.drain()
    this.dek = dek
    try {
      await this.convertAll('encrypt')
    } catch (err) {
      // the password is set; any file still in plaintext is encrypted at the next unlock
      throw new Error(
        `The password was set, but some files could not be encrypted yet (${(err as Error).message}). ` +
          'Lock and unlock the profile to finish, then create a new recovery key in Edit profile.'
      )
    }
    return { recoveryKey: sealed.recoveryKey }
  }

  /** Remove the password: decrypt every file back to plain JSON, then drop the keys. */
  async removePassword(currentPassword: string): Promise<void> {
    const cur = this.requireCurrent()
    if (!cur.hasPassword) return
    const dek = await this.passwordKey(cur, currentPassword)
    dek.fill(0)
    await this.drain()
    const old = this.dek
    this.dek = null // new writes are plaintext from here on
    try {
      await this.convertAll('decrypt', old)
    } catch (err) {
      this.dek = old
      throw err
    }
    await this.patchProfile(cur.id, (p) => {
      p.hasPassword = false
      delete p.crypto
    })
    old?.fill(0)
  }

  /** Replace the recovery key (the old one stops working). */
  async newRecoveryKey(currentPassword: string): Promise<string> {
    const cur = this.requireCurrent()
    if (!cur.hasPassword) throw new Error('Profile has no password')
    const dek = await this.passwordKey(cur, currentPassword)
    const recovery = randomBytes(16)
    const recoverySalt = randomBytes(16)
    const rk = recoveryKek(recovery, recoverySalt)
    await this.patchProfile(cur.id, (p) => {
      p.crypto = { ...p.crypto!, byRecovery: wrap(rk, dek, dekAad(cur.id)), recoverySalt: recoverySalt.toString('base64') }
    })
    const key = formatRecoveryKey(recovery)
    rk.fill(0)
    recovery.fill(0)
    dek.fill(0)
    return key
  }

  async deleteProfile(id: string, password?: string): Promise<void> {
    safeId(id)
    const list = await this.readProfiles()
    const p = list.find((x) => x.id === id)
    if (!p) throw new Error('Profile not found')
    if (p.hasPassword) (await this.passwordKey(p, password)).fill(0)
    if (this.current?.id === id) await this.close()
    await this.writeProfiles(list.filter((x) => x.id !== id))
    this.failures.delete(id)
    await fs.rm(this.profileDir(id), { recursive: true, force: true, maxRetries: 3 })
  }

  private requireCurrent(): ProfileRecord {
    if (!this.current) throw new Error(LOCKED_ERROR)
    return this.current
  }

  // ------------------------------------------------------------------ file I/O for the open profile
  private enqueue<T>(key: string, job: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(key) ?? Promise.resolve()
    const next = prev.catch(() => undefined).then(job)
    this.queues.set(key, next)
    return next
  }

  private async drain(): Promise<void> {
    for (;;) {
      const all = [...this.queues.values()]
      await Promise.allSettled(all)
      if ([...this.queues.values()].every((q) => all.includes(q))) break
    }
  }

  /** Path of a file inside the open profile, e.g. path('files', 'abc.json'). */
  path(...parts: string[]): string {
    const p = join(this.currentDir(), ...parts)
    this.contextOf(p)
    return p
  }

  /**
   * The file's name inside the open profile ("index.json", "files/x.json"), used as its AAD
   * context. Throws for anything outside the open profile's folder (another profile, `..`, another
   * drive, UNC), so no read, write or delete can reach past it.
   */
  private contextOf(path: string): string {
    const dir = this.currentDir()
    if (!isInside(dir, path)) throw new Error('Path outside the profile')
    return relative(resolve(dir), resolve(path)).split('\\').join('/')
  }

  /** Read + decode a file of the open profile. null when missing or unreadable. */
  async readJson<T>(path: string): Promise<T | null> {
    const context = this.contextOf(path)
    let buf: Buffer
    try {
      buf = await fs.readFile(path)
    } catch {
      return null
    }
    try {
      return JSON.parse(this.decode(buf, context).toString('utf8')) as T
    } catch {
      return null
    }
  }

  private decode(buf: Buffer, context: string, dek = this.dek): Buffer {
    if (!isEncrypted(buf)) return buf
    if (!dek) throw new Error(LOCKED_ERROR)
    return decryptBytes(dek, buf, context)
  }

  writeJson(path: string, text: string): Promise<void> {
    const context = this.contextOf(path)
    return this.enqueue(path, () => {
      // encode when the write runs, with the key current at that moment
      const plain = Buffer.from(text, 'utf8')
      return writeAtomic(path, this.dek ? encryptBytes(this.dek, plain, context) : plain)
    })
  }

  remove(path: string): Promise<void> {
    this.contextOf(path)
    return this.enqueue(path, () => fs.rm(path, { force: true }))
  }

  /** Every data file of the open profile (index + docs). */
  private async dataFiles(): Promise<string[]> {
    const dir = this.currentDir()
    const out: string[] = []
    if (existsSync(join(dir, 'index.json'))) out.push(join(dir, 'index.json'))
    try {
      for (const n of await fs.readdir(join(dir, 'files'))) if (n.endsWith('.json')) out.push(join(dir, 'files', n))
    } catch {
      /* no files yet */
    }
    return out
  }

  /**
   * Rewrite every file of the open profile encrypted (with the session DEK) or as plaintext
   * (decrypting with `oldDek`), verifying each by reading it back.
   */
  private async convertAll(mode: 'encrypt' | 'decrypt', oldDek: Buffer | null = null): Promise<void> {
    for (const path of await this.dataFiles()) {
      const context = this.contextOf(path)
      await this.enqueue(path, async () => {
        const buf = await fs.readFile(path)
        const enc = isEncrypted(buf)
        if (mode === 'encrypt' && enc) return
        if (mode === 'decrypt' && !enc) return
        const plain = mode === 'decrypt' ? this.decode(buf, context, oldDek) : buf
        const next = mode === 'encrypt' ? encryptBytes(this.dek!, plain, context) : plain
        await writeAtomic(path, next)
        const back = await fs.readFile(path)
        const check = mode === 'encrypt' ? decryptBytes(this.dek!, back, context) : back
        if (!check.equals(plain)) throw new Error(`verification failed for ${path}`)
      })
    }
  }
}
