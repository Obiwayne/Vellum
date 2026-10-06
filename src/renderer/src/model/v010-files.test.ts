// Files saved by Vellum v0.1.0 (fixtures/v1: real files from that build), a v4 variants doc (fixtures/v4) and a
// Canvas-era doc (fixtures/canvas-era) open in the current build with no data loss: every node, page, token, variant
// and property survives the migration, the doc renders the same, and it stays editable.
import { beforeEach, describe, expect, it } from 'vitest'
import { DASHBOARD, getStore, useStore } from './store'
import { DOC_VERSION, migrateDoc } from './ops'
import { variantsOf } from './variants'
import { nodeToHtml, nodeToRenderHtml } from './html'
import type { Doc } from './types'
import landing from './fixtures/v1/files/i1wL51Z8AV_4.json'
import sketch from './fixtures/v1/files/d2_WyuDutjln.json'
import scratch from './fixtures/v1/files/Ds7_k1U7cioJ.json'
import indexJson from './fixtures/v1/index.json'
import buttonsV4 from './fixtures/v4/buttons-v4.json'
import canvasEra from './fixtures/canvas-era/old-sketch-no-version.json'

const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v))
const doc = (o: unknown): Doc => plain(o) as Doc
const v1Files = { landing, sketch, scratch }

describe.each(Object.entries(v1Files))('v0.1.0 file "%s" (saved by that build)', (_name, file) => {
  it('is a v2 doc, and migrating only stamps the version', () => {
    const original = doc(file)
    expect(original.version).toBe(2)
    const m = migrateDoc(plain(original))
    expect(m.version).toBe(DOC_VERSION)
    expect({ ...m, version: 2 }).toEqual(original)
  })

  it('renders and exports the same HTML as the file as saved', () => {
    const original = doc(file)
    const m = migrateDoc(plain(original))
    for (const p of original.pages) {
      expect(nodeToRenderHtml(m, p.rootId)).toBe(nodeToRenderHtml(original, p.rootId))
      expect(nodeToHtml(m, p.rootId)).toBe(nodeToHtml(original, p.rootId))
    }
  })
})

describe('v4 variants doc (DOC_VERSION 4)', () => {
  const sets = (d: Doc) => Object.values(d.nodes).filter((n) => n.componentSet)
  const mains = (d: Doc) => Object.values(d.nodes).filter((n) => n.component)

  it('has what a v4 doc should: a component set with 3 variants', () => {
    const d = doc(buttonsV4)
    expect(d.version).toBe(4)
    expect(sets(d)).toHaveLength(1)
    expect(sets(d)[0].componentSet!.props[0]).toMatchObject({ type: 'variant', options: expect.arrayContaining(['Default', 'Variant 2', 'Large']) })
    expect(mains(d).filter((n) => n.component?.set)).toHaveLength(3)
  })

  it('migrates by stamping 5 and loses no node, variant or property', () => {
    const original = doc(buttonsV4)
    const m = migrateDoc(plain(original))
    expect(m.version).toBe(5)
    expect(m.version).toBe(DOC_VERSION)
    expect({ ...m, version: 4 }).toEqual(original)
    expect(Object.keys(m.nodes).sort()).toEqual(Object.keys(original.nodes).sort())
    expect(sets(m).map((n) => n.componentSet)).toEqual(sets(original).map((n) => n.componentSet))
    expect(mains(m).map((n) => n.component)).toEqual(mains(original).map((n) => n.component))
    expect(migrateDoc(m)).toBe(m)
  })

  it('opens in the store and the variant helpers still see the set', () => {
    useStore.setState(useStore.getInitialState(), true)
    const m = migrateDoc(doc(buttonsV4))
    getStore().hydrate({ docs: { [m.id]: m }, recents: [m.id], tabs: [DASHBOARD, m.id], activeTab: m.id, prefs: {}, scratchpadId: m.id })
    const d = getStore().docs[m.id]
    expect(variantsOf(d, sets(d)[0].id)).toHaveLength(3)
  })
})

describe('Canvas-era doc (no version field)', () => {
  it('only gives text without a line height the old 20px, and keeps everything else', () => {
    const original = doc(canvasEra)
    expect(original.version).toBeUndefined()
    const m = migrateDoc(plain(original))
    expect(m.version).toBe(DOC_VERSION)
    const expected = plain(original)
    expected.version = DOC_VERSION
    expected.nodes['3-0'].style.lineHeight = '20px'
    expect(m).toEqual(expected)
    expect(m.nodes['4-0'].style.lineHeight).toBe('28px')
  })

  it('does not mutate its input', () => {
    const original = doc(canvasEra)
    const before = plain(original)
    migrateDoc(original)
    expect(original).toEqual(before)
  })
})

describe('v0.1.0 files opened in the app', () => {
  let id: string
  const cur = (): Doc => getStore().docs[id]
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
    const docs: Record<string, Doc> = {}
    for (const f of Object.values(v1Files)) {
      const m = migrateDoc(doc(f))
      docs[m.id] = m
    }
    getStore().hydrate({ docs, recents: indexJson.recents, tabs: indexJson.tabs, activeTab: indexJson.activeTab, prefs: indexJson.prefs, scratchpadId: indexJson.scratchpadId })
    id = landing.id
  })

  it('restores the index: tabs, recents, scratchpad and prefs', () => {
    const s = getStore()
    expect(s.tabs).toEqual(indexJson.tabs)
    expect(s.activeTab).toBe(indexJson.activeTab)
    expect(s.recents).toEqual(indexJson.recents)
    expect(s.scratchpadId).toBe(indexJson.scratchpadId)
  })

  it('keeps every node, page, token and the text, svg and image content', () => {
    const original = doc(landing)
    expect(Object.keys(cur().nodes).sort()).toEqual(Object.keys(original.nodes).sort())
    expect(cur().pages).toEqual(original.pages)
    expect(cur().tokens).toEqual(original.tokens)
    expect(cur().tokens).toHaveLength(4)
    const types = (d: Doc) => Object.values(d.nodes).map((n) => n.type).sort()
    expect(types(cur())).toEqual(types(original))
    expect(Object.values(cur().nodes).some((n) => n.type === 'svg' && n.svg)).toBe(true)
    expect(Object.values(cur().nodes).some((n) => n.type === 'image' && n.attrs?.src?.startsWith('data:image/png'))).toBe(true)
    expect(Object.values(cur().nodes).some((n) => n.text === 'Ünïcode ✓ 日本語')).toBe(true)
  })

  it('stays editable: an edit and its undo leave the old data intact (updatedAt aside)', () => {
    const before = plain(cur())
    const textId = Object.values(cur().nodes).find((n) => n.type === 'text')!.id
    getStore().updateStyles(id, [textId], { color: '#FF0000' })
    expect(cur().nodes[textId].style.color).toBe('#FF0000')
    getStore().undo(id)
    expect({ ...plain(cur()), updatedAt: 0 }).toEqual({ ...before, updatedAt: 0 })
  })

  it('can use newer features on an old doc: a new page and a colour token', () => {
    const before = Object.keys(cur().nodes).length
    getStore().addPage(id, 'Page 3')
    expect(cur().pages).toHaveLength(3)
    expect(Object.keys(cur().nodes).length).toBe(before + 1)
    getStore().upsertTokens(id, [{ name: '--color-brand', value: '#112233' }])
    expect(cur().tokens.find((t) => t.name === '--color-brand')?.value).toBe('#112233')
  })
})
