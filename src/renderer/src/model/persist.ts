// Load docs + index on startup, debounce-save on change. Falls back to in-memory when
// window.canvasApi is missing (e.g. renderer opened in a plain browser).
import type { IndexData, StoredDoc } from '@shared/api'
import type { Doc } from './types'
import { DASHBOARD, useStore, type Store } from './store'
import { makeDoc, migrateDoc } from './ops'
import { nanoid } from 'nanoid'
import { restoredNotice, useRecovery } from './recovery'

const DOC_DEBOUNCE = 500
/** under constant editing (dragging, scrubbing) the trailing debounce never fires: save at least this often */
const DOC_MAX_WAIT = 2000
/** a copy of the unsaved design goes to <id>.recovery this soon after an edit (a crash before the save lands loses nothing) */
const RECOVERY_DELAY = 120
const INDEX_DEBOUNCE = 300

const api = (): Window['canvasApi'] | undefined => (typeof window !== 'undefined' ? window.canvasApi : undefined)

function isDoc(v: unknown): v is Doc {
  const d = v as Doc
  return Boolean(d && typeof d.id === 'string' && Array.isArray(d.pages) && d.nodes && typeof d.nodes === 'object')
}

function createScratchpad(): Doc {
  const doc = makeDoc(nanoid(12), 'Scratchpad')
  doc.scratchpad = true
  return doc
}

let started = false

export async function initPersistence(): Promise<void> {
  if (started) return
  started = true
  const a = api()
  const docs: Record<string, Doc> = {}
  let index: IndexData | null = null
  const migrated = new Set<string>()

  if (a) {
    try {
      index = await a.loadIndex()
      const list = await a.listDocs()
      const loaded = await Promise.all(list.map((s) => a.loadDoc(s.id)))
      for (const d of loaded) {
        if (!isDoc(d)) continue
        const m = migrateDoc(d)
        if (m !== d) migrated.add(m.id)
        docs[m.id] = m
      }
    } catch (err) {
      console.error('[persist] failed to load', err)
    }
  }

  let scratchpadId = index?.scratchpadId
  if (!scratchpadId || !docs[scratchpadId]) {
    const existing = Object.values(docs).find((d) => d.scratchpad)
    if (existing) scratchpadId = existing.id
    else {
      const s = createScratchpad()
      docs[s.id] = s
      scratchpadId = s.id
    }
  }
  docs[scratchpadId] = { ...docs[scratchpadId], scratchpad: true, archived: false }

  const firstRun = !index
  const known = new Set(Object.keys(docs))
  const recents = [
    ...(index?.recents ?? []).filter((r) => known.has(r)),
    ...Object.values(docs)
      .filter((d) => !(index?.recents ?? []).includes(d.id))
      .sort((x, y) => y.updatedAt - x.updatedAt)
      .map((d) => d.id)
  ]

  useStore.getState().hydrate({
    docs,
    recents,
    tabs: firstRun ? [DASHBOARD, scratchpadId] : index?.tabs ?? [DASHBOARD],
    activeTab: firstRun ? DASHBOARD : index?.activeTab ?? DASHBOARD,
    prefs: index?.prefs ?? {},
    scratchpadId
  })

  if (!a) return
  // everything loaded counts as saved, except docs we just created/patched
  const saved = new Map<string, Doc>()
  for (const d of Object.values(useStore.getState().docs)) {
    if (!firstRun && d.id !== scratchpadId && !migrated.has(d.id)) saved.set(d.id, d)
  }
  subscribe(saved)
  // write new/patched docs + index right away
  scheduleDocs(useStore.getState(), saved, false)
  scheduleIndex(useStore.getState())
  await checkRecovery(a, docs)
}

/** After a crash: designs with unsaved changes newer than their file are offered back; files read from a backup are announced. */
async function checkRecovery(a: NonNullable<Window['canvasApi']>, docs: Record<string, Doc>): Promise<void> {
  try {
    const items: { doc: Doc; existing: boolean }[] = []
    for (const raw of await a.listRecoveries()) {
      if (!isDoc(raw)) continue
      const rec = migrateDoc(raw as unknown as Doc)
      const saved = docs[rec.id]
      // the saved file is as new as the copy (the crash came after the save): nothing is lost
      if (saved && saved.updatedAt >= rec.updatedAt) await a.discardRecovery(rec.id)
      else items.push({ doc: rec, existing: Boolean(saved) })
    }
    const notices = (await a.takeRestored()).map((f) => restoredNotice(f, docs))
    if (items.length || notices.length) useRecovery.setState({ items, notices })
  } catch (err) {
    console.error('[persist] recovery check failed', err)
  }
}

// ------------------------------------------------------------------------------------------------

const docTimers = new Map<string, ReturnType<typeof setTimeout>>()
let indexTimer: ReturnType<typeof setTimeout> | null = null
let lastIndexJson = ''
const pendingDocs = new Map<string, Doc>()
/** when each design first became dirty since its last save (for DOC_MAX_WAIT) */
const dirtySince = new Map<string, number>()
const recoveryTimers = new Map<string, ReturnType<typeof setTimeout>>()

function toIndex(s: Store): IndexData {
  return { recents: s.recents, tabs: s.tabs, activeTab: s.activeTab, scratchpadId: s.scratchpadId, prefs: s.prefs }
}

/** false once the profile is being locked / switched: nothing may be written after that */
let enabled = true
const inflight = new Set<Promise<unknown>>()
function track(p: Promise<unknown> | undefined): void {
  if (!p) return
  const q = p.catch(() => undefined).finally(() => inflight.delete(q))
  inflight.add(q)
}

function clearPending(id: string): void {
  dirtySince.delete(id)
  const r = recoveryTimers.get(id)
  if (r) clearTimeout(r)
  recoveryTimers.delete(id)
}

function writeDoc(doc: Doc): void {
  pendingDocs.delete(doc.id)
  clearPending(doc.id) // the save deletes the recovery copy in main
  if (!enabled) return
  track(
    api()
      ?.saveDoc(doc as unknown as StoredDoc)
      .catch((err) => console.error('[persist] save failed', doc.id, err))
  )
}

function scheduleDocs(s: Store, saved: Map<string, Doc>, withRecovery = true): void {
  for (const [id, doc] of Object.entries(s.docs)) {
    if (saved.get(id) === doc) continue
    saved.set(id, doc)
    pendingDocs.set(id, doc)
    const now = Date.now()
    if (!dirtySince.has(id)) dirtySince.set(id, now)
    const t = docTimers.get(id)
    if (t) clearTimeout(t)
    const wait = Math.max(0, Math.min(DOC_DEBOUNCE, (dirtySince.get(id) as number) + DOC_MAX_WAIT - now))
    docTimers.set(
      id,
      setTimeout(() => {
        docTimers.delete(id)
        const latest = pendingDocs.get(id)
        if (latest) writeDoc(latest)
      }, wait)
    )
    if (withRecovery && !recoveryTimers.has(id)) {
      recoveryTimers.set(
        id,
        setTimeout(() => {
          recoveryTimers.delete(id)
          const latest = pendingDocs.get(id)
          if (latest && enabled) track(api()?.saveRecovery(latest as unknown as StoredDoc))
        }, RECOVERY_DELAY)
      )
    }
  }
  for (const id of [...saved.keys()]) {
    if (!s.docs[id]) {
      saved.delete(id)
      pendingDocs.delete(id)
      clearPending(id)
      const t = docTimers.get(id)
      if (t) clearTimeout(t)
      docTimers.delete(id)
      if (enabled) track(api()?.deleteDoc(id))
    }
  }
}

function scheduleIndex(s: Store): void {
  const json = JSON.stringify(toIndex(s))
  if (json === lastIndexJson) return
  lastIndexJson = json
  if (indexTimer) clearTimeout(indexTimer)
  indexTimer = setTimeout(() => {
    indexTimer = null
    if (enabled) track(api()?.saveIndex(JSON.parse(json) as IndexData))
  }, INDEX_DEBOUNCE)
}

function subscribe(saved: Map<string, Doc>): void {
  useStore.subscribe((s, prev) => {
    if (s.docs !== prev.docs) scheduleDocs(s, saved)
    if (s.recents !== prev.recents || s.tabs !== prev.tabs || s.activeTab !== prev.activeTab || s.prefs !== prev.prefs) {
      scheduleIndex(s)
    }
  })
  window.addEventListener('beforeunload', flushNow)
  // leaving the window (alt-tab, minimise, a dialog) is a good moment to put pending edits on disk
  window.addEventListener('blur', flushNow)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flushNow())
}

/** Write all pending changes immediately. */
export function flushNow(): void {
  for (const [id, t] of docTimers) {
    clearTimeout(t)
    docTimers.delete(id)
  }
  for (const doc of [...pendingDocs.values()]) writeDoc(doc)
  if (indexTimer) {
    clearTimeout(indexTimer)
    indexTimer = null
    if (enabled) track(api()?.saveIndex(toIndex(useStore.getState())))
  }
}

/** Flush everything, wait until it is on disk, then stop writing (before lock / switch profile). */
export async function flushAndStop(): Promise<void> {
  flushNow()
  enabled = false
  await Promise.all([...inflight])
}
