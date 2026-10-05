// @vitest-environment jsdom
// Component UI wiring checked from the code: the Layers diamond icons and the Ctrl+Alt+K / Ctrl+Alt+B shortcuts.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getStore, useStore } from '../model/store'
import { instanceRootOf } from '../model/components'
import { NodeIcon } from './left/LayersTree'
import { installCanvasShortcuts } from './shortcuts'

vi.mock('./canvas/toast', () => ({ toast: vi.fn() }))

const S = getStore
let id: string
const doc = () => S().docs[id]
const key = (code: string, init: KeyboardEventInit = {}): void => {
  window.dispatchEvent(new KeyboardEvent('keydown', { code, ctrlKey: true, altKey: true, bubbles: true, cancelable: true, ...init }))
}

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true)
  id = S().createDoc('T', { open: true })
})

describe('Layers icons', () => {
  it('main component = filled diamond, instance = hollow diamond, plain frame = neither', () => {
    const root = doc().pages[0].rootId
    const card = S().createNode(id, { type: 'frame', name: 'Card' }, root)
    const plain = renderToStaticMarkup(createElement(NodeIcon, { node: doc().nodes[card] }))
    expect(plain).not.toContain('lucide-diamond')
    S().createComponent(id, [card], { rects: new Map(), bounds: { x: 0, y: 0, width: 1, height: 1 }, origin: { x: 0, y: 0 } })
    const main = renderToStaticMarkup(createElement(NodeIcon, { node: doc().nodes[card] }))
    expect(main).toContain('lucide-diamond')
    expect(main).toContain('fill="currentColor"')
    const inst = S().createInstance(id, card, root)
    const hollow = renderToStaticMarkup(createElement(NodeIcon, { node: doc().nodes[inst] }))
    expect(hollow).toContain('lucide-diamond')
    expect(hollow).toContain('fill="none"')
  })
})

describe('shortcuts', () => {
  it('Ctrl+Alt+K makes a component from the selected frame; Ctrl+Alt+B detaches the selected instance', () => {
    const off = installCanvasShortcuts(id)
    try {
      const root = doc().pages[0].rootId
      const card = S().createNode(id, { type: 'frame', name: 'Card', style: { width: 100, height: 50 } }, root)
      S().select(id, [card])
      key('KeyK')
      expect(doc().nodes[card].component).toBeTruthy()
      const inst = S().createInstance(id, card, root)
      S().select(id, [inst])
      expect(doc().nodes[inst].instance).toBeTruthy()
      key('KeyB')
      expect(doc().nodes[inst].instance).toBeUndefined()
      expect(instanceRootOf(doc(), inst)).toBeNull()
    } finally {
      off()
    }
  })

  it('Ctrl+Alt+Shift+K and plain Ctrl+K do nothing', () => {
    const off = installCanvasShortcuts(id)
    try {
      const root = doc().pages[0].rootId
      const card = S().createNode(id, { type: 'frame', name: 'Card' }, root)
      S().select(id, [card])
      key('KeyK', { shiftKey: true })
      key('KeyK', { altKey: false })
      expect(doc().nodes[card].component).toBeFalsy()
    } finally {
      off()
    }
  })
})

/** Client render (the store hook has no server snapshot): the section's HTML for a selection. */
async function renderInspector(ids: string[]): Promise<string> {
  const { ComponentSection } = await import('./inspector/ComponentSection')
  const host = document.createElement('div')
  const root = createRoot(host)
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  await act(async () => root.render(createElement(ComponentSection, { docId: id, ids })))
  const html = host.innerHTML
  await act(async () => root.unmount())
  return html
}

describe('variants UI', () => {
  const geo = { rects: new Map(), bounds: { x: 0, y: 0, width: 1, height: 1 }, origin: { x: 0, y: 0 } }
  function withSet() {
    const root = doc().pages[0].rootId
    const btn = S().createNode(id, { type: 'frame', name: 'Button', style: { width: 100, height: 40 } }, root)
    S().createComponent(id, [btn], geo)
    return { root, btn }
  }

  it('Layers: a component set gets its own icon, variant mains keep the filled diamond', () => {
    const { btn } = withSet()
    const second = S().addVariant(id, btn)
    const setId = doc().nodes[btn].component!.set as string
    const set = renderToStaticMarkup(createElement(NodeIcon, { node: doc().nodes[setId] }))
    expect(set).toContain('lucide-component')
    expect(set).not.toContain('lucide-diamond')
    for (const m of [btn, second]) expect(renderToStaticMarkup(createElement(NodeIcon, { node: doc().nodes[m] }))).toContain('fill="currentColor"')
  })

  it('the Add variant menu entry and action: a main gets a set and a selected new variant', async () => {
    const { btn } = withSet()
    const { componentMenu, addVariantToSelection } = await import('./canvas/componentActions')
    const labels = (ids: string[]): string[] => componentMenu(id, ids).map((e) => ('label' in e ? e.label : '-'))
    expect(labels([btn])).toContain('Add variant')
    S().select(id, [btn])
    addVariantToSelection(id)
    const setId = doc().nodes[btn].component!.set as string
    expect(setId).toBeTruthy()
    const sel = S().editors[id].selection
    expect(sel).toHaveLength(1)
    expect(doc().nodes[sel[0]].parent).toBe(setId)
    // not a main: nothing happens
    const plain = S().createNode(id, { type: 'frame' }, doc().pages[0].rootId)
    S().select(id, [plain])
    addVariantToSelection(id)
    expect(doc().nodes[plain].component).toBeUndefined()
    expect(labels([plain]).includes('Add variant')).toBe(false)
  })

  it('variantLabel and the instance header read the chosen variant', async () => {
    const { btn } = withSet()
    const second = S().addVariant(id, btn)
    const { variantLabel } = await import('./canvas/componentActions')
    expect(variantLabel(doc(), btn)).toBe('Variant=Default')
    expect(variantLabel(doc(), second)).toBe('Variant=Variant 2')
    const inst = S().createInstance(id, second, doc().pages[0].rootId)
    const html = await renderInspector([inst])
    expect(html).toContain('Variant=Variant 2')
    expect(variantLabel(doc(), doc().pages[0].rootId)).toBeNull()
  })

  it('inspector: a main shows Add variant, a set shows its variant count', async () => {
    const { btn } = withSet()
    expect(await renderInspector([btn])).toContain('Add variant')
    S().addVariant(id, btn)
    const setId = doc().nodes[btn].component!.set as string
    const html = await renderInspector([setId])
    expect(html).toContain('Component set')
    expect(html).toContain('2 variants')
  })

  it('Assets lists a set once, by its default variant, with its variant count and all instances', async () => {
    const { btn } = withSet()
    const second = S().addVariant(id, btn)
    S().createInstance(id, btn, doc().pages[0].rootId)
    S().createInstance(id, second, doc().pages[0].rootId)
    const { assetGroups } = await import('./canvas/componentActions')
    const items = assetGroups(doc()).flatMap((g) => g.items)
    expect(items).toEqual([{ id: btn, name: 'Button', instances: 2, variants: 2 }])
    expect(assetGroups(doc(), 'variant 2').flatMap((g) => g.items)).toHaveLength(1) // matches a variant's layer name
    expect(assetGroups(doc(), 'zzz')).toEqual([])
  })
})
