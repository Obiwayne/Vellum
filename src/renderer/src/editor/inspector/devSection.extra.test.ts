// @vitest-environment jsdom
// T69 test station: undo granularity of the Dev sections, Dev Mode read-only, instances, and code tabs without notes.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

vi.mock('../canvas/toast', () => ({ toast: vi.fn() }))

import { getStore, useStore } from '../../model/store'
import { codeFor } from '../canvas/codegen'
import { textContrast } from '../../model/contrast'
import { DevSections } from './DevSection'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const S = getStore
let id: string
let host: HTMLDivElement
let root: Root

const mount = (nodeId: string): void => {
  S().select(id, [nodeId])
  act(() => root.render(createElement(DevSections, { docId: id, id: nodeId })))
}
const commit = (el: HTMLInputElement, value: string): void => {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => el.focus())
  act(() => {
    set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  act(() => el.blur())
}

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true)
  id = S().createDoc('Dev', { open: false })
  host = document.createElement('div')
  document.body.innerHTML = ''
  document.body.appendChild(host)
  root = createRoot(host)
})

function card() {
  const rootId = S().docs[id].pages[0].rootId
  const f = S().createNode(id, { type: 'frame', name: 'Card', style: { width: 200, height: 100, backgroundColor: '#FFFFFF' } }, rootId)
  const t = S().createNode(id, { type: 'text', name: 'Title', text: 'Hello', style: { color: '#111111', fontSize: 16 } }, f)
  return { f, t, rootId }
}

describe('each edit is one undo step', () => {
  it('label, focus order and role are separate steps, each undone on its own', () => {
    const { f } = card()
    mount(f)
    commit(host.querySelector('input[placeholder="Accessible name"]') as HTMLInputElement, 'Order card')
    commit(host.querySelector('input[placeholder="Reading order"]') as HTMLInputElement, '2')
    expect(S().docs[id].nodes[f].dev).toMatchObject({ label: 'Order card', tab: 2 })
    S().undo(id)
    expect(S().docs[id].nodes[f].dev).toEqual({ label: 'Order card' })
    S().undo(id)
    expect(S().docs[id].nodes[f].dev).toBeUndefined()
  })

  it('redo brings a note back, and undo restores exactly the document before (no stray empty dev)', () => {
    const { f } = card()
    const before = JSON.stringify(S().docs[id].nodes[f])
    mount(f)
    commit(host.querySelector('input[placeholder="Accessible name"]') as HTMLInputElement, 'x')
    S().undo(id)
    expect(JSON.stringify(S().docs[id].nodes[f])).toBe(before)
    S().redo(id)
    expect(S().docs[id].nodes[f].dev?.label).toBe('x')
  })
})

describe('Design mode only', () => {
  it('in Dev Mode the store refuses every Dev section edit, so a stale form cannot write', () => {
    const { f } = card()
    mount(f)
    S().setDevMode(id, true)
    const input = host.querySelector('input[placeholder="Accessible name"]') as HTMLInputElement
    commit(input, 'sneaky')
    expect(S().docs[id].nodes[f].dev).toBeUndefined()
    expect(S().makeStateProperty(id, f).ok).toBe(false)
    S().setDevMode(id, false)
    commit(input, 'fine')
    expect(S().docs[id].nodes[f].dev?.label).toBe('fine')
  })
})

describe('instances and code', () => {
  it('contrast works for a text layer inside an instance (a materialised twin)', () => {
    const { f, t } = card()
    const main = S().createComponent(id, [f])
    const inst = S().createInstance(id, main, S().docs[id].pages[0].rootId)
    const twin = S().docs[id].nodes[inst].children.map((c) => S().docs[id].nodes[c]).find((n) => n.srcId === t)!
    const r = textContrast(S().docs[id], twin.id)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.results[0].ratio).toBeGreaterThan(15)
  })

  it('the Spec panel code tabs (html, jsx, tailwind, react, css) carry no dev notes, states or open question', () => {
    const { f, t } = card()
    S().setDev(id, [f], { notes: 'CANARY_NOTE', needsDecision: 'CANARY_QUESTION', states: { hover: { backgroundColor: '#FF0000' } }, role: 'region', label: 'CANARY_LABEL' })
    S().setDev(id, [t], { notes: 'CANARY_TEXT_NOTE' })
    const doc = S().docs[id]
    for (const format of ['html', 'jsx', 'tailwind', 'react', 'css'] as const) {
      const out = codeFor(doc, [f], format)
      expect(out.length, format).toBeGreaterThan(0)
      expect(out, format).not.toMatch(/CANARY/)
    }
  })

  it('a text colour that is translucent and an unreadable background both give a clear answer, not a throw', () => {
    const { f, t } = card()
    S().updateStyles(id, [t], { color: 'rgba(0, 0, 0, 0.5)' })
    const half = textContrast(S().docs[id], t)
    expect(half.ok).toBe(true)
    if (half.ok) expect(half.results[0].ratio).toBeLessThan(21)
    S().updateStyles(id, [f], { backgroundColor: 'var(--missing)' })
    const bad = textContrast(S().docs[id], t)
    expect(typeof bad.ok).toBe('boolean')
  })
})
