// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { getStore, useStore } from '../../model/store'
import { reevaluateHoverOnKey } from './hoverKeys'

const S = getStore
let id: string
let outer: string
let mid: string
let leaf: string
let leafEl: HTMLElement

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true)
  id = S().createDoc('Hover', { open: true })
  const root = S().docs[id].pages[0].rootId
  outer = S().createNode(id, { type: 'frame', name: 'Outer', style: { width: 300, height: 300 } }, root)
  mid = S().createNode(id, { type: 'frame', name: 'Mid', style: { width: 200, height: 200 } }, outer)
  leaf = S().createNode(id, { type: 'rect', name: 'Leaf', style: { width: 50, height: 50 } }, mid)
  // the DOM as the canvas renders it: nested elements carrying data-node-id
  const el = (nid: string, parent?: HTMLElement): HTMLElement => {
    const e = document.createElement('div')
    e.setAttribute('data-node-id', nid)
    ;(parent ?? document.body).appendChild(e)
    return e
  }
  document.body.innerHTML = ''
  leafEl = el(leaf, el(mid, el(outer)))
  S().setTool(id, 'move')
})

const key = (k: string, extra: Partial<{ ctrlKey: boolean; metaKey: boolean }> = {}) => ({ key: k, ctrlKey: false, metaKey: false, ...extra })
const at = () => leafEl

describe('Alt without a pointer move', () => {
  it('pressing Alt in Dev Mode hovers the deepest layer under the last pointer position; releasing it goes back', () => {
    S().setDevMode(id, true)
    S().setHovered(id, mid)
    expect(reevaluateHoverOnKey(id, key('Alt'), true, { x: 5, y: 5 }, at, false)).toBe(true)
    expect(S().editors[id].hovered).toBe(leaf)
    expect(reevaluateHoverOnKey(id, key('Alt'), false, { x: 5, y: 5 }, at, false)).toBe(true)
    expect(S().editors[id].hovered).toBe(mid)
  })

  it('does nothing outside Dev Mode, for other keys, without a pointer position, or while a gesture runs', () => {
    S().setHovered(id, mid)
    expect(reevaluateHoverOnKey(id, key('Alt'), true, { x: 1, y: 1 }, at, false)).toBe(false)
    S().setDevMode(id, true)
    expect(reevaluateHoverOnKey(id, key('Shift'), true, { x: 1, y: 1 }, at, false)).toBe(false)
    expect(reevaluateHoverOnKey(id, key('Alt'), true, null, at, false)).toBe(false)
    expect(reevaluateHoverOnKey(id, key('Alt'), true, { x: 1, y: 1 }, at, true)).toBe(false)
    expect(S().editors[id].hovered).toBe(mid)
  })

  it('clears the hover when the pointer is over empty canvas', () => {
    S().setDevMode(id, true)
    S().setHovered(id, mid)
    reevaluateHoverOnKey(id, key('Alt'), true, { x: 1, y: 1 }, () => document.body, false)
    expect(S().editors[id].hovered).toBeNull()
  })

  it('Ctrl keeps picking the deepest layer without Alt', () => {
    S().setDevMode(id, true)
    reevaluateHoverOnKey(id, key('Alt', { ctrlKey: true }), false, { x: 1, y: 1 }, at, false)
    expect(S().editors[id].hovered).toBe(leaf)
  })
})
