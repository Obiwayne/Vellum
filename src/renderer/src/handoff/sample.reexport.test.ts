// @vitest-environment jsdom
// T73 test station (QA round 1): the re-export criterion at unit level. The sample design is the one the e2e and the
// dogfood run use (scripts/handoff-fixture.mjs, read from the file so there is one copy): paste it, tag and mark the
// screens, export as v1, edit one layer, export as v2 against the saved v1, and check what CHANGES.md says.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HandoffExportResult } from '@shared/api'
import { getStore, useStore } from '../model/store'
import type { Doc } from '../model/types'
import { runExport, type ExportDeps, type ExportRequest } from './exportFlow'
import fixtureSource from '../../../../scripts/handoff-fixture.mjs?raw'

vi.mock('../history/versions', () => ({ listVersions: async () => [] }))

// the part of the fixture file before the Electron driver: only constants (the HTML strings and the canaries)
const head = fixtureSource.split('/** Launch the built app')[0].replace(/^import .*$/gm, '').replace(/export const /g, 'const ')
const { CANARY, DESKTOP_HTML, MOBILE_HTML, RECEIPT_HTML, UNREADY_HTML } = new Function(`${head}\nreturn { CANARY, DESKTOP_HTML, MOBILE_HTML, RECEIPT_HTML, UNREADY_HTML }`)() as Record<string, string> & {
  CANARY: Record<string, string>
}

const S = getStore
let id: string
const doc = (): Doc => S().docs[id]
const root = (): string => doc().pages[0].rootId
const PNG = new Uint8Array([137, 80, 78, 71, 1, 2, 3])
const req = (frames: string[]): ExportRequest => ({ frames, retina: false, rem: false, devNotes: true, kind: 'folder' })

function history() {
  const snaps = new Map<string, Doc>()
  const names: string[] = []
  const written: Array<Record<string, unknown>> = []
  const deps: ExportDeps = {
    engine: { resize: async () => PNG, renderPng: async () => PNG },
    write: async (args): Promise<HandoffExportResult> => {
      written.push(args.files)
      return { ok: true, path: `C:/out/${args.name}`, files: Object.keys(args.files).length, bytes: 1, kind: args.kind }
    },
    saveVersion: async (name, record) => {
      S().recordHandoff(id, record.version, record.frames)
      names.push(name)
      snaps.set(name, JSON.parse(JSON.stringify(doc())))
    },
    listVersions: async () => names.map((name, i) => ({ id: `v${i}-${name}`, name, createdAt: i })),
    loadVersion: async (versionId) => snaps.get(versionId.replace(/^v\d+-/, '')) ?? null,
    now: () => '2026-10-13T12:00:00.000Z',
    vellum: '1.0.0'
  }
  return { deps, written }
}

/** The design as the e2e builds it: Checkout at two breakpoints, a receipt screen, one unready frame, a hidden promo. */
function sampleDesign() {
  const pasted = [DESKTOP_HTML, MOBILE_HTML, RECEIPT_HTML, UNREADY_HTML].map((h) => S().insertHtml(id, root(), h)[0])
  const [desktop, mobile, receipt, unready] = pasted
  const promo = Object.values(doc().nodes).find((n) => n.type === 'text' && n.text === CANARY.hidden)!
  S().updateNode(id, promo.id, { visible: false })
  S().setScreen(id, desktop, { name: 'Checkout', bp: 'Tablet' })
  S().setScreen(id, mobile, { name: 'Checkout', bp: 'Mobile' })
  S().setScreen(id, receipt, { name: 'Receipt', bp: 'Mobile' })
  S().setReady(id, [desktop, mobile, receipt], 1)
  return { desktop, mobile, receipt, unready }
}

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true)
  id = S().createDoc('Acme', { open: false })
})

describe('sample design: edit, export again', () => {
  it('v2 says to rebuild only Checkout, lists Receipt as unchanged, and names the edited layer', async () => {
    const d = sampleDesign()
    const h = history()
    const frames = [d.desktop, d.mobile, d.receipt]
    const first = await runExport(doc(), req(frames), h.deps)
    expect(first.ok).toBe(true)
    expect(h.written[0]['CHANGES.md']).toBeUndefined()
    expect(JSON.parse(String(h.written[0]['spec.json'])).changes).toBeUndefined()

    const price = Object.values(doc().nodes).find((n) => n.type === 'text' && n.text === '$89.00' && n.visible)!
    S().setText(id, price.id, '$95.00')
    const second = await runExport(doc(), req(frames), h.deps)
    expect(second.ok && second.version).toBe(2)

    const md = String(h.written[1]['CHANGES.md'])
    expect(md.split('\n')[0]).toBe('# Changes since handoff v1')
    expect(md).toContain('**Rebuild only these:** Checkout.')
    expect(md).toContain('**Unchanged:** Receipt.')
    expect(md).toContain('### Checkout: changed')
    expect(md).toMatch(/text: "\$89\.00" → "\$95\.00"/)
    // exactly one layer in one screen: no false positives from the other 40-odd layers
    const spec = JSON.parse(String(h.written[1]['spec.json']))
    expect(spec.changes.counts).toEqual({ added: 0, removed: 0, changed: 1, unchanged: 1 })
    expect(spec.changes.screens.find((s: { name: string }) => s.name === 'Checkout').nodes).toHaveLength(1)
    expect(spec.changes.screens.find((s: { name: string }) => s.name === 'Receipt').status).toBe('unchanged')
  })

  it('leaks nothing hidden or unready in either bundle, edit or not', async () => {
    const d = sampleDesign()
    const h = history()
    const frames = [d.desktop, d.mobile, d.receipt]
    await runExport(doc(), req(frames), h.deps)
    S().setText(id, Object.values(doc().nodes).find((n) => n.text === 'Delivery')!.id, 'Shipping')
    await runExport(doc(), req(frames), h.deps)
    for (const files of h.written) {
      const text = Object.values(files).filter((v): v is string => typeof v === 'string').join('\n')
      for (const [k, v] of Object.entries(CANARY)) expect(text, `${k} canary`).not.toContain(v)
    }
    expect(String(h.written[1]['CHANGES.md'])).toMatch(/"Delivery" → "Shipping"/)
  })

  it('an unrelated edit to the unready frame changes nothing in the comparison', async () => {
    const d = sampleDesign()
    const h = history()
    const frames = [d.desktop, d.mobile, d.receipt]
    await runExport(doc(), req(frames), h.deps)
    const unreadyText = Object.values(doc().nodes).find((n) => n.text === CANARY.unready)!
    S().setText(id, unreadyText.id, 'Edited draft')
    await runExport(doc(), req(frames), h.deps)
    const md = String(h.written[1]['CHANGES.md'])
    expect(md).toContain('Nothing changed')
    expect(md).toContain('**Rebuild only these:** nothing.')
    expect(md).toContain('**Unchanged:** Checkout, Receipt.')
  })

  it('re-exporting without edits is stable: same counts, no changes', async () => {
    const d = sampleDesign()
    const h = history()
    const frames = [d.desktop, d.mobile, d.receipt]
    await runExport(doc(), req(frames), h.deps)
    await runExport(doc(), req(frames), h.deps)
    const spec = JSON.parse(String(h.written[1]['spec.json']))
    expect(spec.changes.counts).toEqual({ added: 0, removed: 0, changed: 0, unchanged: 2 })
  })
})
