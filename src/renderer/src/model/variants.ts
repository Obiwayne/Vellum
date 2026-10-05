// Component sets and variants (docs/factory/T17-plan.md, task T-A). Pure helpers meant for an immer draft,
// like components.ts. A set is a frame (`componentSet`) whose direct children are the variant mains of one
// component; each main carries `component.set` and `component.variant` (variant prop id -> option).
import { cloneSubtree, descendants, insertNode, makeNode, newId } from './ops'
import { instanceRootOf, syncInstance } from './components'
import type { CNode, Doc, NodeOverride, PropDef } from './types'

/** The set frame a main belongs to, or null (a lone component). */
export function setOf(doc: Doc, mainId: string): string | null {
  const s = doc.nodes[mainId]?.component?.set
  return s && doc.nodes[s]?.componentSet ? s : null
}

/** The variant mains of a set, in doc order. */
export function variantsOf(doc: Doc, setId: string): CNode[] {
  return (doc.nodes[setId]?.children ?? []).map((c) => doc.nodes[c]).filter((n): n is CNode => Boolean(n?.component?.set === setId))
}

const variantProps = (set: CNode): PropDef[] => (set.componentSet?.props ?? []).filter((p) => p.type === 'variant')

/** A main's variant values with the set's defaults filled in for missing props. */
export function variantValues(doc: Doc, mainId: string): Record<string, string> {
  const main = doc.nodes[mainId]
  const set = main?.component?.set ? doc.nodes[main.component.set] : undefined
  const out: Record<string, string> = {}
  for (const p of set ? variantProps(set) : []) out[p.id] = main.component?.variant?.[p.id] ?? String(p.default)
  return out
}

/**
 * The main of a set that best fits `values` (variant prop id -> option; missing props use the default).
 * Exact match wins, otherwise the main matching the most props, ties go to the first in doc order.
 * Null when the set has no variants.
 */
export function pickMain(doc: Doc, setId: string, values: Record<string, string> = {}): string | null {
  const set = doc.nodes[setId]
  if (!set?.componentSet) return null
  const props = variantProps(set)
  const want = (p: PropDef): string => values[p.id] ?? String(p.default)
  let best: string | null = null
  let bestScore = -1
  for (const m of variantsOf(doc, setId)) {
    const have = variantValues(doc, m.id)
    const score = props.filter((p) => have[p.id] === want(p)).length
    if (score > bestScore) {
      best = m.id
      bestScore = score
    }
  }
  return best
}

/** Wrap a lone main in a new set frame (a flex row) at its place; the main becomes the "Default" variant. */
function makeSet(doc: Doc, main: CNode): string {
  const parent = doc.nodes[main.parent as string]
  const prop: PropDef = { id: `p:${newId(doc)}`, name: 'Variant', type: 'variant', options: ['Default'], default: 'Default' }
  const set = makeNode(
    doc,
    {
      type: 'frame',
      name: main.component?.name ?? main.name,
      style: { display: 'flex', flexDirection: 'row', alignItems: 'flex-start', gap: 24, padding: 24, width: 'fit-content', height: 'fit-content' }
    },
    false
  )
  set.x = main.x
  set.y = main.y
  set.componentSet = { name: main.component?.name ?? main.name, props: [prop] }
  insertNode(doc, set, parent.id, parent.children.indexOf(main.id))
  parent.children = parent.children.filter((c) => c !== main.id)
  set.children.push(main.id)
  main.parent = set.id
  main.x = 0
  main.y = 0
  if (main.style.position === 'absolute') delete main.style.position
  main.component = { ...(main.component as { name: string }), set: set.id, variant: { [prop.id]: 'Default' } }
  main.name = `${prop.name}=Default`
  return set.id
}

/**
 * Duplicate a main as a new variant next to it, inside its set (a lone main is wrapped in a new set first,
 * becoming its "Default" variant). `values` (variant prop id -> option) names the new variant; props you
 * leave out keep their defaults, unknown options are added to the prop. Without `values` a new option
 * "Variant N" is added to the set's first variant prop. Returns the new main's id.
 */
export function createVariant(doc: Doc, mainId: string, values?: Record<string, string>, name?: string): string {
  const main = doc.nodes[mainId]
  if (!main?.component) throw new Error(`${mainId} is not a component`)
  if (!main.parent || instanceRootOf(doc, mainId)) throw new Error('Cannot make a variant from an instance or inside one')
  const existing = setOf(doc, mainId)
  // validate before touching the doc: a lone main has no variant props yet, so any key is unknown
  for (const k of Object.keys(values ?? {})) {
    if (!existing || !variantProps(doc.nodes[existing]).some((p) => p.id === k)) throw new Error(`Unknown variant property ${k}`)
  }
  const setId = existing ?? makeSet(doc, main)
  const set = doc.nodes[setId]
  const props = variantProps(set)
  const vals = variantValues(doc, mainId)
  if (values) {
    for (const [k, opt] of Object.entries(values)) {
      const p = props.find((x) => x.id === k) as PropDef
      if (!p.options?.includes(opt)) (p.options ??= []).push(opt)
      vals[k] = opt
    }
  } else {
    const p = props[0]
    const options = (p.options ??= [])
    let n = options.length + 1
    while (options.includes(`Variant ${n}`)) n++
    options.push(`Variant ${n}`)
    vals[p.id] = `Variant ${n}`
  }
  const key = (v: Record<string, string>): string => props.map((p) => v[p.id]).join('\u0000')
  if (variantsOf(doc, setId).some((m) => key(variantValues(doc, m.id)) === key(vals))) throw new Error('A variant with these values already exists')

  const cid = cloneSubtree(doc, mainId)
  const copy = doc.nodes[cid]
  const host = doc.nodes[setId]
  copy.parent = setId
  host.children.splice(host.children.indexOf(mainId) + 1, 0, cid)
  copy.component = { name: main.component.name, set: setId, variant: vals }
  copy.name = name?.trim() || props.map((p) => `${p.name}=${vals[p.id]}`).join(', ')
  return cid
}

// ---------------------------------------------------------------------------------------------
// switching an instance to another variant

/**
 * Match the nodes of one main to the nodes of another by tree position and type (a name match breaks ties):
 * for each child, the closest-by-index unused child of the same type; equal distance prefers the same name.
 * Returns main-side id -> id in the other main, root included. Layers with no counterpart are absent.
 */
export function matchTrees(from: Doc, fromRoot: string, to: Doc, toRoot: string): Map<string, string> {
  const map = new Map<string, string>([[fromRoot, toRoot]])
  const walk = (a: string, b: string): void => {
    const bs = (to.nodes[b]?.children ?? []).map((id) => to.nodes[id]).filter(Boolean)
    const used = new Set<string>()
    ;(from.nodes[a]?.children ?? []).forEach((aid, i) => {
      const an = from.nodes[aid]
      if (!an) return
      let best: CNode | undefined
      let bestScore = Infinity
      bs.forEach((bn, j) => {
        if (used.has(bn.id) || bn.type !== an.type) return
        const score = Math.abs(i - j) * 2 + (bn.name === an.name ? 0 : 1)
        if (score < bestScore) {
          best = bn
          bestScore = score
        }
      })
      if (!best) return
      used.add(best.id)
      map.set(aid, best.id)
      walk(aid, best.id)
    })
  }
  walk(fromRoot, toRoot)
  return map
}

/**
 * Point an instance at another main of its set and carry its overrides over (matchTrees). Overrides whose
 * layer has no counterpart are dropped; their number is returned. The instance takes the new main's size.
 * `fromDoc` is where the old main still lives (the doc before an edit that deleted it).
 */
export function switchVariant(doc: Doc, instId: string, toMainId: string, fromDoc: Doc = doc): number {
  const inst = doc.nodes[instId]
  if (!inst?.instance) throw new Error(`${instId} is not an instance`)
  const to = doc.nodes[toMainId]
  const oldId = inst.instance.of
  const from = fromDoc.nodes[oldId]
  if (!to?.component || !from?.component) throw new Error('Not a component')
  if (!to.component.set || to.component.set !== from.component.set) throw new Error('A variant must belong to the same component set')
  if (oldId === toMainId) return 0
  const map = matchTrees(fromDoc, oldId, doc, toMainId)
  const old = new Set(descendants(fromDoc, oldId))
  const ov = inst.instance.overrides
  let dropped = 0
  if (ov) {
    const next: Record<string, NodeOverride> = {}
    for (const [k, o] of Object.entries(ov)) {
      if (k === '') next[''] = o
      else if (old.has(k)) {
        const t = map.get(k)
        if (t) next[t] = o
        else dropped++
      } else next[k] = o // a node of a swapped-in main: sync keeps or prunes it
    }
    if (Object.keys(next).length) inst.instance.overrides = next
    else delete inst.instance.overrides
  }
  inst.instance.of = toMainId
  for (const k of ['width', 'height']) {
    if (to.style[k] === undefined) delete inst.style[k]
    else inst.style[k] = to.style[k]
  }
  syncInstance(doc, instId)
  return dropped
}

/** Choose a variant option on an instance: re-points it to the matching main of its set (see pickMain). Returns the dropped override count. */
export function setVariantValue(doc: Doc, instId: string, propId: string, option: string): number {
  const inst = doc.nodes[instId]
  if (!inst?.instance) throw new Error(`${instId} is not an instance`)
  const setId = setOf(doc, inst.instance.of)
  const prop = setId ? doc.nodes[setId].componentSet?.props.find((p) => p.id === propId && p.type === 'variant') : undefined
  if (!setId || !prop) throw new Error(`Variant property ${propId} not found`)
  if (!prop.options?.includes(option)) throw new Error(`"${option}" is not an option of ${prop.name}`)
  const target = pickMain(doc, setId, { ...variantValues(doc, inst.instance.of), [propId]: option })
  return target ? switchVariant(doc, instId, target) : 0
}

/**
 * For an instance whose main was deleted (it is gone from `doc`, still in `base`): move it to the default
 * variant of the set when one is left. False when there is nothing to move to (the caller detaches it).
 */
export function repointToDefault(doc: Doc, base: Doc, instId: string): boolean {
  const oldId = doc.nodes[instId]?.instance?.of
  const setId = oldId ? base.nodes[oldId]?.component?.set : undefined
  if (!setId || !doc.nodes[setId]?.componentSet) return false
  const target = pickMain(doc, setId)
  if (!target) return false
  switchVariant(doc, instId, target, base)
  return true
}
