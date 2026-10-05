// @vitest-environment jsdom
// Theme tab Styles view: text style list, create/rename/delete/edit-in-place, colour styles over tokens.
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getStore, useStore } from '../../model/store'
import { StylesPanel, parseStyleInput } from './StylesPanel'
import { colourSource, colourTokenName, groupColourStyles, groupTextStyles, previewStyle } from './styleUtils'

vi.mock('../canvas/toast', () => ({ toast: vi.fn() }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const S = getStore
let id: string
const doc = () => S().docs[id]
let host: HTMLDivElement
let root: Root
const onEditToken = vi.fn()

const render = (mode: string | null = null): void => act(() => root.render(createElement(StylesPanel, { docId: id, mode, onEditToken })))
const rootId = (): string => doc().pages[0].rootId
const text = (t = 'A') => S().createNode(id, { type: 'text', text: t }, rootId())
const section = (k: 'text' | 'colour'): HTMLElement => host.querySelector(`[data-styles="${k}"]`) as HTMLElement
const rows = (k: 'text' | 'colour'): string[] => [...section(k).querySelectorAll('.lp-style')].map((e) => e.querySelector('.lp-style__name')?.textContent ?? '')
const addBtn = (k: 'text' | 'colour'): HTMLButtonElement => section(k).querySelector('.lp-styles__head button') as HTMLButtonElement
const msg = (): string => host.querySelector('.lp-styles__msg')?.textContent ?? ''
const typeInto = (input: HTMLInputElement, v: string): void => {
  act(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    set.call(input, v)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
}

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true)
  id = S().createDoc('T', { open: true })
  onEditToken.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ''
})

describe('helpers', () => {
  it('groups text styles by the slash and puts ungrouped first', () => {
    const g = groupTextStyles([
      { id: '1', name: 'Heading/H1', style: {} },
      { id: '2', name: 'Body', style: {} },
      { id: '3', name: 'Heading/H2', style: {} }
    ])
    expect(g.map((x) => x.group)).toEqual(['', 'Heading'])
    expect(g[1].items.map((i) => i.label)).toEqual(['H1', 'H2'])
  })

  it('groups colour tokens by the first word after color- and skips other tokens', () => {
    const g = groupColourStyles([
      { name: '--color-brand-primary', value: '#f00' },
      { name: '--color-white', value: '#fff' },
      { name: '--text-lg', value: '18px' },
      { name: '--color-brand-accent', value: '#0f0' }
    ])
    expect(g.map((x) => x.group)).toEqual(['', 'brand'])
    expect(g[1].items.map((i) => i.label)).toEqual(['primary', 'accent'])
  })

  it('previewStyle caps a big size but keeps var() sizes; parseStyleInput types numbers', () => {
    expect(previewStyle({ fontSize: 64 }).fontSize).toBe(22)
    expect(previewStyle({ fontSize: 'var(--text-lg)' }).fontSize).toBe('var(--text-lg)')
    expect(parseStyleInput('fontSize', '48')).toBe(48)
    expect(parseStyleInput('fontSize', '48px')).toBe(48)
    expect(parseStyleInput('fontSize', 'var(--x)')).toBe('var(--x)')
    expect(parseStyleInput('lineHeight', '1.5')).toBe('1.5')
    expect(parseStyleInput('letterSpacing', '  ')).toBeNull()
  })

  it('colourSource: text colour for text, fill for frames, refuses tokens and empty selections', () => {
    const t = text()
    const f = S().createNode(id, { type: 'frame', style: { backgroundColor: '#336699' } }, rootId())
    expect(colourSource([doc().nodes[t]])).toMatchObject({ key: 'color', color: '#000000' })
    expect(colourSource([doc().nodes[f]])).toMatchObject({ key: 'backgroundColor', color: '#336699' })
    expect(colourSource([])).toHaveProperty('error')
    S().updateStyles(id, [f], { backgroundColor: 'var(--color-x)', borderColor: null })
    expect(colourSource([doc().nodes[f]])).toEqual({ error: 'That colour already is a style' })
    expect(colourTokenName('brand primary')).toBe('--color-brand-primary')
    expect(colourTokenName('--color-brand')).toBe('--color-brand')
  })
})

describe('text styles', () => {
  it('shows an empty hint, then a row per style with a live preview and its linked count', () => {
    render()
    expect(host.textContent).toContain('No text styles yet')
    const t = text()
    const sid = S().createTextStyle(id, 'Body', { fontSize: 18, fontWeight: 400 })
    S().applyTextStyle(id, [t], sid)
    render()
    expect(rows('text')).toEqual(['Body'])
    const prev = section('text').querySelector('.lp-style__preview') as HTMLElement
    expect(prev.style.fontSize).toBe('18px')
    expect(section('text').querySelector('.lp-style__count')?.textContent).toBe('1')
    expect(section('text').querySelector('.lp-style__caption')?.textContent).toBe('18 · Regular')
  })

  it('slash names are grouped under a heading', () => {
    S().createTextStyle(id, 'Heading/H1', { fontSize: 32 })
    S().createTextStyle(id, 'Heading/H2', { fontSize: 24 })
    S().createTextStyle(id, 'Body', { fontSize: 16 })
    render()
    expect(rows('text')).toEqual(['Body', 'H1', 'H2'])
    expect(section('text').textContent).toContain('Heading')
  })

  it('+ with one text selected creates a style from it, links the layer, in one undo step', () => {
    const t = text()
    S().updateStyles(id, [t], { fontSize: 30 })
    S().select(id, [t])
    render()
    act(() => addBtn('text').click())
    expect(doc().textStyles).toHaveLength(1)
    expect(doc().textStyles![0].style.fontSize).toBe(30)
    expect(doc().nodes[t].textStyle).toBe(doc().textStyles![0].id)
    expect(section('text').querySelector('.lp-inline-edit')).toBeTruthy() // name editor opens
    S().undo(id)
    expect(doc().textStyles ?? []).toHaveLength(0)
    expect(doc().nodes[t].textStyle).toBeUndefined()
  })

  it('+ with nothing selected adds a blank style; names stay unique', () => {
    render()
    act(() => addBtn('text').click())
    act(() => addBtn('text').click())
    expect(doc().textStyles!.map((s) => s.name)).toEqual(['Text style', 'Text style 2'])
  })

  it('renaming to a name that exists is refused with a message', () => {
    S().createTextStyle(id, 'Body', { fontSize: 16 })
    const b = S().createTextStyle(id, 'Other', { fontSize: 16 })
    render()
    const row = section('text').querySelector(`[data-text-style-id="${b}"]`) as HTMLElement
    act(() => row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    typeInto(section('text').querySelector('.lp-inline-edit') as HTMLInputElement, 'body')
    expect(msg()).toContain('already exists')
    expect(doc().textStyles!.map((s) => s.name)).toEqual(['Body', 'Other'])
  })

  it('the context menu deletes a style; linked layers keep their values', () => {
    const t = text()
    const sid = S().createTextStyle(id, 'Body', { fontSize: 20 })
    S().applyTextStyle(id, [t], sid)
    render()
    const row = section('text').querySelector(`[data-text-style-id="${sid}"]`) as HTMLElement
    act(() => row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 })))
    const del = [...document.querySelectorAll('[role="menuitem"]')].find((e) => e.textContent === 'Delete') as HTMLElement
    act(() => del.click())
    expect(doc().textStyles).toEqual([])
    expect(doc().nodes[t].textStyle).toBeUndefined()
    expect(doc().nodes[t].style.fontSize).toBe(20)
    S().undo(id)
    expect(doc().textStyles).toHaveLength(1)
    expect(doc().nodes[t].textStyle).toBe(sid)
  })

  it('edit in place: changing Size to 48 updates every linked layer in one undo step', () => {
    const a = text('A')
    const b = text('B')
    const sid = S().createTextStyle(id, 'Body', { fontSize: 16 })
    S().applyTextStyle(id, [a, b], sid)
    render()
    const row = section('text').querySelector(`[data-text-style-id="${sid}"]`) as HTMLElement
    act(() => row.click())
    const field = [...document.querySelectorAll('.lp-style-editor .lp-token-editor__field')].find((e) => e.textContent?.startsWith('Size')) as HTMLElement
    typeInto(field.querySelector('input') as HTMLInputElement, '48')
    expect(doc().nodes[a].style.fontSize).toBe(48)
    expect(doc().nodes[b].style.fontSize).toBe(48)
    expect(doc().textStyles![0].style.fontSize).toBe(48)
    S().undo(id)
    expect(doc().nodes[a].style.fontSize).toBe(16)
    expect(doc().nodes[b].style.fontSize).toBe(16)
    expect(doc().textStyles![0].style.fontSize).toBe(16)
  })

  it('Apply to selection links the selected text layers', () => {
    const a = text('A')
    const sid = S().createTextStyle(id, 'Body', { fontSize: 33 })
    S().select(id, [a])
    render()
    const row = section('text').querySelector(`[data-text-style-id="${sid}"]`) as HTMLElement
    act(() => row.click())
    const apply = [...document.querySelectorAll('.lp-style-editor button')].find((e) => e.textContent === 'Apply to selection') as HTMLElement
    act(() => apply.click())
    expect(doc().nodes[a].textStyle).toBe(sid)
    expect(doc().nodes[a].style.fontSize).toBe(33)
  })
})

describe('colour styles', () => {
  const tokenize = (name: string, value: string, modes?: Record<string, string>): void => S().upsertTokens(id, [{ name, value, modes }])
  const name = (v: string): void => typeInto(section('colour').querySelector('.lp-style__new-input') as HTMLInputElement, v)

  it('lists colour tokens only, with a swatch and the value; clicking a row opens the token editor', () => {
    tokenize('--color-brand-primary', '#ff0000')
    tokenize('--text-lg', '18px')
    render()
    expect(rows('colour')).toEqual(['primary'])
    expect(section('colour').querySelector('.lp-style__caption')?.textContent).toBe('#ff0000')
    act(() => (section('colour').querySelector('[data-colour-style]') as HTMLElement).click())
    expect(onEditToken).toHaveBeenCalledWith('--color-brand-primary', expect.anything())
  })

  it('shows one swatch per theme mode and the value of the viewed mode', () => {
    S().addMode(id, 'Dark')
    tokenize('--color-bg', '#ffffff', { Dark: '#111111' })
    const modes = doc().modes!
    render(modes[1])
    expect(section('colour').querySelectorAll('.lp-style__swatch')).toHaveLength(2)
    expect(section('colour').querySelector('.lp-style__caption')?.textContent).toBe('#111111')
    render(modes[0])
    expect(section('colour').querySelector('.lp-style__caption')?.textContent).toBe('#ffffff')
  })

  it('creates a colour style from the selected fill in one undo step and points the fill at it', () => {
    const f = S().createNode(id, { type: 'frame', style: { backgroundColor: '#336699' } }, rootId())
    S().select(id, [f])
    render()
    act(() => addBtn('colour').click())
    name('brand primary')
    expect(doc().tokens.find((t) => t.name === '--color-brand-primary')?.value.toLowerCase()).toBe('#336699')
    expect(doc().nodes[f].style.backgroundColor).toBe('var(--color-brand-primary)')
    S().undo(id)
    expect(doc().tokens.some((t) => t.name === '--color-brand-primary')).toBe(false)
    expect(doc().nodes[f].style.backgroundColor).toBe('#336699')
  })

  it('refuses a duplicate name with a message and changes nothing', () => {
    tokenize('--color-brand', '#ff0000')
    const f = S().createNode(id, { type: 'frame', style: { backgroundColor: '#336699' } }, rootId())
    S().select(id, [f])
    render()
    act(() => addBtn('colour').click())
    name('brand')
    expect(msg()).toContain('"brand" already exists')
    expect(doc().tokens).toHaveLength(1)
    expect(doc().nodes[f].style.backgroundColor).toBe('#336699')
  })

  it('says why when nothing usable is selected', () => {
    render()
    act(() => addBtn('colour').click())
    name('x')
    expect(msg()).toContain('Select a layer')
    expect(doc().tokens).toHaveLength(0)
  })
})

describe('test station: adversarial', () => {
  const name = (v: string): void => typeInto(section('colour').querySelector('.lp-style__new-input') as HTMLInputElement, v)

  it('a colour style from a text layer saves its text colour and links only that field', () => {
    const t = text()
    S().updateStyles(id, [t], { color: '#aa0000', backgroundColor: '#00aa00' })
    S().select(id, [t])
    render()
    act(() => addBtn('colour').click())
    name('ink')
    expect(doc().nodes[t].style.color).toBe('var(--color-ink)')
    expect(doc().nodes[t].style.backgroundColor).toBe('#00aa00')
    expect(doc().tokens[0].value.toLowerCase()).toBe('#aa0000')
  })

  it('an invalid name is refused and nothing is created', () => {
    const f = S().createNode(id, { type: 'frame', style: { backgroundColor: '#336699' } }, rootId())
    S().select(id, [f])
    render()
    act(() => addBtn('colour').click())
    name('!!!')
    expect(msg().length).toBeGreaterThan(0)
    expect(doc().tokens).toHaveLength(0)
    expect(doc().nodes[f].style.backgroundColor).toBe('#336699')
  })

  it('deleting from the editor removes the style and unlinks; undo brings both back', () => {
    const t = text()
    const sid = S().createTextStyle(id, 'Body', { fontSize: 20 })
    S().applyTextStyle(id, [t], sid)
    render()
    act(() => (section('text').querySelector(`[data-text-style-id="${sid}"]`) as HTMLElement).click())
    const del = [...document.querySelectorAll('.lp-style-editor button')].find((e) => e.textContent === 'Delete style') as HTMLElement
    act(() => del.click())
    expect(doc().textStyles).toEqual([])
    expect(doc().nodes[t].textStyle).toBeUndefined()
    S().undo(id)
    expect(doc().nodes[t].textStyle).toBe(sid)
  })

  it('clearing a field in the editor removes that key from the style and the layers', () => {
    const t = text()
    const sid = S().createTextStyle(id, 'Body', { fontSize: 20, letterSpacing: '2px' })
    S().applyTextStyle(id, [t], sid)
    render()
    act(() => (section('text').querySelector(`[data-text-style-id="${sid}"]`) as HTMLElement).click())
    const field = [...document.querySelectorAll('.lp-style-editor .lp-token-editor__field')].find((e) => e.textContent?.startsWith('Spacing')) as HTMLElement
    typeInto(field.querySelector('input') as HTMLInputElement, '')
    expect(doc().textStyles![0].style.letterSpacing).toBeUndefined()
    expect(doc().nodes[t].style.letterSpacing).toBeUndefined()
    expect(doc().nodes[t].style.fontSize).toBe(20)
  })

  it('a style edit in the panel does not detach other layers and new styles render without a selection', () => {
    render()
    expect(host.querySelector('.lp-styles__msg')).toBeNull()
    act(() => addBtn('colour').click())
    name('x')
    expect(msg()).toContain('Select a layer')
    act(() => addBtn('text').click())
    expect(msg()).toBe('') // a successful action clears the message
  })
})
