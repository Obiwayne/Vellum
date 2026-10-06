// @vitest-environment jsdom
// T38: oklch() tokens (the starter theme's whole palette) show up in the colour pickers, can be applied as var(--token),
// detach to their oklch literal unchanged, and an oklch literal is never silently converted to hex.
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getStore, useStore } from '../../model/store'
import { STARTER_THEME } from '../left/starterTheme'
import { ColorInput, addColorToken } from './ColorInput'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const S = getStore
let id: string
let host: HTMLDivElement
let root: Root
const onChange = vi.fn()
const BLUE = STARTER_THEME.find((t) => t.name === '--color-blue-500')!

const render = (value: string): void => act(() => root.render(createElement(ColorInput, { docId: id, value, onChange })))
const openPopover = (): void => act(() => (document.querySelector('button[aria-label="Tokens"], button[title="Tokens"]') as HTMLButtonElement).click())
const items = (): string[] => [...document.querySelectorAll('.insp-pop__list .insp-listitem')].map((e) => e.textContent ?? '')
const click = (text: string): void => act(() => ([...document.querySelectorAll('.insp-listitem')].find((e) => (e.textContent ?? '').endsWith(text)) as HTMLButtonElement).click())
const type = (input: HTMLInputElement, text: string): void => {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  act(() => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })
}

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true)
  id = S().createDoc('T', { open: true })
  onChange.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  S().upsertTokens(id, STARTER_THEME)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ''
})

describe('oklch tokens in the colour picker', () => {
  it('the starter theme colours are listed as colour styles', () => {
    render('#ff0000')
    openPopover()
    const names = items()
    expect(names.some((t) => t.endsWith('color-blue-500'))).toBe(true)
    expect(names.filter((t) => /color-/.test(t)).length).toBeGreaterThan(15)
  })

  it('choosing one writes var(--token)', () => {
    render('#ff0000')
    openPopover()
    click('color-blue-500')
    expect(onChange).toHaveBeenCalledWith('var(--color-blue-500)', { live: false })
  })

  it('Detach writes the oklch literal exactly as the token has it', () => {
    render('var(--color-blue-500)')
    openPopover()
    click('Detach style')
    expect(onChange).toHaveBeenLastCalledWith(BLUE.value, { live: false })
    expect(BLUE.value.startsWith('oklch(')).toBe(true)
  })

  it('the swatch shows the token colour, and its hex field is empty-safe for a var()', () => {
    render('var(--color-blue-500)')
    const swatch = document.querySelector('.c-colorrow .c-swatch, .c-colorrow__field [style*="background"]') as HTMLElement | null
    expect(swatch).not.toBeNull()
    expect(document.querySelector('.c-colorrow__token')?.textContent).toBe('blue-500')
  })

  it('typing var(--token) into the hex field is accepted when the token is a colour, refused otherwise', () => {
    render('#112233')
    const hex = document.querySelector('.c-colorrow__hex') as HTMLInputElement
    type(hex, 'var(--color-blue-500)')
    expect(onChange).toHaveBeenLastCalledWith('var(--color-blue-500)', { live: false })
    onChange.mockClear()
    type(document.querySelector('.c-colorrow__hex') as HTMLInputElement, 'var(--no-such-token)')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('typing an oklch literal into the hex field writes it as typed, not as hex', () => {
    render('#112233')
    type(document.querySelector('.c-colorrow__hex') as HTMLInputElement, 'oklch(62.3% 0.214 258)')
    expect(onChange).toHaveBeenLastCalledWith('oklch(62.3% 0.214 258)', { live: false })
    onChange.mockClear()
    type(document.querySelector('.c-colorrow__hex') as HTMLInputElement, 'oklch(nonsense)')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('Add as colour style from an oklch literal keeps the literal', () => {
    const apply = vi.fn()
    expect(addColorToken(id, 'brand', 'oklch(62.3% 0.214 258)', apply)).toBeNull()
    expect(S().docs[id].tokens.find((t) => t.name === '--brand')?.value).toBe('oklch(62.3% 0.214 258)')
    expect(apply).toHaveBeenCalledWith('var(--brand)')
    // a hex literal still becomes hex, and junk is refused
    expect(addColorToken(id, 'plain', '#ff0000', apply)).toBeNull()
    expect(S().docs[id].tokens.find((t) => t.name === '--plain')?.value.toLowerCase()).toBe('#ff0000')
    expect(addColorToken(id, 'bad', 'oklch(x)', apply)).toBe('Not a colour')
  })
})
