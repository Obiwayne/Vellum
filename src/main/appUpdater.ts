// Updates for installed (packaged) builds, on top of electron-updater and the GitHub Releases feed. It maps the
// updater's events onto UpdateStatus, checks 15 s after start and every 4 h, downloads in the background and installs
// only when the renderer asks (quitAndInstall) or on the next quit. A failed check or download leaves the app usable and
// is retried at the next interval. Copies run from a git clone keep the git updater (updater.ts); this engine does
// nothing unless the build is packaged. It does not import electron: everything it needs is passed in, so it can be
// tested against a mocked autoUpdater.
import type { UpdateStatus } from '@shared/api'

/** The part of electron-updater's `autoUpdater` this engine uses. */
export interface AutoUpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowPrerelease: boolean
  setFeedURL(options: { provider: 'generic'; url: string }): void
  checkForUpdates(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
  on(event: string, listener: (...args: any[]) => void): unknown // eslint-disable-line @typescript-eslint/no-explicit-any
}

export interface AppUpdaterOptions {
  autoUpdater: AutoUpdaterLike
  /** app.isPackaged: when false the engine never checks, whatever else is set */
  isPackaged: boolean
  /** app.getVersion() */
  version: string
  /** called with every new status (the main process forwards it to the window) */
  emit: (status: UpdateStatus) => void
  /** VELLUM_UPDATE_URL: a test feed. Honoured only in packaged builds. */
  updateUrl?: string
  /** the "Check for updates automatically" setting; read before every timed check (default on) */
  autoCheck?: () => boolean
  firstCheckMs?: number
  everyMs?: number
}

export interface AppUpdater {
  status(): UpdateStatus
  /** one check at a time; later callers get the running one */
  check(): Promise<UpdateStatus>
  /** quit and install a downloaded update; anything else leaves the status as it is */
  install(): UpdateStatus
  /** arms the timers (15 s after start, then every 4 h) */
  start(): void
  stop(): void
}

export const FIRST_CHECK_MS = 15_000
export const CHECK_EVERY_MS = 4 * 60 * 60 * 1000

interface UpdateInfoLike {
  version?: string
  releaseNotes?: unknown
}

/** electron-updater gives release notes as a string, or a list of { version, note }. */
export function notesText(notes: unknown): string | undefined {
  if (typeof notes === 'string') return notes.trim() || undefined
  if (Array.isArray(notes)) {
    const text = notes
      .map((n) => (n && typeof n === 'object' && typeof (n as { note?: unknown }).note === 'string' ? (n as { note: string }).note : ''))
      .filter(Boolean)
      .join('\n\n')
      .trim()
    return text || undefined
  }
  return undefined
}

export function createAppUpdater(opts: AppUpdaterOptions): AppUpdater {
  const { autoUpdater, isPackaged, version, emit } = opts
  let status: UpdateStatus = {
    state: isPackaged ? 'idle' : 'unsupported',
    current: version,
    commits: [],
    behind: 0,
    dirty: [],
    dev: false
  }
  let busy: Promise<UpdateStatus> | null = null
  let first: ReturnType<typeof setTimeout> | null = null
  let every: ReturnType<typeof setInterval> | null = null

  const set = (patch: Partial<UpdateStatus>): UpdateStatus => {
    status = { ...status, ...patch }
    emit(status)
    return status
  }

  if (isPackaged) {
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.allowPrerelease = false
    if (opts.updateUrl) autoUpdater.setFeedURL({ provider: 'generic', url: opts.updateUrl })
    autoUpdater.on('checking-for-update', () => set({ state: 'checking', message: undefined, progress: undefined }))
    autoUpdater.on('update-available', (info: UpdateInfoLike) =>
      set({ state: 'available', latest: info?.version, releaseNotes: notesText(info?.releaseNotes), message: undefined, progress: 0, checkedAt: Date.now() })
    )
    autoUpdater.on('update-not-available', () =>
      set({ state: 'up-to-date', latest: undefined, releaseNotes: undefined, message: undefined, progress: undefined, checkedAt: Date.now() })
    )
    autoUpdater.on('download-progress', (p: { percent?: number }) =>
      set({ state: 'downloading', progress: Math.max(0, Math.min(100, Math.round(p?.percent ?? 0))) })
    )
    autoUpdater.on('update-downloaded', (info: UpdateInfoLike) =>
      set({
        state: 'ready',
        latest: info?.version ?? status.latest,
        releaseNotes: notesText(info?.releaseNotes) ?? status.releaseNotes,
        progress: 100,
        message: undefined
      })
    )
    autoUpdater.on('error', (err: unknown) =>
      set({ state: 'error', message: `Could not update: ${err instanceof Error ? err.message : String(err)}`, progress: undefined, checkedAt: Date.now() })
    )
  }

  const check = (): Promise<UpdateStatus> => {
    if (!isPackaged) return Promise.resolve(status)
    // a downloaded update waits for the restart; checking again would only discard it
    if (status.state === 'ready' || status.state === 'downloading') return Promise.resolve(status)
    busy ??= (async () => {
      try {
        await autoUpdater.checkForUpdates()
      } catch (err) {
        // the 'error' event usually fires too; make sure the status says so either way
        if (status.state !== 'error') set({ state: 'error', message: `Could not update: ${err instanceof Error ? err.message : String(err)}`, checkedAt: Date.now() })
      }
      return status
    })().finally(() => (busy = null))
    return busy
  }

  return {
    status: () => status,
    check,
    install() {
      if (isPackaged && status.state === 'ready') autoUpdater.quitAndInstall(false, true)
      return status
    },
    start() {
      if (!isPackaged || first || every) return
      const timed = (): void => {
        if (opts.autoCheck && !opts.autoCheck()) return
        void check()
      }
      first = setTimeout(timed, opts.firstCheckMs ?? FIRST_CHECK_MS)
      every = setInterval(timed, opts.everyMs ?? CHECK_EVERY_MS)
      every.unref?.()
    },
    stop() {
      if (first) clearTimeout(first)
      if (every) clearInterval(every)
      first = every = null
    }
  }
}
