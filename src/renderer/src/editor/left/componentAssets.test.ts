// @vitest-environment jsdom
// Assets panel: sets are one row that expands to variants, every row has a thumbnail, search covers variants.
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getStore, useStore } from '../../model/store'
import { createVariant } from '../../model/variants'
import * as C from '../canvas/componentActions'
import { ComponentsSection } from './ComponentsSection'

vi.mock('../canvas/toast', () => ({ toast: vi.fn() }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const S = getStore
let id: string
const doc = () => S().docs[id]
let host: HTMLDivElement
let root: Root

function setup() {
  const r = doc().pages[0].rootId
  const button = S().createNode(id, { type: 'frame', name: 'Button', style: { width: 120, height: 40 } }, r)
  S().createNode(id, { type: 'text', text: 'Click' }, button)
  const card = S().createNode(id, { type: 'frame', name: 'Card', style: { width: 200, height: 80 } }, r)
  S().select(id, [button])
  C.createComponentFromSelection(id)
  S().select(id, [card])
  C.createComponentFromSelection(id)
  return { button, card }
}

/** Make `button` a set with Size = Small (default) / Large. Returns the two mains. */
function makeSet(button: string): { small: string; large: string } {
  let large = ''
  S().mutate(id, 'Add variant', (d) => {
    large = createVariant(d, button, undefined)
  })
  const set = doc().nodes[button].component!.set as string
  S().mutate(id, 'Rename options', (d) => {
    const prop = d.nodes[set].componentSet!.props[0]
    prop.name = 'Size'
    prop.options = ['Small', 'Large']
    prop.default = 'Small'
    d.nodes[button].component!.variant = { [prop.id]: 'Small' }
    d.nodes[large].component!.variant = { [prop.id]: 'Large' }
  })
  return { small: button, large }
}

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true)
  id = S().createDoc('T', { open: false })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const render = (): void => act(() => root.render(createElement(ComponentsSection, { docId: id })))
const rows = (): string[] => [...host.querySelectorAll('.lp-component')].map((e) => e.querySelector('.lp-ellipsis')?.textContent ?? '')

describe('assetGroups with sets', () => {
  it('a set is one item: default variant id, set name, total instances, variants listed', () => {
    const { button } = setup()
    const { small, large } = makeSet(button)
    S().createInstance(id, large, doc().pages[0].rootId)
    S().createInstance(id, large, doc().pages[0].rootId)
    const items = C.assetGroups(doc())[0].items
    const set = items.find((i) => i.variants)!
    expect(items.length).toBe(2) // the set + Card
    expect(set.id).toBe(small)
    expect(set.instances).toBe(2)
    expect(set.variants!.map((v) => v.id)).toEqual([small, large])
    expect(set.variants!.map((v) => v.label)).toEqual(['Small', 'Large'])
    expect(set.variants![1].instances).toBe(2)
    expect(items.find((i) => !i.variants)!.name).toBe('Card')
  })

  it('search: a set name shows all its variants, a variant value shows only matching ones', () => {
    const { button } = setup()
    makeSet(button)
    const byName = C.assetGroups(doc(), 'button')[0].items
    expect(byName.length).toBe(1)
    expect(byName[0].variants!.length).toBe(2)
    const byValue = C.assetGroups(doc(), 'large')[0].items
    expect(byValue.length).toBe(1)
    expect(byValue[0].variants!.map((v) => v.label)).toEqual(['Large'])
    expect(C.assetGroups(doc(), 'zzz')).toEqual([])
  })
})

describe('Assets panel rendering', () => {
  it('every row has a thumbnail; lone components render their preview', () => {
    setup()
    render()
    expect(rows()).toEqual(['Button', 'Card'])
    expect(host.querySelectorAll('.lp-thumb').length).toBe(2)
    expect(host.querySelector('.lp-thumb')?.textContent).toContain('Click') // the live preview, not a placeholder
  })

  it('a set row shows a chevron, expands to its variants, and a variant row inserts that variant', () => {
    const { button } = setup()
    const { large } = makeSet(button)
    render()
    expect(rows()).toEqual(['Button', 'Card']) // collapsed
    const chev = host.querySelector('.lp-component__chev') as HTMLElement
    expect(chev).toBeTruthy()
    act(() => chev.click())
    expect(rows()).toEqual(['Button', 'Small', 'Large', 'Card'])
    expect(host.querySelectorAll('.lp-thumb').length).toBe(4)
    const before = Object.values(doc().nodes).filter((n) => n.instance).length
    const largeRow = [...host.querySelectorAll('.lp-component--variant')][1] as HTMLElement
    act(() => largeRow.click())
    const inst = Object.values(doc().nodes).filter((n) => n.instance)
    expect(inst.length).toBe(before + 1)
    expect(inst[inst.length - 1].instance!.of).toBe(large)
    act(() => chev.click())
    expect(rows()).toEqual(['Button', 'Card'])
  })

  it('clicking the set row inserts its default variant', () => {
    const { button } = setup()
    const { small } = makeSet(button)
    render()
    act(() => (host.querySelector('.lp-component') as HTMLElement).click())
    const inst = Object.values(doc().nodes).filter((n) => n.instance)
    expect(inst[inst.length - 1].instance!.of).toBe(small)
  })

  it('searching expands sets automatically and variant rows can be dragged (drag payload = the variant main)', () => {
    const { button } = setup()
    const { large } = makeSet(button)
    render()
    const input = host.querySelector('input') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => {
      setter.call(input, 'large')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(rows()).toEqual(['Button', 'Large'])
    const data: Record<string, string> = {}
    const ev = new Event('dragstart', { bubbles: true }) as Event & { dataTransfer?: unknown }
    ev.dataTransfer = { setData: (k: string, v: string) => (data[k] = v), effectAllowed: '' }
    act(() => {
      host.querySelector('.lp-component--variant')!.dispatchEvent(ev)
    })
    expect(data[C.COMPONENT_DRAG_TYPE]).toBe(large)
  })
})

describe('T34 acceptance gaps found at the test station', () => {
  it('a collapsed set row shows its variant count next to the instance count', () => {
    const { button } = setup()
    makeSet(button)
    render()
    const setRow = host.querySelector('.lp-component') as HTMLElement
    expect(setRow.textContent).toMatch(/2 variants/)
    expect(setRow.querySelector('.lp-component__variants')?.textContent).toBe('2 variants')
    expect(setRow.querySelector('.lp-component__count')?.textContent).toBe('0')
    expect([...host.querySelectorAll('.lp-component')].find((r) => r.textContent?.startsWith('Card'))?.querySelector('.lp-component__variants')).toBeNull()
  })

  it('a set with a single variant says "1 variant"', () => {
    const { button } = setup()
    makeSet(button)
    S().mutate(id, 'Drop', (d) => {
      const set = d.nodes[button].component!.set as string
      const other = d.nodes[set].children.find((c) => c !== button) as string
      d.nodes[set].children = [button]
      delete d.nodes[other]
    })
    render()
    expect(host.querySelector('.lp-component__variants')?.textContent).toBe('1 variant')
  })

  it('30 components render with a thumbnail each, within a generous time budget', () => {
    const r = doc().pages[0].rootId
    for (let i = 0; i < 30; i++) {
      const f = S().createNode(id, { type: 'frame', name: `C${i}`, style: { width: 100, height: 40 } }, r)
      S().createNode(id, { type: 'text', text: `t${i}` }, f)
      S().select(id, [f])
      C.createComponentFromSelection(id)
    }
    const t0 = performance.now()
    render()
    const ms = performance.now() - t0
    expect(rows().length).toBe(30)
    expect(host.querySelectorAll('.lp-thumb').length).toBe(30)
    expect(ms).toBeLessThan(3000)
  })

  it('a component over the node cap falls back to the icon thumbnail', () => {
    const r = doc().pages[0].rootId
    const big = S().createNode(id, { type: 'frame', name: 'Big', style: { width: 100, height: 100 } }, r)
    for (let i = 0; i < 130; i++) S().createNode(id, { type: 'rect' }, big)
    S().select(id, [big])
    C.createComponentFromSelection(id)
    render()
    expect(host.querySelectorAll('.lp-thumb--icon').length).toBe(1)
  })
})

describe('lazy thumbnails', () => {
  type IO = { cb: IntersectionObserverCallback; el: Element | null; disconnected: boolean }
  const observers: IO[] = []
  beforeEach(() => {
    observers.length = 0
    ;(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
      rec: IO
      constructor(cb: IntersectionObserverCallback) {
        this.rec = { cb, el: null, disconnected: false }
        observers.push(this.rec)
      }
      observe(el: Element): void {
        this.rec.el = el
      }
      disconnect(): void {
        this.rec.disconnected = true
      }
    }
  })
  afterEach(() => {
    delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver
  })

  it('a row renders its preview only after it scrolls into view, and stops observing then', () => {
    setup()
    render()
    expect(host.querySelectorAll('.lp-thumb--lazy').length).toBe(2)
    expect(host.querySelector('.lp-thumb')?.textContent).not.toContain('Click') // placeholder only
    const first = observers.find((o) => o.el === host.querySelector('.lp-thumb--lazy'))!
    act(() => first.cb([{ isIntersecting: true, target: first.el } as unknown as IntersectionObserverEntry], {} as IntersectionObserver))
    expect(host.querySelectorAll('.lp-thumb--lazy').length).toBe(1)
    expect(host.querySelector('.lp-thumb')?.textContent).toContain('Click')
    expect(first.disconnected).toBe(true)
  })

  it('a non-intersecting callback keeps the placeholder', () => {
    setup()
    render()
    const first = observers[0]
    act(() => first.cb([{ isIntersecting: false, target: first.el } as unknown as IntersectionObserverEntry], {} as IntersectionObserver))
    expect(host.querySelectorAll('.lp-thumb--lazy').length).toBe(2)
  })

  it('big components keep the icon fallback and are never observed', () => {
    const r = doc().pages[0].rootId
    const big = S().createNode(id, { type: 'frame', name: 'Big' }, r)
    for (let i = 0; i < 130; i++) S().createNode(id, { type: 'rect' }, big)
    S().select(id, [big])
    C.createComponentFromSelection(id)
    render()
    expect(host.querySelectorAll('.lp-thumb--icon').length).toBe(1)
    expect(observers.length).toBe(0)
  })
})
