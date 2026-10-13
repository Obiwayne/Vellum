// @vitest-environment jsdom
// T66: Dev Mode polish. A selected main component says so (badge and Component rows), and edit keys and drags
// say "read-only" instead of doing nothing silently.
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

vi.mock('../canvas/toast', () => ({ toast: vi.fn() }))

import { getStore, onEditRefused, useStore } from '../../model/store'
import { nodeSpec } from '../../model/devSpec'
import { devModeKey, isEditKey } from '../shortcuts'
import { DRAG_SLOP, refusalGate, refuseOnDrag } from './refuse'
import { SpecPanel } from './SpecPanel'
import { mainInfo, specSections } from './specView'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const S = getStore
let id: string
let refused: Mock<(docId: string) => void>
let off: () => void

const ev = (code: string, extra: Partial<KeyboardEvent> = {}) => ({
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  code,
  key: code.replace(/^Key/, '').toLowerCase(),
  ...extra
})

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true)
  id = S().createDoc('Dev', { open: false })
  refused = vi.fn<(docId: string) => void>()
  off = onEditRefused(refused)
})

/** a Button set with State=default|hover and a Label text property, plus an instance */
function button() {
  const root = S().docs[id].pages[0].rootId
  const main = S().createNode(id, { type: 'frame', name: 'Button', style: { width: 120, height: 40 } }, root)
  const label = S().createNode(id, { type: 'text', text: 'Buy', style: { fontSize: 14 } }, main)
  S().createComponent(id, [main])
  const variant = S().addVariant(id, main, undefined, 'Big')
  const set = S().docs[id].nodes[main].component!.set!
  const propId = S().addProp(id, main, { name: 'Label', type: 'text', default: 'Buy' })
  S().bindProp(id, label, 'text', propId)
  return { main, variant, set }
}

describe('main component rows', () => {
  it('a lone main lists its name, kind and properties', () => {
    const root = S().docs[id].pages[0].rootId
    const f = S().createNode(id, { type: 'frame', name: 'Card', style: { width: 10, height: 10 } }, root)
    S().createComponent(id, [f])
    const doc = S().docs[id]
    const info = mainInfo(doc, f)!
    expect(info).toMatchObject({ name: 'Card', variants: [], props: [] })
    const rows = specSections(nodeSpec(doc, f, { depth: 0 })!, info).find((s) => s.id === 'component')!.rows
    expect(rows).toEqual([
      { label: 'Component', value: 'Card' },
      { label: 'Kind', value: 'Component' }
    ])
  })

  it('a variant of a set shows its set, its value of each variant property and the other properties', () => {
    const { variant } = button()
    const doc = S().docs[id]
    const info = mainInfo(doc, variant)!
    expect(info.setName).toBe('Button')
    expect(info.props).toEqual([{ name: 'Label', type: 'text', default: 'Buy' }])
    expect(info.variants[0].options.length).toBeGreaterThan(1)
    const rows = specSections(nodeSpec(doc, variant, { depth: 0 })!, info).find((s) => s.id === 'component')!.rows
    expect(rows.find((r) => r.label === 'Kind')?.value).toBe('Component (variant of Button)')
    expect(rows.find((r) => r.label === 'Label')?.value).toBe('Buy (text property)')
  })

  it('a plain frame and an instance are not mains', () => {
    const root = S().docs[id].pages[0].rootId
    const f = S().createNode(id, { type: 'frame', name: 'Plain', style: { width: 10, height: 10 } }, root)
    expect(mainInfo(S().docs[id], f)).toBeNull()
    const { main } = button()
    const stage = S().createNode(id, { type: 'frame', name: 'Stage', style: { width: 400, height: 300 } }, root)
    const inst = S().createInstance(id, main, stage)
    expect(mainInfo(S().docs[id], inst)).toBeNull()
  })

  it('the panel header says Component for a main, Component set for a set and Instance for an instance', () => {
    const { main } = button()
    const root = S().docs[id].pages[0].rootId
    const stage = S().createNode(id, { type: 'frame', name: 'Stage', style: { width: 400, height: 300 } }, root)
    const inst = S().createInstance(id, main, stage)
    S().setDevMode(id, true)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const r = createRoot(host)
    const html = (sel: string): string => {
      S().select(id, [sel])
      act(() => r.render(createElement(SpecPanel, { docId: id })))
      return host.querySelector('.dev-head__type')?.textContent ?? ''
    }
    expect(html(main)).toBe('Component')
    const setId = S().docs[id].nodes[main].component!.set!
    expect(html(setId)).toBe('Component set')
    expect(html(inst)).toBe('Instance')
    expect(html(stage)).toBe('frame')
    expect(host.innerHTML).not.toContain('Component set')
    act(() => r.unmount())
  })
})

describe('component set rows', () => {
  it('a set frame lists its variant property with options, other properties, and its variants', () => {
    const { set } = button()
    const doc = S().docs[id]
    const info = mainInfo(doc, set)!
    expect(info.kind).toBe('set')
    expect(info.name).toBe('Button')
    expect(info.variants[0].options.length).toBeGreaterThan(1)
    expect(info.members).toHaveLength(2)
    expect(info.members?.map((m) => m.name)).toContain('Big')
    const rows = specSections(nodeSpec(doc, set, { depth: 0 })!, info).find((s) => s.id === 'component')!.rows
    expect(rows.find((r) => r.label === 'Kind')?.value).toBe('Component set (2 variants)')
    expect(rows.filter((r) => r.label === 'Variant')).toHaveLength(2)
    expect(rows.some((r) => /variant property/.test(r.label))).toBe(true)
    expect(rows.find((r) => r.label === 'Label')?.value).toBe('Buy (text property)')
  })

  it('a single main stays Component and its set is not mentioned', () => {
    const root = S().docs[id].pages[0].rootId
    const f = S().createNode(id, { type: 'frame', name: 'Chip', style: { width: 10, height: 10 } }, root)
    S().createComponent(id, [f])
    const info = mainInfo(S().docs[id], f)!
    expect(info.kind).toBe('component')
    expect(info.members).toBeUndefined()
  })
})

describe('edit keys in Dev Mode say it is read-only', () => {
  it('isEditKey classifies edit shortcuts and leaves navigation alone', () => {
    const edit = [
      ev('Delete', { key: 'Delete' }),
      ev('Backspace', { key: 'Backspace' }),
      ev('ArrowLeft', { key: 'ArrowLeft' }),
      ev('ArrowDown', { key: 'ArrowDown', shiftKey: true }),
      ev('KeyG', { ctrlKey: true }),
      ev('KeyG', { ctrlKey: true, shiftKey: true }),
      ev('KeyD', { ctrlKey: true }),
      ev('KeyX', { ctrlKey: true }),
      ev('KeyV', { ctrlKey: true }),
      ev('KeyB', { ctrlKey: true }),
      ev('KeyK', { ctrlKey: true, altKey: true }),
      ev('KeyF'),
      ev('KeyR'),
      ev('KeyT'),
      ev('KeyP'),
      ev('BracketRight'),
      ev('KeyL', { ctrlKey: true, shiftKey: true }),
      ev('KeyH', { ctrlKey: true, shiftKey: true }),
      ev('KeyA', { shiftKey: true }),
      ev('Digit5', { key: '5' })
    ]
    for (const e of edit) expect(isEditKey(e, true), `${e.code} ${JSON.stringify(e)}`).toBe(true)
    const nav = [
      ev('KeyV'),
      ev('KeyH'),
      ev('KeyC'),
      ev('Escape', { key: 'Escape' }),
      ev('Tab', { key: 'Tab' }),
      ev('KeyC', { ctrlKey: true }),
      ev('KeyA', { ctrlKey: true }),
      ev('Digit0', { ctrlKey: true, key: '0' }),
      ev('Digit1', { shiftKey: true, key: '!' }),
      ev('Equal', { key: '=' })
    ]
    for (const e of nav) expect(isEditKey(e, true), `${e.code}`).toBe(false)
  })

  it('keys that need a selection stay quiet when nothing is selected', () => {
    expect(isEditKey(ev('Delete', { key: 'Delete' }), false)).toBe(false)
    expect(isEditKey(ev('ArrowLeft', { key: 'ArrowLeft' }), false)).toBe(false)
    expect(isEditKey(ev('KeyF'), false)).toBe(true)
  })

  it('a held key (auto-repeat) is one attempt: only the first press tells the editor', () => {
    const root = S().docs[id].pages[0].rootId
    const f = S().createNode(id, { type: 'frame', name: 'F', style: { width: 10, height: 10 } }, root)
    S().select(id, [f])
    S().setDevMode(id, true)
    devModeKey(id, ev('Delete', { key: 'Delete' }))
    for (let i = 0; i < 20; i++) devModeKey(id, ev('Delete', { key: 'Delete', repeat: true }))
    expect(refused).toHaveBeenCalledTimes(1)
    off()
  })

  it('devModeKey tells the editor once per refused key, never for navigation, and changes nothing', () => {
    const root = S().docs[id].pages[0].rootId
    const f = S().createNode(id, { type: 'frame', name: 'F', style: { width: 10, height: 10 } }, root)
    S().select(id, [f])
    S().setDevMode(id, true)
    const doc = S().docs[id]
    expect(devModeKey(id, ev('Delete', { key: 'Delete' }))).toBe(false)
    expect(refused).toHaveBeenCalledTimes(1)
    expect(refused).toHaveBeenCalledWith(id)
    expect(devModeKey(id, ev('KeyG', { ctrlKey: true }))).toBe(false)
    expect(refused).toHaveBeenCalledTimes(2)
    expect(devModeKey(id, ev('KeyH'))).toBe(true)
    expect(refused).toHaveBeenCalledTimes(2)
    expect(S().docs[id]).toBe(doc)
    off()
  })
})

describe('drags in Dev Mode say it is read-only', () => {
  const move = (x: number, y: number): void => {
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y }))
  }
  const up = (): void => {
    window.dispatchEvent(new MouseEvent('pointerup'))
  }

  it('a click says nothing; moving past the slop says it once', () => {
    refuseOnDrag(id, { clientX: 100, clientY: 100 })
    move(100 + DRAG_SLOP - 1, 100)
    expect(refused).not.toHaveBeenCalled()
    up()
    move(300, 300)
    expect(refused).not.toHaveBeenCalled() // the press ended with the click
    refuseOnDrag(id, { clientX: 100, clientY: 100 })
    move(100 + DRAG_SLOP, 100)
    move(200, 200)
    expect(refused).toHaveBeenCalledTimes(1)
    expect(refused).toHaveBeenCalledWith(id)
    off()
  })
})

describe('toast throttle', () => {
  afterEach(() => vi.useRealTimers())

  it('lets one refusal through per second per document', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const gate = refusalGate()
    const shown: number[] = []
    for (let t = 0; t <= 2500; t += 100) {
      vi.setSystemTime(t)
      if (gate('a')) shown.push(t)
    }
    expect(shown).toEqual([0, 1000, 2000])
  })

  it('documents are throttled independently', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const gate = refusalGate()
    expect(gate('a')).toBe(true)
    expect(gate('b')).toBe(true)
    expect(gate('a')).toBe(false)
    vi.setSystemTime(999)
    expect(gate('a')).toBe(false)
    vi.setSystemTime(1000)
    expect(gate('a')).toBe(true)
  })

  it('the interval and clock can be injected', () => {
    let now = 0
    const gate = refusalGate(50, () => now)
    expect(gate('x')).toBe(true)
    now = 49
    expect(gate('x')).toBe(false)
    now = 50
    expect(gate('x')).toBe(true)
  })
})
