// Nested folders for the dashboard. The folder tree lives in the profile's prefs (index.json);
// each file records its folder in `Doc.folderId`. Deleting a folder never deletes files: its
// files and subfolders move up to the parent.
import { nanoid } from 'nanoid'
import { getStore, useStore } from '../model/store'
import type { Doc } from '../model/types'
import type { MenuEntry, MenuItem } from '../ui'

export interface Folder {
  id: string
  name: string
  /** parent folder id, null = top level */
  parent: string | null
  createdAt: number
}

export const FOLDERS_PREF = 'folders'
/** drag-and-drop payload types (DND_FILE holds one or more doc ids, newline-separated) */
export const DND_FILE = 'application/x-vellum-file'
export const DND_FOLDER = 'application/x-vellum-folder'

function valid(v: unknown): Folder[] {
  if (!Array.isArray(v)) return []
  return v.filter(
    (f): f is Folder =>
      Boolean(f) && typeof f.id === 'string' && typeof f.name === 'string' && (f.parent === null || typeof f.parent === 'string')
  )
}

const EMPTY: Folder[] = []
let lastRaw: unknown = null
let lastList: Folder[] = EMPTY

/** Folders from prefs (memoised so selectors return a stable array). */
function fromPrefs(prefs: Record<string, unknown>): Folder[] {
  const raw = prefs[FOLDERS_PREF]
  if (raw !== lastRaw) {
    lastRaw = raw
    lastList = raw === undefined ? EMPTY : valid(raw)
  }
  return lastList
}

export const getFolders = (): Folder[] => fromPrefs(getStore().prefs)
export const useFolders = (): Folder[] => useStore((s) => fromPrefs(s.prefs))

const save = (list: Folder[]): void => getStore().setPref(FOLDERS_PREF, list)

export const folderById = (list: Folder[], id: string | null | undefined): Folder | undefined =>
  id ? list.find((f) => f.id === id) : undefined

/** Children of a folder (null = top level), sorted by name. */
export const childFolders = (list: Folder[], parent: string | null): Folder[] =>
  list.filter((f) => f.parent === parent).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))

/** Root → folder. */
export function folderPath(list: Folder[], id: string | null): Folder[] {
  const out: Folder[] = []
  let cur = folderById(list, id)
  const seen = new Set<string>()
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    out.unshift(cur)
    cur = folderById(list, cur.parent)
  }
  return out
}

/** The folder a doc is in (null when none, or its folder no longer exists). */
export const docFolder = (list: Folder[], d: Doc): string | null => (d.folderId && folderById(list, d.folderId) ? d.folderId : null)

/** Number of files in a folder and all its subfolders (archived files excluded). */
export function fileCount(list: Folder[], docs: Doc[], id: string): number {
  const ids = new Set([id, ...descendants(list, id)])
  return docs.filter((d) => !d.archived && d.folderId && ids.has(d.folderId)).length
}

function descendants(list: Folder[], id: string): string[] {
  const out: string[] = []
  const walk = (p: string): void => {
    for (const f of list) if (f.parent === p && !out.includes(f.id)) (out.push(f.id), walk(f.id))
  }
  walk(id)
  return out
}

/** Unique name among siblings: "New folder", "New folder 2"… */
function uniqueName(list: Folder[], parent: string | null, base: string): string {
  const names = new Set(childFolders(list, parent).map((f) => f.name.toLowerCase()))
  if (!names.has(base.toLowerCase())) return base
  for (let i = 2; ; i++) if (!names.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`
}

export function createFolder(parent: string | null, name = 'New folder'): string {
  const list = getFolders()
  const id = nanoid(10)
  save([...list, { id, name: uniqueName(list, parent, name.trim() || 'New folder'), parent, createdAt: Date.now() }])
  return id
}

export function renameFolder(id: string, name: string): void {
  const n = name.trim()
  if (!n) return
  save(getFolders().map((f) => (f.id === id ? { ...f, name: n } : f)))
}

/** Move a folder under another (or to the top level). Refuses moves into itself or its subfolders. */
export function moveFolder(id: string, parent: string | null): boolean {
  const list = getFolders()
  if (id === parent || (parent && descendants(list, id).includes(parent))) return false
  save(list.map((f) => (f.id === id ? { ...f, parent } : f)))
  return true
}

/** Delete a folder; its files and subfolders move to its parent. */
export function deleteFolder(id: string): void {
  const s = getStore()
  const list = getFolders()
  const f = folderById(list, id)
  if (!f) return
  for (const d of Object.values(s.docs)) if (d.folderId === id) moveDocToFolder(d.id, f.parent)
  save(list.filter((x) => x.id !== id).map((x) => (x.parent === id ? { ...x, parent: f.parent } : x)))
}

/** File-level change (not undoable), like rename/archive. */
export function moveDocToFolder(docId: string, folderId: string | null): void {
  getStore().mutate(
    docId,
    'Move to folder',
    (d) => {
      if (folderId) d.folderId = folderId
      else delete d.folderId
    },
    { noHistory: true }
  )
}

/** "Move to folder" submenu for one file or several (the Scratchpad never moves). */
export function moveToFolderMenu(docs: Doc | Doc[]): MenuItem {
  const list = getFolders()
  const movable = (Array.isArray(docs) ? docs : [docs]).filter((d) => !d.scratchpad)
  const places = new Set(movable.map((d) => docFolder(list, d)))
  // a check only when every file is in the same place
  const current = places.size === 1 ? [...places][0] : undefined
  const move = (folderId: string | null): void => {
    for (const d of movable) moveDocToFolder(d.id, folderId)
  }
  const rows: MenuEntry[] = [{ label: 'No folder', checked: current === null, onSelect: () => move(null) }]
  const walk = (parent: string | null, depth: number): void => {
    for (const f of childFolders(list, parent)) {
      rows.push({ label: `${'    '.repeat(depth)}${f.name}`, checked: current === f.id, onSelect: () => move(f.id) })
      walk(f.id, depth + 1)
    }
  }
  walk(null, 0)
  return { label: 'Move to folder', disabled: !movable.length, submenu: rows }
}
