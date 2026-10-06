// The installed-build update engine against a mocked electron-updater: state transitions, retry at the next interval,
// nothing when not packaged, the test feed override only in packaged builds, install only when ready.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateStatus } from '@shared/api'
import { CHECK_EVERY_MS, FIRST_CHECK_MS, createAppUpdater, notesText, type AutoUpdaterLike } from './appUpdater'

function mockUpdater() {
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
  return { u: u as unknown as AutoUpdaterLike & typeof u, fire: (ev: string, ...a: unknown[]) => listeners.get(ev)?.(...a) }
}

function make(over: { isPackaged?: boolean; updateUrl?: string; autoCheck?: () => boolean } = {}) {
  const m = mockUpdater()
  const seen: UpdateStatus[] = []
  const engine = createAppUpdater({ autoUpdater: m.u, isPackaged: over.isPackaged ?? true, version: '1.0.0', emit: (s) => seen.push(s), updateUrl: over.updateUrl, autoCheck: over.autoCheck })
  return { ...m, engine, seen, states: () => seen.map((s) => s.state) }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('state transitions', () => {
  it('starts idle on the running version, with downloads on and installs only on quit or request', () => {
    const { engine, u } = make()
    expect(engine.status()).toMatchObject({ state: 'idle', current: '1.0.0', commits: [], behind: 0, dirty: [], dev: false })
    expect(u.autoDownload).toBe(true)
    expect(u.autoInstallOnAppQuit).toBe(true)
    expect(u.allowPrerelease).toBe(false)
  })

  it('checking -> available -> downloading (with progress) -> ready, and says which version', () => {
    const { fire, engine, states } = make()
    fire('checking-for-update')
    fire('update-available', { version: '1.2.0', releaseNotes: 'Fixes things' })
    expect(engine.status()).toMatchObject({ state: 'available', latest: '1.2.0', releaseNotes: 'Fixes things', current: '1.0.0' })
    fire('download-progress', { percent: 41.6 })
    expect(engine.status()).toMatchObject({ state: 'downloading', progress: 42 })
    fire('download-progress', { percent: 250 })
    expect(engine.status().progress).toBe(100)
    fire('update-downloaded', { version: '1.2.0' })
    expect(engine.status()).toMatchObject({ state: 'ready', latest: '1.2.0', progress: 100, releaseNotes: 'Fixes things' })
    expect(states()).toEqual(['checking', 'available', 'downloading', 'downloading', 'ready'])
  })

  it('no update: up-to-date, with the check time', () => {
    const { fire, engine } = make()
    fire('checking-for-update')
    fire('update-not-available', { version: '1.0.0' })
    expect(engine.status().state).toBe('up-to-date')
    expect(engine.status().checkedAt).toBeTypeOf('number')
  })

  it('errors keep the app usable: a short message, no progress, and the next check clears it', async () => {
    const { fire, engine, u } = make()
    fire('download-progress', { percent: 10 })
    fire('error', new Error('net::ERR_INTERNET_DISCONNECTED'))
    expect(engine.status()).toMatchObject({ state: 'error', progress: undefined })
    expect(engine.status().message).toMatch(/ERR_INTERNET_DISCONNECTED/)
    fire('checking-for-update')
    expect(engine.status()).toMatchObject({ state: 'checking', message: undefined })
    await engine.check()
    expect(u.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('a check that throws without an error event still ends as an error', async () => {
    const { engine, u } = make()
    u.checkForUpdates.mockRejectedValueOnce(new Error('boom'))
    const s = await engine.check()
    expect(s.state).toBe('error')
    expect(s.message).toMatch(/boom/)
  })

  it('release notes may be a list of { version, note }', () => {
    expect(notesText([{ version: '1.1.0', note: 'A' }, { version: '1.2.0', note: 'B' }])).toBe('A\n\nB')
    expect(notesText('  ')).toBeUndefined()
    expect(notesText(undefined)).toBeUndefined()
  })
})

describe('checking', () => {
  it('runs one check at a time', async () => {
    const { engine, u } = make()
    let release!: () => void
    u.checkForUpdates.mockImplementationOnce(() => new Promise<unknown>((r) => (release = () => r(undefined))))
    const a = engine.check()
    const b = engine.check()
    expect(u.checkForUpdates).toHaveBeenCalledTimes(1)
    release()
    await Promise.all([a, b])
    await engine.check()
    expect(u.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('does not check again while an update downloads or waits to be installed', async () => {
    const { engine, fire, u } = make()
    fire('download-progress', { percent: 5 })
    await engine.check()
    fire('update-downloaded', { version: '2.0.0' })
    await engine.check()
    expect(u.checkForUpdates).not.toHaveBeenCalled()
    expect(engine.status().state).toBe('ready')
  })

  it('checks 15 s after start and every 4 h, and retries after an error at the next interval', async () => {
    const { engine, u, fire } = make()
    engine.start()
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS - 1)
    expect(u.checkForUpdates).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(u.checkForUpdates).toHaveBeenCalledTimes(1)
    fire('error', new Error('offline'))
    expect(engine.status().state).toBe('error')
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS)
    expect(u.checkForUpdates).toHaveBeenCalledTimes(2)
    fire('update-not-available', {})
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS)
    expect(u.checkForUpdates).toHaveBeenCalledTimes(3)
    engine.stop()
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS * 2)
    expect(u.checkForUpdates).toHaveBeenCalledTimes(3)
  })

  it('skips the timed checks when "check automatically" is off, and takes them up again when it is back on', async () => {
    let on = false
    const { engine, u } = make({ autoCheck: () => on })
    engine.start()
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS + CHECK_EVERY_MS)
    expect(u.checkForUpdates).not.toHaveBeenCalled()
    on = true
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS)
    expect(u.checkForUpdates).toHaveBeenCalledTimes(1)
    on = false
    await engine.check() // a manual check always works
    expect(u.checkForUpdates).toHaveBeenCalledTimes(2)
  })
})

describe('not packaged', () => {
  it('never checks, never touches the updater, ignores the test feed', async () => {
    const { engine, u } = make({ isPackaged: false, updateUrl: 'http://localhost:9/feed' })
    expect(engine.status().state).toBe('unsupported')
    engine.start()
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS * 2)
    await engine.check()
    expect(u.checkForUpdates).not.toHaveBeenCalled()
    expect(u.setFeedURL).not.toHaveBeenCalled()
    expect(u.on).not.toHaveBeenCalled()
    expect(u.autoDownload).toBe(false)
    engine.install()
    expect(u.quitAndInstall).not.toHaveBeenCalled()
  })
})

describe('VELLUM_UPDATE_URL (test feed)', () => {
  it('points a packaged build at a generic feed', () => {
    const { u } = make({ updateUrl: 'http://127.0.0.1:8123/feed' })
    expect(u.setFeedURL).toHaveBeenCalledWith({ provider: 'generic', url: 'http://127.0.0.1:8123/feed' })
  })
  it('is not used when unset', () => {
    const { u } = make()
    expect(u.setFeedURL).not.toHaveBeenCalled()
  })
})

describe('install', () => {
  it('quits and installs only a downloaded update', () => {
    const { engine, fire, u } = make()
    engine.install()
    fire('update-available', { version: '2.0.0' })
    engine.install()
    fire('download-progress', { percent: 50 })
    engine.install()
    expect(u.quitAndInstall).not.toHaveBeenCalled()
    fire('update-downloaded', { version: '2.0.0' })
    engine.install()
    expect(u.quitAndInstall).toHaveBeenCalledTimes(1)
  })
})

describe('release notes from GitHub arrive as HTML (T48 test station)', () => {
  it('become plain text: paragraphs, bullets, no tags, entities decoded', () => {
    const html = '<h2>What\'s new</h2>\n<p>Faster saves &amp; safer files.</p>\n<ul>\n<li>Crash recovery</li>\n<li>Components &amp; Assets &lt;3</li>\n</ul>\n<p>Thanks!<br>See you</p>'
    const text = notesText(html)!
    expect(text).not.toMatch(/<\/?[a-z]/i)
    expect(text).toContain("What's new")
    expect(text).toContain('Faster saves & safer files.')
    expect(text).toContain('- Crash recovery')
    expect(text).toContain('- Components & Assets <3')
    expect(text.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(2)
    expect(text).not.toMatch(/\n{3,}/)
  })

  it('drops script and style blocks, keeps plain text and markdown as written, and handles a list of notes', () => {
    expect(notesText('<p>ok</p><script>alert(1)</script><style>p{}</style>')).toBe('ok')
    expect(notesText('Plain text\n- one\n- two < three')).toBe('Plain text\n- one\n- two < three')
    expect(notesText([{ version: '1', note: '<p>A</p>' }, { version: '2', note: '<p>B</p>' }])).toBe('A\n\nB')
    expect(notesText('<p></p>')).toBeUndefined()
    expect(notesText('<br>')).toBeUndefined()
  })
})
