// @vitest-environment jsdom
// The Export handoff dialog against the design (T58 D02 / D05, T65 design note): header with subtitle, singular and
// plural counts, grouping line from screen tags, warnings in one callout, wrapping tree, done line with assets and a
// path that wraps at separators, a prompt that names only written files; and the ready switch in the inspector.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { create } from 'zustand'

vi.mock('../canvas/toast', () => ({ toast: vi.fn() }))
vi.mock('../../history/versions', () => ({ listVersions: async () => [] }))
vi.mock('../inspector/fonts', () => ({ queryLocalFamilies: async () => null, GOOGLE_FONTS: [] }))
vi.mock('./exportDialog', () => {
  const useExportHandoff = create<{ docId: string | null; open: (id: string) => void; close: () => void }>((set) => ({
    docId: null,
    open: (docId) => set({ docId }),
    close: () => set({ docId: null })
  }))
  const written: Array<{ kind: string }> = []
  ;(globalThis as { __eh?: { mode: 'ok' | 'fail' | 'cancel'; written: Array<{ kind: string }> } }).__eh = { mode: 'ok', written }
  return {
    useExportHandoff,
    openExportHandoff: (id: string) => useExportHandoff.getState().open(id),
    appExportDeps: () => ({
      engine: { resize: async () => new Uint8Array([1]), renderPng: async () => new Uint8Array([137, 80]) },
      write: async (args: { files: Record<string, unknown>; name: string; kind: 'folder' | 'zip' }) => {
        written.push(args)
        const eh = (globalThis as unknown as { __eh: { mode: 'ok' | 'fail' | 'cancel' } }).__eh
        if (eh.mode === 'fail') return { ok: false, error: 'The folder is read-only or the disk is full.' }
        if (eh.mode === 'cancel') return { ok: false, canceled: true }
        return { ok: true, path: 'C:\\Users\\wayne\\Documents\\acme-handoff-v1', files: Object.keys(args.files).length, bytes: 2048, kind: args.kind }
      },
      saveVersion: async () => undefined,
      listVersions: async () => [{ name: 'Handoff v3', createdAt: Date.UTC(2026, 9, 12) }],
      now: () => '2026-10-13T12:00:00.000Z',
      vellum: '1.0.0'
    })
  }
})

import { getStore, useStore } from '../../model/store'
import { ExportHandoffDialog, groupingNotes, plural } from './ExportHandoffDialog'
import { ReadyRow } from './ReadyRow'
import { useExportHandoff } from './exportDialog'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const S = getStore
let id: string
let host: HTMLDivElement
let root: Root

const flush = async (ms = 400): Promise<void> => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms))
  })
}
const text = (): string => document.body.textContent ?? ''

afterEach(() => {
  act(() => root.unmount())
  document.body.innerHTML = ''
})

const eh = (): { mode: 'ok' | 'fail' | 'cancel'; written: Array<{ kind: string }> } => (globalThis as unknown as { __eh: { mode: 'ok' | 'fail' | 'cancel'; written: Array<{ kind: string }> } }).__eh
const button = (label: string): HTMLButtonElement => [...document.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement
const click = async (label: string, wait = 600): Promise<void> => {
  const b = button(label)
  if (!b) throw new Error(`no button ${label}`)
  await act(async () => {
    b.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, wait))
  })
}

beforeEach(() => {
  eh().mode = 'ok'
  eh().written.length = 0
  useStore.setState(useStore.getInitialState(), true)
  useExportHandoff.setState({ docId: null })
  id = S().createDoc('Acme', { open: false })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

function ready(name: string, width: number, tag?: { name: string; bp: string }): string {
  const f = S().createNode(id, { type: 'frame', name, style: { width, height: 300 } }, S().docs[id].pages[0].rootId)
  S().setReady(id, [f], 4)
  if (tag) S().setScreen(id, f, tag)
  return f
}

describe('counting words', () => {
  it('plural gives one and many', () => {
    expect(plural(1, 'screen')).toBe('1 screen')
    expect(plural(0, 'screen')).toBe('0 screens')
    expect(plural(3, 'asset')).toBe('3 assets')
    expect(plural(1, 'hidden layer')).toBe('1 hidden layer')
  })
  it('the grouping line names the tagged frames, widest first, with their widths', () => {
    const a = ready('A', 390, { name: 'Checkout', bp: 'Mobile' })
    const b = ready('B', 1280, { name: 'Checkout', bp: 'Desktop' })
    const c = ready('C', 768, { name: 'checkout', bp: 'Tablet' })
    const lone = ready('D', 500, { name: 'Settings', bp: 'Desktop' })
    expect(groupingNotes(S().docs[id], [a, b, c, lone])).toEqual(['Desktop, Tablet and Mobile export as one screen, Checkout, with three breakpoints (1280 / 768 / 390).'])
    expect(groupingNotes(S().docs[id], [lone])).toEqual([])
  })
})

describe('the dialog', () => {
  it('has a title with a subtitle that names the previous handoff, and groups tagged screens', async () => {
    ready('Desktop frame', 1280, { name: 'Checkout', bp: 'Desktop' })
    ready('Mobile frame', 390, { name: 'Checkout', bp: 'Mobile' })
    act(() => root.render(createElement(ExportHandoffDialog)))
    act(() => useExportHandoff.getState().open(id))
    await flush()
    const title = document.querySelector('.eh-title')
    expect(title?.textContent).toBe('Export handoff · v4')
    expect(document.querySelector('.eh-sub')?.textContent).toMatch(/^A folder \(or zip\) a developer puts next to their repo\. Needs no Vellum\. Previous handoff: v3, /)
    expect(document.querySelector('[data-testid="eh-grouping"]')?.textContent).toBe('Desktop and Mobile export as one screen, Checkout, with two breakpoints (1280 / 390).')
    expect(text()).toContain('Writes a decrypted copy')
  })

  it('counts are singular for one, and warnings sit in one callout box', async () => {
    const f = ready('Home', 400)
    S().createNode(id, { type: 'text', name: 'T', text: 'x', style: { fontFamily: 'Inter' } }, f)
    const hidden = S().createNode(id, { type: 'rect', name: 'Hid', style: { width: 1, height: 1 } }, f)
    S().updateNode(id, hidden, { visible: false })
    act(() => root.render(createElement(ExportHandoffDialog)))
    act(() => useExportHandoff.getState().open(id))
    await flush(800)
    const counts = [...document.querySelectorAll('.eh-counts > div')].map((d) => d.textContent)
    expect(counts[0]).toBe('1screen')
    expect(counts.join(' ')).toMatch(/1\s*font|1font/)
    expect(counts.join(' ')).not.toMatch(/1 ?screens|1 ?fonts/)
    const callout = document.querySelector('[data-testid="eh-callout"]')
    expect(callout).not.toBeNull()
    expect(callout?.textContent).toContain('1 hidden layer is left out.')
    expect(document.querySelector('ul.eh-warn')).toBeNull()
    expect(document.querySelectorAll('.eh-tree')).toHaveLength(1)
  })

  it('exports, then says screens, layers, assets and size, wraps the path at separators and copies a prompt of written files', async () => {
    ready('Home', 400)
    const written: string[] = []
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t: string) => void written.push(t) }, configurable: true })
    act(() => root.render(createElement(ExportHandoffDialog)))
    act(() => useExportHandoff.getState().open(id))
    await flush(800)
    const exportBtn = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Export folder…') as HTMLButtonElement
    await act(async () => {
      exportBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 600))
    })
    expect(document.querySelector('.c-modal__title')?.textContent).toBe('Handoff v4 exported')
    expect(document.querySelector('.eh-ok')?.textContent).toMatch(/^1 screen, \d+ layers?, 0 assets, 2 KB$/)
    const path = document.querySelector('.eh-path') as HTMLElement
    expect(path.textContent).toBe('C:\\Users\\wayne\\Documents\\acme-handoff-v1')
    expect(path.querySelectorAll('wbr').length).toBeGreaterThanOrEqual(4)
    const copy = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Copy prompt') as HTMLButtonElement
    await act(async () => {
      copy.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(written[0]).toBe('Read HANDOFF.md first; build and verify against screens/*.png')
  })
})

describe('the other states of the dialog', () => {
  const open = async (): Promise<void> => {
    act(() => root.render(createElement(ExportHandoffDialog)))
    act(() => useExportHandoff.getState().open(id))
    await flush(800)
  }

  it('nothing ready: the empty state, then the frames can be chosen anyway with a banner', async () => {
    S().createNode(id, { type: 'frame', name: 'Draft', style: { width: 100, height: 100 } }, S().docs[id].pages[0].rootId)
    await open()
    expect(text()).toContain('No screens are ready for dev')
    expect(button('Choose frames anyway')).toBeDefined()
    await click('Choose frames anyway', 100)
    expect(text()).toContain('These frames are not all marked ready.')
    expect(text()).toContain('Not ready')
    expect(text()).toContain('Tick at least one screen.')
    expect(button('Export folder…').disabled).toBe(true)
  })

  it('a file with no frames says there is nothing to export', async () => {
    await open()
    expect(text()).toContain('Nothing to export')
  })

  it('a failed write shows the reason and that nothing was written, and goes back to the form', async () => {
    ready('Home', 400)
    eh().mode = 'fail'
    await open()
    await click('Export folder…')
    expect(document.querySelector('.c-modal__title')?.textContent).toBe('Could not export')
    expect(document.querySelector('.eh-error')?.textContent).toBe('The folder is read-only or the disk is full.')
    expect(text()).toContain('Nothing was written')
    await click('Choose another folder…', 300)
    expect(document.querySelector('.eh-title')?.textContent).toMatch(/^Export handoff · v/)
  })

  it('cancelling the save dialog returns to the form without an error', async () => {
    ready('Home', 400)
    eh().mode = 'cancel'
    await open()
    await click('Export folder…')
    expect(document.querySelector('.eh-title')).not.toBeNull()
    expect(text()).not.toContain('Could not export')
    expect(button('Export folder…').disabled).toBe(false)
  })

  it('Save as zip sends kind zip and the done state offers the file', async () => {
    ready('Home', 400)
    await open()
    await click('Save as zip…')
    expect(eh().written.map((w) => w.kind)).toEqual(['zip'])
    expect(button('Show file')).toBeDefined()
  })
})

describe('the ready row in the inspector', () => {
  it('is a switch that marks and clears, and shows the amber line when changed', async () => {
    const f = S().createNode(id, { type: 'frame', name: 'Home', style: { width: 400, height: 300 } }, S().docs[id].pages[0].rootId)
    act(() => root.render(createElement(ReadyRow, { docId: id, id: f })))
    const sw = host.querySelector('button[role="switch"]') as HTMLButtonElement
    expect(sw).not.toBeNull()
    expect(sw.getAttribute('aria-checked')).toBe('false')
    expect(host.querySelector('input[type="checkbox"]')).toBeNull()
    await act(async () => {
      sw.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 50))
    })
    expect(S().docs[id].nodes[f].dev?.ready?.at).toBe(1)
    expect((host.querySelector('button[role="switch"]') as HTMLButtonElement).getAttribute('aria-checked')).toBe('true')
    // a change inside the frame
    S().createNode(id, { type: 'rect', name: 'New', style: { width: 5, height: 5 } }, f)
    act(() => root.render(createElement(ReadyRow, { docId: id, id: f })))
    expect(host.textContent).toContain('Changed since v1')
  })
})
