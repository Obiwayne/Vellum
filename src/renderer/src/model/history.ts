// Undo/redo per doc using immer patches. Transactions group several mutations into one step.
import { applyPatches, enablePatches, type Patch } from 'immer'
import type { Doc } from './types'

enablePatches()

export interface HistoryEntry {
  label: string
  patches: Patch[]
  inverse: Patch[]
  time: number
  /** entries with the same key recorded within COALESCE_MS are merged (e.g. scrubbing a field) */
  coalesceKey?: string
}

interface DocHistory {
  undo: HistoryEntry[]
  redo: HistoryEntry[]
  /** open transaction group (depth > 0) */
  depth: number
  group: HistoryEntry | null
}

export const HISTORY_CAP = 200
const COALESCE_MS = 1000

const stacks = new Map<string, DocHistory>()

function get(docId: string): DocHistory {
  let h = stacks.get(docId)
  if (!h) {
    h = { undo: [], redo: [], depth: 0, group: null }
    stacks.set(docId, h)
  }
  return h
}

function push(h: DocHistory, entry: HistoryEntry): void {
  const last = h.undo[h.undo.length - 1]
  if (
    entry.coalesceKey &&
    last &&
    last.coalesceKey === entry.coalesceKey &&
    entry.time - last.time < COALESCE_MS
  ) {
    last.patches = [...last.patches, ...entry.patches]
    last.inverse = [...entry.inverse, ...last.inverse]
    last.time = entry.time
  } else {
    h.undo.push(entry)
    if (h.undo.length > HISTORY_CAP) h.undo.splice(0, h.undo.length - HISTORY_CAP)
  }
  h.redo = []
}

export const history = {
  /** Record a mutation's patches. Inside a transaction they are appended to the open group. */
  record(docId: string, label: string, patches: Patch[], inverse: Patch[], coalesceKey?: string): void {
    if (!patches.length) return
    const h = get(docId)
    if (h.depth > 0 && h.group) {
      h.group.patches.push(...patches)
      h.group.inverse = [...inverse, ...h.group.inverse]
      return
    }
    push(h, { label, patches, inverse, time: Date.now(), coalesceKey })
  },

  begin(docId: string, label: string): void {
    const h = get(docId)
    if (h.depth === 0) h.group = { label, patches: [], inverse: [], time: Date.now() }
    h.depth++
  },

  end(docId: string): void {
    const h = get(docId)
    if (h.depth === 0) return
    h.depth--
    if (h.depth === 0 && h.group) {
      const g = h.group
      h.group = null
      if (g.patches.length) push(h, g)
    }
  },

  inTransaction(docId: string): boolean {
    return get(docId).depth > 0
  },

  /** Returns the doc with the last step undone, or null if nothing to undo. */
  undo(docId: string, doc: Doc): Doc | null {
    const h = get(docId)
    if (h.depth > 0) return null
    const e = h.undo.pop()
    if (!e) return null
    h.redo.push(e)
    return applyPatches(doc, e.inverse)
  },

  redo(docId: string, doc: Doc): Doc | null {
    const h = get(docId)
    if (h.depth > 0) return null
    const e = h.redo.pop()
    if (!e) return null
    h.undo.push(e)
    return applyPatches(doc, e.patches)
  },

  canUndo: (docId: string): boolean => get(docId).undo.length > 0,
  canRedo: (docId: string): boolean => get(docId).redo.length > 0,
  peekUndoLabel: (docId: string): string | undefined => get(docId).undo.at(-1)?.label,
  peekRedoLabel: (docId: string): string | undefined => get(docId).redo.at(-1)?.label,

  clear(docId: string): void {
    stacks.delete(docId)
  }
}
