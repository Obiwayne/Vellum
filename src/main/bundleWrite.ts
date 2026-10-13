// Writing a hand-off bundle to disk (docs/factory/T65-design.md section 4): into a temporary sibling first, then
// renamed into place, so a failure never leaves a half-written folder or file. Every path is checked again here:
// the renderer builds the file map, but the main process is the one that touches the disk.
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { assertSafePaths } from '@shared/bundlePaths'
import { buildZip } from './zip'

export type BundleInput = Record<string, string | Uint8Array>

export interface WriteResult {
  path: string
  files: number
  bytes: number
}

const MAX_FILES = 5000
const MAX_BYTES = 1024 * 1024 * 1024

function toBytes(v: string | Uint8Array): Uint8Array {
  return typeof v === 'string' ? new TextEncoder().encode(v) : v
}

/** Check a file map and turn it into byte entries (throws on anything unsafe or too big). */
export function prepare(files: unknown): Array<{ path: string; data: Uint8Array }> {
  if (!files || typeof files !== 'object' || Array.isArray(files)) throw new Error('Nothing to write')
  const entries = Object.entries(files as Record<string, unknown>)
  if (!entries.length) throw new Error('Nothing to write')
  if (entries.length > MAX_FILES) throw new Error(`Too many files (${entries.length}, at most ${MAX_FILES})`)
  assertSafePaths(entries.map(([p]) => p))
  let total = 0
  const out = entries.map(([path, v]) => {
    if (typeof v !== 'string' && !(v instanceof Uint8Array)) throw new Error(`File ${path} has no content`)
    const data = toBytes(v)
    total += data.length
    return { path, data }
  })
  if (total > MAX_BYTES) throw new Error('The bundle is larger than 1 GB')
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

const exists = async (p: string): Promise<boolean> => {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

/** The target must be a plain name in an existing folder: no traversal, nothing already there. */
async function checkTarget(target: string): Promise<void> {
  if (typeof target !== 'string' || !target || !isAbsolute(target)) throw new Error('Choose a folder on this PC')
  const parent = dirname(target)
  const st = await stat(parent).catch(() => null)
  if (!st?.isDirectory()) throw new Error(`The folder ${parent} does not exist`)
  if (await exists(target)) throw new Error(`${basename(target)} already exists in ${parent}. Choose another name.`)
}

/** Write the bundle as a folder at `target`. */
export async function writeFolder(target: string, files: unknown): Promise<WriteResult> {
  const entries = prepare(files)
  await checkTarget(target)
  const tmp = join(dirname(target), `.${basename(target)}.vellum-tmp-${randomBytes(4).toString('hex')}`)
  let bytes = 0
  try {
    await mkdir(tmp)
    for (const e of entries) {
      const dest = resolve(tmp, ...e.path.split('/'))
      const rel = relative(tmp, dest)
      if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Unsafe bundle path "${e.path}"`)
      await mkdir(dirname(dest), { recursive: true })
      await writeFile(dest, e.data, { flag: 'wx' })
      bytes += e.data.length
    }
    if (await exists(target)) throw new Error(`${basename(target)} appeared while writing. Nothing was written.`)
    await rename(tmp, target)
  } catch (e) {
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined)
    throw e
  }
  return { path: target, files: entries.length, bytes }
}

/** Write the bundle as a zip file at `target` (the folder name becomes the archive's top folder). */
export async function writeZip(target: string, files: unknown, topFolder: string): Promise<WriteResult> {
  const entries = prepare(files)
  await checkTarget(target)
  const top = topFolder.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '') || 'handoff'
  const zip = buildZip(entries.map((e) => ({ path: `${top}/${e.path}`, data: e.data })))
  const tmp = join(dirname(target), `.${basename(target)}.vellum-tmp-${randomBytes(4).toString('hex')}`)
  try {
    await writeFile(tmp, zip, { flag: 'wx' })
    if (await exists(target)) throw new Error(`${basename(target)} appeared while writing. Nothing was written.`)
    await rename(tmp, target)
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => undefined)
    throw e
  }
  return { path: target, files: entries.length, bytes: zip.length }
}
