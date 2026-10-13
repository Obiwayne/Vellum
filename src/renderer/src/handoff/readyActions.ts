// Mark and clear "ready for dev" from the UI (Layers menu, inspector row, export dialog). Marking records the next
// handoff number and the frame's content hash, as one undoable step.
import { canEdit, getStore } from '../model/store'
import { listVersions } from '../history/versions'
import { canMark, frameHash, nextHandoffNumber } from './ready'

/** Mark the top-level frames among `ids` ready. Returns how many were marked. Refused in Dev Mode (read-only). */
export async function markReady(docId: string, ids: string[]): Promise<number> {
  const s = getStore()
  const doc = s.docs[docId]
  if (!doc || !canEdit(docId)) return 0
  const frames = ids.filter((id) => canMark(doc, id))
  if (!frames.length) return 0
  const at = nextHandoffNumber(await listVersions(docId))
  const hashes: Record<string, string> = {}
  // the document may have changed while the history was read: hash the current one
  const now = getStore().docs[docId] ?? doc
  for (const id of frames) {
    const h = frameHash(now, id)
    if (h) hashes[id] = h
  }
  getStore().setReady(docId, frames, at, hashes)
  return frames.length
}

export function clearReady(docId: string, ids: string[]): void {
  const doc = getStore().docs[docId]
  if (!doc || !canEdit(docId)) return
  const marked = ids.filter((id) => doc.nodes[id]?.dev?.ready)
  if (marked.length) getStore().setReady(docId, marked, null)
}

/** Toggle: any unmarked frame in `ids` makes it a "mark all"; all marked makes it a "clear". */
export async function toggleReady(docId: string, ids: string[]): Promise<void> {
  const doc = getStore().docs[docId]
  if (!doc) return
  const frames = ids.filter((id) => canMark(doc, id))
  if (!frames.length) return
  if (frames.every((id) => doc.nodes[id].dev?.ready)) clearReady(docId, frames)
  else await markReady(docId, frames.filter((id) => !doc.nodes[id].dev?.ready))
}
