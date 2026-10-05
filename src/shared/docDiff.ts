// What changed between two saved states of a doc (version history). Pure data, no runtime imports:
// used by main (the summary stored with each version) and the renderer (the change list).

/** The parts of a doc that a diff looks at (StoredDoc / renderer Doc both fit). */
export interface DiffableDoc {
  name?: string
  pages?: { id: string; name: string; rootId: string; background?: string }[]
  nodes?: Record<string, DiffNode>
  tokens?: { name: string; value: string; modes?: Record<string, string> }[]
  modes?: string[]
}

interface DiffNode {
  id: string
  type: string
  name: string
  parent: string | null
  children: string[]
  style?: Record<string, unknown>
  x?: number
  y?: number
  text?: string
  svg?: string
  attrs?: Record<string, string>
  visible?: boolean
  locked?: boolean
  /** components: instance link + overrides; srcId marks a node derived from a main (not listed in the diff) */
  instance?: unknown
  srcId?: string
  /** components: main info (name, set, variant values, props), set info (name, props) and property bindings */
  component?: unknown
  componentSet?: unknown
  bind?: unknown
}

/** What about a layer changed. */
export type ChangeAspect = 'style' | 'text' | 'position' | 'name' | 'visibility' | 'layers' | 'content'

export interface NodeChange {
  id: string
  name: string
  type: string
  pageId: string | null
  parent: string | null
  /** for 'changed' */
  aspects?: ChangeAspect[]
}

export interface DocDiff {
  renamed?: { from: string; to: string }
  pagesAdded: string[]
  pagesRemoved: string[]
  pagesRenamed: { from: string; to: string }[]
  /** pages whose canvas colour changed */
  pagesRecoloured: string[]
  added: NodeChange[]
  removed: NodeChange[]
  changed: NodeChange[]
  tokensAdded: string[]
  tokensRemoved: string[]
  tokensChanged: string[]
  modesChanged: boolean
}

/** Counts stored with each version, for the list rows. */
export interface DiffSummary {
  added: number
  removed: number
  changed: number
  pages: number
  tokens: number
  renamed?: boolean
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** page id of every node (walks up to the page root) */
function pageIndex(doc: DiffableDoc): (id: string) => string | null {
  const byRoot = new Map((doc.pages ?? []).map((p) => [p.rootId, p.id]))
  const memo = new Map<string, string | null>()
  const nodes = doc.nodes ?? {}
  const find = (id: string, depth = 0): string | null => {
    if (memo.has(id)) return memo.get(id) as string | null
    const n = nodes[id]
    let r: string | null = null
    if (byRoot.has(id)) r = byRoot.get(id) as string
    else if (n?.parent && depth < 500) r = find(n.parent, depth + 1)
    memo.set(id, r)
    return r
  }
  return find
}

function aspects(a: DiffNode, b: DiffNode): ChangeAspect[] {
  const out: ChangeAspect[] = []
  if (!same(a.style, b.style)) out.push('style')
  if ((a.text ?? '') !== (b.text ?? '')) out.push('text')
  if ((a.x ?? 0) !== (b.x ?? 0) || (a.y ?? 0) !== (b.y ?? 0)) out.push('position')
  if (a.name !== b.name) out.push('name')
  if (Boolean(a.visible) !== Boolean(b.visible) || Boolean(a.locked) !== Boolean(b.locked)) out.push('visibility')
  // an instance's children are derived from its main: only the main's own change is a layers change
  if (a.parent !== b.parent || (!b.instance && !same(a.children, b.children))) out.push('layers')
  // instance link / property values / overrides, a main's variant values and props, a set's props, bindings
  if (!out.includes('content') && !(same(a.instance, b.instance) && same(a.component, b.component) && same(a.componentSet, b.componentSet) && same(a.bind, b.bind))) out.push('content')
  if ((a.svg ?? '') !== (b.svg ?? '') || !same(a.attrs, b.attrs) || a.type !== b.type) out.push('content')
  return out
}

/** Changes from `before` (older) to `after` (newer). */
export function diffDocs(before: DiffableDoc | null, after: DiffableDoc): DocDiff {
  const d: DocDiff = {
    pagesAdded: [],
    pagesRemoved: [],
    pagesRenamed: [],
    pagesRecoloured: [],
    added: [],
    removed: [],
    changed: [],
    tokensAdded: [],
    tokensRemoved: [],
    tokensChanged: [],
    modesChanged: false
  }
  if (!before) return d
  if (before.name && after.name && before.name !== after.name) d.renamed = { from: before.name, to: after.name }

  const oldPages = new Map((before.pages ?? []).map((p) => [p.id, p]))
  const newPages = new Map((after.pages ?? []).map((p) => [p.id, p]))
  for (const [id, p] of newPages) {
    const o = oldPages.get(id)
    if (!o) d.pagesAdded.push(p.name)
    else {
      if (o.name !== p.name) d.pagesRenamed.push({ from: o.name, to: p.name })
      if ((o.background ?? '') !== (p.background ?? '')) d.pagesRecoloured.push(p.name)
    }
  }
  for (const [id, p] of oldPages) if (!newPages.has(id)) d.pagesRemoved.push(p.name)

  const oldNodes = before.nodes ?? {}
  const newNodes = after.nodes ?? {}
  const oldPage = pageIndex(before)
  const newPage = pageIndex(after)
  const roots = new Set([...oldPages.values(), ...newPages.values()].map((p) => p.rootId))
  // nodes derived from a main component (instance children) are not listed: their main or the instance root is
  const derived = (n: DiffNode): boolean => n.srcId !== undefined && !n.instance
  for (const [id, n] of Object.entries(newNodes)) {
    if (roots.has(id) || derived(n)) continue
    const o = oldNodes[id]
    const entry = { id, name: n.name, type: n.type, pageId: newPage(id), parent: n.parent }
    if (!o) d.added.push(entry)
    else {
      const a = aspects(o, n)
      if (a.length) d.changed.push({ ...entry, aspects: a })
    }
  }
  for (const [id, n] of Object.entries(oldNodes)) {
    if (!roots.has(id) && !newNodes[id] && !derived(n)) d.removed.push({ id, name: n.name, type: n.type, pageId: oldPage(id), parent: n.parent })
  }
  // a parent whose only change is gaining/losing the added/removed children is noise
  d.changed = d.changed.filter((c) => !(c.aspects?.length === 1 && c.aspects[0] === 'layers' && childOnly(c.id, d)))

  const oldTokens = new Map((before.tokens ?? []).map((t) => [t.name, t]))
  const newTokens = new Map((after.tokens ?? []).map((t) => [t.name, t]))
  for (const [name, t] of newTokens) {
    const o = oldTokens.get(name)
    if (!o) d.tokensAdded.push(name)
    else if (o.value !== t.value || !same(o.modes, t.modes)) d.tokensChanged.push(name)
  }
  for (const name of oldTokens.keys()) if (!newTokens.has(name)) d.tokensRemoved.push(name)
  d.modesChanged = !same(before.modes, after.modes)
  return d

  function childOnly(id: string, diff: DocDiff): boolean {
    const a = (oldNodes[id]?.children ?? []).filter((c) => newNodes[c])
    const b = (newNodes[id]?.children ?? []).filter((c) => oldNodes[c])
    return same(a, b) && diff.added.concat(diff.removed).length > 0
  }
}

/**
 * Only the topmost of a set of added/removed layers (a deleted group lists once, not with every
 * layer inside it), each with how many layers it stands for.
 */
export function topmost(list: NodeChange[]): { change: NodeChange; count: number }[] {
  const ids = new Map(list.map((c) => [c.id, c]))
  const out = new Map<string, { change: NodeChange; count: number }>()
  const rootOf = (c: NodeChange): NodeChange => {
    let cur = c
    for (let i = 0; i < 500 && cur.parent && ids.has(cur.parent); i++) cur = ids.get(cur.parent) as NodeChange
    return cur
  }
  for (const c of list) {
    const r = rootOf(c)
    const e = out.get(r.id)
    if (e) e.count++
    else out.set(r.id, { change: r, count: 1 })
  }
  return [...out.values()]
}

export function summarize(d: DocDiff): DiffSummary {
  return {
    added: topmost(d.added).length,
    removed: topmost(d.removed).length,
    changed: d.changed.length,
    pages: d.pagesAdded.length + d.pagesRemoved.length + d.pagesRenamed.length + d.pagesRecoloured.length,
    tokens: d.tokensAdded.length + d.tokensRemoved.length + d.tokensChanged.length + (d.modesChanged ? 1 : 0),
    ...(d.renamed ? { renamed: true } : {})
  }
}

/** "3 added · 5 edited · 1 removed" (empty string when nothing changed). */
export function summaryText(s: DiffSummary | undefined): string {
  if (!s) return ''
  const parts: string[] = []
  const layers = (n: number): string => `${n} layer${n === 1 ? '' : 's'}`
  if (s.added) parts.push(`${layers(s.added)} added`)
  if (s.changed) parts.push(`${s.added ? s.changed : layers(s.changed)} edited`)
  if (s.removed) parts.push(`${s.added || s.changed ? s.removed : layers(s.removed)} removed`)
  if (s.pages) parts.push(`${s.pages} page change${s.pages === 1 ? '' : 's'}`)
  if (s.tokens) parts.push(`${s.tokens} token change${s.tokens === 1 ? '' : 's'}`)
  if (s.renamed) parts.push('renamed')
  return parts.join(' · ')
}
