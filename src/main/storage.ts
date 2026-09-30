import { app, ipcMain } from 'electron'
import { promises as fs, copyFileSync, existsSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'
import { IPC, type DocSummary, type IndexData, type StoredDoc } from '@shared/api'

const root = (): string => app.getPath('userData')
const filesDir = (): string => join(root(), 'files')
const indexPath = (): string => join(root(), 'index.json')

const safeId = (id: string): string => {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`Invalid doc id: ${id}`)
  return id
}

async function writeAtomic(path: string, data: string): Promise<void> {
  const tmp = `${path}.tmp`
  await fs.writeFile(tmp, data, 'utf8')
  await fs.rename(tmp, path)
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(path, 'utf8')) as T
  } catch {
    return null
  }
}

/**
 * One-time migration from the app's old name: when %APPDATA%\Vellum\files is missing or empty and
 * %APPDATA%\Canvas\files exists, COPY files/*.json and index.json across. The old folder is left
 * untouched (it is the user's backup). Call before the renderer loads anything.
 */
export function migrateLegacyUserData(legacyName = 'Canvas'): void {
  try {
    const dest = root()
    const src = join(app.getPath('appData'), legacyName)
    if (src.toLowerCase() === dest.toLowerCase()) return
    const srcFiles = join(src, 'files')
    const destFiles = join(dest, 'files')
    if (!existsSync(srcFiles)) return
    if (existsSync(destFiles) && readdirSync(destFiles).some((n) => n.endsWith('.json'))) return
    mkdirSync(destFiles, { recursive: true })
    let copied = 0
    for (const n of readdirSync(srcFiles)) {
      if (!n.endsWith('.json')) continue
      copyFileSync(join(srcFiles, n), join(destFiles, n))
      copied++
    }
    const srcIndex = join(src, 'index.json')
    const hasIndex = existsSync(srcIndex)
    if (hasIndex) copyFileSync(srcIndex, join(dest, 'index.json'))
    console.log(`[vellum] migrated ${copied} file(s)${hasIndex ? ' and index.json' : ''} from ${src} to ${dest} (copied; the old folder is kept)`)
  } catch (err) {
    console.error('[vellum] user data migration failed:', err)
  }
}

export async function listDocs(): Promise<DocSummary[]> {
  await fs.mkdir(filesDir(), { recursive: true })
  const names = (await fs.readdir(filesDir())).filter((n) => n.endsWith('.json'))
  const out: DocSummary[] = []
  for (const n of names) {
    const d = await readJson<StoredDoc>(join(filesDir(), n))
    if (d && typeof d.id === 'string') {
      out.push({ id: d.id, name: d.name, updatedAt: d.updatedAt, archived: Boolean(d.archived) })
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}

// Serialise writes per file so a slow write never lands after a newer one.
const queues = new Map<string, Promise<void>>()
function enqueue(key: string, job: () => Promise<void>): Promise<void> {
  const prev = queues.get(key) ?? Promise.resolve()
  const next = prev.catch(() => undefined).then(job)
  queues.set(key, next)
  return next
}

export function registerStorageIpc(): void {
  ipcMain.handle(IPC.userDataPath, () => root())
  ipcMain.handle(IPC.listDocs, () => listDocs())
  ipcMain.handle(IPC.loadDoc, (_e, id: string) => readJson<StoredDoc>(join(filesDir(), `${safeId(id)}.json`)))
  ipcMain.handle(IPC.saveDoc, async (_e, doc: StoredDoc) => {
    const id = safeId(doc.id)
    await fs.mkdir(filesDir(), { recursive: true })
    await enqueue(id, () => writeAtomic(join(filesDir(), `${id}.json`), JSON.stringify(doc)))
  })
  ipcMain.handle(IPC.deleteDoc, async (_e, id: string) => {
    await enqueue(safeId(id), () => fs.rm(join(filesDir(), `${id}.json`), { force: true }))
  })
  ipcMain.handle(IPC.loadIndex, () => readJson<IndexData>(indexPath()))
  ipcMain.handle(IPC.saveIndex, async (_e, index: IndexData) => {
    await fs.mkdir(root(), { recursive: true })
    await enqueue('__index', () => writeAtomic(indexPath(), JSON.stringify(index, null, 2)))
  })
}
