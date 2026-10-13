// Dev info (v6): per-node handoff fields in CNode.dev. Functions mutate the doc: call on an immer draft.
import type { CNode, DevInfo, Doc, StylePatch } from './types'

/** A change to a node's dev info: a key set to `null` is removed; `states` entries merge per state name (null removes a state). */
export type DevPatch = {
  [K in Exclude<keyof DevInfo, 'states'>]?: DevInfo[K] | null
} & { states?: Record<string, StylePatch | null> | null }

const DEV_KEYS: (keyof DevInfo)[] = ['ready', 'notes', 'states', 'role', 'label', 'tab', 'screen', 'needsDecision']

const isEmptyText = (v: unknown): boolean => typeof v === 'string' && v.trim() === ''

/** Normalise one value; undefined = drop it. Rejects shapes the spec cannot hold. */
function clean(key: keyof DevInfo, v: unknown): unknown {
  switch (key) {
    case 'notes':
    case 'needsDecision':
      return typeof v === 'string' && !isEmptyText(v) ? v : undefined
    case 'role':
    case 'label':
      return typeof v === 'string' && v.trim() ? v.trim() : undefined
    case 'tab':
      return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : undefined
    case 'ready': {
      const at = (v as { at?: unknown } | null)?.at
      return typeof at === 'number' && Number.isInteger(at) && at >= 0 ? { at } : undefined
    }
    case 'screen': {
      const s = v as { name?: unknown; bp?: unknown } | null
      const name = typeof s?.name === 'string' ? s.name.trim() : ''
      const bp = typeof s?.bp === 'string' ? s.bp.trim() : ''
      return name && bp ? { name, bp } : undefined
    }
    case 'states': {
      if (!v || typeof v !== 'object') return undefined
      const out: Record<string, StylePatch> = {}
      for (const [k, patch] of Object.entries(v as Record<string, StylePatch>)) {
        const name = k.trim()
        if (name && patch && typeof patch === 'object' && Object.keys(patch).length) out[name] = { ...patch }
      }
      return Object.keys(out).length ? out : undefined
    }
  }
}

/** Dev info of a node, or undefined when it has none. */
export const getDev = (doc: Doc, id: string): DevInfo | undefined => doc.nodes[id]?.dev

/** Is there anything the dev side would read on this node? */
export const hasDev = (n: CNode): boolean => Boolean(n.dev && Object.keys(n.dev).length)

/**
 * Merge a patch into a node's dev info. Empty values clear the field and an empty DevInfo is removed
 * from the node, so a file that never used dev info has no `dev` keys. Returns false when the node is
 * missing or the patch changed nothing.
 */
export function setDev(doc: Doc, id: string, patch: DevPatch): boolean {
  const n = doc.nodes[id]
  if (!n) return false
  const next: Record<string, unknown> = { ...(n.dev ?? {}) }
  for (const key of DEV_KEYS) {
    if (!(key in patch)) continue
    const raw = patch[key] as unknown
    if (key === 'states' && raw && typeof raw === 'object') {
      const merged: Record<string, unknown> = { ...((n.dev?.states ?? {}) as Record<string, unknown>) }
      for (const [state, p] of Object.entries(raw as Record<string, unknown>)) {
        if (p === null) delete merged[state]
        else merged[state] = p
      }
      assign(next, key, clean(key, merged))
    } else assign(next, key, raw === null ? undefined : clean(key, raw))
  }
  const before = JSON.stringify(n.dev ?? null)
  const after = Object.keys(next).length ? (next as DevInfo) : undefined
  if (JSON.stringify(after ?? null) === before) return false
  if (after) n.dev = after
  else delete n.dev
  return true
}

function assign(o: Record<string, unknown>, k: string, v: unknown): void {
  if (v === undefined) delete o[k]
  else o[k] = v
}

/** Top-level frames (page children) in a page, i.e. the nodes that may carry `dev.screen`. */
export function isTopLevelFrame(doc: Doc, id: string): boolean {
  const n = doc.nodes[id]
  if (!n || n.type !== 'frame' || !n.parent) return false
  return doc.pages.some((p) => p.rootId === n.parent)
}

/**
 * Tag a top-level frame as a screen at a breakpoint (null clears). Only top-level frames can be
 * screens; anything else is refused with false.
 */
export function setScreen(doc: Doc, id: string, screen: { name: string; bp: string } | null): boolean {
  if (screen && !isTopLevelFrame(doc, id)) return false
  return setDev(doc, id, { screen })
}

/** Mark frames ready for dev in handoff version `at` (null clears). Frames only. */
export function setReady(doc: Doc, ids: string[], at: number | null): number {
  let n = 0
  for (const id of ids) {
    if (doc.nodes[id]?.type !== 'frame') continue
    if (setDev(doc, id, { ready: at === null ? null : { at } })) n++
  }
  return n
}

/** Typical widths of the named breakpoints (the frame's own width is what the handoff uses). */
export const BREAKPOINT_WIDTHS = { Desktop: 1280, Tablet: 768, Mobile: 390 } as const
export const BREAKPOINT_NAMES = Object.keys(BREAKPOINT_WIDTHS) as Array<keyof typeof BREAKPOINT_WIDTHS>

/** The breakpoint name a frame of this width most likely is. */
export function suggestBreakpoint(width: number): keyof typeof BREAKPOINT_WIDTHS {
  if (width >= 1024) return 'Desktop'
  if (width >= 600) return 'Tablet'
  return 'Mobile'
}

/** Screens of the document (tag name -> frames tagged with it, with their breakpoint), in document order. */
export function screensOf(doc: Doc): Array<{ name: string; frames: Array<{ id: string; bp: string }> }> {
  const out = new Map<string, { name: string; frames: Array<{ id: string; bp: string }> }>()
  for (const p of doc.pages) {
    for (const id of doc.nodes[p.rootId]?.children ?? []) {
      const tag = doc.nodes[id]?.dev?.screen
      if (!tag) continue
      const key = tag.name.trim().toLowerCase()
      const g = out.get(key) ?? { name: tag.name.trim(), frames: [] }
      g.frames.push({ id, bp: tag.bp })
      out.set(key, g)
    }
  }
  return [...out.values()]
}
