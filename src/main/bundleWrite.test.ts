import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prepare, writeFolder, writeZip } from './bundleWrite'
import { buildZip, crc32 } from './zip'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vellum-bundle-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const sample = {
  'HANDOFF.md': '# Acme — handoff v1\n',
  'CLAUDE.md': '# Acme — handoff v1\n',
  'spec.json': '{"schema":"vellum.handoff/1"}\n',
  'screens/checkout.md': '# Checkout\n',
  'screens/checkout.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]),
  'tokens/tokens.css': ':root{--c:#fff}\n',
  'assets/images/hero.jpg': new Uint8Array(Array.from({ length: 300 }, (_, i) => i % 251))
}

/** every file under `root`, relative POSIX paths */
function tree(root: string, base = ''): string[] {
  return readdirSync(join(root, base), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? tree(root, `${base}${e.name}/`) : [`${base}${e.name}`]))
    .sort()
}

/** a minimal zip reader for the tests: central directory, deflate or store */
function unzip(buf: Buffer): Record<string, Buffer> {
  const end = buf.length - 22
  expect(buf.readUInt32LE(end)).toBe(0x06054b50)
  const count = buf.readUInt16LE(end + 10)
  let p = buf.readUInt32LE(end + 16)
  const out: Record<string, Buffer> = {}
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50)
    const method = buf.readUInt16LE(p + 10)
    const crc = buf.readUInt32LE(p + 16)
    const csize = buf.readUInt32LE(p + 20)
    const usize = buf.readUInt32LE(p + 24)
    const nlen = buf.readUInt16LE(p + 28)
    const off = buf.readUInt32LE(p + 42)
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8')
    const lnlen = buf.readUInt16LE(off + 26)
    const data = buf.subarray(off + 30 + lnlen, off + 30 + lnlen + csize)
    const raw = method === 8 ? inflateRawSync(data) : Buffer.from(data)
    expect(raw.length).toBe(usize)
    expect(crc32(raw)).toBe(crc)
    out[name] = raw
    p += 46 + nlen
  }
  return out
}

describe('writeFolder', () => {
  it('writes the whole file tree, text and bytes, and reports counts', async () => {
    const target = join(dir, 'acme-handoff-v1')
    const r = await writeFolder(target, sample)
    expect(r).toMatchObject({ path: target, files: 7 })
    expect(tree(target)).toEqual(Object.keys(sample).sort())
    expect(readFileSync(join(target, 'HANDOFF.md'), 'utf8')).toBe(sample['HANDOFF.md'])
    expect([...readFileSync(join(target, 'screens/checkout.png'))]).toEqual([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
    expect(r.bytes).toBe(
      Object.values(sample).reduce<number>((n, v) => n + (typeof v === 'string' ? Buffer.byteLength(v) : v.length), 0)
    )
    // nothing else in the parent: no temp folder left behind
    expect(readdirSync(dir)).toEqual(['acme-handoff-v1'])
  })

  it('refuses an existing target and leaves it untouched', async () => {
    const target = join(dir, 'taken')
    mkdirSync(target)
    writeFileSync(join(target, 'mine.txt'), 'keep')
    await expect(writeFolder(target, sample)).rejects.toThrow(/already exists/)
    expect(readFileSync(join(target, 'mine.txt'), 'utf8')).toBe('keep')
    expect(readdirSync(dir)).toEqual(['taken'])
  })

  it('refuses unsafe paths before writing anything', async () => {
    for (const bad of ['../evil.md', 'a/../../x', '/abs.md', 'C:/x.md', 'a\\b.md', 'con.txt', 'a//b', 'x?.md']) {
      await expect(writeFolder(join(dir, 'out'), { 'ok.md': 'x', [bad]: 'y' })).rejects.toThrow(/Unsafe bundle path/)
      expect(readdirSync(dir)).toEqual([])
    }
  })

  it('refuses duplicates that differ only by case, empty input, a missing parent and a relative target', async () => {
    await expect(writeFolder(join(dir, 'o'), { 'a.md': '1', 'A.md': '2' })).rejects.toThrow(/Duplicate/)
    await expect(writeFolder(join(dir, 'o'), {})).rejects.toThrow(/Nothing to write/)
    await expect(writeFolder(join(dir, 'nope', 'o'), sample)).rejects.toThrow(/does not exist/)
    await expect(writeFolder('relative-folder', sample)).rejects.toThrow(/Choose a folder/)
    await expect(writeFolder(join(dir, 'o'), 'not a map')).rejects.toThrow(/Nothing to write/)
    expect(readdirSync(dir)).toEqual([])
  })

  it('a failure in the middle removes the temp folder', async () => {
    // a file whose parent path is an existing file cannot be created
    const target = join(dir, 'broken')
    const files = { 'a.md': 'x', 'a.md/b.md': 'y' }
    await expect(writeFolder(target, files)).rejects.toThrow()
    expect(readdirSync(dir)).toEqual([])
  })

  it('rejects entries that are neither text nor bytes', async () => {
    await expect(writeFolder(join(dir, 'o'), { 'a.md': 5 })).rejects.toThrow(/no content/)
    expect(readdirSync(dir)).toEqual([])
  })
})

describe('writeZip', () => {
  it('writes an archive whose entries are the files under one top folder', async () => {
    const target = join(dir, 'acme.zip')
    const r = await writeZip(target, sample, 'acme-handoff-v1')
    expect(r.path).toBe(target)
    const got = unzip(readFileSync(target))
    expect(Object.keys(got).sort()).toEqual(Object.keys(sample).map((p) => `acme-handoff-v1/${p}`).sort())
    expect(got['acme-handoff-v1/HANDOFF.md'].toString('utf8')).toBe(sample['HANDOFF.md'])
    expect([...got['acme-handoff-v1/assets/images/hero.jpg']]).toEqual([...(sample['assets/images/hero.jpg'] as Uint8Array)])
    expect(readdirSync(dir)).toEqual(['acme.zip'])
  })

  it('is reproducible and refuses an existing file', async () => {
    const a = buildZip([{ path: 'x/a.txt', data: new TextEncoder().encode('hello hello hello hello') }])
    const b = buildZip([{ path: 'x/a.txt', data: new TextEncoder().encode('hello hello hello hello') }])
    expect(a.equals(b)).toBe(true)
    const target = join(dir, 'x.zip')
    writeFileSync(target, 'old')
    await expect(writeZip(target, sample, 'x')).rejects.toThrow(/already exists/)
    expect(readFileSync(target, 'utf8')).toBe('old')
    expect(statSync(target).size).toBe(3)
  })

  it('names the top folder safely and stores empty files', async () => {
    const target = join(dir, 'e.zip')
    await writeZip(target, { 'empty.txt': '' }, '../../weird name!!')
    const got = unzip(readFileSync(target))
    expect(Object.keys(got)).toEqual(['weird-name/empty.txt'])
    expect(got['weird-name/empty.txt'].length).toBe(0)
  })
})

describe('prepare', () => {
  it('sorts entries so the output does not depend on key order', () => {
    const a = prepare({ 'b.md': '1', 'a.md': '2' }).map((e) => e.path)
    const b = prepare({ 'a.md': '2', 'b.md': '1' }).map((e) => e.path)
    expect(a).toEqual(['a.md', 'b.md'])
    expect(b).toEqual(a)
  })
})
