// @vitest-environment jsdom
// Test-station checks for colour styles in colour fields (T30): alias chains per mode, cycles, missing tokens,
// nested mode frames, swatches, search order, and one undo step for "Add as colour style".
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getStore, useStore } from '../../model/store'
import { ColorInput, addColorToken, resolveTokenInMode } from './ColorInput'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const S = getStore
let id: string
let host: HTMLDivElement
let root: Root
const onChange = vi.fn()
const doc = () => S().docs[id]

const render = (value: string, nodeId?: string): void => act(() => root.render(createElement(ColorInput, { docId: id, nodeId, value, onChange })))
const openPopover = (): void => act(() => (document.querySelector('button[aria-label="Tokens"], button[title="Tokens"]') as HTMLButtonElement).click())
const items = (): string[] => [...document.querySelectorAll('.insp-pop__list .insp-listitem')].map((e) => e.textContent ?? '')
const click = (text: string): void => act(() => ([...document.querySelectorAll('.insp-listitem')].find((e) => e.textContent === text) as HTMLButtonElement).click())

const moded = (parent: string, mode: string, type: 'frame' | 'rect' = 'frame'): string => {
  const n = S().createNode(id, { type }, parent)
  S().mutate(id, 'mode', (d) => {
    d.nodes[n].attrs = { ...(d.nodes[n].attrs ?? {}), 'data-mode': mode }
  })
  return n
}

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true)
  id = S().createDoc('T', { open: true })
  onChange.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  S().addMode(id, 'Dark')
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ''
})

describe('Detach resolves per mode', () => {
  it('a three-level alias chain follows the mode at every step', () => {
    S().upsertTokens(id, [
      { name: '--color-a', value: '#111111', modes: { Dark: '#eeeeee' } },
      { name: '--color-b', value: 'var(--color-a)' },
      { name: '--color-c', value: 'var(--color-b)' }
    ])
    const frame = moded(doc().pages[0].rootId, 'Dark')
    const kid = S().createNode(id, { type: 'rect' }, frame)
    render('var(--color-c)', kid)
    openPopover()
    click('Detach style')
    expect(onChange).toHaveBeenLastCalledWith('#eeeeee', { live: false })
  })

  it('an alias whose own Dark value points elsewhere uses that value', () => {
    S().upsertTokens(id, [
      { name: '--color-a', value: '#111111' },
      { name: '--color-z', value: '#222222' },
      { name: '--color-b', value: 'var(--color-a)', modes: { Dark: 'var(--color-z)' } }
    ])
    expect(resolveTokenInMode(doc(), '--color-b', 'Dark')).toBe('#222222')
    expect(resolveTokenInMode(doc(), '--color-b', null)).toBe('#111111')
  })

  it('nested frames: the nearest mode wins, and a layer\'s own mode beats its Dark ancestor', () => {
    S().upsertTokens(id, [{ name: '--color-ink', value: '#111111', modes: { Dark: '#eeeeee' } }])
    const dark = moded(doc().pages[0].rootId, 'Dark')
    const inner = S().createNode(id, { type: 'frame' }, dark)
    const deep = S().createNode(id, { type: 'rect' }, inner)
    render('var(--color-ink)', deep)
    openPopover()
    click('Detach style')
    expect(onChange).toHaveBeenLastCalledWith('#eeeeee', { live: false })
    act(() => root.unmount())
    host.remove()
    document.body.innerHTML = ''
    onChange.mockClear()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    const light = moded(dark, 'Light', 'rect')
    render('var(--color-ink)', light)
    openPopover()
    click('Detach style')
    expect(onChange).toHaveBeenLastCalledWith('#111111', { live: false })
  })

  it('a deleted token still offers Detach and writes a safe fallback colour', () => {
    S().upsertTokens(id, [{ name: '--color-ink', value: '#111111' }])
    S().removeToken(id, '--color-ink')
    render('var(--color-ink)')
    openPopover()
    click('Detach style')
    expect(onChange).toHaveBeenLastCalledWith('#000000', { live: false })
  })

  // Defect reported to the builder (gus): with circular aliases Detach writes the leftover var(--...) string as the
  // colour. Drop `.fails` once Detach falls back to a real colour (e.g. #000000) when the value is still a reference.
  it.fails('circular aliases terminate, and Detach never writes a var() string as the colour', () => {
    S().upsertTokens(id, [
      { name: '--color-x', value: 'var(--color-y)' },
      { name: '--color-y', value: 'var(--color-x)' }
    ])
    expect(() => resolveTokenInMode(doc(), '--color-x', 'Dark')).not.toThrow()
    render('var(--color-x)')
    openPopover()
    click('Detach style')
    const written = String(onChange.mock.calls.at(-1)?.[0])
    expect(written).not.toMatch(/var\(/)
  })
})

describe('listing and swatches', () => {
  it('swatches show the colour in the layer\'s mode', () => {
    S().upsertTokens(id, [{ name: '--color-ink', value: '#111111', modes: { Dark: '#eeeeee' } }])
    const frame = moded(doc().pages[0].rootId, 'Dark')
    const kid = S().createNode(id, { type: 'rect' }, frame)
    render('#ff0000', kid)
    openPopover()
    const sw = document.querySelector('.insp-pop__list .c-swatch span') as HTMLElement
    expect(sw.style.background.toLowerCase()).toMatch(/#eeeeee|rgb\(238, 238, 238\)/)
  })

  it('search keeps styles before other tokens and matches without the leading dashes', () => {
    S().upsertTokens(id, Array.from({ length: 8 }, (_, i) => ({ name: `--color-pad${i}`, value: '#101010' })))
    S().upsertTokens(id, [
      { name: '--brand', value: '#0000ff' },
      { name: '--color-brand-dark', value: '#000088' },
      { name: '--color-brand-light', value: '#8888ff' },
      { name: '--color-other', value: '#123456' }
    ])
    render('#ff0000')
    openPopover()
    act(() => {
      const input = document.querySelector('.insp-pop input') as HTMLInputElement
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'brand')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(items().map((t) => t.replace(/^\s+/, ''))).toEqual(['color-brand-dark', 'color-brand-light', 'brand'])
  })

  it('tokens that are not colours are not listed', () => {
    S().upsertTokens(id, [
      { name: '--text-lg', value: '18px' },
      { name: '--color-ink', value: '#111111' },
      { name: '--color-broken', value: 'not a colour' }
    ])
    render('#ff0000')
    openPopover()
    expect(items().join('|')).toContain('color-ink')
    expect(items().join('|')).not.toContain('text-lg')
    expect(items().join('|')).not.toContain('color-broken')
  })
})

describe('Add as colour style is one undo step', () => {
  it('the token and the reference written through apply come back together', () => {
    const frame = S().createNode(id, { type: 'frame', style: { backgroundColor: '#ff0000' } }, doc().pages[0].rootId)
    const err = addColorToken(id, '--color-brand', '#ff0000', (ref) => S().updateStyles(id, [frame], { backgroundColor: ref }))
    expect(err).toBeNull()
    expect(doc().tokens.some((t) => t.name === '--color-brand')).toBe(true)
    expect(doc().nodes[frame].style.backgroundColor).toBe('var(--color-brand)')
    S().undo(id)
    expect(doc().tokens.some((t) => t.name === '--color-brand')).toBe(false)
    expect(doc().nodes[frame].style.backgroundColor).toBe('#ff0000')
  })

  it('a taken name is refused and nothing changes; names are normalised', () => {
    S().upsertTokens(id, [{ name: '--color-brand', value: '#111111' }])
    const before = JSON.stringify(doc().tokens)
    const apply = vi.fn()
    expect(addColorToken(id, 'color-brand', '#ff0000', apply)).toBe('Name already used')
    expect(apply).not.toHaveBeenCalled()
    expect(JSON.stringify(doc().tokens)).toBe(before)
  })
})
