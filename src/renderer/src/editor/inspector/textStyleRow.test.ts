// @vitest-environment jsdom
// Inspector text style row: picker states, apply/detach in one undo step, create, manual-edit toast.
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getStore, useStore } from '../../model/store'
import { useCtx } from './common'
import { TextStyleRow } from './TextStyleRow'

const toastSpy = vi.hoisted(() => vi.fn())
vi.mock('../canvas/toast', () => ({ toast: toastSpy }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const S = getStore
let id: string
const doc = () => S().docs[id]
let host: HTMLDivElement
let root: Root
let setFn: ((p: Record<string, string | number | null>) => void) | null = null

function Harness({ ids }: { ids: string[] }): JSX.Element {
  const d = useStore((s) => s.docs[id])
  const ctx = useCtx(id, d, ids)
  setFn = ctx.set
  return createElement(TextStyleRow, { ctx })
}
const render = (ids: string[]): void => act(() => root.render(createElement(Harness, { ids })))
const row = (): HTMLElement => host.querySelector('.insp-tstyle') as HTMLElement
const button = (label: string): HTMLButtonElement | null => host.querySelector(`button[aria-label="${label}"]`)
const pick = (name: string): void => {
  act(() => (host.querySelector('.c-select') as HTMLElement).click())
  const item = [...document.querySelectorAll('[role="menuitem"]')].find((e) => e.textContent?.includes(name)) as HTMLElement
  expect(item, `menu item ${name}`).toBeTruthy()
  act(() => item.click())
}

function two() {
  const r = doc().pages[0].rootId
  const a = S().createNode(id, { type: 'text', text: 'A' }, r)
  const b = S().createNode(id, { type: 'text', text: 'B' }, r)
  return { a, b }
}

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true)
  id = S().createDoc('T', { open: false })
  toastSpy.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('text style row states', () => {
  it('none: shows "None", no detach button, create enabled for one layer', () => {
    const { a } = two()
    render([a])
    expect(row().dataset.textStyle).toBe('none')
    expect(host.querySelector('.c-select__value')?.textContent).toBe('None')
    expect(button('Detach from text style')).toBeNull()
    expect(button('Create text style from selection')?.disabled).toBe(false)
  })

  it('linked: shows the style name, marker and a detach button', () => {
    const { a } = two()
    const sid = S().createTextStyle(id, 'Heading/H1', { fontSize: 32 })
    S().applyTextStyle(id, [a], sid)
    render([a])
    expect(row().dataset.textStyle).toBe(sid)
    expect(host.querySelector('.c-select__value')?.textContent).toBe('Heading/H1')
    expect(host.querySelector('.insp-tstyle__on')).toBeTruthy()
    expect(button('Detach from text style')).toBeTruthy()
  })

  it('mixed: two layers on different styles show Mixed', () => {
    const { a, b } = two()
    const s1 = S().createTextStyle(id, 'One', { fontSize: 10 })
    S().applyTextStyle(id, [a], s1)
    render([a, b])
    expect(row().dataset.textStyle).toBe('mixed')
    expect(host.querySelector('.c-select__value')?.textContent).toBe('Mixed')
    expect(button('Create text style from selection')).toBeNull() // label says to select one layer
    expect(button('Select one text layer to create a style')?.disabled).toBe(true)
  })
})

describe('actions', () => {
  it('picking a style applies it to every selected layer in one undo step; None detaches in one step', () => {
    const { a, b } = two()
    const sid = S().createTextStyle(id, 'Big', { fontSize: 40 })
    render([a, b])
    const before = JSON.stringify(doc().nodes)
    pick('Big')
    expect(doc().nodes[a].textStyle).toBe(sid)
    expect(doc().nodes[b].style.fontSize).toBe(40)
    S().undo(id)
    expect(JSON.stringify(doc().nodes).length).toBe(before.length)
    expect(doc().nodes[a].textStyle).toBeUndefined()
    S().redo(id)
    pick('None')
    expect(doc().nodes[a].textStyle).toBeUndefined()
    expect(doc().nodes[b].textStyle).toBeUndefined()
    expect(doc().nodes[a].style.fontSize).toBe(40) // values stay
    S().undo(id)
    expect(doc().nodes[a].textStyle).toBe(sid)
  })

  it('the detach button unlinks and keeps the values', () => {
    const { a } = two()
    const sid = S().createTextStyle(id, 'Big', { fontSize: 40 })
    S().applyTextStyle(id, [a], sid)
    render([a])
    act(() => button('Detach from text style')!.click())
    expect(doc().nodes[a].textStyle).toBeUndefined()
    expect(doc().nodes[a].style.fontSize).toBe(40)
    expect(row().dataset.textStyle).toBe('none')
  })

  it('create from selection makes a style from the layer, links it, and is one undo step', () => {
    const { a } = two()
    S().updateStyles(id, [a], { fontSize: 28, fontWeight: 700 })
    render([a])
    act(() => button('Create text style from selection')!.click())
    expect(doc().textStyles).toHaveLength(1)
    expect(doc().textStyles![0].style).toMatchObject({ fontSize: 28, fontWeight: 700 })
    expect(doc().nodes[a].textStyle).toBe(doc().textStyles![0].id)
    expect(row().dataset.textStyle).toBe(doc().textStyles![0].id)
    S().undo(id)
    expect(doc().textStyles ?? []).toHaveLength(0)
    expect(doc().nodes[a].textStyle).toBeUndefined()
  })

  it('a manual typography edit through the inspector detaches and shows the toast; colour does not', () => {
    const { a } = two()
    const sid = S().createTextStyle(id, 'Body', { fontSize: 16 })
    S().applyTextStyle(id, [a], sid)
    render([a])
    act(() => setFn!({ color: '#ff0000' }))
    expect(toastSpy).not.toHaveBeenCalled()
    expect(doc().nodes[a].textStyle).toBe(sid)
    act(() => setFn!({ fontSize: 20 }))
    expect(toastSpy).toHaveBeenCalledWith('Detached from text style Body')
    expect(doc().nodes[a].textStyle).toBeUndefined()
    expect(row().dataset.textStyle).toBe('none')
  })
})

describe('test station: adversarial', () => {
  it('picking from a Mixed selection links both; the label follows a rename and a delete', () => {
    const { a, b } = two()
    const s1 = S().createTextStyle(id, 'One', { fontSize: 10 })
    const s2 = S().createTextStyle(id, 'Two', { fontSize: 20 })
    S().applyTextStyle(id, [a], s1)
    S().applyTextStyle(id, [b], s2)
    render([a, b])
    expect(row().dataset.textStyle).toBe('mixed')
    pick('Two')
    expect(doc().nodes[a].textStyle).toBe(s2)
    expect(doc().nodes[a].style.fontSize).toBe(20)
    expect(row().dataset.textStyle).toBe(s2)
    act(() => S().renameTextStyle(id, s2, 'Renamed'))
    expect(host.querySelector('.c-select__value')?.textContent).toBe('Renamed')
    act(() => S().deleteTextStyle(id, s2))
    expect(row().dataset.textStyle).toBe('none')
    expect(host.querySelector('.c-select__value')?.textContent).toBe('None')
    expect(doc().nodes[a].style.fontSize).toBe(20)
  })

  it('a style edit shows through while the row is mounted', () => {
    const { a } = two()
    const sid = S().createTextStyle(id, 'Body', { fontSize: 16 })
    S().applyTextStyle(id, [a], sid)
    render([a])
    act(() => S().updateTextStyle(id, sid, { fontSize: 44 }))
    expect(doc().nodes[a].style.fontSize).toBe(44)
    expect(row().dataset.textStyle).toBe(sid)
  })

  it('create on a layer that already follows a style makes a second style and relinks to it', () => {
    const { a } = two()
    const s1 = S().createTextStyle(id, 'Body', { fontSize: 16 })
    S().applyTextStyle(id, [a], s1)
    render([a])
    act(() => button('Create text style from selection')!.click())
    expect(doc().textStyles).toHaveLength(2)
    expect(doc().textStyles![1].name).toBe('Text style')
    expect(doc().nodes[a].textStyle).toBe(doc().textStyles![1].id)
    act(() => button('Detach from text style')!.click())
    act(() => button('Create text style from selection')!.click())
    expect(doc().textStyles![2].name).toBe('Text style 2') // unique names
  })

  it('inside a component instance: picking links via an override, detach pins, one undo each', () => {
    const r = doc().pages[0].rootId
    const main = S().createNode(id, { type: 'frame', name: 'Card' }, r)
    const label = S().createNode(id, { type: 'text', text: 'Hi' }, main)
    const stage = S().createNode(id, { type: 'frame', name: 'Stage' }, r)
    S().createComponent(id, [main])
    const inst = S().createInstance(id, main, stage)
    const twin = (): string => doc().nodes[inst].children.find((c) => doc().nodes[c].srcId === label)!
    const sid = S().createTextStyle(id, 'Big', { fontSize: 40 })
    render([twin()])
    pick('Big')
    expect(doc().nodes[inst].instance?.overrides?.[label]?.textStyle).toBe(sid)
    expect(row().dataset.textStyle).toBe(sid)
    S().undo(id)
    expect(doc().nodes[inst].instance?.overrides?.[label]?.textStyle).toBeUndefined()
    expect(doc().nodes[twin()].textStyle).toBeUndefined()
    S().redo(id)
    act(() => button('Detach from text style')!.click())
    expect(row().dataset.textStyle).toBe('none')
    S().updateTextStyle(id, sid, { fontSize: 99 })
    expect(doc().nodes[twin()].style.fontSize).toBe(40) // pinned
  })

  it('the picker lists every style once, with None first', () => {
    const { a } = two()
    S().createTextStyle(id, 'Body', { fontSize: 16 })
    S().createTextStyle(id, 'Heading/H1', { fontSize: 32 })
    render([a])
    act(() => (host.querySelector('.c-select') as HTMLElement).click())
    const labels = [...document.querySelectorAll('[role="menuitem"]')].map((e) => e.textContent)
    expect(labels).toEqual(['None', 'Body', 'Heading/H1'])
  })
})
