// The git updater must never run git or npm in a packaged (installer) build, even if a .git folder is somehow present, and must
// keep working as before for a git clone.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (e: unknown, ...a: unknown[]) => unknown
const handlers = new Map<string, Handler>()
const state = { packaged: false, hasGit: false }
const execFile = vi.fn()
const spawn = vi.fn()

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return state.packaged
    },
    getAppPath: () => 'C:\\app',
    getVersion: () => '1.0.0',
    relaunch: vi.fn(),
    quit: vi.fn()
  },
  ipcMain: { handle: (ch: string, fn: Handler) => handlers.set(ch, fn) }
}))
vi.mock('child_process', () => ({
  execFile: (...a: unknown[]) => execFile(...a),
  spawn: (...a: unknown[]) => spawn(...a)
}))
vi.mock('fs', () => ({
  existsSync: () => state.hasGit,
  writeFileSync: vi.fn()
}))

const trusted = (): boolean => true
const load = async (opts?: import('./updater').UpdaterOptions) => {
  vi.resetModules()
  handlers.clear()
  const mod = await import('./updater')
  mod.startUpdater(() => null, trusted, opts)
  const { IPC } = await import('@shared/api')
  return {
    status: () => handlers.get(IPC.updStatus)!({}) as Promise<{ state: string; message?: string; commits: unknown[]; behind: number }>,
    check: () => handlers.get(IPC.updCheck)!({}) as Promise<{ state: string; message?: string; commits: unknown[]; behind: number }>,
    install: () => handlers.get(IPC.updInstall)!({}) as Promise<{ state: string; message?: string }>
  }
}

beforeEach(() => {
  execFile.mockReset()
  spawn.mockReset()
  state.packaged = false
  state.hasGit = false
  vi.useRealTimers()
  process.env.VELLUM_NO_UPDATE_CHECK = '1'
})

const noUpdater = { loadAutoUpdater: (): never => { throw new Error('electron-updater is not installed') } }

// T50: a packed app whose electron-updater cannot be loaded (missing from app.asar) used to say "unsupported" and "download the
// installer", as if updates were never meant to run there. That hides a packaging defect: it has to show up as an error.
describe('packaged build where electron-updater cannot be loaded (T50)', () => {
  it('reports an error that names the problem, never "unsupported"', async () => {
    state.packaged = true
    const u = await load(noUpdater)
    const s = await u.check()
    expect(s.state).toBe('error')
    expect(s.message).toMatch(/electron-updater/i)
    expect((await u.status()).state).not.toBe('unsupported')
    expect(execFile).not.toHaveBeenCalled()
    expect(spawn).not.toHaveBeenCalled()
  })
})

describe('packaged build where electron-updater cannot be loaded: reporting (T50 test station)', () => {
  const start = async (win: unknown) => {
    vi.resetModules()
    handlers.clear()
    state.packaged = true
    const mod = await import('./updater')
    const { IPC } = await import('@shared/api')
    mod.startUpdater(() => win as never, () => true, noUpdater)
    return { IPC, call: (ch: string) => handlers.get(ch)!({}) as Promise<{ state: string; message?: string }> }
  }

  it('tells the window right away, and the message carries the reason from the loader', async () => {
    const send = vi.fn()
    const { IPC } = await start({ isDestroyed: () => false, webContents: { send } })
    expect(send).toHaveBeenCalledWith(IPC.updChanged, expect.objectContaining({ state: 'error', message: expect.stringContaining('electron-updater is not installed') }))
  })

  it('install and check keep saying error, and never run git or npm', async () => {
    state.hasGit = true
    const { IPC, call } = await start(null)
    expect((await call(IPC.updInstall)).state).toBe('error')
    expect((await call(IPC.updCheck)).state).toBe('error')
    expect((await call(IPC.updStatus)).state).toBe('error')
    expect(execFile).not.toHaveBeenCalled()
    expect(spawn).not.toHaveBeenCalled()
  })

  it('a clone without .git is still "unsupported" (unchanged)', async () => {
    state.packaged = false
    vi.resetModules()
    handlers.clear()
    const mod = await import('./updater')
    const { IPC } = await import('@shared/api')
    mod.startUpdater(() => null, () => true)
    expect((await (handlers.get(IPC.updCheck)!({}) as Promise<{ state: string }>)).state).toBe('unsupported')
  })
})

describe('packaged build without electron-updater', () => {
  it('starts as an error, and a check says so without running git or npm', async () => {
    state.packaged = true
    const u = await load(noUpdater)
    expect((await u.status()).state).toBe('error')
    const s = await u.check()
    expect(s.state).toBe('error')
    expect(s.message).toMatch(/electron-updater.*could not be loaded/i)
    expect(s.message).toMatch(/not installed/) // the reason from the loader
    expect(s.commits).toEqual([])
    expect(s.behind).toBe(0)
    expect(execFile).not.toHaveBeenCalled()
    expect(spawn).not.toHaveBeenCalled()
  })

  it('stays disabled even when a .git folder exists next to the app', async () => {
    state.packaged = true
    state.hasGit = true
    const u = await load(noUpdater)
    expect((await u.check()).state).toBe('error')
    expect(execFile).not.toHaveBeenCalled()
  })

  it('install is refused and never runs git or npm', async () => {
    state.packaged = true
    state.hasGit = true
    const u = await load(noUpdater)
    const s = await u.install()
    expect(s.state).toBe('error')
    expect(execFile).not.toHaveBeenCalled()
    expect(spawn).not.toHaveBeenCalled()
  })

  it('schedules no background checks', async () => {
    vi.useFakeTimers()
    delete process.env.VELLUM_NO_UPDATE_CHECK
    state.packaged = true
    state.hasGit = true
    await load(noUpdater)
    await vi.advanceTimersByTimeAsync(5 * 60 * 60 * 1000)
    expect(execFile).not.toHaveBeenCalled()
  })
})

describe('git clone (not packaged)', () => {
  it('without a .git folder the copy cannot update itself, and no command runs', async () => {
    const u = await load()
    const s = await u.check()
    expect(s.state).toBe('unsupported')
    expect(s.message).toMatch(/git clone/)
    expect(execFile).not.toHaveBeenCalled()
  })

  it('with a .git folder the check runs git as before', async () => {
    state.hasGit = true
    execFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (e: Error | null, out: string, err: string) => void) => cb(new Error('git is not installed'), '', 'not recognized'))
    const u = await load()
    const s = await u.check()
    expect(execFile).toHaveBeenCalled()
    expect(execFile.mock.calls[0][0]).toBe('git')
    expect(s.state).toBe('error')
    expect(s.message).toMatch(/Git is not installed/)
  })
})

describe('packaged build with electron-updater', () => {
  const mock = () => {
    const listeners = new Map<string, (...a: unknown[]) => void>()
    const u = {
      autoDownload: false,
      autoInstallOnAppQuit: false,
      allowPrerelease: false,
      setFeedURL: vi.fn(),
      checkForUpdates: vi.fn(async () => undefined),
      quitAndInstall: vi.fn(),
      on: (ev: string, fn: (...a: unknown[]) => void) => void listeners.set(ev, fn)
    }
    return { u, fire: (ev: string, ...a: unknown[]) => listeners.get(ev)?.(...a) }
  }

  it('the update IPC goes to electron-updater: check, progress, ready, then restart on request, and never git or npm', async () => {
    state.packaged = true
    state.hasGit = true
    const m = mock()
    const u = await load({ loadAutoUpdater: () => m.u as never })
    expect((await u.status()).state).toBe('idle')
    await u.check()
    expect(m.u.checkForUpdates).toHaveBeenCalledTimes(1)
    m.fire('update-available', { version: '2.0.0' })
    m.fire('download-progress', { percent: 30 })
    expect(await u.status()).toMatchObject({ state: 'downloading', progress: 30, latest: '2.0.0' })
    expect((await u.install()).state).toBe('downloading')
    expect(m.u.quitAndInstall).not.toHaveBeenCalled()
    m.fire('update-downloaded', { version: '2.0.0' })
    await u.install()
    expect(m.u.quitAndInstall).toHaveBeenCalledTimes(1)
    expect(execFile).not.toHaveBeenCalled()
    expect(spawn).not.toHaveBeenCalled()
  })

  it('polls the feed 15 s after start (unless VELLUM_NO_UPDATE_CHECK is set) and never git', async () => {
    vi.useFakeTimers()
    delete process.env.VELLUM_NO_UPDATE_CHECK
    state.packaged = true
    state.hasGit = true
    const m = mock()
    await load({ loadAutoUpdater: () => m.u as never })
    const { IPC } = await import('@shared/api')
    await handlers.get(IPC.updAuto)!({ trustedCaller: true }, true) // the renderer has loaded the setting: on
    await vi.advanceTimersByTimeAsync(15_000)
    expect(m.u.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(execFile).not.toHaveBeenCalled()
  })

  it('the test feed is used only here, in a packaged build', async () => {
    process.env.VELLUM_UPDATE_URL = 'http://127.0.0.1:9/feed'
    try {
      state.packaged = true
      const m = mock()
      await load({ loadAutoUpdater: () => m.u as never })
      expect(m.u.setFeedURL).toHaveBeenCalledWith({ provider: 'generic', url: 'http://127.0.0.1:9/feed' })
      state.packaged = false
      const clone = mock()
      await load({ loadAutoUpdater: () => clone.u as never })
      expect(clone.u.setFeedURL).not.toHaveBeenCalled()
      expect(clone.u.checkForUpdates).not.toHaveBeenCalled()
    } finally {
      delete process.env.VELLUM_UPDATE_URL
    }
  })

  it('a clone never loads electron-updater at all', async () => {
    const loader = vi.fn()
    await load({ loadAutoUpdater: loader })
    expect(loader).not.toHaveBeenCalled()
  })
})

describe('packaged build: IPC wiring', () => {
  const engineMock = () => {
    const listeners = new Map<string, (...a: unknown[]) => void>()
    return {
      u: {
        autoDownload: false,
        autoInstallOnAppQuit: false,
        allowPrerelease: false,
        setFeedURL: vi.fn(),
        checkForUpdates: vi.fn(async () => undefined),
        quitAndInstall: vi.fn(),
        on: (ev: string, fn: (...a: unknown[]) => void) => void listeners.set(ev, fn)
      },
      fire: (ev: string, ...a: unknown[]) => listeners.get(ev)?.(...a)
    }
  }
  const start = async (win: unknown, isTrusted: boolean, m = engineMock(), env: Record<string, string> = {}) => {
    vi.resetModules()
    handlers.clear()
    state.packaged = true
    for (const [k, v] of Object.entries(env)) process.env[k] = v
    const mod = await import('./updater')
    const { IPC } = await import('@shared/api')
    mod.startUpdater(() => win as never, () => isTrusted, { loadAutoUpdater: () => m.u as never })
    return { m, IPC, call: (ch: string) => handlers.get(ch)!({}) }
  }

  it('an untrusted sender gets nothing from status, check or install, and nothing runs', async () => {
    const { m, IPC, call } = await start(null, false)
    expect(await call(IPC.updStatus)).toBeNull()
    expect(await call(IPC.updCheck)).toBeNull()
    expect(await call(IPC.updInstall)).toBeNull()
    expect(m.u.checkForUpdates).not.toHaveBeenCalled()
    m.fire('update-downloaded', {})
    expect(await call(IPC.updInstall)).toBeNull()
    expect(m.u.quitAndInstall).not.toHaveBeenCalled()
  })

  it('every status change is pushed to the window, and a destroyed or missing window is skipped', async () => {
    const send = vi.fn()
    const win = { isDestroyed: () => false, webContents: { send } }
    const { m, IPC } = await start(win, true)
    m.fire('update-available', { version: '3.0.0' })
    expect(send).toHaveBeenCalledWith(IPC.updChanged, expect.objectContaining({ state: 'available', latest: '3.0.0' }))
    const dead = { isDestroyed: () => true, webContents: { send: vi.fn() } }
    const d = await start(dead, true)
    d.m.fire('update-available', { version: '3.0.0' })
    expect(dead.webContents.send).not.toHaveBeenCalled()
    const none = await start(null, true)
    expect(() => none.m.fire('update-available', { version: '3.0.0' })).not.toThrow()
  })

  it('an empty VELLUM_UPDATE_URL is ignored', async () => {
    const { m } = await start(null, true, engineMock(), { VELLUM_UPDATE_URL: '' })
    expect(m.u.setFeedURL).not.toHaveBeenCalled()
    delete process.env.VELLUM_UPDATE_URL
  })
})

describe('"Check for updates automatically" setting (updates:auto)', () => {
  const setAuto = async (on: unknown, trustedCaller = true): Promise<void> => {
    const { IPC } = await import('@shared/api')
    const h = handlers.get(IPC.updAuto)!
    await h({ trustedCaller }, on)
  }
  const mockU = () => ({ autoDownload: false, autoInstallOnAppQuit: false, allowPrerelease: false, setFeedURL: vi.fn(), checkForUpdates: vi.fn(async () => undefined), quitAndInstall: vi.fn(), on: vi.fn() })

  it('installed build: the timed check is skipped while off, runs when on, and Check for Updates still works', async () => {
    vi.useFakeTimers()
    delete process.env.VELLUM_NO_UPDATE_CHECK
    state.packaged = true
    const m = mockU()
    const u = await load({ loadAutoUpdater: () => m as never })
    await setAuto(false)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(m.checkForUpdates).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000)
    expect(m.checkForUpdates).not.toHaveBeenCalled()
    await u.check() // the manual check ignores the setting
    expect(m.checkForUpdates).toHaveBeenCalledTimes(1)
    await setAuto(true)
    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000)
    expect(m.checkForUpdates.mock.calls.length).toBeGreaterThan(1)
  })

  it('clone: the timed git check follows the setting too', async () => {
    vi.useFakeTimers()
    delete process.env.VELLUM_NO_UPDATE_CHECK
    state.hasGit = true
    execFile.mockImplementation((_c: string, _a: string[], _o: unknown, cb: (e: Error | null, out: string, err: string) => void) => cb(new Error('x'), '', 'not recognized'))
    await load()
    await setAuto(false)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(execFile).not.toHaveBeenCalled()
    await setAuto(true)
    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000)
    expect(execFile).toHaveBeenCalled()
  })

  it('a non-boolean or untrusted sender cannot set it', async () => {
    vi.useFakeTimers()
    delete process.env.VELLUM_NO_UPDATE_CHECK
    state.packaged = true
    const m = mockU()
    vi.resetModules()
    handlers.clear()
    const mod = await import('./updater')
    const { IPC } = await import('@shared/api')
    let ok = true
    mod.startUpdater(() => null, () => ok, { loadAutoUpdater: () => m as never })
    const h = handlers.get(IPC.updAuto)!
    await h({}, 'yes')
    await h({}, 1)
    ok = false
    await h({}, true) // untrusted: ignored
    ok = true
    await vi.advanceTimersByTimeAsync(15_000)
    expect(m.checkForUpdates).not.toHaveBeenCalled() // still unknown
    await h({}, true)
    expect(m.checkForUpdates).toHaveBeenCalledTimes(1) // a trusted true arrives late: the skipped first check runs now
  })

  describe('the setting is unknown until the renderer has loaded it from the profile (T48 QA)', () => {
    it('installed build: no timed check before the first setAutoCheck; one right after setAutoCheck(true) when the first timed check has passed', async () => {
      vi.useFakeTimers()
      delete process.env.VELLUM_NO_UPDATE_CHECK
      state.packaged = true
      const m = mockU()
      await load({ loadAutoUpdater: () => m as never })
      await vi.advanceTimersByTimeAsync(15_000) // a locked profile: nothing pushed yet
      expect(m.checkForUpdates).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000 - 15_000) // not at the next interval either, while still unknown
      expect(m.checkForUpdates).not.toHaveBeenCalled()
      await setAuto(true)
      expect(m.checkForUpdates).toHaveBeenCalledTimes(1)
      await setAuto(true) // further pushes do not trigger another
      expect(m.checkForUpdates).toHaveBeenCalledTimes(1)
    })

    it('a user who turned it off is never checked, however long the profile stayed locked', async () => {
      vi.useFakeTimers()
      delete process.env.VELLUM_NO_UPDATE_CHECK
      state.packaged = true
      const m = mockU()
      await load({ loadAutoUpdater: () => m as never })
      await vi.advanceTimersByTimeAsync(60_000)
      await setAuto(false)
      await vi.advanceTimersByTimeAsync(8 * 60 * 60 * 1000)
      expect(m.checkForUpdates).not.toHaveBeenCalled()
    })

    it('known before the first timed check: that check runs once at 15 s, with no extra catch-up', async () => {
      vi.useFakeTimers()
      delete process.env.VELLUM_NO_UPDATE_CHECK
      state.packaged = true
      const m = mockU()
      await load({ loadAutoUpdater: () => m as never })
      await vi.advanceTimersByTimeAsync(5_000)
      await setAuto(true)
      expect(m.checkForUpdates).not.toHaveBeenCalled() // the timer will do it
      await vi.advanceTimersByTimeAsync(10_000)
      expect(m.checkForUpdates).toHaveBeenCalledTimes(1)
    })

    it('VELLUM_NO_UPDATE_CHECK still wins: a late true starts nothing', async () => {
      vi.useFakeTimers()
      process.env.VELLUM_NO_UPDATE_CHECK = '1'
      state.packaged = true
      const m = mockU()
      await load({ loadAutoUpdater: () => m as never })
      await vi.advanceTimersByTimeAsync(60_000)
      await setAuto(true)
      expect(m.checkForUpdates).not.toHaveBeenCalled()
      delete process.env.VELLUM_NO_UPDATE_CHECK
    })

    it('clone: no timed git check before the first setAutoCheck; one after setAutoCheck(true)', async () => {
      vi.useFakeTimers()
      delete process.env.VELLUM_NO_UPDATE_CHECK
      state.hasGit = true
      execFile.mockImplementation((_c: string, _a: string[], _o: unknown, cb: (e: Error | null, out: string, err: string) => void) => cb(new Error('x'), '', 'not recognized'))
      await load()
      await vi.advanceTimersByTimeAsync(30_000)
      expect(execFile).not.toHaveBeenCalled()
      await setAuto(true)
      await vi.advanceTimersByTimeAsync(10)
      expect(execFile).toHaveBeenCalled()
    })
  })
})
