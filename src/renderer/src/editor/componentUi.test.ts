// @vitest-environment jsdom
// Component UI wiring checked from the code: the Layers diamond icons and the Ctrl+Alt+K / Ctrl+Alt+B shortcuts.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
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
