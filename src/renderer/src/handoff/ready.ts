// Ready-for-dev marks: which top-level frames are ready, and whether one changed since it was marked.
// A mark is `dev.ready = { at, hash }`: `hash` is the content hash of the frame's spec (without measurement, so it is
// cheap and does not depend on layout) at mark time. A different hash now means "changed since ready".
import type { Doc } from '../model/types'
import { nodeSpec } from '../model/devSpec'
import { isPageRoot } from '../model/ops'
import { contentHash } from './handoffMd'
import { withDev } from './collect'

export type ReadyStatus = 'ready' | 'changed'

/**
 * What a frame's hash depends on, as object identities: every node of its subtree, the mains its instances point
 * at, and the document-wide tables a spec reads. Edits elsewhere leave all of them untouched (immer shares them), so
 * the hash is reused instead of rebuilding the spec on every Layers render.
 */
function dependencies(doc: Doc, id: string): object[] {
  const refs: object[] = [doc.tokens, doc.textStyles ?? EMPTY, doc.modes ?? EMPTY]
  const seen = new Set<string>()
  const walk = (nid: string): void => {
    if (seen.has(nid)) return
    seen.add(nid)
    const n = doc.nodes[nid]
    if (!n) return
    refs.push(n)
    if (n.instance) {
      const main = doc.nodes[n.instance.of]
      if (main) refs.push(main)
    }
    for (const c of n.children) walk(c)
  }
  walk(id)
  return refs
}

const EMPTY: object[] = []
const memo = new Map<string, { refs: object[]; hash: string | null }>()

const same = (a: object[], b: object[]): boolean => a.length === b.length && a.every((x, i) => x === b[i])

/** Content hash of a frame's hand-off spec (authored values; hidden layers are not part of it), or null. */
export function frameHash(doc: Doc, id: string): string | null {
  const key = `${doc.id}:${id}`
  const refs = dependencies(doc, id)
  const hit = memo.get(key)
  if (hit && same(hit.refs, refs)) return hit.hash
  const spec = nodeSpec(doc, id, { precision: 2 })
  const h = spec ? contentHash(withDev(doc, spec)) : null
  memo.set(key, { refs, hash: h })
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

/** The newest recorded export (highest "Handoff vN") and when it was saved. */
export function previousHandoff(versions: ReadonlyArray<{ name?: string | null; createdAt?: number }>): { version: number; at: number } | undefined {
  let best: { version: number; at: number } | undefined
  for (const v of versions) {
    const m = HANDOFF_VERSION_RE.exec(v.name ?? '')
    if (!m) continue
    const n = Number(m[1])
    if (!best || n > best.version) best = { version: n, at: v.createdAt ?? 0 }
  }
  return best
}
