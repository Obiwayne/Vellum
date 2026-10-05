// MCP tools for components, variants and properties (docs/COMPONENTS.md, docs/factory/T17-plan.md). Each call is
// one undo step. Overrides go through the normal update_styles / set_text_content, which already hit the
// override path; writing HTML into an instance is refused (see write_html).
import { getStore } from '../model/store'
import { instanceRootOf, instancesOf, mainOf, propDefsOf } from '../model/components'
import { setOf, variantValues, variantsOf } from '../model/variants'
import type { CNode, Doc, PropDef } from '../model/types'
import { arr, getDoc, markWorking, registerHandler, requireNode, resolveDocId, resolvePage, scoped, str } from './registry'

type Scalar = string | boolean

function requireMain(doc: Doc, id: unknown): CNode {
  const n = requireNode(doc, id)
  if (!n.component) throw new Error(`Node ${n.id} is not a main component. Use create_component first.`)
  return n
}

function requireInstanceRoot(doc: Doc, id: unknown): CNode {
  const n = requireNode(doc, id)
  const root = instanceRootOf(doc, n.id)
  if (!root) throw new Error(`Node ${n.id} is not an instance. Use create_instance first.`)
  return doc.nodes[root]
}

/** A property by id, else by (case-sensitive) name; throws with the available names. */
function findProp(defs: PropDef[], key: string, type?: PropDef['type']): PropDef {
  const hit = defs.find((d) => d.id === key) ?? defs.find((d) => d.name === key)
  if (!hit || (type && hit.type !== type)) {
    const list = defs.filter((d) => !type || d.type === type).map((d) => `${d.name} (${d.id}, ${d.type})`)
    throw new Error(`Property "${key}" not found${type ? ` among ${type} properties` : ''}. Available: ${list.join(', ') || 'none'}`)
  }
  return hit
}

/** What a node says about components: used by get_node_info / get_children / find_nodes / get_selection. */
export function componentInfo(doc: Doc, n: CNode, full = false): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (n.component) {
    out.isComponent = true
    out.componentName = n.component.name
    const setId = setOf(doc, n.id)
    if (setId) {
      out.componentSetId = setId
      out.variant = variantValues(doc, n.id)
    }
    if (full) out.properties = propDefsOf(doc, n.id).map(describeProp)
  }
  if (n.componentSet) {
    out.isComponentSet = true
    if (full) {
      out.componentSet = {
        name: n.componentSet.name,
        properties: n.componentSet.props.map(describeProp),
        variants: variantsOf(doc, n.id).map((m) => ({ id: m.id, name: m.name, values: variantValues(doc, m.id) }))
      }
    }
  }
  if (n.instance) {
    out.instanceOf = n.instance.of
    if (full) {
      const defs = propDefsOf(doc, n.instance.of).filter((d) => d.type !== 'variant')
      out.instanceProperties = Object.fromEntries(defs.map((d) => [d.name, n.instance?.props?.[d.id] ?? d.default]))
      out.variant = variantValues(doc, n.instance.of)
      out.overriddenNodeIds = Object.keys(n.instance.overrides ?? {}).map((k) => (k === '' ? n.id : k))
    }
  } else if (n.srcId !== undefined && instanceRootOf(doc, n.id)) {
    out.insideInstance = instanceRootOf(doc, n.id)
  }
  if (full && n.bind) out.boundProperties = n.bind
  return out
}

const describeProp = (d: PropDef): Record<string, unknown> => ({ id: d.id, name: d.name, type: d.type, default: d.default, ...(d.options ? { options: d.options } : {}) })

function parentFor(doc: Doc, parentId: unknown, args: Record<string, unknown>): string {
  const p = str(parentId)
  if (!p || p === 'root') return resolvePage(doc, args.pageId).rootId
  requireNode(doc, p)
  return p
}

// ------------------------------------------------------------------------------------------------

registerHandler('create_component', (args) => {
  const docId = resolveDocId(args)
  const doc = getDoc(docId)
  const ids = arr<string>(args.nodeIds).length ? arr<string>(args.nodeIds) : str(args.nodeId) ? [str(args.nodeId) as string] : []
  if (!ids.length) throw new Error('Pass nodeIds (or nodeId): a frame becomes the component, other nodes are wrapped in a frame first')
  for (const id of ids) requireNode(doc, id)
  const id = getStore().createComponent(docId, ids, undefined, str(args.name))
  markWorking(docId, [id])
  const after = getDoc(docId)
  return scoped(docId, { componentId: id, name: after.nodes[id].component?.name, nodeIds: [id] })
})

registerHandler('create_instance', (args) => {
  const docId = resolveDocId(args)
  const doc = getDoc(docId)
  const main = requireMain(doc, args.componentId)
  const parent = parentFor(doc, args.parentId, args)
  const at = typeof args.x === 'number' && typeof args.y === 'number' ? { x: args.x, y: args.y } : undefined
  const index = typeof args.index === 'number' ? args.index : undefined
  const id = getStore().createInstance(docId, main.id, parent, index, at)
  markWorking(docId, [id])
  return scoped(docId, { instanceId: id, componentId: main.id, parentId: parent, nodeIds: [id] })
})

registerHandler('detach_instance', (args) => {
  const docId = resolveDocId(args)
  const root = requireInstanceRoot(getDoc(docId), args.nodeId)
  getStore().detachInstance(docId, root.id)
  markWorking(docId, [root.id])
  return scoped(docId, { detachedNodeId: root.id })
})

registerHandler('create_variant', (args) => {
  const docId = resolveDocId(args)
  const doc = getDoc(docId)
  const main = requireMain(doc, args.componentId)
  const raw = (args.values ?? undefined) as Record<string, unknown> | undefined
  let values: Record<string, string> | undefined
  if (raw && Object.keys(raw).length) {
    const setId = setOf(doc, main.id)
    if (!setId) throw new Error('This component is not in a set yet: call create_variant without values first (it wraps the component in a set), then name the options')
    const defs = doc.nodes[setId].componentSet?.props ?? []
    values = {}
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v !== 'string') throw new Error(`Variant value for "${k}" must be a string`)
      values[findProp(defs, k, 'variant').id] = v
    }
  }
  const id = getStore().addVariant(docId, main.id, values, str(args.name))
  markWorking(docId, [id])
  const after = getDoc(docId)
  const setId = setOf(after, id) as string
  return scoped(docId, {
    variantId: id,
    componentSetId: setId,
    variants: variantsOf(after, setId).map((m) => ({ id: m.id, name: m.name, values: variantValues(after, m.id) })),
    properties: (after.nodes[setId].componentSet?.props ?? []).map(describeProp)
  })
})

registerHandler('add_component_prop', (args) => {
  const docId = resolveDocId(args)
  const doc = getDoc(docId)
  const main = requireMain(doc, args.componentId)
  const type = str(args.type)
  if (type !== 'boolean' && type !== 'text' && type !== 'swap') throw new Error('type must be "boolean", "text" or "swap" (variant properties come from create_variant)')
  const name = str(args.name)?.trim()
  if (!name) throw new Error('name is required')
  const def = args.defaultValue
  const fallback = type === 'boolean' ? true : type === 'text' ? '' : undefined
  const value = def === undefined ? fallback : def
  if (value === undefined) throw new Error('A swap property needs defaultValue: the id of the main component it shows by default')
  const id = getStore().addProp(docId, main.id, { name, type, default: value as Scalar })
  return scoped(docId, { propertyId: id, name, type, default: value, properties: propDefsOf(getDoc(docId), main.id).map(describeProp) })
})

registerHandler('bind_component_prop', (args) => {
  const docId = resolveDocId(args)
  const doc = getDoc(docId)
  const node = requireNode(doc, args.nodeId)
  const aspect = str(args.aspect)
  if (aspect !== 'visible' && aspect !== 'text' && aspect !== 'swap') throw new Error('aspect must be "visible" (boolean prop), "text" (text prop) or "swap" (swap prop)')
  const mainId = mainOf(doc, node.id)
  if (!mainId) throw new Error(`Node ${node.id} is not inside a main component`)
  const key = args.property === null ? null : str(args.property)
  if (key === undefined) throw new Error('property is required (a property name or id), or null to unbind')
  const propId = key === null ? null : findProp(propDefsOf(doc, mainId), key, aspect === 'visible' ? 'boolean' : aspect === 'text' ? 'text' : 'swap').id
  getStore().bindProp(docId, node.id, aspect, propId)
  markWorking(docId, [node.id])
  return scoped(docId, { nodeId: node.id, aspect, propertyId: propId })
})

registerHandler('set_instance_props', (args) => {
  const docId = resolveDocId(args)
  const doc = getDoc(docId)
  const inst = requireInstanceRoot(doc, args.nodeId)
  const props = (args.props ?? {}) as Record<string, unknown>
  const variants = (args.variants ?? {}) as Record<string, unknown>
  const reset = args.reset
  if (!Object.keys(props).length && !Object.keys(variants).length && !reset) throw new Error('Pass props, variants and/or reset')
  let dropped = 0
  getStore().transact(docId, 'Set instance properties', () => {
    const s = getStore()
    // variants first: switching re-points the instance and the property list may change with it
    for (const [k, v] of Object.entries(variants)) {
      const cur = getDoc(docId)
      const root = cur.nodes[inst.id]
      const setId = setOf(cur, root.instance?.of ?? '')
      if (!setId) throw new Error('This instance\'s component has no variants')
      if (typeof v !== 'string') throw new Error(`Variant value for "${k}" must be a string`)
      dropped += s.setVariantValue(docId, inst.id, findProp(cur.nodes[setId].componentSet?.props ?? [], k, 'variant').id, v)
    }
    if (reset) {
      const cur = getDoc(docId).nodes[inst.id]
      const defs = propDefsOf(getDoc(docId), cur.instance?.of ?? '')
      for (const k of Array.isArray(reset) ? (reset as string[]) : Object.keys(cur.instance?.props ?? {})) {
        const id = Array.isArray(reset) ? findProp(defs, k).id : k
        if (cur.instance?.props?.[id] !== undefined) s.setInstanceProp(docId, inst.id, id, defs.find((d) => d.id === id)?.default as Scalar)
      }
    }
    for (const [k, v] of Object.entries(props)) {
      const cur = getDoc(docId)
      const defs = propDefsOf(cur, cur.nodes[inst.id].instance?.of ?? '')
      if (typeof v !== 'string' && typeof v !== 'boolean') throw new Error(`Value for "${k}" must be a string or boolean`)
      s.setInstanceProp(docId, inst.id, findProp(defs, k).id, v)
    }
  })
  markWorking(docId, [inst.id])
  const after = getDoc(docId)
  return scoped(docId, { instanceId: inst.id, ...componentInfo(after, after.nodes[inst.id], true), droppedOverrides: dropped, instanceCount: instancesOf(after, after.nodes[inst.id].instance?.of ?? '').length })
})
