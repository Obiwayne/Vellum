// @vitest-environment jsdom
// The Design | Dev switch in the top bar: clicking Dev turns Dev Mode on for the doc (editor state only),
// clicking Design turns it off, and the inspector area then shows the Spec panel.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

vi.mock('../canvas/toast', () => ({ toast: vi.fn() }))
vi.mock('../../profile/profile', () => ({ useCurrentProfile: () => ({ name: 'Tester', color: '#4A5A6A' }) }))

import { getStore, useStore } from '../../model/store'
import { TopBar } from '../inspector/TopBar'
import { SpecPanel } from './SpecPanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let id: string
let host: HTMLDivElement
let root: Root

const click = (label: string): void => {
  const el = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)
  if (!el) throw new Error(`no ${label} button: ${host.innerHTML}`)
  act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true)
  id = getStore().createDoc('Dev', { open: false })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

describe('top bar Design | Dev switch', () => {
  it('Dev turns Dev Mode on, Design turns it off; the document is untouched', () => {
    act(() => root.render(createElement(TopBar, { docId: id })))
    const doc = getStore().docs[id]
    expect(getStore().editors[id].devMode).toBe(false)
    click('Dev')
    expect(getStore().editors[id].devMode).toBe(true)
    expect(host.querySelector('.insp-top--dev')).not.toBeNull()
    click('Design')
    expect(getStore().editors[id].devMode).toBe(false)
    expect(host.querySelector('.insp-top--dev')).toBeNull()
    expect(getStore().docs[id]).toBe(doc)
  })

  it('in Dev Mode the Spec panel renders for a frame, a text node and an instance with a click-to-copy row', async () => {
    const s = getStore()
    const rootId = s.docs[id].pages[0].rootId
    const main = s.createNode(id, { type: 'frame', name: 'Card', style: { width: 200, height: 100, backgroundColor: '#FFFFFF' } }, rootId)
    const text = s.createNode(id, { type: 'text', text: 'Hi', style: { fontSize: 18, fontWeight: 700 } }, main)
    s.createComponent(id, [main])
    const stage = s.createNode(id, { type: 'frame', name: 'Stage', style: { width: 400, height: 300 } }, rootId)
    const inst = s.createInstance(id, main, stage)
    s.setDevMode(id, true)
    const html = (sel: string): string => {
      s.select(id, [sel])
      act(() => root.render(createElement(SpecPanel, { docId: id })))
      return host.innerHTML
    }
    const frame = html(stage)
    expect(frame).toContain('Stage')
    expect(frame).toContain('Layout')
    expect(frame).not.toContain('Instance')
    const t = html(text)
    expect(t).toContain('Typography')
    expect(t).toContain('18px')
    const i = html(inst)
    expect(i).toContain('Instance')
    expect(i).toContain('Component')
    expect(i).toContain('Card')
    // every value row is a copy button
    expect(host.querySelectorAll('button.dev-row__main[title="Click to copy"]').length).toBeGreaterThan(3)
    // clicking a value row copies it to the clipboard
    const write = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true })
    const widthRow = [...host.querySelectorAll('button.dev-row__main')].find((b) => b.textContent?.startsWith('Width'))!
    await act(async () => {
      widthRow.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(write).toHaveBeenCalledWith(expect.stringMatching(/^\d+(\.\d+)?px$/))
    act(() => root.unmount())
  })
})
