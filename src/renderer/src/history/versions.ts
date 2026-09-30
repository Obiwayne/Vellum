// Version history actions in the renderer (storage lives in src/main/history.ts).
import { create } from 'zustand'
import type { StoredDoc, VersionMeta } from '@shared/api'
import { getStore } from '../model/store'
import { migrateDoc } from '../model/ops'
import type { Doc } from '../model/types'
import { flushNow } from '../model/persist'

const api = (): Window['canvasApi']['history'] | undefined =>
  typeof window !== 'undefined' ? window.canvasApi?.history : undefined

function isDoc(v: unknown): v is Doc {
  const d = v as Doc
  return Boolean(d && typeof d.id === 'string' && Array.isArray(d.pages) && d.nodes && typeof d.nodes === 'object')
}

export async function listVersions(docId: string): Promise<VersionMeta[]> {
  return (await api()?.list(docId)) ?? []
}

export async function loadVersionDoc(docId: string, versionId: string): Promise<Doc | null> {
  const d = await api()?.load(docId, versionId)
  return isDoc(d) ? migrateDoc(d) : null
}

/** "30 Sep, 14:32" (with the year when it isn't this year) */
export function versionTime(ts: number): string {
  const d = new Date(ts)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit'
  })
}

export function versionTitle(v: VersionMeta): string {
  if (v.name) return v.name
  if (v.kind === 'restore') return 'Before restore'
  return versionTime(v.docUpdatedAt)
}

/** Save the doc as it is now as a named version. */
export async function saveNamedVersion(docId: string, name: string): Promise<VersionMeta | null> {
  const doc = getStore().docs[docId]
  const a = api()
  if (!doc || !a) return null
  flushNow()
  return a.save(doc as unknown as StoredDoc, { kind: 'named', name: name.trim() || undefined })
}

/**
 * Replace the doc's content with a version's. The current state is kept as a "Before restore"
 * version first, and the restore itself is one undo step. Name, folder and comments stay as they are.
 */
export async function restoreVersion(docId: string, v: VersionMeta): Promise<boolean> {
  const s = getStore()
  const cur = s.docs[docId]
  const a = api()
  if (!cur || !a) return false
  const old = await loadVersionDoc(docId, v.id)
  if (!old) return false
  flushNow()
  await a.save(cur as unknown as StoredDoc, { kind: 'restore', restoredFrom: v.docUpdatedAt })
  getStore().mutate(docId, 'Restore version', (d) => {
    d.pages = old.pages
    d.nodes = old.nodes
    d.tokens = old.tokens
    if (old.modes) d.modes = old.modes
    else delete d.modes
    d.nextId = Math.max(d.nextId, old.nextId)
    d.version = old.version
  })
  const after = getStore()
  const e = after.editors[docId]
  const doc = after.docs[docId]
  after.select(docId, [])
  if (doc && e && !doc.pages.some((p) => p.id === e.pageId) && doc.pages[0]) after.setActivePage(docId, doc.pages[0].id)
  return true
}

/** Copy a version into a new file (not opened). Returns the new doc id. */
export async function duplicateVersion(docId: string, v: VersionMeta): Promise<string | null> {
  const s = getStore()
  const src = s.docs[docId]
  const old = await loadVersionDoc(docId, v.id)
  if (!src || !old) return null
  const newId = s.createDoc(`${src.name} (${versionTitle(v)})`, { open: false })
  s.mutate(
    newId,
    'Duplicate version',
    (d) => {
      d.pages = old.pages
      d.nodes = old.nodes
      d.tokens = old.tokens
      if (old.modes) d.modes = old.modes
      d.nextId = old.nextId
      d.version = old.version
      if (src.folderId) d.folderId = src.folderId
    },
    { noHistory: true }
  )
  return newId
}

/** "Save to version history" dialog, openable from anywhere (menu, Ctrl+Alt+S). */
export const useSaveVersionDialog = create<{ docId: string | null; open: (docId: string) => void; close: () => void }>(
  (set) => ({
    docId: null,
    open: (docId) => set({ docId }),
    close: () => set({ docId: null })
  })
)
