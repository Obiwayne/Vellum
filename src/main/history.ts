// Version history of each doc, stored in the open profile (encrypted like everything else):
//   history/<doc>/index.json        VersionMeta[] (newest first)
//   history/<doc>/<version>.bin     gzipped doc JSON; strings >= BLOB_MIN (images) are replaced by a blob ref
//   history/<doc>/blobs/<hash>.bin  gzipped big string, shared by every version that uses it
// Auto versions: when a save arrives and the newest version is older than AUTO_INTERVAL, the doc as it is
// on disk (the state before this save) becomes a version, so the last state before every break is kept.
import { createHash, randomBytes } from 'crypto'
import { existsSync, promises as fs } from 'fs'
import { join } from 'path'
import { promisify } from 'util'
import { gunzip as gunzipCb, gzip as gzipCb } from 'zlib'
import type { StoredDoc, VersionKind, VersionMeta } from '@shared/api'
import { diffDocs, summarize, type DiffableDoc } from '@shared/docDiff'
import { safeId } from './vault'
import { getVault } from './storage'

const gzip = promisify(gzipCb)
const gunzip = promisify(gunzipCb)

export const AUTO_INTERVAL = Number(process.env.VELLUM_HISTORY_INTERVAL_MS) || 5 * 60_000
const MAX_AUTO = 100
const BLOB_MIN = 4096
const BLOB_MARK = '\u0001vellum-blob:'
const BLOB_RE = /\\u0001vellum-blob:([0-9a-f]{40})/g

const docDir = (docId: unknown): string => getVault().path('history', safeId(docId))
const indexFile = (docId: string): string => join(docDir(docId), 'index.json')
const versionFile = (docId: string, vid: string): string => join(docDir(docId), `${safeId(vid)}.bin`)
const blobFile = (docId: string, hash: string): string => join(docDir(docId), 'blobs', `${hash}.bin`)

/** one operation at a time per doc (index read-modify-write) */
const locks = new Map<string, Promise<unknown>>()
function locked<T>(docId: string, fn: () => Promise<T>): Promise<T> {
  const key = `${getVault().currentDir()}|${docId}`
  const next = (locks.get(key) ?? Promise.resolve()).catch(() => undefined).then(fn)
  locks.set(key, next)
  void next.finally(() => {
    if (locks.get(key) === next) locks.delete(key)
  })
  return next
}

async function readIndex(docId: string): Promise<VersionMeta[]> {
  const v = await getVault().readJson<{ versions?: VersionMeta[] }>(indexFile(docId))
  return Array.isArray(v?.versions) ? v.versions : []
}

async function writeIndex(docId: string, versions: VersionMeta[]): Promise<void> {
  await getVault().writeJson(indexFile(docId), JSON.stringify({ versions }))
}

/** JSON with big strings swapped for blob refs, plus the blobs it refers to */
function dehydrate(doc: StoredDoc): { json: string; blobs: Map<string, string> } {
  const blobs = new Map<string, string>()
  const json = JSON.stringify(doc, (_k, v: unknown) => {
    if (typeof v === 'string' && v.length >= BLOB_MIN) {
      const hash = createHash('sha1').update(v).digest('hex')
      blobs.set(hash, v)
      return BLOB_MARK + hash
    }
    return v
  })
  return { json, blobs }
}

/** The stored (dehydrated) JSON of a version, or null. */
async function readRaw(docId: string, vid: string): Promise<string | null> {
  const buf = await getVault().readBytes(versionFile(docId, vid))
  if (!buf) return null
  try {
    return (await gunzip(buf)).toString('utf8')
  } catch {
    return null
  }
}

async function hydrate(docId: string, json: string): Promise<StoredDoc | null> {
  const hashes = new Set([...json.matchAll(BLOB_RE)].map((m) => m[1]))
  const blobs = new Map<string, string>()
  for (const h of hashes) {
    const buf = await getVault().readBytes(blobFile(docId, h))
    if (buf) blobs.set(h, (await gunzip(buf)).toString('utf8'))
  }
  try {
    return JSON.parse(json, (_k, v: unknown) =>
      typeof v === 'string' && v.startsWith(BLOB_MARK) ? blobs.get(v.slice(BLOB_MARK.length)) ?? '' : v
    ) as StoredDoc
  } catch {
    return null
  }
}

const parse = (json: string | null): DiffableDoc | null => {
  if (!json) return null
  try {
    return JSON.parse(json) as DiffableDoc
  } catch {
    return null
  }
}

async function addVersion(
  docId: string,
  versions: VersionMeta[],
  doc: StoredDoc,
  kind: VersionKind,
  extra: { name?: string; restoredFrom?: number } = {}
): Promise<VersionMeta> {
  const v = getVault()
  const { json, blobs } = dehydrate(doc)
  await fs.mkdir(join(docDir(docId), 'blobs'), { recursive: true })
  for (const [hash, str] of blobs) {
    const p = blobFile(docId, hash)
    if (!existsSync(p)) await v.writeBytes(p, await gzip(Buffer.from(str, 'utf8')))
  }
  const data = await gzip(Buffer.from(json, 'utf8'))
  const id = randomBytes(9).toString('base64url')
  await v.writeBytes(versionFile(docId, id), data)
  const prev = versions[0] ? parse(await readRaw(docId, versions[0].id)) : null
  const parsed = parse(json) as DiffableDoc
  const meta: VersionMeta = {
    id,
    kind,
    createdAt: Date.now(),
    docUpdatedAt: typeof doc.updatedAt === 'number' ? doc.updatedAt : Date.now(),
    ...(extra.name ? { name: extra.name } : {}),
    ...(extra.restoredFrom ? { restoredFrom: extra.restoredFrom } : {}),
    ...(prev ? { summary: summarize(diffDocs(prev, parsed)) } : {}),
    pageCount: parsed.pages?.length ?? 0,
    nodeCount: Object.keys(parsed.nodes ?? {}).length,
    size: data.length,
    blobs: [...blobs.keys()]
  }
  versions.unshift(meta)
  // keep named / restore points; cap the automatic ones
  const autos = versions.filter((x) => x.kind === 'auto')
  for (const old of autos.slice(MAX_AUTO)) await dropVersion(docId, versions, old.id)
  await writeIndex(docId, versions)
  return meta
}

/** Remove a version from `versions` (in place) and its file; fix the neighbour's summary; drop unused blobs. */
async function dropVersion(docId: string, versions: VersionMeta[], vid: string): Promise<void> {
  const i = versions.findIndex((x) => x.id === vid)
  if (i < 0) return
  const [gone] = versions.splice(i, 1)
  const v = getVault()
  await v.remove(versionFile(docId, gone.id))
  // the newer neighbour's summary was "since `gone`": recompute it against the next older one
  const newer = versions[i - 1]
  if (newer) {
    const older = versions[i]
    const a = older ? parse(await readRaw(docId, older.id)) : null
    const b = parse(await readRaw(docId, newer.id))
    if (b) {
      if (a) newer.summary = summarize(diffDocs(a, b))
      else delete newer.summary
    }
  }
  const used = new Set(versions.flatMap((x) => x.blobs ?? []))
  for (const h of gone.blobs ?? []) if (!used.has(h)) await v.remove(blobFile(docId, h))
}

/**
 * Called before a doc save is written: keeps the on-disk state as an automatic version when the
 * newest version is older than AUTO_INTERVAL. Reads the disk copy before returning (so the save
 * that follows can't overwrite it first); the version itself is written in the background.
 */
export async function beforeSave(doc: StoredDoc, diskPath: string): Promise<void> {
  const docId = doc.id
  const versions = await readIndex(docId)
  const latest = versions[0]
  if (latest && Date.now() - latest.createdAt < AUTO_INTERVAL) return
  const prev = await getVault().readJson<StoredDoc>(diskPath)
  if (!prev || prev.id !== docId) return
  if (latest && prev.updatedAt <= latest.docUpdatedAt) return
  void locked(docId, async () => {
    const cur = await readIndex(docId)
    if (cur[0] && (Date.now() - cur[0].createdAt < AUTO_INTERVAL || prev.updatedAt <= cur[0].docUpdatedAt)) return
    await addVersion(docId, cur, prev, 'auto')
  }).catch((err) => console.error('[history] auto version failed:', err instanceof Error ? err.message : err))
}

export const listVersions = (docId: string): Promise<VersionMeta[]> =>
  locked(docId, async () => (await readIndex(docId)).map(({ blobs: _b, ...m }) => m))

export async function loadVersion(docId: string, vid: string): Promise<StoredDoc | null> {
  const raw = await readRaw(docId, vid)
  return raw ? hydrate(docId, raw) : null
}

export function saveVersion(doc: StoredDoc, kind: VersionKind, extra: { name?: string; restoredFrom?: number }): Promise<VersionMeta> {
  return locked(doc.id, async () => {
    const { blobs: _b, ...m } = await addVersion(doc.id, await readIndex(doc.id), doc, kind, extra)
    return m
  })
}

export function renameVersion(docId: string, vid: string, name: string): Promise<void> {
  return locked(docId, async () => {
    const versions = await readIndex(docId)
    const v = versions.find((x) => x.id === vid)
    if (!v) return
    const trimmed = name.trim().slice(0, 200)
    if (trimmed) {
      v.name = trimmed
      if (v.kind === 'auto') v.kind = 'named' // a named version is never pruned
    } else delete v.name
    await writeIndex(docId, versions)
  })
}

export function removeVersion(docId: string, vid: string): Promise<void> {
  return locked(docId, async () => {
    const versions = await readIndex(docId)
    await dropVersion(docId, versions, vid)
    await writeIndex(docId, versions)
  })
}

/** Delete a doc's whole history (the doc was deleted). */
export function removeHistory(docId: string): Promise<void> {
  return locked(docId, () => getVault().removeDir(docDir(docId)))
}
