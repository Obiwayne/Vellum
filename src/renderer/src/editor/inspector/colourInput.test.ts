// @vitest-environment jsdom
// ColorInput popover: colour styles listed first, choosing one writes var(--token), Detach writes the colour of the
// theme mode in effect at the layer, "Add as colour style" makes a --color-* token.
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getStore, useStore } from '../../model/store'
import { ColorInput } from './ColorInput'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const S = getStore
let id: string
let host: HTMLDivElement
let root: Root
const onChange = vi.fn()

const render = (value: string, nodeId?: string): void =>
  act(() => root.render(createElement(ColorInput, { docId: id, nodeId, value, onChange })))
const openPopover = (): void => act(() => (document.querySelector('button[aria-label="Tokens"], button[title="Tokens"]') as HTMLButtonElement).click())
const items = (): string[] => [...document.querySelectorAll('.insp-pop__list .insp-listitem')].map((e) => e.textContent ?? '')
const click = (text: string): void =>
  act(() => ([...document.querySelectorAll('.insp-listitem')].find((e) => e.textContent === text) as HTMLButtonElement).click())

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true)
  id = S().createDoc('T', { open: true })
  onChange.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  S().upsertTokens(id, [
    { name: '--bg', value: '#ffffff' },
    { name: '--color-ink', value: '#111111' }
  ])
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ''
})

describe('ColorInput colour styles', () => {
  it('lists --color-* styles before other tokens, and choosing one writes var()', () => {
    render('#ff0000')
    openPopover()
    expect(items().slice(-2).map((t) => t.replace(/^.*?(color-ink|bg)$/, '$1'))).toEqual(['color-ink', 'bg'])
    click('color-ink')
    expect(onChange).toHaveBeenCalledWith('var(--color-ink)', { live: false })
  })

  it('Detach writes the literal for the layer\'s theme mode', () => {
    S().addMode(id, 'Dark')
    S().setTokenValue(id, '--color-ink', 'Dark', '#eeeeee')
    const frame = S().createNode(id, { type: 'frame' }, S().docs[id].pages[0].rootId)
    S().mutate(id, 'mode', (d) => {
      d.nodes[frame].attrs = { ...(d.nodes[frame].attrs ?? {}), 'data-mode': 'Dark' }
    })
    const child = S().createNode(id, { type: 'rect' }, frame)
    render('var(--color-ink)', child)
    openPopover()
    click('Detach style')
    expect(onChange).toHaveBeenLastCalledWith('#eeeeee', { live: false })
  })

  it('Detach without a layer writes the base value', () => {
    S().addMode(id, 'Dark')
    S().setTokenValue(id, '--color-ink', 'Dark', '#eeeeee')
    render('var(--color-ink)')
    openPopover()
    click('Detach style')
    expect(onChange).toHaveBeenLastCalledWith('#111111', { live: false })
  })

  it('Add as colour style creates a --color-* token and writes var()', () => {
    render('#ff0000')
    openPopover()
    click('Add as colour style')
    act(() => (document.querySelector('.insp-newtoken__ok') as HTMLButtonElement).click())
    expect(S().docs[id].tokens.some((t) => t.name === '--color-1' && t.value.toLowerCase() === '#ff0000')).toBe(true)
    expect(onChange).toHaveBeenCalledWith('var(--color-1)', { live: false })
  })
})
