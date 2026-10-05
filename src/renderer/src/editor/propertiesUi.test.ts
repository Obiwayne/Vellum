// @vitest-environment jsdom
// Wiring of the property / variant-switch inspector controls, rendered on the client.
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getStore, useStore } from '../model/store'
import * as A from './canvas/componentActions'
import { ComponentSection } from './inspector/ComponentSection'

vi.mock('./canvas/toast', () => ({ toast: vi.fn() }))
import { toast } from './canvas/toast'

const S = getStore
let id: string
const doc = () => S().docs[id]
const root = (): string => doc().pages[0].rootId
const geo = { rects: new Map(), bounds: { x: 0, y: 0, width: 1, height: 1 }, origin: { x: 0, y: 0 } }
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Render the component section for a selection and hand back the host element. */
async function render(ids: string[]): Promise<{ host: HTMLElement; done: () => Promise<void> }> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const r = createRoot(host)
  await act(async () => r.render(createElement(ComponentSection, { docId: id, ids })))
  return {
    host,
    done: async () => {
      await act(async () => r.unmount())
      host.remove()
    }
  }
}
const setValue = async (input: HTMLInputElement, v: string): Promise<void> => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, v)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  })
}

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true)
  id = S().createDoc('T', { open: true })
  vi.mocked(toast).mockClear()
  document.body.innerHTML = ''
})

/** Button main (text label + icon rect) and an instance of it. */
function button() {
  const btn = S().createNode(id, { type: 'frame', name: 'Button', style: { width: 100, height: 40 } }, root())
  const label = S().createNode(id, { type: 'text', text: 'Click' }, btn)
  const icon = S().createNode(id, { type: 'rect', name: 'Icon' }, btn)
  S().createComponent(id, [btn], geo)
  const inst = S().createInstance(id, btn, root())
  return { btn, label, icon, inst }
}

describe('properties on a main', () => {
  it('lists, adds, renames, sets the default of and deletes properties', async () => {
    const { btn } = button()
    const show = A.addPropertyTo(id, btn, 'boolean')!
    const text = A.addPropertyTo(id, btn, 'text')!
    const swap = A.addPropertyTo(id, btn, 'swap')!
    expect([show, text, swap].every(Boolean)).toBe(true)
    expect(A.addPropertyTo(id, btn, 'boolean')).toBeDefined() // a second one gets a unique name
    const names = doc().nodes[btn].component!.props!.map((p) => p.name)
    expect(names).toEqual(['Show', 'Label', 'Swap', 'Show 2'])

    let r = await render([btn])
    expect(r.host.querySelectorAll('[data-prop-id]')).toHaveLength(4)
    expect([...r.host.querySelectorAll('[data-prop-type]')].map((e) => e.getAttribute('data-prop-type'))).toEqual(['boolean', 'text', 'swap', 'boolean'])
    // rename through the field
    await setValue(r.host.querySelector<HTMLInputElement>('input[aria-label="Property name Label"]')!, 'Caption')
    expect(doc().nodes[btn].component!.props!.find((p) => p.id === text)!.name).toBe('Caption')
    // default of a text property
    await setValue(r.host.querySelector<HTMLInputElement>('input[aria-label="Default of Caption"]')!, 'Go')
    expect(doc().nodes[btn].component!.props!.find((p) => p.id === text)!.default).toBe('Go')
    // default of a boolean via the checkbox
    await act(async () => r.host.querySelector<HTMLElement>(`[data-prop-id="${show}"] [role=checkbox]`)!.click())
    expect(doc().nodes[btn].component!.props!.find((p) => p.id === show)!.default).toBe(false)
    // delete
    await act(async () => r.host.querySelector<HTMLElement>('button[aria-label="Delete Caption"]')!.click())
    expect(doc().nodes[btn].component!.props!.some((p) => p.id === text)).toBe(false)
    await r.done()
    r = await render([btn])
    expect(r.host.querySelectorAll('[data-prop-id]')).toHaveLength(3)
    await r.done()
  })

  it('a refused rename (duplicate name) toasts and changes nothing', async () => {
    const { btn } = button()
    A.addPropertyTo(id, btn, 'boolean')
    const b = A.addPropertyTo(id, btn, 'boolean')!
    A.renameProperty(id, btn, b, 'Show')
    expect(toast).toHaveBeenCalled()
    expect(doc().nodes[btn].component!.props!.find((p) => p.id === b)!.name).toBe('Show 2')
  })

  it('"+ Boolean / Text / Swap" buttons add properties', async () => {
    const { btn } = button()
    const r = await render([btn])
    const add = [...r.host.querySelectorAll('button')].filter((b) => /^\+ /.test(b.textContent ?? ''))
    expect(add.map((b) => b.textContent)).toEqual(['+ Boolean', '+ Text', '+ Swap'])
    await act(async () => add[1].click())
    expect(doc().nodes[btn].component!.props!.map((p) => p.type)).toEqual(['text'])
    await r.done()
  })
})

describe('binding a layer to a property', () => {
  it('shows Visible and Text for a text layer, only Visible for a rect, and binds / unbinds', async () => {
    const { btn, label, icon } = button()
    const show = A.addPropertyTo(id, btn, 'boolean')!
    const text = A.addPropertyTo(id, btn, 'text')!
    let r = await render([label])
    expect([...r.host.querySelectorAll('[data-bind-aspect]')].map((e) => e.getAttribute('data-bind-aspect'))).toEqual(['visible', 'text'])
    await r.done()
    r = await render([icon])
    expect([...r.host.querySelectorAll('[data-bind-aspect]')].map((e) => e.getAttribute('data-bind-aspect'))).toEqual(['visible'])
    await r.done()
    A.bindLayer(id, label, 'text', text)
    A.bindLayer(id, icon, 'visible', show)
    expect(doc().nodes[label].bind).toEqual({ text })
    expect(doc().nodes[icon].bind).toEqual({ visible: show })
    A.bindLayer(id, icon, 'visible', null)
    expect(doc().nodes[icon].bind).toBeUndefined()
    // a type mismatch is refused with a toast
    A.bindLayer(id, label, 'visible', text)
    expect(toast).toHaveBeenCalled()
  })

  it('nothing to bind without properties of that type', async () => {
    const { icon } = button()
    const r = await render([icon])
    expect(r.host.querySelector('[data-bind-aspect]')).toBeNull()
    await r.done()
  })
})

describe('properties on an instance', () => {
  it('renders a control per type and writes the instance values', async () => {
    const { btn, label, icon, inst } = button()
    const show = A.addPropertyTo(id, btn, 'boolean')!
    const text = A.addPropertyTo(id, btn, 'text')!
    A.bindLayer(id, icon, 'visible', show)
    A.bindLayer(id, label, 'text', text)
    const r = await render([inst])
    expect([...r.host.querySelectorAll('.insp-prop__row')].map((e) => e.getAttribute('data-prop-type'))).toEqual(['boolean', 'text'])
    await act(async () => r.host.querySelector<HTMLElement>(`[data-prop-id="${show}"] [role=checkbox]`)!.click())
    expect(doc().nodes[inst].instance?.props?.[show]).toBe(false)
    expect(doc().nodes[doc().nodes[inst].children[1]].visible).toBe(false)
    await setValue(r.host.querySelector<HTMLInputElement>('input[aria-label="Label"]')!, 'Go')
    expect(doc().nodes[doc().nodes[inst].children[0]].text).toBe('Go')
    await r.done()
    S().undo(id) // back to the property default: the text of the layer it was bound to
    expect(doc().nodes[doc().nodes[inst].children[0]].text).toBe('Click')
  })

  it('a layer inside the instance shows which property drives it', async () => {
    const { btn, label, inst } = button()
    const text = A.addPropertyTo(id, btn, 'text')!
    A.bindLayer(id, label, 'text', text)
    const twin = doc().nodes[inst].children[0]
    const r = await render([twin])
    expect(r.host.querySelector('[data-bound="text"]')?.textContent).toContain('Label')
    expect(r.host.querySelector('[data-prop-id]')).toBeNull() // the controls live on the instance root
    await r.done()
  })

  it('variant props get a dropdown; switching reports dropped overrides', async () => {
    const { btn, icon, inst } = button()
    const second = S().addVariant(id, btn)
    const set = doc().nodes[btn].component!.set as string
    const prop = doc().nodes[set].componentSet!.props[0].id
    S().deleteNodes(id, [doc().nodes[second].children[1]]) // Variant 2 has no icon
    S().updateStyles(id, [doc().nodes[inst].children[1]], { opacity: 0.5 }) // override on the icon
    expect(icon).toBeTruthy()
    const r = await render([inst])
    const row = r.host.querySelector(`[data-prop-id="${prop}"]`)!
    expect(row.getAttribute('data-prop-type')).toBe('variant')
    expect(row.textContent).toContain('Default')
    await r.done()
    A.chooseVariant(id, inst, prop, 'Variant 2')
    expect(doc().nodes[inst].instance!.of).toBe(second)
    expect(toast).toHaveBeenCalledWith('1 override could not carry over')
    vi.mocked(toast).mockClear()
    A.chooseVariant(id, inst, prop, 'Default') // nothing left to drop
    expect(toast).not.toHaveBeenCalled()
    A.chooseVariant(id, inst, prop, 'Huge') // not an option: refused
    expect(toast).toHaveBeenCalled()
  })

  it('a swap property shows a picker with the components', async () => {
    const { btn, icon } = button()
    const other = S().createNode(id, { type: 'frame', name: 'Other', style: { width: 10, height: 10 } }, root())
    S().createComponent(id, [other], geo)
    const swap = A.addPropertyTo(id, btn, 'swap')!
    expect(doc().nodes[btn].component!.props!.find((p) => p.id === swap)!.default).toBe(other)
    expect(icon).toBeTruthy()
    const inst2 = S().createInstance(id, btn, root())
    const r = await render([inst2])
    expect(r.host.querySelector(`[data-prop-id="${swap}"]`)!.textContent).toContain('Other')
    await r.done()
  })
})

describe('a set frame edits the shared properties', () => {
  it('shows the property editor and shares it across the variants', async () => {
    const { btn } = button()
    const second = S().addVariant(id, btn)
    const set = doc().nodes[btn].component!.set as string
    const id1 = A.addPropertyTo(id, btn, 'boolean')!
    const r = await render([set])
    expect(r.host.querySelector(`[data-prop-id="${id1}"]`)).not.toBeNull()
    await r.done()
    const r2 = await render([second])
    expect(r2.host.querySelector(`[data-prop-id="${id1}"]`)).not.toBeNull()
    await r2.done()
  })
})

describe('renaming the variant property and values', () => {
  it('the Variant section on a variant main renames the property and the value; the instance dropdown shows them', async () => {
    const { btn, inst } = button()
    const second = S().addVariant(id, btn)
    const set = doc().nodes[btn].component!.set as string
    const prop = doc().nodes[set].componentSet!.props[0].id
    S().setVariantValue(id, inst, prop, 'Variant 2')
    let r = await render([second])
    expect(r.host.querySelector(`[data-variant-prop="${prop}"]`)).not.toBeNull()
    await setValue(r.host.querySelector<HTMLInputElement>('input[aria-label="Variant property name Variant"]')!, 'State')
    expect(doc().nodes[set].componentSet!.props[0].name).toBe('State')
    await setValue(r.host.querySelector<HTMLInputElement>('input[aria-label="Value of State"]')!, 'Hover')
    expect(doc().nodes[second].component!.variant![prop]).toBe('Hover')
    expect(doc().nodes[inst].instance!.of).toBe(second)
    await r.done()
    r = await render([inst])
    const row = r.host.querySelector(`[data-prop-id="${prop}"]`)!
    expect(row.textContent).toContain('State')
    expect(row.textContent).toContain('Hover')
    expect(r.host.querySelector('[data-variant]')!.textContent).toBe('State=Hover')
    await r.done()
    // a duplicate value is refused with a toast and the field snaps back on the next render
    A.renameVariantValue(id, set, prop, 'Hover', 'Default')
    expect(toast).toHaveBeenCalled()
    expect(doc().nodes[second].component!.variant![prop]).toBe('Hover')
  })

  it('a lone main has no Variant section', async () => {
    const { btn } = button()
    const r = await render([btn])
    expect(r.host.querySelector('[data-variant-prop]')).toBeNull()
    await r.done()
  })
})
