// Updates for copies installed with `git clone`: checks GitHub for new commits on the branch this copy
// tracks, and on request fast-forwards to them, installs changed packages, rebuilds and restarts.
// Every command is fixed here; nothing the renderer sends ends up on a command line.
import { app, ipcMain, type BrowserWindow } from 'electron'
import { execFile, spawn } from 'child_process'
import { existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { IPC, type UpdateStatus } from '@shared/api'

const FIRST_CHECK_MS = 15_000
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000
const MAX_COMMITS = 30

const root = (): string => app.getAppPath()
const dev = Boolean(process.env.ELECTRON_RENDERER_URL)

let status: UpdateStatus = { state: 'idle', commits: [], behind: 0, dirty: [], dev }
let getWindow: () => BrowserWindow | null = () => null
let busy: Promise<UpdateStatus> | null = null

function set(patch: Partial<UpdateStatus>): UpdateStatus {
  status = { ...status, ...patch }
  const w = getWindow()
  if (w && !w.isDestroyed()) w.webContents.send(IPC.updChanged, status)
  return status
}

function run(cmd: string, args: string[], cwd = root(), timeout = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { cwd, timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (err, stdout, stderr) => (err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout.trim()))
    )
  })
}

const git = (...args: string[]): Promise<string> => run('git', args)

/** npm is a .cmd on Windows, which execFile can't start without a shell. The command line is fixed. */
function npm(args: string, cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(`npm ${args}`, { cwd, shell: true, windowsHide: true, stdio: 'ignore' })
    const timer = setTimeout(() => child.kill(), 15 * 60_000)
    child.on('error', reject)
    child.on('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`npm ${args} failed in ${cwd} (exit ${code})`))
    })
  })
}

/** The remote branch this copy follows (usually origin/master). */
async function upstream(): Promise<string> {
  try {
    return await git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}')
  } catch {
    return `origin/${await git('rev-parse', '--abbrev-ref', 'HEAD')}`
  }
}

async function check(): Promise<UpdateStatus> {
  if (!existsSync(join(root(), '.git'))) {
    return set({
      state: 'unsupported',
      message: 'This copy was not installed with git clone, so it cannot update itself. Download the latest version from GitHub.'
    })
  }
  set({ state: 'checking', message: undefined })
  try {
    const up = await upstream()
    await run('git', ['fetch', '--quiet', up.split('/')[0]], root(), 60_000)
    const [current, latest, behind, ahead, log, dirty] = await Promise.all([
      git('rev-parse', '--short', 'HEAD'),
      git('rev-parse', '--short', up),
      git('rev-list', '--count', `HEAD..${up}`),
      git('rev-list', '--count', `${up}..HEAD`),
      git('log', `--max-count=${MAX_COMMITS}`, '--format=%h%x1f%s%x1f%ct', `HEAD..${up}`),
      git('status', '--porcelain', '--untracked-files=no')
    ])
    const commits = log
      ? log.split('\n').map((line) => {
          const [hash, subject, ct] = line.split('\x1f')
          return { hash, subject, date: Number(ct) * 1000 }
        })
      : []
    const n = Number(behind) || 0
    return set({
      state: n > 0 ? 'available' : 'up-to-date',
      current,
      latest,
      behind: n,
      commits,
      dirty: dirty ? dirty.split('\n').map((l) => l.slice(3)) : [],
      message: n > 0 && Number(ahead) > 0 ? 'This copy has its own commits, so it has to be updated by hand (git pull).' : undefined,
      checkedAt: Date.now()
    })
  } catch (err) {
    const msg = (err as Error).message
    return set({
      state: 'error',
      message: /not recognized|ENOENT/i.test(msg) ? 'Git is not installed or not on PATH.' : `Could not reach GitHub: ${msg}`,
      checkedAt: Date.now()
    })
  }
}

async function install(): Promise<UpdateStatus> {
  const before = await check()
  if (before.state !== 'available') return before
  if (before.dirty.length) {
    return set({ state: 'error', message: 'Some Vellum files were edited on this PC. Commit or undo those changes, then update.' })
  }
  if (before.message) return set({ state: 'error' })
  try {
    const up = await upstream()
    const changed = (await git('diff', '--name-only', 'HEAD', up)).split('\n')
    set({ state: 'installing', message: 'Downloading the update…' })
    await git('merge', '--ff-only', up)

    const touched = (re: RegExp): boolean => changed.some((f) => re.test(f))
    if (touched(/^package(-lock)?\.json$/)) {
      set({ message: 'Installing packages…' })
      await npm('install', root())
      // the stamp Vellum.cmd compares with package-lock.json
      writeFileSync(join(root(), 'node_modules', '.vellum-installed'), '')
    }
    if (touched(/^mcp\/package(-lock)?\.json$/)) {
      set({ message: 'Installing MCP server packages…' })
      await npm('install', join(root(), 'mcp'))
    }
    if (dev) {
      return set({ state: 'up-to-date', behind: 0, commits: [], message: 'Updated. Restart `npm run dev` to load it.' })
    }
    if (touched(/^mcp\//)) {
      set({ message: 'Building the MCP server…' })
      await npm('run build', join(root(), 'mcp'))
    }
    set({ message: 'Building Vellum…' })
    await npm('exec electron-vite build', root())
    set({ message: 'Restarting…' })
    setTimeout(() => {
      app.relaunch()
      app.quit()
    }, 300)
    return status
  } catch (err) {
    return set({ state: 'error', message: `The update did not finish: ${(err as Error).message}` })
  }
}

/** Run one check or install at a time; later callers get the running one. */
function once(fn: () => Promise<UpdateStatus>): Promise<UpdateStatus> {
  busy ??= fn().finally(() => (busy = null))
  return busy
}

export function startUpdater(
  window: () => BrowserWindow | null,
  trusted: (e: Electron.IpcMainInvokeEvent) => boolean
): void {
  getWindow = window
  ipcMain.handle(IPC.updStatus, (e) => (trusted(e) ? status : null))
  ipcMain.handle(IPC.updCheck, (e) => (trusted(e) ? once(check) : null))
  ipcMain.handle(IPC.updInstall, (e) => (trusted(e) ? once(install) : null))
  if (process.env.VELLUM_NO_UPDATE_CHECK) return
  setTimeout(() => void once(check), FIRST_CHECK_MS)
  setInterval(() => void once(check), CHECK_EVERY_MS).unref()
}
