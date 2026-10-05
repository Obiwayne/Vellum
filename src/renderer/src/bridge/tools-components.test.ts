// @vitest-environment jsdom
// MCP tools for components, variants and properties, called through the bridge handler registry.
import { beforeEach, describe, expect, it } from 'vitest'
import { getStore, useStore } from '../model/store'
import { handlers } from './registry'
import './tools-read'
import './tools-write'
import './tools-components'

const S = getStore
let fileId: string
const doc = () => S().docs[fileId]
const root = (): string => doc().pages[0].rootId

type Res = { body: Record<string, any> }
const call = async (tool: string, args: Record<string, unknown> = {}): Promise<Record<string, any>> => ((await handlers[tool]({ fileId, ...args })) as Res).body
const fails = async (tool: string, args: Record<string, unknown>): Promise<string> => {
  try {
    await handlers[tool]({ fileId, ...args })
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
  throw new Error(`${tool} did not throw`)
}

/** A "Button" frame with a Label text and an Icon rect on an artboard. */
function button(): { frame: string; label: string; icon: string } {
  const frame = S().createNode(fileId, { type: 'frame', name: 'Button', style: { width: 120, height: 40 } }, root())
  const label = S().createNode(fileId, { type: 'text', text: 'Click' }, frame)
  const icon = S().createNode(fileId, { type: 'rect', name: 'Icon' }, frame)
  return { frame, label, icon }
}

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true)
  fileId = S().createDoc('T', { open: true })
})

describe('create_component / create_instance / detach_instance', () => {
  it('a frame becomes the component; an instance mirrors it; reads report both', async () => {
    const { frame, label } = button()
    const made = await call('create_component', { nodeIds: [frame], name: 'Primary' })
    expect(made.componentId).toBe(frame)
    expect(made.name).toBe('Primary')
    const inst = (await call('create_instance', { componentId: frame, parentId: 'root' })).instanceId as string
    expect(doc().nodes[inst].instance?.of).toBe(frame)
    const info = await call('get_node_info', { nodeId: frame })
    expect(info.isComponent).toBe(true)
    expect(info.componentName).toBe('Primary')
    expect(info.properties).toEqual([])
    const iinfo = await call('get_node_info', { nodeId: inst })
    expect(iinfo.instanceOf).toBe(frame)
    expect(iinfo.instanceProperties).toEqual({})
    const children = await call('get_children', { nodeId: root() })
    expect(children.children.find((c: any) => c.id === inst).instanceOf).toBe(frame)
    expect(children.children.find((c: any) => c.id === frame).isComponent).toBe(true)
    const found = await call('find_nodes', { query: 'Button' })
    expect(found.nodes.some((n: any) => n.isComponent)).toBe(true)
    // a node inside the instance says so
    const twin = doc().nodes[inst].children.find((c) => doc().nodes[c].srcId === label) as string
    expect((await call('get_node_info', { nodeId: twin })).insideInstance).toBe(inst)
  })

  it('wraps a non-frame node, refuses missing nodes, and one undo reverts', async () => {
    const { icon } = button()
    const made = await call('create_component', { nodeIds: [icon] })
    expect(doc().nodes[made.componentId].component).toBeTruthy()
    expect(doc().nodes[icon].parent).toBe(made.componentId)
    S().undo(fileId)
    expect(doc().nodes[icon].parent).not.toBe(made.componentId)
    expect(await fails('create_component', { nodeIds: ['nope'] })).toMatch(/not found/)
    expect(await fails('create_component', {})).toMatch(/nodeIds/)
  })

  it('create_instance needs a main; detach_instance accepts a node inside the instance', async () => {
    const { frame, label } = button()
    expect(await fails('create_instance', { componentId: frame })).toMatch(/not a main component/)
    await call('create_component', { nodeIds: [frame] })
    const inst = (await call('create_instance', { componentId: frame })).instanceId as string
    const twin = doc().nodes[inst].children.find((c) => doc().nodes[c].srcId === label) as string
    const d = await call('detach_instance', { nodeId: twin })
    expect(d.detachedNodeId).toBe(inst)
    expect(doc().nodes[inst].instance).toBeUndefined()
    expect(await fails('detach_instance', { nodeId: frame })).toMatch(/not an instance/)
  })

  it('write_html into an instance is refused with the structure message; into the main it works', async () => {
    const { frame } = button()
    await call('create_component', { nodeIds: [frame] })
    const inst = (await call('create_instance', { componentId: frame })).instanceId as string
    const before = Object.keys(doc().nodes).length
    const msg = await fails('write_html', { targetNodeId: inst, html: '<div style="width:10px;height:10px"></div>' })
    expect(msg).toContain('Detach instance to change structure')
    expect(Object.keys(doc().nodes).length).toBe(before)
    const twin = doc().nodes[inst].children[0]
    expect(await fails('write_html', { targetNodeId: twin, mode: 'replace', html: '<div style="width:10px;height:10px"></div>' })).toContain('Detach instance')
    await call('write_html', { targetNodeId: frame, html: '<div style="width:10px;height:10px"></div>' })
    expect(doc().nodes[inst].children.length).toBe(doc().nodes[frame].children.length) // the instance followed
  })

  it('overrides through the normal tools still work inside an instance', async () => {
    const { frame, label } = button()
    await call('create_component', { nodeIds: [frame] })
    const inst = (await call('create_instance', { componentId: frame })).instanceId as string
    const twin = doc().nodes[inst].children.find((c) => doc().nodes[c].srcId === label) as string
    await call('set_text_content', { updates: [{ nodeId: twin, textContent: 'Buy' }] })
    expect(doc().nodes[twin].text).toBe('Buy')
    expect((await call('get_node_info', { nodeId: inst })).overriddenNodeIds).toContain(label)
  })
})

describe('variants and properties', () => {
  async function component() {
    const b = button()
    await call('create_component', { nodeIds: [b.frame] })
    return b
  }

  it('create_variant wraps a lone component in a set, then names options by property name', async () => {
    const { frame } = await component()
    const first = await call('create_variant', { componentId: frame })
    expect(first.variants.length).toBe(2)
    expect(first.properties[0].type).toBe('variant')
    const prop = first.properties[0]
    const second = await call('create_variant', { componentId: first.variantId, values: { [prop.name]: 'Large' }, name: 'Big' })
    expect(second.variants.length).toBe(3)
    expect(second.variants.find((v: any) => v.id === second.variantId).values[prop.id]).toBe('Large')
    expect(doc().nodes[second.variantId].name).toBe('Big')
    S().undo(fileId) // one undo removes the second variant only
    expect((await call('get_node_info', { nodeId: first.componentSetId })).componentSet.variants.length).toBe(2)
    S().redo(fileId)
    // values on a lone component, unknown property names, and non-components are refused with useful messages
    const lone = button()
    await call('create_component', { nodeIds: [lone.frame] })
    expect(await fails('create_variant', { componentId: lone.frame, values: { Size: 'L' } })).toMatch(/without values first/)
    expect(await fails('create_variant', { componentId: first.variantId, values: { Nope: 'x' } })).toMatch(/Available: /)
    expect(await fails('create_variant', { componentId: lone.icon })).toMatch(/not a main component/)
  })

  it('boolean and text props: add, bind by name, set on an instance, read back, reset', async () => {
    const { frame, label, icon } = await component()
    const show = await call('add_component_prop', { componentId: frame, name: 'Show icon', type: 'boolean' })
    const txt = await call('add_component_prop', { componentId: frame, name: 'Label', type: 'text', defaultValue: 'Click' })
    expect(show.default).toBe(true)
    await call('bind_component_prop', { nodeId: icon, aspect: 'visible', property: 'Show icon' })
    await call('bind_component_prop', { nodeId: label, aspect: 'text', property: txt.propertyId })
    const inst = (await call('create_instance', { componentId: frame })).instanceId as string
    const res = await call('set_instance_props', { nodeId: inst, props: { 'Show icon': false, Label: 'Buy now' } })
    expect(res.instanceProperties).toEqual({ 'Show icon': false, Label: 'Buy now' })
    const kid = (src: string): any => Object.values(doc().nodes).find((n) => n.parent === inst && n.srcId === src)
    expect(kid(icon).visible).toBe(false)
    expect(kid(label).text).toBe('Buy now')
    expect((await call('get_node_info', { nodeId: frame })).properties.map((p: any) => p.name)).toEqual(['Show icon', 'Label'])
    expect((await call('get_node_info', { nodeId: label })).boundProperties).toEqual({ text: txt.propertyId })
    // one undo step for the whole call
    S().undo(fileId)
    expect(kid(icon).visible).toBe(true)
    expect(kid(label).text).toBe('Click')
    S().redo(fileId)
    // reset one by name, then everything
    await call('set_instance_props', { nodeId: inst, reset: ['Label'] })
    expect(kid(label).text).toBe('Click')
    expect(kid(icon).visible).toBe(false)
    const cleared = await call('set_instance_props', { nodeId: inst, reset: true })
    expect(cleared.instanceProperties).toEqual({ 'Show icon': true, Label: 'Click' })
    // unbind with null
    await call('bind_component_prop', { nodeId: icon, aspect: 'visible', property: null })
    expect(doc().nodes[icon].bind).toBeUndefined()
  })

  it('wrong types and unknown names are refused with the available names', async () => {
    const { frame, label, icon } = await component()
    await call('add_component_prop', { componentId: frame, name: 'Show', type: 'boolean' })
    expect(await fails('add_component_prop', { componentId: frame, name: 'Show', type: 'boolean' })).toMatch(/already exists/)
    expect(await fails('add_component_prop', { componentId: frame, name: 'S', type: 'swap' })).toMatch(/defaultValue/)
    expect(await fails('add_component_prop', { componentId: frame, name: 'V', type: 'variant' })).toMatch(/boolean/)
    expect(await fails('bind_component_prop', { nodeId: label, aspect: 'text', property: 'Show' })).toMatch(/among text properties/)
    expect(await fails('bind_component_prop', { nodeId: icon, aspect: 'sideways', property: 'Show' })).toMatch(/aspect/)
    const inst = (await call('create_instance', { componentId: frame })).instanceId as string
    expect(await fails('set_instance_props', { nodeId: inst, props: { Nope: true } })).toMatch(/Available: Show/)
    expect(await fails('set_instance_props', { nodeId: inst, props: { Show: 'yes' } })).toMatch(/boolean/)
    expect(await fails('set_instance_props', { nodeId: inst })).toMatch(/Pass props/)
    expect(await fails('set_instance_props', { nodeId: frame, props: { Show: false } })).toMatch(/not an instance/)
  })

  it('swap: the default is a main, an instance swaps to another main', async () => {
    const { frame } = await component()
    const star = S().createNode(fileId, { type: 'frame', name: 'Star', style: { width: 24, height: 24 } }, root())
    S().createNode(fileId, { type: 'text', text: 'star' }, star)
    const heart = S().createNode(fileId, { type: 'frame', name: 'Heart', style: { width: 24, height: 24 } }, root())
    S().createNode(fileId, { type: 'text', text: 'heart' }, heart)
    await call('create_component', { nodeIds: [star] })
    await call('create_component', { nodeIds: [heart] })
    const card = S().createNode(fileId, { type: 'frame', name: 'Card', style: { width: 200, height: 80 } }, root())
    await call('create_component', { nodeIds: [card] })
    const slot = (await call('create_instance', { componentId: star, parentId: card })).instanceId as string
    await call('add_component_prop', { componentId: card, name: 'Icon', type: 'swap', defaultValue: star })
    await call('bind_component_prop', { nodeId: slot, aspect: 'swap', property: 'Icon' })
    const inst = (await call('create_instance', { componentId: card })).instanceId as string
    const texts = (): string[] =>
      Object.values(doc().nodes)
        .filter((n) => n.type === 'text' && n.id.length && isUnder(n.id, inst))
        .map((n) => n.text as string)
    const isUnder = (id: string, anc: string): boolean => {
      for (let c = doc().nodes[id]?.parent; c; c = doc().nodes[c]?.parent) if (c === anc) return true
      return false
    }
    expect(texts()).toEqual(['star'])
    await call('set_instance_props', { nodeId: inst, props: { Icon: heart } })
    expect(texts()).toEqual(['heart'])
    expect(frame).toBeTruthy()
  })

  it('set_instance_props variants switches the instance to the matching variant', async () => {
    const { frame, label } = await component()
    const v = await call('create_variant', { componentId: frame })
    const prop = v.properties[0]
    const large = await call('create_variant', { componentId: v.variantId, values: { [prop.name]: 'Large' } })
    S().mutate(fileId, 'edit large', (d) => {
      const t = d.nodes[large.variantId].children.map((c) => d.nodes[c]).find((n) => n.type === 'text')
      if (t) t.text = 'LARGE'
    })
    const inst = (await call('create_instance', { componentId: frame })).instanceId as string
    const res = await call('set_instance_props', { nodeId: inst, variants: { [prop.name]: 'Large' } })
    expect(res.instanceOf).toBe(large.variantId)
    expect(res.variant[prop.id]).toBe('Large')
    expect(res.droppedOverrides).toBe(0)
    const shown = doc().nodes[inst].children.map((c) => doc().nodes[c]).find((n) => n.type === 'text')
    expect(shown?.text).toBe('LARGE')
    expect(await fails('set_instance_props', { nodeId: inst, variants: { [prop.name]: 'Huge' } })).toMatch(/not an option/)
    expect(label).toBeTruthy()
  })
})

describe('test station: gaps and adversarial cases', () => {
  async function withTextProp() {
    const { frame, label } = button()
    await call('create_component', { nodeIds: [frame] })
    await call('add_component_prop', { componentId: frame, name: 'Heading', type: 'text', defaultValue: 'Hi' })
    await call('bind_component_prop', { nodeId: label, aspect: 'text', property: 'Heading' })
    const inst = (await call('create_instance', { componentId: frame })).instanceId as string
    return { frame, label, inst }
  }

  // Acceptance: get_jsx exports an instance as component usage (<Button .../>) plus a definition per main.
  // Known gap reported to the builder (tools-render.ts is unchanged): drop `.fails` once implemented.
  it.fails('get_jsx exports an instance as component usage plus a definition for the main', async () => {
    const { frame, inst } = await withTextProp()
    S().updateNode(fileId, frame, { name: 'Button' })
    const res = (await handlers.get_jsx({ fileId, nodeId: inst, format: 'inline-styles' })) as unknown
    const text = typeof res === 'string' ? res : JSON.stringify(res)
    expect(text).toMatch(/<Button\b[^>]*Heading=/)
    expect(text).toMatch(/function Button|const Button/)
  })

  it('set_instance_props is one undo step', async () => {
    const { inst } = await withTextProp()
    const before = JSON.stringify(doc().nodes)
    await call('set_instance_props', { nodeId: inst, props: { Heading: 'Bye' } })
    expect(JSON.stringify(doc().nodes)).not.toBe(before)
    S().undo(fileId)
    expect(JSON.stringify(doc().nodes)).toBe(before)
  })

  // Defect reported to the builder: a bad name later in props leaves the earlier prop applied (the call throws
  // but "Bye" stays set). Drop `.fails` once the call validates first or rolls back.
  it.fails('a failing set_instance_props call changes nothing', async () => {
    const { inst } = await withTextProp()
    const before = JSON.stringify(doc().nodes)
    const err = await fails('set_instance_props', { nodeId: inst, props: { Heading: 'Bye', Nope: 'x' } })
    expect(err).toMatch(/Nope/)
    expect(JSON.stringify(doc().nodes)).toBe(before)
  })

  it('write_html replacing a node inside an instance is refused; the doc is untouched', async () => {
    const { inst } = await withTextProp()
    const twin = doc().nodes[inst].children[0]
    const before = JSON.stringify(doc().nodes)
    for (const mode of ['replace', 'insert-children']) {
      const msg = await fails('write_html', { targetNodeId: twin, mode, html: '<div style="width:5px;height:5px"></div>' })
      expect(msg).toContain('Detach instance to change structure')
    }
    expect(JSON.stringify(doc().nodes)).toBe(before)
  })

  it('tools refuse bad ids with a useful message', async () => {
    expect(await fails('create_instance', { componentId: 'nope' })).toMatch(/nope/)
    expect(await fails('detach_instance', { nodeId: 'nope' })).toMatch(/nope/)
    expect(await fails('create_component', {})).toMatch(/nodeIds/)
    const { frame } = button()
    expect(await fails('create_instance', { componentId: frame })).toMatch(/not a main component/)
  })
})
