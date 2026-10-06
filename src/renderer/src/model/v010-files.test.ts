// Files saved by Vellum v0.1.0 (fixtures in src/renderer/src/test-fixtures/v0.1.0) open in the current build with no data loss:
// every node, page, token, thumbnail and flag survives the migration, the doc renders the same, and it stays editable.
import { beforeEach, describe, expect, it } from 'vitest'
import { DASHBOARD, getStore, useStore } from './store'
import { DOC_VERSION, migrateDoc } from './ops'
import { nodeToHtml, nodeToRenderHtml } from './html'
import type { Doc } from './types'
import designA from '../test-fixtures/v0.1.0/files/v010designA1.json'
import legacyV1 from '../test-fixtures/v0.1.0/files/v010legacyV1.json'
import scratch from '../test-fixtures/v0.1.0/files/v010scratch01.json'
import indexJson from '../test-fixtures/v0.1.0/index.json'

const files: Record<string, unknown> = { v010designA1: designA, v010legacyV1: legacyV1, v010scratch01: scratch }
const load = (name: string): Doc => JSON.parse(JSON.stringify(files[name])) as Doc
const fixtures = Object.keys(files)
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v))

describe('v0.1.0 fixtures', () => {
  it('are all there', () => {
    expect(fixtures.sort()).toEqual(['v010designA1', 'v010legacyV1', 'v010scratch01'])
  })
})

describe.each(['v010designA1', 'v010scratch01'])('%s (v2, as saved by v0.1.0)', (name) => {
  it('migrates by stamping the version only: nothing else changes', () => {
    const original = load(name)
    const m = migrateDoc(plain(original))
    expect(m.version).toBe(DOC_VERSION)
    expect({ ...m, version: original.version }).toEqual(original)
  })
})

describe('v010legacyV1 (no version field)', () => {
  it('only gives text without a line height the old 20px, and keeps everything else', () => {
    const original = load('v010legacyV1')
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
    const original = load('v010legacyV1')
    const before = plain(original)
    migrateDoc(original)
    expect(original).toEqual(before)
  })
})

describe('opened in the app', () => {
  let id: string
  const doc = (): Doc => getStore().docs[id]
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
    const docs: Record<string, Doc> = {}
    for (const f of fixtures) {
      const m = migrateDoc(load(f))
      docs[m.id] = m
    }
    const index = indexJson
    getStore().hydrate({ docs, recents: index.recents, tabs: index.tabs, activeTab: index.activeTab, prefs: index.prefs, scratchpadId: index.scratchpadId })
    id = 'v010designA1'
  })

  it('restores the index: tabs, recents, scratchpad and prefs', () => {
    const s = getStore()
    expect(s.tabs).toEqual([DASHBOARD, 'v010designA1', 'v010scratch01'])
    expect(s.activeTab).toBe('v010designA1')
    expect(s.recents).toEqual(['v010designA1', 'v010scratch01', 'v010legacyV1'])
    expect(s.scratchpadId).toBe('v010scratch01')
    expect(s.prefs).toEqual({ userName: 'Obi', dashboardView: 'grid' })
  })

  it('keeps every node, page and token with the same content', () => {
    const original = load(id)
    expect(Object.keys(doc().nodes).sort()).toEqual(Object.keys(original.nodes).sort())
    expect(doc().pages).toEqual(original.pages)
    expect(doc().tokens).toEqual(original.tokens)
    expect(doc().thumbnail).toBe(original.thumbnail)
    expect(doc().nodes['8-0']).toMatchObject({ visible: false, locked: true })
    expect(doc().nodes['4-0'].text).toBe('Line one\nLine two')
    expect(doc().nodes['13-0'].text).toBe('Ünïcode ✓ 日本語')
    expect(doc().nodes['6-0'].svg).toBe(original.nodes['6-0'].svg)
    expect(doc().nodes['7-0'].attrs).toEqual(original.nodes['7-0'].attrs)
  })

  it('renders the same HTML as the unmigrated file (v2 changes nothing)', () => {
    const original = load(id)
    for (const root of ['2-0', '10-0']) {
      expect(nodeToRenderHtml(doc(), root)).toBe(nodeToRenderHtml(original, root))
      expect(nodeToHtml(doc(), root)).toBe(nodeToHtml(original, root))
    }
  })

  it('stays editable: an edit and its undo leave the old data intact (updatedAt aside)', () => {
    const before = plain(doc())
    getStore().updateStyles(id, ['3-0'], { color: '#FF0000' })
    expect(doc().nodes['3-0'].style.color).toBe('#FF0000')
    getStore().undo(id)
    expect({ ...plain(doc()), updatedAt: 0 }).toEqual({ ...before, updatedAt: 0 })
  })

  it('can use the newer features on an old doc: tokens as a colour style, a new page', () => {
    const before = Object.keys(doc().nodes).length
    getStore().addPage(id, 'Page 3')
    expect(doc().pages).toHaveLength(3)
    expect(Object.keys(doc().nodes).length).toBe(before + 1) // the new page root
    getStore().upsertTokens(id, [{ name: '--color-brand', value: '#112233' }])
    expect(doc().tokens.find((t) => t.name === '--color-brand')?.value).toBe('#112233')
  })

  it('a save after opening writes nothing the old file had away', () => {
    const original = load(id)
    const saved = plain(doc())
    for (const [nid, n] of Object.entries(original.nodes)) expect(saved.nodes[nid]).toEqual(n)
    for (const k of Object.keys(original)) if (k !== 'version') expect(saved[k as keyof Doc]).toEqual(original[k as keyof Doc])
  })
})
