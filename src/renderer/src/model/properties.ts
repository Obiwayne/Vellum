// Component properties (docs/factory/T17-plan.md, task T-B). Pure helpers meant for an immer draft, like
// components.ts. A prop is defined on a lone main (`component.props`) or on its set (`componentSet.props`,
// shared by every variant), bound to layers inside the main with `node.bind`, and given a value per
// instance in `instance.props`. syncInstance resolves them: main < property value < explicit override.
// Variant props are not set here: they choose which main of a set an instance points at (variants.ts).
import { descendants } from './ops'
import { CYCLE_MSG, instanceRootOf, mainOf, propDefsOf, reaches, syncInstance, syncInstances } from './components'
import { variantsOf } from './variants'
import type { CNode, Doc, PropBinding, PropDef } from './types'

type Aspect = keyof PropBinding
const ASPECT_TYPE: Record<Aspect, PropDef['type']> = { visible: 'boolean', text: 'text', swap: 'swap' }

/** The mains that share one definition list: every variant of a set, or the lone main. */
function sharing(doc: Doc, mainId: string): string[] {
  const setId = doc.nodes[mainId]?.component?.set
  return setId && doc.nodes[setId]?.componentSet ? variantsOf(doc, setId).map((m) => m.id) : [mainId]
}

/** Where the definitions of a main live: its set's `componentSet`, or its own `component`. */
function defsOwner(doc: Doc, mainId: string): { props?: PropDef[] } {
  const main = doc.nodes[mainId]
  const set = main?.component?.set ? doc.nodes[main.component.set] : undefined
  return set?.componentSet ?? (main.component as { props?: PropDef[] })
}

function requireMain(doc: Doc, mainId: string): CNode {
  const main = doc.nodes[mainId]
  if (!main?.component) throw new Error(`${mainId} is not a component`)
  return main
}

function resync(doc: Doc, mainId: string): void {
  for (const m of sharing(doc, mainId)) syncInstances(doc, m)
}

/** Add a boolean, text or swap property to a main (variant props belong to createVariant). Returns the prop id. */
export function addProp(doc: Doc, mainId: string, def: Omit<PropDef, 'id'> & { id?: string }): string {
  requireMain(doc, mainId)
  if (def.type === 'variant') throw new Error('Variant properties are created with createVariant')
  const defs = propDefsOf(doc, mainId)
  if (!def.name.trim()) throw new Error('A property needs a name')
  if (defs.some((d) => d.name === def.name)) throw new Error(`A property named "${def.name}" already exists`)
  const typeOk = def.type === 'boolean' ? typeof def.default === 'boolean' : typeof def.default === 'string'
  if (!typeOk) throw new Error(`Default of a ${def.type} property must be a ${def.type === 'boolean' ? 'boolean' : 'string'}`)
  if (def.type === 'swap' && !doc.nodes[def.default as string]?.component) throw new Error('A swap property defaults to a main component')
  const id = def.id ?? `p:${doc.nextId}`
  if (def.id === undefined) doc.nextId += 1
  if (defs.some((d) => d.id === id)) throw new Error(`Property id ${id} already used`)
  const owner = defsOwner(doc, mainId)
  ;(owner.props ??= []).push({ id, name: def.name, type: def.type, default: def.default })
  return id
}

/** Remove a property: its bindings go, instances drop their value, and they re-sync. */
export function removeProp(doc: Doc, mainId: string, propId: string): void {
  requireMain(doc, mainId)
  const owner = defsOwner(doc, mainId)
  const i = owner.props?.findIndex((d) => d.id === propId) ?? -1
  if (!owner.props || i < 0) throw new Error(`Property ${propId} not found`)
  owner.props.splice(i, 1)
  if (!owner.props.length) delete owner.props
  for (const m of sharing(doc, mainId)) {
    for (const d of [m, ...descendants(doc, m)]) {
      const b = doc.nodes[d]?.bind
      if (!b) continue
      for (const a of Object.keys(b) as Aspect[]) if (b[a] === propId) delete b[a]
      if (!Object.keys(b).length) delete doc.nodes[d].bind
    }
  }
  resync(doc, mainId)
}

/**
 * Bind a layer inside a main to a property (or clear the binding with null): boolean → visible,
 * text → a text layer's text, swap → a nested instance's component. Re-syncs the instances.
 */
export function bindProp(doc: Doc, nodeId: string, aspect: Aspect, propId: string | null): void {
  const node = doc.nodes[nodeId]
  if (!node) throw new Error(`Node ${nodeId} not found`)
  const mainId = mainOf(doc, nodeId)
  const inInstance = instanceRootOf(doc, nodeId)
  // a nested instance's root is a layer of the main (bindable); its derived children are not
  if (!mainId || (inInstance && inInstance !== nodeId)) throw new Error('Only a layer inside a main component can be bound to a property')
  if (nodeId === mainId && aspect !== 'swap') throw new Error('The component root cannot be bound')
  if (propId === null) {
    if (node.bind) {
      delete node.bind[aspect]
      if (!Object.keys(node.bind).length) delete node.bind
    }
    return resync(doc, mainId)
  }
  const def = propDefsOf(doc, mainId).find((d) => d.id === propId)
  if (!def) throw new Error(`Property ${propId} not found`)
  if (def.type !== ASPECT_TYPE[aspect]) throw new Error(`A ${def.type} property cannot drive ${aspect}`)
  if (aspect === 'text' && node.type !== 'text') throw new Error('Only a text layer can follow a text property')
  if (aspect === 'swap') {
    if (!node.instance) throw new Error('Only a nested instance can follow a swap property')
    if (reaches(doc, def.default as string, mainId)) throw new Error(CYCLE_MSG)
  }
  ;(node.bind ??= {})[aspect] = propId
  resync(doc, mainId)
}

/**
 * Set an instance's value for a property (values equal to the default are not stored). A swap target that
 * would put the instance inside itself throws CYCLE_MSG. Variant props are chosen through the set instead.
 */
export function setInstanceProp(doc: Doc, instId: string, propId: string, value: string | boolean): void {
  const inst = doc.nodes[instId]
  if (!inst?.instance) throw new Error(`${instId} is not an instance`)
  const def = propDefsOf(doc, inst.instance.of).find((d) => d.id === propId)
  if (!def) throw new Error(`Property ${propId} not found`)
  if (def.type === 'variant') throw new Error('Choose a variant through the component set')
  if (typeof value !== (def.type === 'boolean' ? 'boolean' : 'string')) throw new Error(`A ${def.type} property takes a ${def.type === 'boolean' ? 'boolean' : 'string'}`)
  if (def.type === 'swap') {
    if (!doc.nodes[value as string]?.component) throw new Error('A swap property takes a main component')
    const host = mainOf(doc, inst.parent ?? '')
    if (host && reaches(doc, value as string, host)) throw new Error(CYCLE_MSG)
  }
  const props = (inst.instance.props ??= {})
  if (value === def.default) delete props[propId]
  else props[propId] = value
  if (!Object.keys(props).length) delete inst.instance.props
  syncInstance(doc, instId)
}

/** Clear one property value (or all of the instance's), then re-sync. */
export function resetInstanceProps(doc: Doc, instId: string, propId?: string): void {
  const inst = doc.nodes[instId]
  if (!inst?.instance) throw new Error(`${instId} is not an instance`)
  if (propId === undefined) delete inst.instance.props
  else if (inst.instance.props) {
    delete inst.instance.props[propId]
    if (!Object.keys(inst.instance.props).length) delete inst.instance.props
  }
  syncInstance(doc, instId)
}

/** Rename a property and/or change its default (same checks as addProp); instances re-sync. Variant props are not edited here. */
export function updateProp(doc: Doc, mainId: string, propId: string, patch: { name?: string; default?: string | boolean }): void {
  requireMain(doc, mainId)
  const owner = defsOwner(doc, mainId)
  const def = owner.props?.find((d) => d.id === propId)
  if (!def) throw new Error(`Property ${propId} not found`)
  if (def.type === 'variant') throw new Error('Variant properties are edited through the component set')
  if (patch.name !== undefined) {
    const name = patch.name.trim()
    if (!name) throw new Error('A property needs a name')
    if (propDefsOf(doc, mainId).some((d) => d.id !== propId && d.name === name)) throw new Error(`A property named "${name}" already exists`)
    def.name = name
  }
  if (patch.default !== undefined) {
    const typeOk = def.type === 'boolean' ? typeof patch.default === 'boolean' : typeof patch.default === 'string'
    if (!typeOk) throw new Error(`Default of a ${def.type} property must be a ${def.type === 'boolean' ? 'boolean' : 'string'}`)
    if (def.type === 'swap') {
      if (!doc.nodes[patch.default as string]?.component) throw new Error('A swap property defaults to a main component')
      for (const m of sharing(doc, mainId)) {
        const bound = [m, ...descendants(doc, m)].some((d) => doc.nodes[d]?.bind?.swap === propId)
        if (bound && reaches(doc, patch.default as string, m)) throw new Error(CYCLE_MSG)
      }
    }
    def.default = patch.default
  }
  resync(doc, mainId)
}
