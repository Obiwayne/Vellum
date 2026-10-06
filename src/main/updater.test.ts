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
const load = async () => {
  vi.resetModules()
  handlers.clear()
  const mod = await import('./updater')
  mod.startUpdater(() => null, trusted)
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

describe('packaged build', () => {
  it('starts as unsupported, and a check says so without running git or npm', async () => {
    state.packaged = true
    const u = await load()
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
    const u = await load()
    expect((await u.check()).state).toBe('unsupported')
    expect(execFile).not.toHaveBeenCalled()
  })

  it('install is refused and never runs git or npm', async () => {
    state.packaged = true
    state.hasGit = true
    const u = await load()
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
    await load()
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
