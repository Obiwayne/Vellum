// T69: what the Dev section writes shows up in the bundle (states with deltas and targets, contrast, alt text),
// and never in the HTML a designer copies out.
import { describe, expect, it } from 'vitest'
import * as ops from '../model/ops'
import * as comp from '../model/components'
import * as variants from '../model/variants'
import { makeStateProperty } from '../model/devState'
import { setDev, setReady } from '../model/dev'
import { nodeToHtml, nodeToJsx, nodeToRenderHtml } from '../model/html'
import { buildHandoff } from './index'
import { SPEC_SCHEMA } from './specJson'
import type { CNode } from '../model/types'

// ---- a small JSON Schema checker for the vocabulary spec.schema.json uses
type Schema = Record<string, unknown>
function check(value: unknown, schema: Schema, root: Schema, path = '$'): string[] {
  if (typeof schema.$ref === 'string') {
    const name = schema.$ref.replace('#/$defs/', '')
    return check(value, (root.$defs as Record<string, Schema>)[name], root, path)
  }
  if (Array.isArray(schema.anyOf)) {
    const tries = (schema.anyOf as Schema[]).map((s) => check(value, s, root, path))
    return tries.some((t) => !t.length) ? [] : [`${path}: matches none of anyOf (${tries.map((t) => t[0]).join(' | ')})`]
  }
  if ('const' in schema) return value === schema.const ? [] : [`${path}: expected ${String(schema.const)}`]
  if (Array.isArray(schema.enum)) return schema.enum.includes(value) ? [] : [`${path}: ${String(value)} not in enum`]
  const errors: string[] = []
  const type = schema.type as string | undefined
  const kind = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
  if (type === 'integer') {
    if (!Number.isInteger(value)) errors.push(`${path}: expected integer, got ${String(value)}`)
    return errors
  }
  if (type === 'number' ? kind !== 'number' : type && type !== kind) return [`${path}: expected ${type}, got ${kind}`]
  if (type === 'array') {
    ;(value as unknown[]).forEach((v, i) => errors.push(...check(v, schema.items as Schema, root, `${path}[${i}]`)))
  }
  if (type === 'object') {
    const o = value as Record<string, unknown>
    const props = (schema.properties ?? {}) as Record<string, Schema>
    for (const k of (schema.required ?? []) as string[]) if (!(k in o)) errors.push(`${path}: missing ${k}`)
    for (const [k, v] of Object.entries(o)) {
      if (k in props) errors.push(...check(v, props[k], root, `${path}.${k}`))
      else if (schema.additionalProperties === false) errors.push(`${path}: unexpected key ${k}`)
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') errors.push(...check(v, schema.additionalProperties as Schema, root, `${path}.${k}`))
    }
  }
  return errors
}
const validateAgainst = (v: unknown, schema: Schema): string[] => check(v, schema, schema)

const OPTS = { version: 1, exportedAt: '2026-01-01T00:00:00.000Z', vellum: '1.0.0' }

function doc() {
  const d = ops.makeDoc('d', 'File')
  const root = d.pages[0].rootId
  const add = (partial: Parameters<typeof ops.makeNode>[1], parent: string): CNode => {
    const n = ops.makeNode(d, partial, false)
    ops.insertNode(d, n, parent)
    return n
  }
  const screen = add({ type: 'frame', name: 'Home', style: { width: 400, height: 300, backgroundColor: '#FFFFFF' } }, root)
  setReady(d, [screen.id], 1)
  return { d, root, add, screen }
}

describe('contrast in the bundle', () => {
  it('writes per-mode ratios on text layers and lists failures in HANDOFF.md', () => {
    const { d, add, screen } = doc()
    d.modes = ['Light', 'Dark']
    d.tokens = [{ name: '--bg', value: '#FFFFFF', modes: { Dark: '#000000' } }]
    const panel = add({ type: 'frame', name: 'Panel', style: { width: 100, height: 100, backgroundColor: 'var(--bg)' } }, screen.id)
    add({ type: 'text', name: 'Grey', text: 'hello', style: { color: '#777777', fontSize: 14 } }, panel.id)
    const r = buildHandoff(d, { frames: [screen.id], ...OPTS })
    const spec = JSON.parse(r.files['spec.json'])
    const find = (n: { name: string; children: unknown[] }, name: string): any => (n.name === name ? n : n.children.map((c) => find(c as never, name)).find(Boolean))
    const grey = find(spec.screens[0].breakpoints[0].root, 'Grey')
    expect(grey.contrast.map((c: { mode: string }) => c.mode)).toEqual(['Light', 'Dark'])
    expect(grey.contrast[0]).toMatchObject({ ratio: 4.48, aa: false })
    expect(grey.contrast[1]).toMatchObject({ aa: true })
    expect(r.files['screens/home.md']).toContain('contrast: Light 4.48:1 fails AA · Dark 4.69:1 AA')
    expect(r.files['HANDOFF.md']).toContain('Text contrast below WCAG AA: "Grey" in Home (Light) 4.48:1')
    expect(r.summary.contrastFailures).toBe(1)
    expect(validateAgainst(SPEC_SCHEMA, spec)).toEqual([])
  })

  it('a gradient background is "not computed", not a failure', () => {
    const { d, add, screen } = doc()
    const g = add({ type: 'frame', name: 'Hero', style: { width: 100, height: 100, backgroundImage: 'linear-gradient(#000, #fff)' } }, screen.id)
    add({ type: 'text', name: 'Caption', text: 'x', style: { color: '#fff' } }, g.id)
    const r = buildHandoff(d, { frames: [screen.id], ...OPTS })
    expect(r.files['screens/home.md']).toContain('contrast: not computed (the background is a gradient or an image)')
    expect(r.summary.contrastFailures).toBe(0)
    expect(r.warnings.join(' ')).not.toMatch(/contrast/i)
  })
})

describe('images without alt text', () => {
  it('are listed; an empty alt is a decision', () => {
    const { d, add, screen } = doc()
    add({ type: 'image', name: 'Hero photo', attrs: { src: 'data:image/png;base64,AAAA' }, style: { width: 10, height: 10 } }, screen.id)
    add({ type: 'image', name: 'Divider', attrs: { src: 'data:image/png;base64,AAAA', alt: '' }, style: { width: 10, height: 10 } }, screen.id)
    add({ type: 'image', name: 'Logo', attrs: { src: 'data:image/png;base64,AAAA', alt: 'Acme' }, style: { width: 10, height: 10 } }, screen.id)
    const r = buildHandoff(d, { frames: [screen.id], ...OPTS })
    expect(r.summary.imagesWithoutAlt).toBe(1)
    expect(r.files['HANDOFF.md']).toContain('Images without alt text')
    expect(r.files['HANDOFF.md']).toContain('"Hero photo" in Home')
    expect(r.files['HANDOFF.md']).not.toContain('"Logo" in Home')
    expect(r.files['HANDOFF.md']).not.toContain('"Divider" in Home')
  })
})

describe('states with deltas and targets', () => {
  function button() {
    const { d, add, screen } = doc()
    const main = add({ type: 'frame', name: 'Button', x: 500, style: { width: 100, height: 40, backgroundColor: '#2563EB' } }, d.pages[0].rootId)
    add({ type: 'text', name: 'Label', text: 'Go', style: { color: '#FFFFFF' } }, main.id)
    comp.createComponent(d, main.id, 'Button')
    makeStateProperty(d, main.id)
    const setId = d.nodes[main.id].component!.set!
    const hover = variants.variantsOf(d, setId).find((m) => m.id !== main.id)!
    hover.style.backgroundColor = '#1D4ED8'
    comp.createInstance(d, main.id, screen.id)
    return { d, screen, main, setId }
  }

  it('a drawn state lists what changes against the default and the selector it maps to', () => {
    const { d, screen } = button()
    const r = buildHandoff(d, { frames: [screen.id], ...OPTS })
    const md = r.files['components/button.md']
    expect(md).toContain('| State | How it is specified | Maps to | What changes |')
    expect(md).toMatch(/\| hover \| drawn \(a variant\) \| :hover \| backgroundColor → #1D4ED8 \|/)
    expect(md).toMatch(/\| default \| drawn \(a variant\) \| {2}\| {2}\|/)
    const spec = JSON.parse(r.files['spec.json'])
    const states = spec.components[0].states
    expect(states.find((s: { state: string }) => s.state === 'hover')).toEqual({ state: 'hover', badge: 'drawn', target: ':hover', changes: ['backgroundColor → #1D4ED8'] })
    // the other core states an interactive component should specify are flagged, with their targets
    expect(states.find((s: { state: string }) => s.state === 'pressed')).toMatchObject({ badge: 'missing', target: ':active' })
    expect(states.find((s: { state: string }) => s.state === 'disabled')).toMatchObject({ badge: 'missing', target: ':disabled or [aria-disabled="true"]' })
    expect(validateAgainst(SPEC_SCHEMA, spec)).toEqual([])
  })

  it('a described state (dev.states) says what it sets, and a drawn one wins over a described one', () => {
    const { d, screen, main, setId } = button()
    setDev(d, main.id, { states: { disabled: { opacity: 0.5 }, hover: { opacity: 0.1 } } })
    void setId
    const r = buildHandoff(d, { frames: [screen.id], ...OPTS })
    const md = r.files['components/button.md']
    expect(md).toMatch(/\| disabled \| described \(state rule on the component\) \| :disabled or \\?\[aria-disabled="true"\\?\] \| opacity → 0\.5 \|/)
    expect(md).toMatch(/\| hover \| drawn/)
    expect(md).not.toContain('opacity → 0.1')
  })

  it('option names are canonicalised: Active is pressed', () => {
    const { d, screen, main, setId } = button()
    const p = d.nodes[setId].componentSet!.props[0]
    variants.createVariant(d, main.id, { [p.id]: 'Active' })
    const r = buildHandoff(d, { frames: [screen.id], ...OPTS })
    const md = r.files['components/button.md']
    expect(md).toMatch(/\| pressed \| drawn/)
    expect(md).not.toMatch(/\| active \|/)
  })
})

describe('dev notes never leave through Copy as', () => {
  it('HTML, render HTML and JSX of a layer carry no note, state rule or open question', () => {
    const { d, add, screen } = doc()
    const t = add({ type: 'text', name: 'Title', text: 'Hello', style: { fontSize: 20 } }, screen.id)
    setDev(d, t.id, { notes: 'SECRET-NOTE', needsDecision: 'SECRET-QUESTION', role: 'heading', label: 'SECRET-LABEL', states: { hover: { color: 'red' } } })
    setDev(d, screen.id, { notes: 'SECRET-FRAME-NOTE' })
    for (const out of [nodeToHtml(d, screen.id), nodeToRenderHtml(d, screen.id), nodeToJsx(d, screen.id), nodeToHtml(d, t.id)]) {
      expect(out).not.toMatch(/SECRET/)
      expect(out).not.toMatch(/aria-|role=/)
    }
    expect(nodeToHtml(d, screen.id)).toContain('Hello')
  })
})
