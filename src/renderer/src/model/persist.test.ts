// @vitest-environment jsdom
// Saving and crash recovery in the renderer: debounce with a max wait, recovery copies while edits are pending,
// flush on blur, and the offer to restore unsaved changes at start. The main-process half is in main/crashSafe.test.ts.
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoredDoc } from '@shared/api'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Api = {
  loadIndex: ReturnType<typeof vi.fn>
  listDocs: ReturnType<typeof vi.fn>
  loadDoc: ReturnType<typeof vi.fn>
  saveDoc: ReturnType<typeof vi.fn>
  deleteDoc: ReturnType<typeof vi.fn>
  saveIndex: ReturnType<typeof vi.fn>
  saveRecovery: ReturnType<typeof vi.fn>
  listRecoveries: ReturnType<typeof vi.fn>
  discardRecovery: ReturnType<typeof vi.fn>
  takeRestored: ReturnType<typeof vi.fn>
}

const stored = (id: string, name: string, updatedAt: number): StoredDoc =>
  ({ id, name, updatedAt, version: 5, pages: [{ id: 'p', name: 'Page 1', rootId: 'r', background: '#282828' }], nodes: { r: { id: 'r', type: 'frame', name: 'Page 1', parent: null, children: [], style: {}, x: 0, y: 0, visible: true, locked: false } }, tokens: [], nextId: 2, createdAt: 1 }) as unknown as StoredDoc

let api: Api
let saved: StoredDoc[]

/** a fresh renderer: the persistence module is a singleton, so every test re-imports it with a mocked canvasApi */
async function boot(opts: { docs?: StoredDoc[]; recoveries?: StoredDoc[]; restored?: string[]; recoveriesFail?: boolean } = {}) {
  vi.resetModules()
  saved = opts.docs ?? [stored('a', 'Alpha', 100)]
  api = {
    loadIndex: vi.fn(async () => ({ recents: saved.map((d) => d.id), tabs: ['dashboard'], activeTab: 'dashboard', prefs: {}, scratchpadId: saved[0].id })),
    listDocs: vi.fn(async () => saved.map((d) => ({ id: d.id, name: d.name, updatedAt: d.updatedAt, archived: false }))),
    loadDoc: vi.fn(async (id: string) => saved.find((d) => d.id === id) ?? null),
    saveDoc: vi.fn(async () => undefined),
    deleteDoc: vi.fn(async () => undefined),
    saveIndex: vi.fn(async () => undefined),
    saveRecovery: vi.fn(async () => undefined),
    listRecoveries: vi.fn(async () => {
      if (opts.recoveriesFail) throw new Error('boom')
      return opts.recoveries ?? []
    }),
    discardRecovery: vi.fn(async () => undefined),
    takeRestored: vi.fn(async () => opts.restored ?? [])
  }
  ;(window as unknown as { canvasApi: Api }).canvasApi = api
  const store = await import('./store')
  const persist = await import('./persist')
  const recovery = await import('./recovery')
  await persist.initPersistence()
  return { ...store, persist, recovery }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  delete (window as unknown as { canvasApi?: Api }).canvasApi
})

/** advance fake time and let pending promises settle */
const tick = async (ms: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms)
}
const edit = (s: { useStore: typeof import('./store').useStore }, id: string, n: number): void => {
  s.useStore.getState().updateStyles(id, [s.useStore.getState().docs[id].pages[0].rootId], { width: 100 + n })
}

describe('saving: debounce, max wait, recovery copies', () => {
  it('saves 500 ms after the last edit, and writes a recovery copy 120 ms after the first', async () => {
    const s = await boot()
    api.saveDoc.mockClear()
    edit(s, 'a', 1)
    await tick(100)
    expect(api.saveRecovery).not.toHaveBeenCalled()
    await tick(40)
    expect(api.saveRecovery).toHaveBeenCalledTimes(1)
    expect((api.saveRecovery.mock.calls[0][0] as StoredDoc).id).toBe('a')
    expect(api.saveDoc).not.toHaveBeenCalled()
    await tick(400)
    expect(api.saveDoc).toHaveBeenCalledTimes(1)
    // after the save nothing more is written for it
    api.saveRecovery.mockClear()
    await tick(2000)
    expect(api.saveRecovery).not.toHaveBeenCalled()
    expect(api.saveDoc).toHaveBeenCalledTimes(1)
  })

  it('constant editing still saves at least every 2 s (the trailing debounce alone would never fire)', async () => {
    const s = await boot()
    api.saveDoc.mockClear()
    for (let i = 0; i < 30; i++) {
      edit(s, 'a', i)
      await tick(100) // an edit every 100 ms for 3 s: never 500 ms of quiet
    }
    expect(api.saveDoc.mock.calls.length).toBeGreaterThanOrEqual(1)
    const first = api.saveDoc.mock.calls.length
    expect(first).toBeLessThanOrEqual(2)
    // the recovery copy is not rewritten on every edit: the first soon, later ones throttled (a save also restarts the cycle)
    expect(api.saveRecovery.mock.calls.length).toBeGreaterThanOrEqual(1)
    expect(api.saveRecovery.mock.calls.length).toBeLessThanOrEqual(3)
    await tick(1000)
    expect(api.saveDoc.mock.calls.length).toBeGreaterThan(first) // and the tail end lands after the edits stop
  })

  it('leaving the window flushes pending edits at once', async () => {
    const s = await boot()
    api.saveDoc.mockClear()
    edit(s, 'a', 1)
    await tick(50)
    window.dispatchEvent(new Event('blur'))
    expect(api.saveDoc).toHaveBeenCalledTimes(1)
    await tick(1000)
    expect(api.saveDoc).toHaveBeenCalledTimes(1) // not saved a second time
    edit(s, 'a', 2)
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(api.saveDoc).toHaveBeenCalledTimes(2)
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  })

  it('a deleted design stops its pending recovery copy and save', async () => {
    const s = await boot({ docs: [stored('a', 'Alpha', 100), stored('b', 'Beta', 100)] })
    api.saveDoc.mockClear()
    edit(s, 'b', 1)
    s.useStore.getState().deleteDoc('b')
    await tick(2000)
    expect(api.saveDoc.mock.calls.map((c) => (c[0] as StoredDoc).id)).not.toContain('b')
    expect(api.saveRecovery.mock.calls.map((c) => (c[0] as StoredDoc).id)).not.toContain('b')
    expect(api.deleteDoc).toHaveBeenCalledWith('b')
  })

  it('loading and the first startup writes do not leave recovery copies', async () => {
    await boot()
    await tick(3000)
    expect(api.saveRecovery).not.toHaveBeenCalled()
  })
})

describe('restoring after a crash', () => {
  it('offers a recovery copy that is newer than the saved file, and nothing for one that is not', async () => {
    const s = await boot({
      docs: [stored('a', 'Alpha', 100), stored('b', 'Beta', 100), stored('c', 'Gamma', 100)],
      recoveries: [stored('a', 'Alpha edited', 200), stored('b', 'Beta old copy', 100), stored('c', 'Gamma older', 50), stored('new', 'Never saved', 300)]
    })
    const items = s.recovery.useRecovery.getState().items.map((i) => [i.doc.id, i.doc.name, i.existing])
    expect(items).toEqual([['a', 'Alpha edited', true], ['new', 'Never saved', false]])
    expect(api.discardRecovery.mock.calls.map((c) => c[0]).sort()).toEqual(['b', 'c']) // as new as the file: nothing lost
  })

  it('Restore puts the recovered design in place and saves it (which deletes the copy in main)', async () => {
    const s = await boot({ recoveries: [stored('a', 'Alpha edited', 200)] })
    api.saveDoc.mockClear()
    s.recovery.restoreRecovery('a')
    expect(s.useStore.getState().docs.a.name).toBe('Alpha edited')
    expect(s.recovery.useRecovery.getState().items).toEqual([])
    await tick(1000)
    expect(api.saveDoc.mock.calls.map((c) => (c[0] as StoredDoc).name)).toContain('Alpha edited')
  })

  it('Restore of a design that was never saved adds it to the recents', async () => {
    const s = await boot({ recoveries: [stored('fresh', 'Fresh', 300)] })
    s.recovery.restoreRecovery('fresh')
    expect(s.useStore.getState().docs.fresh.name).toBe('Fresh')
    expect(s.useStore.getState().recents[0]).toBe('fresh')
  })

  it('Discard keeps the saved design and removes the copy', async () => {
    const s = await boot({ recoveries: [stored('a', 'Alpha edited', 200)] })
    s.recovery.discardRecovery('a')
    expect(s.useStore.getState().docs.a.name).toBe('Alpha')
    expect(api.discardRecovery).toHaveBeenCalledWith('a')
    expect(s.recovery.useRecovery.getState().items).toEqual([])
  })

  it('files read from their backup are announced in plain words', async () => {
    const s = await boot({ restored: ['files/a.json', 'index.json', 'profiles.json', 'files/ghost.json'] })
    const notes = s.recovery.useRecovery.getState().notices
    expect(notes[0]).toContain('"Alpha"')
    expect(notes[0]).toContain('restored from its last backup')
    expect(notes[1]).toContain('recent files')
    expect(notes[2]).toContain('profiles')
    expect(notes[3]).toMatch(/^A design could not be read/)
  })

  it('a failing recovery check never breaks startup', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const s = await boot({ recoveriesFail: true })
    expect(s.useStore.getState().ready).toBe(true)
    expect(s.recovery.useRecovery.getState().items).toEqual([])
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })

  it('the prompt names the design once and asks "Restore them?"; its buttons restore or discard', async () => {
    const s = await boot({ recoveries: [stored('a', 'Alpha edited', 200), stored('new', 'Never saved', 300)] })
    const { RecoveryPrompt } = await import('../shell/RecoveryPrompt')
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => root.render(createElement(RecoveryPrompt)))
    expect(document.body.textContent).toContain('last changes to Alpha edited were saved. Restore them?')
    expect(document.body.textContent).toContain('1 more after this one')
    await act(async () => document.querySelector<HTMLButtonElement>('[data-recovery="restore"]')!.click())
    expect(s.useStore.getState().docs.a.name).toBe('Alpha edited')
    expect(document.body.textContent).toContain('last changes to Never saved were saved. Restore them?')
    await act(async () => document.querySelector<HTMLButtonElement>('[data-recovery="discard"]')!.click())
    expect(api.discardRecovery).toHaveBeenCalledWith('new')
    expect(s.useStore.getState().docs.new).toBeUndefined()
    expect(document.querySelector('[data-recovery-prompt]')).toBeNull()
    await act(async () => root.unmount())
    host.remove()
  })

  it('notices alone get an OK button that dismisses them', async () => {
    const s = await boot({ restored: ['index.json'] })
    const { RecoveryPrompt } = await import('../shell/RecoveryPrompt')
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => root.render(createElement(RecoveryPrompt)))
    expect(document.querySelector('[data-recovery-notice]')?.textContent).toContain('recent files')
    await act(async () => document.querySelector<HTMLButtonElement>('[data-recovery="ok"]')!.click())
    expect(s.recovery.useRecovery.getState().notices).toEqual([])
    expect(document.querySelector('[data-recovery-prompt]')).toBeNull()
    await act(async () => root.unmount())
    host.remove()
  })
})

describe('postponing', () => {
  it('closing the prompt keeps the copy on disk (no discard) and hides it for this session', async () => {
    const s = await boot({ recoveries: [stored('a', 'Alpha edited', 200)] })
    s.recovery.postponeRecovery()
    expect(s.recovery.useRecovery.getState().items).toEqual([])
    expect(api.discardRecovery).not.toHaveBeenCalled()
    expect(s.useStore.getState().docs.a.name).toBe('Alpha') // nothing restored either
  })
})

describe('recovery copy throttling', () => {
  it('writes the first copy after 120 ms, then at most once every 3 s while edits keep arriving, always the newest state', async () => {
    const s = await boot()
    api.saveDoc.mockClear()
    // inside one save cycle (the 2 s max wait ends it): one copy soon, no more while the edits go on
    edit(s, 'a', 1)
    await tick(130)
    expect(api.saveRecovery).toHaveBeenCalledTimes(1)
    for (let i = 2; i < 12; i++) {
      edit(s, 'a', i)
      await tick(100) // 1 s of edits: no second copy yet
    }
    expect(api.saveRecovery).toHaveBeenCalledTimes(1)
    // a save (max wait 2 s) starts a new cycle: the next edit gets a quick copy again
    await tick(1500)
    expect(api.saveDoc).toHaveBeenCalled()
    api.saveRecovery.mockClear()
    edit(s, 'a', 99)
    await tick(130)
    expect(api.saveRecovery).toHaveBeenCalledTimes(1)
    expect((api.saveRecovery.mock.calls[0][0] as StoredDoc & { nodes: Record<string, { style: Record<string, number> }> }).nodes.r.style.width).toBe(199)
  })
})
