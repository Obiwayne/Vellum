// @vitest-environment jsdom
// Spec panel for a component instance (T63 test station): the rows come from NodeSpec, and the rendered panel
// shows the component, its variant and property values, overrides, per-mode token values and the read-only
// dev notes. It is mounted in jsdom: the store hook needs a client render.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

vi.mock('../canvas/toast', () => ({ toast: vi.fn() }))

import { getStore, useStore } from '../../model/store'
import { nodeSpec } from '../../model/devSpec'
import { SpecPanel } from './SpecPanel'
import { specSections } from './specView'

const S = getStore
let id: string

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Mount the panel, return its HTML and unmount. */
function panelHtml(): string {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => root.render(createElement(SpecPanel, { docId: id })))
  const html = host.innerHTML
  act(() => root.unmount())
  host.remove()
  return html
}

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true)
  id = S().createDoc('Dev', { open: false })
})

/** A Button main with a text prop, a Large variant, and two instances on a stage. */
function buttons() {
  const root = S().docs[id].pages[0].rootId
  const main = S().createNode(
    id,
    { type: 'frame', name: 'Button', style: { display: 'flex', gap: 8, padding: 12, width: 'fit-content', height: 'fit-content', backgroundColor: 'var(--c)' } },
    root
  )
  const label = S().createNode(id, { type: 'text', name: 'Label', text: 'Buy', style: { color: '#FFFFFF', fontSize: 16 } }, main)
  S().setTokens(id, [{ name: '--c', value: '#2563EB', modes: { Dark: '#60A5FA' } }])
  S().addMode(id, 'Dark')
  S().createComponent(id, [main])
  const propId = S().addProp(id, main, { name: 'Label', type: 'text', default: 'Buy' })
  S().bindProp(id, label, 'text', propId)
  const stage = S().createNode(id, { type: 'frame', name: 'Stage', style: { width: 600, height: 400 } }, root)
  const inst = S().createInstance(id, main, stage)
  S().setInstanceProp(id, inst, propId, 'Pay now')
  return { main, label, propId, stage, inst }
}

describe('Spec rows of an instance', () => {
  it('has a Component section with the main, the property value and a Fill with its token modes', () => {
    const { inst } = buttons()
    const spec = nodeSpec(S().docs[id], inst, { depth: 0 })!
    const by = Object.fromEntries(specSections(spec).map((s) => [s.id, s]))
    expect(by.component.rows[0]).toEqual({ label: 'Component', value: 'Button' })
    expect(by.component.rows.map((r) => r.value)).toContain('Pay now')
    const fill = by.fills.rows[0]
    expect(fill).toMatchObject({ token: '--c', value: '#2563EB' })
    expect(fill.modes?.map((m) => `${m.mode}:${m.value}`)).toEqual(['Light:#2563EB', 'Dark:#60A5FA'])
    expect(by.tokens.rows.map((r) => r.copy)).toEqual(['var(--c)'])
  })

  it('a plain frame has no Component section', () => {
    const { stage } = buttons()
    const spec = nodeSpec(S().docs[id], stage, { depth: 0 })!
    expect(specSections(spec).some((s) => s.id === 'component')).toBe(false)
  })

  it('an override on the instance is counted', () => {
    const { inst } = buttons()
    const textTwin = S().docs[id].nodes[inst].children[0]
    S().updateStyles(id, [textTwin], { fontSize: 24 })
    const spec = nodeSpec(S().docs[id], inst, { depth: 0 })!
    const rows = specSections(spec).find((s) => s.id === 'component')!.rows
    expect(rows.find((r) => r.label === 'Overrides')?.value).toMatch(/^\d+ layers?$/)
  })
})

describe('rendered SpecPanel for an instance', () => {
  it('shows header, component, per-mode values, dev notes and code tabs; nothing editable', () => {
    const { inst } = buttons()
    S().setDev(id, [inst], { notes: 'Disabled until the form is valid.', role: 'button', needsDecision: 'Loading state?' })
    S().select(id, [inst])
    const html = panelHtml()
    expect(html).toContain('data-testid="dev-spec"')
    expect(html).toContain('Instance')
    expect(html).toContain('Component')
    expect(html).toContain('Button')
    expect(html).toContain('Pay now')
    expect(html).toContain('--c')
    expect(html).toContain('#60A5FA')
    expect(html).toContain('data-testid="dev-info"')
    expect(html).toContain('Disabled until the form is valid.')
    expect(html).toContain('Loading state?')
    expect(html).toContain('Click to copy')
    expect(html).not.toMatch(/<input|<textarea|contenteditable/i)
  })

  it('with nothing selected it shows the page summary', () => {
    buttons()
    S().select(id, [])
    const html = panelHtml()
    expect(html).toContain('data-testid="dev-page-summary"')
    expect(html).toContain('Select a layer')
  })

  it('opening the panel does not touch the document or the undo stack', () => {
    const { inst } = buttons()
    S().select(id, [inst])
    const before = S().docs[id]
    panelHtml()
    expect(S().docs[id]).toBe(before)
  })
})
