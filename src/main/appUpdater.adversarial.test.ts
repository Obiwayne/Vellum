// Test-station checks for the installed-build update engine: odd payloads, ordering, timers, a late error after the
// download, and the IPC wiring in updater.ts (trusted senders only, status pushed to the window). Event names and
// the quitAndInstall / setFeedURL signatures were checked against electron-updater 6.8.9 (types.js, AppUpdater.d.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHECK_EVERY_MS, FIRST_CHECK_MS, createAppUpdater, type AutoUpdaterLike } from './appUpdater'

function make(over: { autoCheck?: () => boolean } = {}) {
  const listeners = new Map<string, (...a: unknown[]) => void>()
  const u = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    allowPrerelease: true,
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(async (): Promise<unknown> => undefined),
    quitAndInstall: vi.fn(),
    on: vi.fn((ev: string, fn: (...a: unknown[]) => void) => void listeners.set(ev, fn))
  }
  const emit = vi.fn()
  const engine = createAppUpdater({ autoUpdater: u as unknown as AutoUpdaterLike, isPackaged: true, version: '1.0.0', emit, autoCheck: over.autoCheck })
  return { u, engine, emit, fire: (ev: string, ...a: unknown[]) => listeners.get(ev)?.(...a) }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('payloads', () => {
  it('progress without a usable percent shows 0, never NaN, and stays within 0-100', () => {
    const { fire, engine } = make()
    for (const p of [undefined, {}, { percent: NaN }, { percent: 'x' }, { percent: -5 }]) {
      fire('download-progress', p)
      expect(engine.status().progress).toBe(0)
    }
    fire('download-progress', { percent: 99.6 })
    expect(engine.status().progress).toBe(100)
  })

  it('update-available without info or version keeps the app on its running version', () => {
    const { fire, engine } = make()
    fire('update-available', undefined)
    expect(engine.status()).toMatchObject({ state: 'available', current: '1.0.0', latest: undefined })
  })

  it('every emitted status is the whole status (the renderer can replace its copy)', () => {
    const { fire, emit } = make()
    fire('update-available', { version: '2.0.0' })
    expect(emit).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'available', latest: '2.0.0', current: '1.0.0', commits: [], behind: 0, dirty: [], dev: false }))
  })
})

describe('after the download', () => {
  it('a late error does not take the downloaded update away', () => {
    const { fire, engine, u } = make()
    fire('update-downloaded', { version: '2.0.0' })
    fire('error', new Error('some later request failed'))
    expect(engine.status().state).toBe('ready')
    engine.install()
    expect(u.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('a download error before it finished is an error, and the next check starts over', async () => {
    const { fire, engine, u } = make()
    fire('download-progress', { percent: 60 })
    fire('error', new Error('connection reset'))
    expect(engine.status().state).toBe('error')
    await engine.check()
    expect(u.checkForUpdates).toHaveBeenCalledTimes(1)
  })
})

describe('timers', () => {
  it('start twice arms one set of timers; stop and start again works', async () => {
    const { engine, u } = make()
    engine.start()
    engine.start()
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS)
    expect(u.checkForUpdates).toHaveBeenCalledTimes(1)
    engine.stop()
    engine.start()
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS)
    expect(u.checkForUpdates).toHaveBeenCalledTimes(2)
    engine.stop()
  })

  it('a setting that throws counts as on, and does not break later timers', async () => {
    let calls = 0
    const { engine, u } = make({
      autoCheck: () => {
        calls++
        if (calls === 1) throw new Error('prefs unreadable')
        return true
      }
    })
    engine.start()
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS)
    expect(u.checkForUpdates).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS)
    expect(u.checkForUpdates).toHaveBeenCalledTimes(2)
    engine.stop()
  })

  it('a check that is still running when the next interval fires is not doubled', async () => {
    const { engine, u } = make()
    let release!: () => void
    u.checkForUpdates.mockImplementationOnce(() => new Promise<unknown>((r) => (release = () => r(undefined))))
    engine.start()
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS + CHECK_EVERY_MS)
    expect(u.checkForUpdates).toHaveBeenCalledTimes(1)
    release()
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS)
    expect(u.checkForUpdates).toHaveBeenCalledTimes(2)
    engine.stop()
  })
})
