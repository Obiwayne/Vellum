// @vitest-environment jsdom
// Test-station checks for the Assets panel (T34): reactivity, several sets, odd defaults, lazy-thumbnail lifecycle.
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

/** A frame with a text, made a component. */
function component(name: string, text = name, parent = doc().pages[0].rootId): string {
  const f = S().createNode(id, { type: 'frame', name, style: { width: 120, height: 40 } }, parent)
  S().createNode(id, { type: 'text', text }, f)
  S().select(id, [f])
  C.createComponentFromSelection(id)
  return f
}

/** Turn `main` into a set with `n` variants in total; options are named "<prefix>1".."<prefix>n". */
function makeSet(main: string, n: number, prefix = 'V'): string[] {
  const ids = [main]
  S().mutate(id, 'variants', (d) => {
    for (let i = 1; i < n; i++) ids.push(createVariant(d, ids[ids.length - 1])) // each after the previous one: canvas order = creation order
  })
  const set = doc().nodes[main].component!.set as string
  S().mutate(id, 'options', (d) => {
    const prop = d.nodes[set].componentSet!.props[0]
    prop.options = ids.map((_, i) => `${prefix}${i + 1}`)
    prop.default = `${prefix}1`
    ids.forEach((m, i) => (d.nodes[m].component!.variant = { [prop.id]: `${prefix}${i + 1}` }))
  })
  return ids
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
const countText = (rowName: string): string =>
  [...host.querySelectorAll('.lp-component')].find((r) => r.querySelector('.lp-ellipsis')?.textContent === rowName)?.querySelector('.lp-component__variants')?.textContent ?? ''

describe('reactivity', () => {
  it('adding a variant while the panel is open updates the count; deleting a main removes its row', () => {
    const a = component('Alpha')
    const b = component('Beta')
    makeSet(a, 2)
    render()
    expect(countText('Alpha')).toBe('2 variants')
    act(() => {
      S().mutate(id, 'add', (d) => void createVariant(d, a))
    })
    expect(countText('Alpha')).toBe('3 variants')
    act(() => {
      S().deleteNodes(id, [b])
    })
    expect(rows()).toEqual(['Alpha'])
  })

  it('a text edit in the main updates the thumbnail preview', () => {
    const a = component('Alpha', 'before')
    render()
    expect(host.querySelector('.lp-thumb')?.textContent).toContain('before')
    const t = doc().nodes[a].children[0]
    act(() => {
      S().setText(id, t, 'after')
    })
    expect(host.querySelector('.lp-thumb')?.textContent).toContain('after')
  })

  it('deleting the whole set (frame and mains) leaves no row and no crash', () => {
    const a = component('Alpha')
    makeSet(a, 3)
    const set = doc().nodes[a].component!.set as string
    render()
    expect(rows().length).toBe(1)
    act(() => {
      S().deleteNodes(id, [set])
    })
    expect(rows()).toEqual([])
    expect(host.querySelector('.lp-components')).toBeNull() // hidden when the file has no components
  })

  it('a set frame whose variant mains were all removed shows nothing', () => {
    const a = component('Alpha')
    const [, b] = makeSet(a, 2)
    act(() => {
      S().deleteNodes(id, [a, b])
    })
    render()
    expect(rows()).toEqual([])
  })
})

describe('several sets and defaults', () => {
  it('two sets with the same name are two rows; expanding one leaves the other collapsed', () => {
    const a = component('Same')
    const b = component('Same', 'other')
    makeSet(a, 2, 'A')
    makeSet(b, 3, 'B')
    render()
    expect(rows()).toEqual(['Same', 'Same'])
    const chevs = host.querySelectorAll('.lp-component__chev')
    expect(chevs.length).toBe(2)
    act(() => (chevs[1] as HTMLElement).click())
    expect(rows()).toEqual(['Same', 'Same', 'B1', 'B2', 'B3'])
    act(() => (chevs[1] as HTMLElement).click())
    act(() => (chevs[0] as HTMLElement).click())
    expect(rows()).toEqual(['Same', 'A1', 'A2', 'Same'])
  })

  it('clicking the set row inserts the DEFAULT variant even when it is not the first main', () => {
    const a = component('Alpha')
    const ids = makeSet(a, 3)
    const set = doc().nodes[a].component!.set as string
    S().mutate(id, 'default -> V3', (d) => {
      d.nodes[set].componentSet!.props[0].default = 'V3'
    })
    render()
    act(() => (host.querySelector('.lp-component') as HTMLElement).click())
    const inst = Object.values(doc().nodes).filter((n) => n.instance)
    expect(inst.at(-1)!.instance!.of).toBe(ids[2])
    // the panel row counts the instance on that variant
    expect(host.querySelector('.lp-component__count')?.textContent).toBe('1')
  })

  it('the set row counts instances of all its variants, each variant row its own', () => {
    const a = component('Alpha')
    const ids = makeSet(a, 2)
    const r = doc().pages[0].rootId
    S().createInstance(id, ids[0], r)
    S().createInstance(id, ids[1], r)
    S().createInstance(id, ids[1], r)
    render()
    expect(host.querySelector('.lp-component .lp-component__count')?.textContent).toBe('3')
    act(() => (host.querySelector('.lp-component__chev') as HTMLElement).click())
    const counts = [...host.querySelectorAll('.lp-component--variant .lp-component__count')].map((e) => e.textContent)
    expect(counts).toEqual(['1', '2'])
  })

  it('a set on page 2 is grouped under its own page heading', () => {
    component('Alpha')
    const p2 = S().addPage(id, 'Two')
    S().setActivePage(id, p2)
    const b = component('Beta', 'b', doc().pages[1].rootId)
    makeSet(b, 2)
    render()
    const heads = [...host.querySelectorAll('.lp-components__page')].map((e) => e.textContent)
    expect(heads).toEqual(['Page 1', 'Two'])
    expect(rows()).toEqual(['Alpha', 'Beta'])
  })

  it('search is case-insensitive, trims, and opens only the matching variants', () => {
    const a = component('Alpha')
    makeSet(a, 3, 'Size ')
    render()
    const input = host.querySelector('input') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => {
      setter.call(input, '  SIZE 2 ')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(rows()).toEqual(['Alpha', 'Size 2'])
  })
})

describe('lazy thumbnail lifecycle', () => {
  type Rec = { cb: IntersectionObserverCallback; el: Element | null; disconnected: boolean }
  const observers: Rec[] = []
  beforeEach(() => {
    observers.length = 0
    ;(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
      rec: Rec
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
  const show = (rec: Rec): void =>
    act(() => rec.cb([{ isIntersecting: true, target: rec.el } as unknown as IntersectionObserverEntry], {} as IntersectionObserver))

  it('unmounting disconnects every observer that is still waiting', () => {
    component('A')
    component('B')
    component('C')
    render()
    expect(observers.length).toBe(3)
    act(() => root.unmount())
    expect(observers.every((o) => o.disconnected)).toBe(true)
    root = createRoot(host) // so afterEach can unmount
  })

  it('once seen, a thumbnail stays rendered and follows later edits (no flip back to the placeholder)', () => {
    const a = component('A', 'one')
    render()
    show(observers[0])
    expect(host.querySelector('.lp-thumb')?.textContent).toContain('one')
    act(() => {
      S().setText(id, doc().nodes[a].children[0], 'two')
    })
    expect(host.querySelectorAll('.lp-thumb--lazy').length).toBe(0)
    expect(host.querySelector('.lp-thumb')?.textContent).toContain('two')
  })

  it('doc changes while a placeholder is waiting do not create extra observers per row', () => {
    const a = component('A', 'one')
    render()
    const before = observers.length
    for (let i = 0; i < 5; i++) act(() => void S().setText(id, doc().nodes[a].children[0], `t${i}`))
    expect(observers.length).toBe(before)
  })

  it('expanding a set creates placeholders for the new variant rows, which load on their own', () => {
    const a = component('A')
    makeSet(a, 3)
    render()
    const base = observers.length
    act(() => (host.querySelector('.lp-component__chev') as HTMLElement).click())
    expect(host.querySelectorAll('.lp-thumb--lazy').length).toBeGreaterThanOrEqual(3)
    expect(observers.length).toBeGreaterThan(base)
    const lazy = host.querySelectorAll('.lp-component--variant .lp-thumb--lazy')
    expect(lazy.length).toBe(3)
    show(observers.find((o) => o.el === lazy[0])!)
    expect(host.querySelectorAll('.lp-component--variant .lp-thumb--lazy').length).toBe(2)
  })
})
