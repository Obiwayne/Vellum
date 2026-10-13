// @vitest-environment jsdom
// Dev Mode is read-only: the selected layer keeps its outline but gets no resize, edge, padding/gap or gradient handles.
import { createElement, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorldRect } from '../../model/types'

// jsdom has no layout: give the overlay the rects the canvas would have measured
const RECTS = new Map<string, WorldRect>()
vi.mock('./geometry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./geometry')>()),
  measure: (id: string) => RECTS.get(id) ?? null
}))

import { getStore, useStore } from '../../model/store'
import { Overlay } from './Overlay'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const S = getStore
let host: HTMLElement
let root: Root
let docId: string
let frame: string

const noop = (): void => undefined
const render = (): void =>
  act(() => {
    root.render(
      createElement(Overlay, {
        docId,
        transient: {},
        onHandleDown: noop,
        onLabelDown: noop,
        onSpacingDown: noop,
        onSpacingDouble: noop,
        onGradientDown: noop
      })
    )
  })

beforeEach(() => {
  RECTS.clear()
  useStore.setState(useStore.getInitialState(), true)
  docId = S().createDoc('Handles', { open: false })
  const page = S().docs[docId].pages[0].rootId
  frame = S().createNode(docId, { type: 'frame', name: 'Card', style: { display: 'flex', gap: 12, padding: 16, width: 300, height: 200 } }, page)
  RECTS.set(frame, { x: 40, y: 60, width: 300, height: 200 })
  S().select(docId, [frame])
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('Overlay handles by mode', () => {
  it('Design mode: the selected frame has its resize handles and edges', () => {
    render()
    expect(host.querySelectorAll('.cv-handle').length).toBe(4)
    expect(host.querySelectorAll('.cv-edge').length).toBe(4)
  })

  it('Dev Mode: no resize handles, no edge hit areas, no spacing handles; the outline is still there', () => {
    S().setDevMode(docId, true)
    render()
    expect(host.querySelectorAll('.cv-handle').length).toBe(0)
    expect(host.querySelectorAll('.cv-edge').length).toBe(0)
    expect(host.querySelector('[class*="cv-spacing"]')).toBeNull()
    expect(host.querySelector('[class*="cv-grad"]')).toBeNull()
    // the selection is still drawn: the frame label is active and the size badge shows
    expect(host.querySelector('.cv-label--active')?.textContent).toBe('Card')
    expect(host.querySelector('.cv-badge')).not.toBeNull()
  })

  it('switching back to Design brings the handles back', () => {
    S().setDevMode(docId, true)
    render()
    expect(host.querySelectorAll('.cv-handle').length).toBe(0)
    S().setDevMode(docId, false)
    render()
    expect(host.querySelectorAll('.cv-handle').length).toBe(4)
  })
})
