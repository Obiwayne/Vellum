import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../canvas/toast', () => ({ toast: vi.fn() }))

import { getStore, useStore } from '../../model/store'
import { nodeSpec } from '../../model/devSpec'
import { codeFor } from '../canvas/codegen'
import { devModeKey } from '../shortcuts'
import { pageSummary } from './pageSummary'
import { sizeText, specSections } from './specView'

const S = getStore
let id: string
const key = (code: string, extra: Partial<Parameters<typeof devModeKey>[1]> = {}) =>
  devModeKey(id, { ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, code, key: code.replace('Key', '').toLowerCase(), ...extra })

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true)
  id = S().createDoc('Dev', { open: false })
})

function card() {
  const root = S().docs[id].pages[0].rootId
  const f = S().createNode(
    id,
    { type: 'frame', name: 'Card', style: { display: 'flex', flexDirection: 'column', gap: 12, padding: 16, width: 320, height: 'fit-content', backgroundColor: 'var(--c)' } },
    root
  )
  const t = S().createNode(id, { type: 'text', text: 'Title', style: { fontSize: 20, fontWeight: 600, color: '#111111' } }, f)
  S().setTokens(id, [{ name: '--c', value: '#2563EB', modes: { Dark: '#60A5FA' } }])
  S().addMode(id, 'Dark')
  return { f, t }
}

describe('Spec rows', () => {
  it('box, layout intent, fill with token and per-mode values', () => {
    const { f } = card()
    const spec = nodeSpec(S().docs[id], f, { depth: 0 })!
    const sections = specSections(spec)
    const by = Object.fromEntries(sections.map((s) => [s.id, s]))
    expect(by.box.rows.find((r) => r.label === 'Width')?.value).toBe('320px')
    const layout = Object.fromEntries(by.layout.rows.map((r) => [r.label, r.value]))
    expect(layout.Direction).toBe('Column')
    expect(layout.Gap).toBe('12px')
    expect(layout.Padding).toBe('16px')
    expect(layout['Width rule']).toBe('320px')
    expect(layout['Height rule']).toBe('Fit')
    const fill = by.fills.rows[0]
    expect(fill.token).toBe('--c')
    expect(fill.value).toBe('#2563EB')
    expect(fill.copy).toBe('#2563EB')
    expect(fill.modes?.map((m) => m.mode).sort()).toEqual(['Dark', 'Light'].sort())
    expect(by.tokens.rows[0]).toMatchObject({ label: '--c', copy: 'var(--c)' })
  })

  it('text gets a typography section', () => {
    const { t } = card()
    const sections = specSections(nodeSpec(S().docs[id], t, { depth: 0 })!)
    const typo = sections.find((s) => s.id === 'typography')!
    const rows = Object.fromEntries(typo.rows.map((r) => [r.label, r.value]))
    expect(rows.Size).toBe('20px')
    expect(rows.Weight).toBe('600')
  })

  it('size rules read as words', () => {
    expect(sizeText({ mode: 'fill', max: 480 })).toBe('Fill (max 480px)')
    expect(sizeText({ mode: 'fit' })).toBe('Fit')
    expect(sizeText({ mode: 'fixed', value: 12.5 })).toBe('12.5px')
    expect(sizeText({ mode: 'percent', value: 50 })).toBe('50%')
  })
})

describe('page summary', () => {
  it('lists top-level frames with ready marks and counts', () => {
    const { f } = card()
    S().setReady(id, [f], 2)
    S().setScreen(id, f, { name: 'Home', bp: 'Desktop' })
    const doc = S().docs[id]
    const sum = pageSummary(doc, doc.pages[0].id)!
    expect(sum.screens).toHaveLength(1)
    expect(sum.screens[0]).toMatchObject({ name: 'Card', readyAt: 2, screen: { name: 'Home', bp: 'Desktop' } })
    expect(sum.readyCount).toBe(1)
    expect(sum.tokenCount).toBe(1)
    expect(pageSummary(doc, 'nope')).toBeNull()
  })
})

describe('code for the tabs and copy', () => {
  it('css, tailwind, react and html all come from the same generator as Copy as', () => {
    const { f } = card()
    const doc = S().docs[id]
    expect(codeFor(doc, [f], 'css')).toContain('flex-direction')
    expect(codeFor(doc, [f], 'tailwind')).toContain('className')
    expect(codeFor(doc, [f], 'react')).toMatch(/^export default function Card\(\)/)
    expect(codeFor(doc, [f], 'html')).toContain('<div')
    expect(codeFor(doc, [], 'css')).toBe('')
  })
})

describe('Dev Mode keyboard', () => {
  it('edit keys are not handled and change nothing', () => {
    const { f, t } = card()
    S().select(id, [t])
    S().setDevMode(id, true)
    const before = S().docs[id]
    const edits: Array<[string, Partial<Parameters<typeof devModeKey>[1]>?]> = [
      ['Delete'],
      ['Backspace'],
      ['ArrowLeft'],
      ['ArrowDown', { shiftKey: true }],
      ['KeyG', { ctrlKey: true }],
      ['KeyD', { ctrlKey: true }],
      ['KeyV', { ctrlKey: true }],
      ['KeyX', { ctrlKey: true }],
      ['KeyF'],
      ['KeyR'],
      ['KeyT'],
      ['KeyP'],
      ['BracketRight'],
      ['KeyB', { ctrlKey: true }],
      ['KeyL', { ctrlKey: true, shiftKey: true }],
      ['KeyH', { ctrlKey: true, shiftKey: true }],
      ['KeyA', { shiftKey: true }]
    ]
    for (const [code, extra] of edits) expect(key(code, { key: code, ...extra }), code).toBe(false)
    expect(S().docs[id]).toBe(before)
    expect(S().editors[id].tool).toBe('move')
    expect(f).toBeTruthy()
  })

  it('navigation keys still work', () => {
    const { f, t } = card()
    S().setDevMode(id, true)
    S().select(id, [t])
    expect(key('KeyC')).toBe(true) // comment tool
    expect(S().editors[id].tool).toBe('comment')
    expect(key('Escape', { key: 'Escape' })).toBe(true)
    expect(S().editors[id].tool).toBe('move')
    expect(key('Escape', { key: 'Escape' })).toBe(true) // selects the parent
    expect(S().editors[id].selection).toEqual([f])
    expect(key('KeyH')).toBe(true)
    expect(S().editors[id].tool).toBe('pan')
  })
})
