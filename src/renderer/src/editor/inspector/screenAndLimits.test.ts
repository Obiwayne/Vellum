// @vitest-environment jsdom
// T71: screen / breakpoint tagging in the inspector and the Min / Max size fields of the Layout section.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

vi.mock('../canvas/toast', () => ({ toast: vi.fn() }))

import { getStore, useStore } from '../../model/store'
import { useCtx } from './common'
import { LayoutSection } from './LayoutSection'
import { ScreenSection } from './ScreenSection'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const S = getStore
let id: string
let host: HTMLDivElement
let root: Root

const commit = (el: HTMLInputElement, value: string): void => {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => el.focus())
  act(() => {
    set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  act(() => el.blur())
}
const field = (placeholder: string): HTMLInputElement => host.querySelector(`input[placeholder="${placeholder}"]`) as HTMLInputElement

function Layout({ ids }: { ids: string[] }): JSX.Element {
  const doc = useStore((s) => s.docs[id])
  return createElement(LayoutSection, { ctx: useCtx(id, doc, ids) })
}

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true)
  id = S().createDoc('Dev', { open: false })
  document.body.innerHTML = ''
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

const frame = (name: string, width: number): string =>
  S().createNode(id, { type: 'frame', name, style: { width, height: 600 } }, S().docs[id].pages[0].rootId)

describe('Screen section', () => {
  it('is only for top-level frames', () => {
    const f = frame('Home', 1280)
    const inner = S().createNode(id, { type: 'frame', name: 'Inner', style: { width: 10, height: 10 } }, f)
    act(() => root.render(createElement(ScreenSection, { docId: id, id: inner })))
    expect(host.innerHTML).toBe('')
    act(() => root.render(createElement(ScreenSection, { docId: id, id: f })))
    expect(host.querySelector('[data-testid="screen-section"]')).not.toBeNull()
  })

  it('naming a frame tags it with a breakpoint guessed from its width', () => {
    const f = frame('Home mobile', 390)
    act(() => root.render(createElement(ScreenSection, { docId: id, id: f })))
    expect(host.textContent).toContain('Looks like Mobile (390 px)')
    commit(field('Home mobile'), 'Home')
    expect(S().docs[id].nodes[f].dev?.screen).toEqual({ name: 'Home', bp: 'Mobile' })
    act(() => root.render(createElement(ScreenSection, { docId: id, id: f })))
    expect(host.textContent).not.toContain('Not tagged')
  })

  it('emptying the name removes the tag; frames with the same name list each other', () => {
    const a = frame('A', 1280)
    const b = frame('B', 390)
    S().setScreen(id, a, { name: 'Home', bp: 'Desktop' })
    S().setScreen(id, b, { name: 'home', bp: 'Mobile' })
    act(() => root.render(createElement(ScreenSection, { docId: id, id: b })))
    expect(host.querySelector('[data-testid="screen-siblings"]')?.textContent).toContain('Desktop, Mobile (this)')
    commit(field('B'), '')
    expect(S().docs[id].nodes[b].dev?.screen).toBeUndefined()
    expect(S().docs[id].nodes[a].dev?.screen).toEqual({ name: 'Home', bp: 'Desktop' })
  })

  it('a custom breakpoint label is kept', () => {
    const f = frame('Wide', 1920)
    S().setScreen(id, f, { name: 'Home', bp: 'Ultra wide' })
    act(() => root.render(createElement(ScreenSection, { docId: id, id: f })))
    const label = field('Wide, Small tablet, 600')
    expect(label.value).toBe('Ultra wide')
    commit(label, 'Cinema')
    expect(S().docs[id].nodes[f].dev?.screen).toEqual({ name: 'Home', bp: 'Cinema' })
  })

  it('tagging is undoable and a refused (non top-level) tag changes nothing', () => {
    const f = frame('Home', 1280)
    const inner = S().createNode(id, { type: 'frame', name: 'Inner', style: { width: 10, height: 10 } }, f)
    expect(S().setScreen(id, inner, { name: 'X', bp: 'Mobile' })).toBe(false)
    S().setScreen(id, f, { name: 'Home', bp: 'Desktop' })
    S().undo(id)
    expect(S().docs[id].nodes[f].dev).toBeUndefined()
  })
})

describe('Min / Max size fields', () => {
  it('write min-width, max-width, min-height and max-height, and None or 0 removes them', () => {
    const f = frame('Card', 400)
    S().select(id, [f])
    act(() => root.render(createElement(Layout, { ids: [f] })))
    const fields = host.querySelectorAll('[data-testid="size-limits"] input')
    expect(fields).toHaveLength(4)
    commit(fields[0] as HTMLInputElement, '120')
    commit(fields[1] as HTMLInputElement, '640')
    commit(fields[2] as HTMLInputElement, '48')
    commit(fields[3] as HTMLInputElement, '900')
    const st = S().docs[id].nodes[f].style
    expect([st.minWidth, st.maxWidth, st.minHeight, st.maxHeight]).toEqual([120, 640, 48, 900])
    commit(fields[1] as HTMLInputElement, 'None')
    commit(fields[2] as HTMLInputElement, '0')
    const after = S().docs[id].nodes[f].style
    expect(after.maxWidth).toBeUndefined()
    expect(after.minHeight).toBeUndefined()
    expect(after.minWidth).toBe(120)
  })

  it('read back what is already in the style, px strings included, and the handoff sees it as a size limit', async () => {
    const f = frame('Card', 400)
    S().updateStyles(id, [f], { maxWidth: '480px', minWidth: 100 })
    act(() => root.render(createElement(Layout, { ids: [f] })))
    const values = [...host.querySelectorAll('[data-testid="size-limits"] input')].map((i) => (i as HTMLInputElement).value)
    expect(values).toEqual(['100', '480', '', ''])
    const { sizeRule } = await import('../../model/devSpec')
    expect(sizeRule(S().docs[id], f, 'w')).toMatchObject({ mode: 'fixed', value: 400, min: 100, max: 480 })
  })

  it('shows Mixed when the selection disagrees', () => {
    const a = frame('A', 100)
    const b = frame('B', 100)
    S().updateStyles(id, [a], { minWidth: 10 })
    S().updateStyles(id, [b], { minWidth: 20 })
    S().select(id, [a, b])
    act(() => root.render(createElement(Layout, { ids: [a, b] })))
    expect((host.querySelector('[data-testid="size-limits"] input') as HTMLInputElement).placeholder).toBe('Mixed')
  })
})
