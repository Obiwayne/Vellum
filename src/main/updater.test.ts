// The git updater must never run git or npm in a packaged (installer) build, even if a .git folder is somehow present, and must
// keep working as before for a git clone.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (e: unknown) => unknown
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

describe('packaged build without electron-updater', () => {
  it('starts as unsupported, and a check says so without running git or npm', async () => {
    state.packaged = true
    const u = await load(noUpdater)
    expect((await u.status()).state).toBe('unsupported')
    const s = await u.check()
    expect(s.state).toBe('unsupported')
    expect(s.message).toMatch(/installer/i)
    expect(s.commits).toEqual([])
    expect(s.behind).toBe(0)
    expect(execFile).not.toHaveBeenCalled()
    expect(spawn).not.toHaveBeenCalled()
  })

  it('stays disabled even when a .git folder exists next to the app', async () => {
    state.packaged = true
    state.hasGit = true
    const u = await load(noUpdater)
    expect((await u.check()).state).toBe('unsupported')
    expect(execFile).not.toHaveBeenCalled()
  })

  it('install is refused and never runs git or npm', async () => {
    state.packaged = true
    state.hasGit = true
    const u = await load(noUpdater)
    const s = await u.install()
    expect(s.state).toBe('unsupported')
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
