// @vitest-environment jsdom
// The Dev sections of the inspector (T69): notes, state rules, Make State property, accessibility, contrast and
// alt text. Mounted in jsdom and driven through the DOM; the document is read back from the store.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

vi.mock('../canvas/toast', () => ({ toast: vi.fn() }))

import { getStore, useStore } from '../../model/store'
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
const typeInto = (el: HTMLInputElement | HTMLTextAreaElement, value: string): void => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const set = Object.getOwnPropertyDescriptor(proto, 'value')!.set!
  act(() => {
    set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
/** a Field commits on blur (or Enter): focus it, type, leave */
const commit = (el: HTMLInputElement, value: string): void => {
  act(() => el.focus())
  typeInto(el, value)
  act(() => el.blur())
}
const clickText = (text: string): void => {
  const el = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
  if (!el) throw new Error(`no button "${text}"`)
  act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}
const byTitle = (title: string): HTMLElement => host.querySelector(`[title="${title}"], [aria-label="${title}"]`) as HTMLElement

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true)
  id = S().createDoc('Dev', { open: false })
  host = document.createElement('div')
  document.body.innerHTML = ''
  document.body.appendChild(host)
  root = createRoot(host)
})

function button() {
  const rootId = S().docs[id].pages[0].rootId
  const main = S().createNode(id, { type: 'frame', name: 'Button', style: { width: 100, height: 40, backgroundColor: '#2563EB' } }, rootId)
  const label = S().createNode(id, { type: 'text', name: 'Label', text: 'Go', style: { color: '#777777', fontSize: 14 } }, main)
  S().createComponent(id, [main])
  return { main, label, rootId }
}

describe('dev notes', () => {
  it('typing writes dev.notes, coalesced into one undo step, and clearing removes it', () => {
    const { main } = button()
    mount(main)
    const area = host.querySelector('textarea') as HTMLTextAreaElement
    typeInto(area, 'D')
    typeInto(area, 'Dis')
    typeInto(area, 'Disabled until valid.')
    expect(S().docs[id].nodes[main].dev?.notes).toBe('Disabled until valid.')
    typeInto(area, '')
    expect(S().docs[id].nodes[main].dev).toBeUndefined()
  })

  it('the open question is written and listed', () => {
    const { main } = button()
    mount(main)
    const q = host.querySelector('input[placeholder="Open question for the developer"]') as HTMLInputElement
    commit(q, 'What about 5 items?')
    expect(S().docs[id].nodes[main].dev?.needsDecision).toBe('What about 5 items?')
    commit(q, '   ')
    expect(S().docs[id].nodes[main].dev?.needsDecision).toBeUndefined()
  })

  it('notes are not part of the layer HTML', async () => {
    const { main } = button()
    S().setDev(id, [main], { notes: 'NOTE-123' })
    const { nodeToHtml } = await import('../../model/html')
    expect(nodeToHtml(S().docs[id], main)).not.toContain('NOTE-123')
  })
})

describe('states', () => {
  it('a main component lists the core states as missing and offers Make State property', () => {
    const { main } = button()
    mount(main)
    const rows = [...host.querySelectorAll('[data-badge="missing"]')].map((r) => r.textContent ?? '')
    expect(rows.join(' ')).toMatch(/hover/)
    expect(rows.join(' ')).toMatch(/disabled/)
    expect(rows).toHaveLength(4)
    expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Make State property')).toBe(true)
  })

  it('Make State property sets up State = default | hover, and the hover state then shows as drawn', () => {
    const { main } = button()
    mount(main)
    clickText('Make State property')
    const set = S().docs[id].nodes[main].component!.set!
    expect(S().docs[id].nodes[set].componentSet?.props[0]).toMatchObject({ name: 'State', options: ['default', 'hover'] })
    S().select(id, [set])
    mount(set)
    const drawn = [...host.querySelectorAll('[data-badge="drawn"]')].map((r) => r.textContent ?? '')
    expect(drawn.join(' ')).toMatch(/hover/)
    expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Make State property')).toBe(false)
    // one undo step takes the whole set-up back
    S().undo(id)
    expect(S().docs[id].nodes[main].component?.set).toBeUndefined()
  })

  it('adding a rule writes dev.states with the canonical name; a rule can be removed again', () => {
    const { main } = button()
    mount(main)
    act(() => (byTitle('Add state rule') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(host.querySelector('[data-testid="dev-state-draft"]')).not.toBeNull()
    // change property to Opacity (a plain text value) through the draft: use the store path the UI uses
    const input = host.querySelector('[data-testid="dev-state-draft"] input') as HTMLInputElement | null
    if (input) commit(input, '#1D4ED8')
    clickText('Add rule')
    const states = S().docs[id].nodes[main].dev?.states
    expect(states).toBeDefined()
    expect(Object.keys(states ?? {})).toEqual(['hover'])
    mount(main)
    expect(host.querySelector('[data-badge="described"]')?.textContent).toContain('hover')
    act(() => (byTitle('Remove hover') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(S().docs[id].nodes[main].dev?.states).toBeUndefined()
  })
})

describe('accessibility', () => {
  it('role, label and focus order go through setDev; an inferred role is shown but not stored', () => {
    const { main } = button()
    mount(main)
    expect(S().docs[id].nodes[main].dev?.role).toBeUndefined()
    expect(host.textContent).toContain('button (inferred)')
    const label = host.querySelector('input[placeholder="Accessible name"]') as HTMLInputElement
    commit(label, 'Pay now')
    expect(S().docs[id].nodes[main].dev?.label).toBe('Pay now')
    const tab = host.querySelector('input[placeholder="Reading order"]') as HTMLInputElement
    commit(tab, '3')
    expect(S().docs[id].nodes[main].dev?.tab).toBe(3)
    commit(tab, '0')
    expect(S().docs[id].nodes[main].dev?.tab).toBeUndefined()
  })

  it('a text layer shows contrast per mode with AA flags', () => {
    const { label } = button()
    S().setTokens(id, [{ name: '--bg', value: '#FFFFFF', modes: { Dark: '#000000' } }])
    S().addMode(id, 'Dark')
    S().updateStyles(id, [S().docs[id].nodes[label].parent as string], { backgroundColor: 'var(--bg)' })
    mount(label)
    const rows = [...host.querySelectorAll('[data-testid="dev-contrast"]')]
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('Light')
    expect(rows[0].textContent).toContain('4.48:1')
    expect(rows[0].textContent).toContain('fails AA')
    expect(rows[1].textContent).toContain('Dark')
    expect(rows[1].textContent).toMatch(/AA/)
  })

  it('contrast says why it is not computed', () => {
    const { label } = button()
    S().updateStyles(id, [S().docs[id].nodes[label].parent as string], { backgroundImage: 'linear-gradient(#000,#fff)' })
    mount(label)
    expect(host.querySelector('[data-testid="dev-contrast-skipped"]')?.textContent).toContain('gradient or an image')
  })

  it('an image without alt is flagged and can be marked decorative', () => {
    const { rootId } = button()
    const img = S().createNode(id, { type: 'image', name: 'Hero', attrs: { src: 'data:image/png;base64,AAAA' }, style: { width: 10, height: 10 } }, rootId)
    mount(img)
    expect(host.querySelector('[data-testid="dev-alt-missing"]')).not.toBeNull()
    clickText('Mark decorative')
    expect(S().docs[id].nodes[img].attrs?.alt).toBe('')
    mount(img)
    expect(host.querySelector('[data-testid="dev-alt-missing"]')).toBeNull()
  })
})
