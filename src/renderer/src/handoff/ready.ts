// Ready-for-dev marks: which top-level frames are ready, and whether one changed since it was marked.
// A mark is `dev.ready = { at, hash }`: `hash` is the content hash of the frame's spec (without measurement, so it is
// cheap and does not depend on layout) at mark time. A different hash now means "changed since ready".
import type { Doc } from '../model/types'
import { nodeSpec } from '../model/devSpec'
import { isPageRoot } from '../model/ops'
import { contentHash } from './handoffMd'
import { withDev } from './collect'

export type ReadyStatus = 'ready' | 'changed'

const cache = new WeakMap<Doc['nodes'], Map<string, string | null>>()

/** Content hash of a frame's hand-off spec (authored values; hidden layers are not part of it), or null. */
export function frameHash(doc: Doc, id: string): string | null {
  let per = cache.get(doc.nodes)
  if (!per) {
    per = new Map()
    cache.set(doc.nodes, per)
  }
  if (per.has(id)) return per.get(id) as string | null
  const spec = nodeSpec(doc, id, { precision: 2 })
  const h = spec ? contentHash(withDev(doc, spec)) : null
  per.set(id, h)
  return h
}

/** Only top-level frames can be marked. */
export function canMark(doc: Doc, id: string): boolean {
  const n = doc.nodes[id]
  return Boolean(n && n.type === 'frame' && n.parent && isPageRoot(doc, n.parent))
}

/** null = not marked. A mark without a hash (made before hashes existed) is never "changed". */
export function readyStatus(doc: Doc, id: string): ReadyStatus | null {
  const r = doc.nodes[id]?.dev?.ready
  if (!r) return null
  if (!r.hash) return 'ready'
  return frameHash(doc, id) === r.hash ? 'ready' : 'changed'
}

/** Version history names the exports "Handoff v3"; the next export is one more than the highest. */
export const HANDOFF_VERSION_RE = /^Handoff v(\d+)$/

export function nextHandoffNumber(versions: ReadonlyArray<{ name?: string | null }>): number {
  let max = 0
  for (const v of versions) {
    const m = HANDOFF_VERSION_RE.exec(v.name ?? '')
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max + 1
}

export const handoffVersionName = (n: number): string => `Handoff v${n}`
