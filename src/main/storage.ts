import { app, dialog, ipcMain, session, BrowserWindow } from 'electron'
import { promises as fs, copyFileSync, existsSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'
import { IPC, type DocSummary, type IndexData, type ProfileInfo, type ProfileResult, type ProfilesState, type StoredDoc } from '@shared/api'
import { Vault, type ProfileRecord } from './vault'
import { disposeRenderer } from './offscreen'

const root = (): string => app.getPath('userData')

let vault: Vault | null = null
/** The profile store for userData. Created on first use (after userData is final). */
export function getVault(): Vault {
  if (!vault) vault = new Vault(root())
  return vault
}

/** false after the user locks / switches, so a lone unprotected profile doesn't reopen by itself */
let autoOpen = true

const filesDir = (): string => getVault().path('files')
const indexPath = (): string => getVault().path('index.json')

const safeId = (id: string): string => {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`Invalid doc id: ${id}`)
  return id
}

/**
 * One-time migration from the app's old name: when %APPDATA%\Vellum has no profiles yet, its files
 * folder is missing or empty and %APPDATA%\Canvas\files exists, COPY files/*.json and index.json
 * across (they then move into the first profile). The old folder is left untouched.
 */
export function migrateLegacyUserData(legacyName = 'Canvas'): void {
  try {
    const dest = root()
    const src = join(app.getPath('appData'), legacyName)
    if (src.toLowerCase() === dest.toLowerCase()) return
    if (existsSync(join(dest, 'profiles.json'))) return
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
    console.log(
      `[vellum] migrated ${copied} file(s)${hasIndex ? ' and index.json' : ''} from ${src} to ${dest} (copied; the old folder is kept)`
    )
  } catch (err) {
    console.error('[vellum] user data migration failed:', err)
  }
}

export async function listDocs(): Promise<DocSummary[]> {
  const v = getVault()
  const dir = filesDir()
  await fs.mkdir(dir, { recursive: true })
  const names = (await fs.readdir(dir)).filter((n) => n.endsWith('.json'))
  const out: DocSummary[] = []
  for (const n of names) {
    const d = await v.readJson<StoredDoc>(join(dir, n))
    if (d && typeof d.id === 'string') {
      out.push({ id: d.id, name: d.name, updatedAt: d.updatedAt, archived: Boolean(d.archived) })
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}

// ------------------------------------------------------------------------------------------------
// profiles

const info = (p: ProfileRecord): ProfileInfo => ({
  id: p.id,
  name: p.name,
  avatar: p.avatar,
  color: p.color,
  hasPassword: p.hasPassword,
  autoLockMinutes: p.autoLockMinutes,
  createdAt: p.createdAt,
  lastUsedAt: p.lastUsedAt
})

async function profilesState(): Promise<ProfilesState> {
  const v = getVault()
  const list = await v.readProfiles()
  return {
    profiles: list.map(info),
    currentId: v.currentProfile?.id ?? null,
    legacyFileCount: v.legacyFileCount(),
    autoOpen
  }
}

/** Run a profile operation and turn errors into `{ok:false, error}` (no "Error invoking remote method" noise). */
async function result<T extends object>(fn: () => Promise<T | void>): Promise<ProfileResult<T>> {
  try {
    const r = await fn()
    return { ok: true, ...(r ?? ({} as T)) } as ProfileResult<T>
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Forget cached network responses (remote images in designs) when a profile closes. */
async function clearCaches(): Promise<void> {
  try {
    await session.defaultSession.clearCache()
  } catch {
    /* ignore */
  }
}

/**
 * At startup (nothing open yet): if any profile is protected, drop the HTTP cache a previous
 * session may have left behind (e.g. remote images used in a design, if Vellum was closed unlocked).
 */
export async function clearCachesIfProtected(): Promise<void> {
  try {
    if ((await getVault().readProfiles()).some((p) => p.hasPassword)) await clearCaches()
  } catch {
    /* ignore */
  }
}

/** Lock the open profile: wait for writes, zero the key, drop caches. */
export async function lockProfile(): Promise<void> {
  const v = getVault()
  const wasProtected = Boolean(v.currentProfile?.hasPassword)
  await v.close()
  autoOpen = false
  disposeRenderer() // the hidden MCP render window may still hold the last rendered design
  if (wasProtected) await clearCaches()
}

export function registerStorageIpc(): void {
  ipcMain.handle(IPC.userDataPath, () => root())
  ipcMain.handle(IPC.listDocs, () => listDocs())
  ipcMain.handle(IPC.loadDoc, (_e, id: string) => getVault().readJson<StoredDoc>(join(filesDir(), `${safeId(id)}.json`)))
  ipcMain.handle(IPC.saveDoc, async (_e, doc: StoredDoc) => {
    const id = safeId(doc.id)
    await fs.mkdir(filesDir(), { recursive: true })
    await getVault().writeJson(join(filesDir(), `${id}.json`), JSON.stringify(doc))
  })
  ipcMain.handle(IPC.deleteDoc, async (_e, id: string) => {
    await getVault().remove(join(filesDir(), `${safeId(id)}.json`))
  })
  ipcMain.handle(IPC.loadIndex, () => getVault().readJson<IndexData>(indexPath()))
  ipcMain.handle(IPC.saveIndex, async (_e, index: IndexData) => {
    await getVault().writeJson(indexPath(), JSON.stringify(index, null, 2))
  })

  // profiles
  const v = getVault
  ipcMain.handle(IPC.profState, () => profilesState())
  ipcMain.handle(IPC.profCreate, (_e, input: { name: string; avatar?: string; password?: string }) =>
    result(async () => {
      const r = await v().create(input ?? { name: '' })
      autoOpen = true
      return { recoveryKey: r.recoveryKey, migrated: r.migrated }
    })
  )
  ipcMain.handle(IPC.profOpen, (_e, id: string, password?: string) =>
    result(async () => {
      await v().open(id, password)
      autoOpen = true
    })
  )
  ipcMain.handle(IPC.profRecover, (_e, id: string, key: string, pw?: string) =>
    result(async () => {
      await v().recover(id, String(key ?? ''), pw)
    })
  )
  ipcMain.handle(IPC.profLock, () => lockProfile())
  ipcMain.handle(IPC.profUpdate, (_e, patch: { name?: string; avatar?: string | null; autoLockMinutes?: number }) =>
    result(async () => {
      await v().update(patch ?? {})
    })
  )
  ipcMain.handle(IPC.profSetPassword, (_e, cur: string | undefined, next: string) => result(() => v().setPassword(cur, next)))
  ipcMain.handle(IPC.profRemovePassword, (_e, cur: string) =>
    result(async () => {
      await v().removePassword(String(cur ?? ''))
      await clearCaches()
    })
  )
  ipcMain.handle(IPC.profNewRecoveryKey, (_e, cur: string) =>
    result(async () => ({ recoveryKey: await v().newRecoveryKey(String(cur ?? '')) }))
  )
  ipcMain.handle(IPC.profRemove, (_e, id: string, pw?: string) =>
    result(async () => {
      const wasOpen = v().currentProfile?.id === id
      await v().deleteProfile(id, pw)
      if (wasOpen) {
        autoOpen = false
        await clearCaches()
      }
    })
  )
  ipcMain.handle(IPC.profSaveRecoveryKey, (e, name: string, key: string) =>
    result(async () => {
      const win = BrowserWindow.fromWebContents(e.sender)
      const safeName =
        String(name ?? 'profile')
          .replace(/[\\/:*?"<>|]+/g, '')
          .trim() || 'profile'
      const opts = {
        title: 'Save recovery key',
        defaultPath: join(app.getPath('documents'), `Vellum recovery key - ${safeName}.txt`),
        filters: [{ name: 'Text', extensions: ['txt'] }]
      }
      const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
      if (r.canceled || !r.filePath) return { path: undefined }
      const text =
        `Vellum recovery key for the profile "${String(name ?? '')}"\r\n\r\n${String(key)}\r\n\r\n` +
        `Use it if you forget this profile's password (Forgot password? > Use recovery key).\r\n` +
        `Keep it somewhere safe and private: anyone with this key can open the profile.\r\n`
      await fs.writeFile(r.filePath, text, 'utf8')
      return { path: r.filePath }
    })
  )
}
