import { beforeEach, describe, expect, it } from 'vitest'
import { getStore, useStore } from '../model/store'
import { diffDocs } from '@shared/docDiff'
import type { Doc } from '../model/types'
import { buildHandoff } from './index'
import { diffSpecs, isUnchanged, type ChangeSet } from './diff'
import { changesMd } from './changesMd'
import type { HandoffSpec } from './types'

const S = getStore
let id: string
const doc = (): Doc => S().docs[id]
const root = (): string => doc().pages[0].rootId
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v))

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true)
  id = S().createDoc('Diff', { open: false })
})

/** The spec of the given frames, built the way the export flow builds it for a diff (no measurement). */
function specOf(d: Doc, frames: string[], version = 1): HandoffSpec {
  const out = buildHandoff(d, { frames, version, exportedAt: 'x', vellum: '1.0.0' })
  return JSON.parse(out.files['spec.json']) as HandoffSpec
}

interface Screen {
  frame: string
  title: string
  body: string
  card: string
}

function screens(n: number): Screen[] {
  const out: Screen[] = []
  for (let i = 0; i < n; i++) {
    const frame = S().createNode(id, { type: 'frame', name: `Screen ${i + 1}`, style: { display: 'flex', flexDirection: 'column', gap: 8, padding: 16, width: 400, height: 300, backgroundColor: '#FFFFFF' } }, root())
    S().updateNode(id, frame, { x: 0, y: i * 400 })
    const title = S().createNode(id, { type: 'text', name: 'Title', text: `Title ${i + 1}`, style: { fontSize: 20, fontWeight: 700 } }, frame)
    const body = S().createNode(id, { type: 'text', name: 'Body', text: `Body ${i + 1}`, style: { fontSize: 14 } }, frame)
    const card = S().createNode(id, { type: 'frame', name: 'Card', style: { width: 200, height: 60, backgroundColor: '#EEEEEE' } }, frame)
    out.push({ frame, title, body, card })
  }
  return out
}

describe('20 screens, 4 edits', () => {
  it('lists exactly the edited layers and nothing else', () => {
    const s = screens(20)
    const frames = s.map((x) => x.frame)
    const before = plain(doc())
    S().setText(id, s[3].title, 'A new title') //                  screen 4: text
    S().updateStyles(id, [s[10].card], { backgroundColor: '#FF0000', width: 220 }) // screen 11: fill and size
    S().deleteNodes(id, [s[16].body]) //                           screen 17: layer removed
    const added = S().createNode(id, { type: 'rect', name: 'Badge', style: { width: 20, height: 20 } }, s[1].frame) // screen 2: layer added

    const changes = diffSpecs(specOf(before, frames), specOf(doc(), frames, 2), 1)
    const byStatus = (st: string) => changes.screens.filter((x) => x.status === st).map((x) => x.name)
    expect(byStatus('changed')).toEqual(['Screen 2', 'Screen 4', 'Screen 11', 'Screen 17'])
    expect(byStatus('unchanged')).toHaveLength(16)
    expect(byStatus('added')).toEqual([])
    expect(byStatus('removed')).toEqual([])
    expect(changes.counts).toEqual({ added: 0, removed: 0, changed: 4, unchanged: 16 })
    expect(changes.rebuild).toEqual(['Screen 2', 'Screen 4', 'Screen 11', 'Screen 17'])

    const nodes = (name: string) => changes.screens.find((x) => x.name === name)!.nodes
    expect(nodes('Screen 4')).toEqual([
      expect.objectContaining({ id: s[3].title, path: 'Screen 4 › Title', kind: 'changed', changes: [{ property: 'text', from: '"Title 4"', to: '"A new title"' }] })
    ])
    const card = nodes('Screen 11')
    expect(card).toHaveLength(1)
    expect(card[0].path).toBe('Screen 11 › Card')
    expect(card[0].changes.map((c) => c.property)).toEqual(expect.arrayContaining(['size rule', 'fill and stroke', 'size']))
    expect(nodes('Screen 17')).toEqual([expect.objectContaining({ id: s[16].body, path: 'Screen 17 › Body', kind: 'removed' })])
    expect(nodes('Screen 2')).toEqual([expect.objectContaining({ id: added, path: 'Screen 2 › Badge', kind: 'added' })])
    expect(changes.tokens).toEqual([])
    expect(changes.assets).toEqual([])
    expect(isUnchanged(changes)).toBe(false)
  })

  it('an export of the same document, built twice, has no changes at all', () => {
    const s = screens(20)
    const frames = s.map((x) => x.frame)
    const a = specOf(plain(doc()), frames)
    const b = specOf(plain(doc()), frames, 2)
    const c = diffSpecs(a, b, 1)
    expect(c.counts).toEqual({ added: 0, removed: 0, changed: 0, unchanged: 20 })
    expect(c.rebuild).toEqual([])
    expect(isUnchanged(c)).toBe(true)
    expect(changesMd(c, 2)).toContain('Nothing changed')
  })
})

describe('agreement with docDiff', () => {
  it('the layers that changed are the layers docDiff reports as changed (layers-only parents aside)', () => {
    const s = screens(6)
    const frames = s.map((x) => x.frame)
    const before = plain(doc())
    S().setText(id, s[0].title, 'Changed')
    S().updateStyles(id, [s[1].card], { backgroundColor: '#123456' })
    S().renameNode(id, s[2].body, 'Description')
    S().updateStyles(id, [s[3].frame], { gap: 24 })
    const after = plain(doc())

    const spec = diffSpecs(specOf(before, frames), specOf(after, frames, 2), 1)
    const mine = new Set(spec.screens.flatMap((x) => x.nodes).filter((n) => n.kind === 'changed').map((n) => n.id))
    const theirs = new Set(
      diffDocs(before as never, after as never)
        .changed.filter((c) => !(c.aspects?.length === 1 && c.aspects[0] === 'layers'))
        .map((c) => c.id)
    )
    expect([...mine].sort()).toEqual([...theirs].sort())
    expect(mine.size).toBe(4)
  })

  it('layers added and removed agree too', () => {
    const s = screens(3)
    const frames = s.map((x) => x.frame)
    const before = plain(doc())
    S().deleteNodes(id, [s[0].card])
    const extra = S().createNode(id, { type: 'text', name: 'Note', text: 'Hi', style: {} }, s[1].frame)
    const after = plain(doc())
    const spec = diffSpecs(specOf(before, frames), specOf(after, frames, 2), 1)
    const nodes = spec.screens.flatMap((x) => x.nodes)
    const d = diffDocs(before as never, after as never)
    expect(nodes.filter((n) => n.kind === 'added').map((n) => n.id)).toEqual(d.added.map((c) => c.id))
    expect(nodes.filter((n) => n.kind === 'removed').map((n) => n.id)).toEqual(d.removed.map((c) => c.id))
    expect(d.added.map((c) => c.id)).toEqual([extra])
  })
})

describe('screens, components, tokens, assets', () => {
  it('a screen that is new, one that is gone, and a breakpoint that appears', () => {
    const s = screens(2)
    const before = plain(doc())
    const fresh = S().createNode(id, { type: 'frame', name: 'Settings', style: { width: 300, height: 200 } }, root())
    S().deleteNodes(id, [s[1].frame])
    const c = diffSpecs(specOf(before, [s[0].frame, s[1].frame]), specOf(doc(), [s[0].frame, fresh], 2), 1)
    expect(c.screens.map((x) => `${x.name}:${x.status}`).sort()).toEqual(['Screen 1:unchanged', 'Screen 2:removed', 'Settings:added'])
    expect(c.rebuild).toEqual(['Settings'])
    const md = changesMd(c, 2)
    expect(md).toContain('**Removed:** Screen 2. Delete them from the build.')
    expect(md).toContain('### Settings: added')
  })

  it('a rename is a changed layer, not a remove and an add; moving siblings is a layer-order change', () => {
    const s = screens(1)
    const before = plain(doc())
    S().renameNode(id, s[0].card, 'Panel')
    const c = diffSpecs(specOf(before, [s[0].frame]), specOf(doc(), [s[0].frame], 2), 1)
    expect(c.screens[0].nodes).toEqual([expect.objectContaining({ id: s[0].card, kind: 'changed', changes: [{ property: 'name', from: 'Card', to: 'Panel' }] })])
    const mid = plain(doc())
    S().moveNodes(id, [s[0].card], s[0].frame, 0)
    const c2 = diffSpecs(specOf(mid, [s[0].frame]), specOf(doc(), [s[0].frame], 3), 2)
    expect(c2.screens[0].nodes.map((n) => n.id)).toEqual([s[0].frame])
    expect(c2.screens[0].nodes[0].changes[0].property).toBe('layer order')
  })

  it('dev notes, state rules and needs-decision show up as properties', () => {
    const s = screens(1)
    const before = plain(doc())
    S().setDev(id, [s[0].card], { notes: 'Collapses under 640', needsDecision: 'Tappable?', states: { hover: { backgroundColor: '#000000' } } })
    const c = diffSpecs(specOf(before, [s[0].frame]), specOf(doc(), [s[0].frame], 2), 1)
    const props = c.screens[0].nodes[0].changes.map((x) => x.property)
    expect(props).toEqual(expect.arrayContaining(['dev notes', 'needs decision', 'state hover']))
    expect(c.screens[0].nodes[0].changes.find((x) => x.property === 'dev notes')).toEqual({ property: 'dev notes', from: 'none', to: 'Collapses under 640' })
  })

  it('token value changes per mode, new and no-longer-used tokens', () => {
    const s = screens(1)
    S().setTokens(id, [
      { name: '--brand', value: '#2563EB' },
      { name: '--gone', value: '#111111' }
    ])
    S().updateStyles(id, [s[0].frame], { backgroundColor: 'var(--brand)' })
    S().updateStyles(id, [s[0].card], { backgroundColor: 'var(--gone)' })
    const before = plain(doc())
    S().setTokens(id, [
      { name: '--brand', value: '#1D4ED8' },
      { name: '--fresh', value: '16px' }
    ])
    S().updateStyles(id, [s[0].card], { backgroundColor: '#EEEEEE', padding: 'var(--fresh)' })
    const c = diffSpecs(specOf(before, [s[0].frame]), specOf(doc(), [s[0].frame], 2), 1)
    expect(c.tokens.map((t) => `${t.status} ${t.name}`)).toEqual(['changed --brand', 'added --fresh', 'removed --gone'])
    expect(c.tokens.find((t) => t.name === '--brand')!.text).toBe('--brand: #2563EB → #1D4ED8')
    expect(changesMd(c, 2)).toContain('## Tokens')
  })

  it('assets: added, removed and changed by content', () => {
    const base = (assets: HandoffSpec['assets']): HandoffSpec => ({ ...specOf(doc(), []), assets })
    const rec = (path: string, sha256: string) => ({ id: path, path, kind: 'image' as const, nodeIds: [], sha256 })
    const c = diffSpecs(base([rec('assets/images/a.png', 'aa'), rec('assets/images/b.png', 'bb')]), base([rec('assets/images/b.png', 'b2'), rec('assets/images/c.png', 'cc')]), 1)
    expect(c.assets).toEqual([
      { path: 'assets/images/a.png', status: 'removed' },
      { path: 'assets/images/b.png', status: 'changed' },
      { path: 'assets/images/c.png', status: 'added' }
    ])
  })

  it('a component: changed layer inside a variant, added and removed components', () => {
    const s = screens(1)
    const main = S().createComponent(id, [s[0].card])
    const inst = S().createInstance(id, main, s[0].frame)
    void inst
    const before = plain(doc())
    S().updateStyles(id, [main], { backgroundColor: '#00FF00' })
    const a = specOf(before, [s[0].frame])
    const b = specOf(doc(), [s[0].frame], 2)
    const c = diffSpecs(a, b, 1)
    expect(c.components).toHaveLength(1)
    expect(c.components[0].status).toBe('changed')
    expect(c.rebuild).toEqual(expect.arrayContaining(['Card (component)']))
    const none = diffSpecs({ ...a, components: [] }, b, 1)
    expect(none.components[0].status).toBe('added')
    const gone = diffSpecs(a, { ...b, components: [] }, 1)
    expect(gone.components[0].status).toBe('removed')
  })
})

describe('CHANGES.md', () => {
  const md = (c: ChangeSet): string => changesMd(c, 2)

  it('rebuild list first, unchanged next, then per screen the layer path, property and old → new', () => {
    const s = screens(3)
    const frames = s.map((x) => x.frame)
    const before = plain(doc())
    S().setText(id, s[1].title, 'Hello')
    const text = md(diffSpecs(specOf(before, frames), specOf(doc(), frames, 2), 1))
    const lines = text.split('\n')
    expect(lines[0]).toBe('# Changes since handoff v1')
    expect(text).toContain('**Rebuild only these:** Screen 2.')
    expect(text).toContain('**Unchanged:** Screen 1, Screen 3.')
    expect(text).toContain('### Screen 2: changed')
    expect(text).toContain('- Screen 2 › Title')
    expect(text).toContain('  - text: "Title 2" → "Hello"')
    expect(text.indexOf('Rebuild only')).toBeLessThan(text.indexOf('Unchanged'))
  })

  it('names from the document cannot inject markup', () => {
    const s = screens(1)
    const before = plain(doc())
    S().renameNode(id, s[0].card, 'Hero\n# Injected\n![x](http://evil)')
    const text = md(diffSpecs(specOf(before, [s[0].frame]), specOf(doc(), [s[0].frame], 2), 1))
    expect(text.split('\n').some((l) => l.startsWith('# Injected'))).toBe(false)
    expect(text).not.toMatch(/(^|[^\\])!\[x\]/m)
    expect(text).not.toMatch(/undefined|NaN/)
  })

  it('is written by buildHandoff only when changes are given, with spec.changes and the read order', () => {
    const s = screens(2)
    const frames = s.map((x) => x.frame)
    const before = plain(doc())
    S().setText(id, s[0].title, 'Hi')
    const changes = diffSpecs(specOf(before, frames), specOf(doc(), frames, 2), 1)
    const first = buildHandoff(doc(), { frames, version: 1, exportedAt: 'x', vellum: '1.0.0' })
    expect(Object.keys(first.files)).not.toContain('CHANGES.md')
    expect(JSON.parse(first.files['spec.json']).changes).toBeUndefined()
    expect(first.files['HANDOFF.md']).not.toContain('CHANGES.md')
    const second = buildHandoff(doc(), { frames, version: 2, exportedAt: 'x', vellum: '1.0.0', changes })
    expect(Object.keys(second.files)).toContain('CHANGES.md')
    expect(JSON.parse(second.files['spec.json']).changes.previous).toBe(1)
    expect(JSON.parse(second.files['spec.json']).changes.counts).toEqual({ added: 0, removed: 0, changed: 1, unchanged: 1 })
    expect(second.files['HANDOFF.md']).toMatch(/Read `CHANGES\.md` first/)
    expect(second.files['HANDOFF.md'].indexOf('CHANGES.md')).toBeGreaterThan(-1)
  })
})
