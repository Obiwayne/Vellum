// Settings → Connect to Claude, main side: runs the remote connector (mcp/src/remote, docs/REMOTE.md) as a child
// process with the app's own Electron as Node, and passes the Settings buttons to its admin API (127.0.0.1:29181,
// x-vellum-admin header with the secret in <userData>/remote/admin-token). The switch is saved in
// <userData>/remote/config.json, so the connector starts with the app while it is on.
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { IPC } from '@shared/api'
import type { RemoteAction, RemoteState } from '@shared/remote'
import { bridgePort } from './bridge'

const ADMIN_PORT = Number(process.env.VELLUM_REMOTE_ADMIN_PORT) || 29181

let child: ChildProcess | null = null
let lastError: string | null = null
let starting = false

const dir = (): string => join(app.getPath('userData'), 'remote')
const configFile = (): string => join(dir(), 'config.json')

function readConfig(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(configFile(), 'utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

function writeConfig(patch: Record<string, unknown>): void {
  mkdirSync(dir(), { recursive: true })
  const tmp = `${configFile()}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify({ ...readConfig(), ...patch }, null, 2), { mode: 0o600 })
  renameSync(tmp, configFile())
}

/** The connector script: the bundle next to an installed app, or the tsc build in a clone. */
function script(): string {
  return app.isPackaged ? join(process.resourcesPath, 'mcp', 'remote.mjs') : join(app.getAppPath(), 'mcp', 'dist', 'remote', 'index.js')
}

function adminToken(): string | null {
  try {
    return readFileSync(join(dir(), 'admin-token'), 'utf8').trim() || null
  } catch {
    return null
  }
}

async function adminCall<T>(path: string, form?: Record<string, string>): Promise<T> {
  const token = adminToken()
  if (!token) throw new Error('The connector has not started yet')
  const r = await fetch(`http://127.0.0.1:${ADMIN_PORT}${path}`, {
    method: form ? 'POST' : 'GET',
    headers: { 'x-vellum-admin': token, ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
    body: form ? new URLSearchParams(form) : undefined,
    signal: AbortSignal.timeout(3000)
  })
  if (!r.ok) throw new Error((await r.text()) || `admin API answered ${r.status}`)
  return (await r.json()) as T
}

interface ApiState {
  status: { port: number; publicHost: string | null; tunnel: RemoteState['tunnel']; connected: boolean; lastTunnelOkAt: string | null; lastTunnelError: RemoteState['lastTunnelError'] }
  apps: RemoteState['apps']
  connections: RemoteState['connections']
  codeActiveUntil: string | null
  loginLockedUntil: string | null
  adminUrl: string
  audit: Record<string, unknown>[]
}

async function state(): Promise<RemoteState> {
  const cfg = readConfig()
  const base: RemoteState = {
    enabled: cfg.enabled === true,
    running: false,
    external: false,
    error: lastError,
    port: null,
    publicHost: typeof cfg.publicHost === 'string' ? cfg.publicHost : null,
    tunnel: cfg.tunnel === 'cloudflare' || cfg.tunnel === 'tailscale' ? cfg.tunnel : null,
    connected: false,
    lastTunnelOkAt: null,
    lastTunnelError: null,
    apps: [],
    connections: [],
    codeActiveUntil: null,
    loginLockedUntil: null,
    adminUrl: null,
    audit: []
  }
  try {
    const s = await adminCall<ApiState>('/api/state')
    return {
      ...base,
      running: true,
      external: !child,
      error: null,
      ...s.status,
      apps: s.apps,
      connections: s.connections,
      codeActiveUntil: s.codeActiveUntil,
      loginLockedUntil: s.loginLockedUntil,
      adminUrl: s.adminUrl,
      audit: s.audit
    }
  } catch {
    // switched on (here or in config.json) but nothing answers and nothing is starting: start it
    if (base.enabled && !child && !starting) void start()
    return base
  }
}

async function answering(): Promise<boolean> {
  try {
    await adminCall('/api/state')
    return true
  } catch {
    return false
  }
}

async function start(): Promise<void> {
  if (starting) return
  starting = true
  try {
    await startOnce()
  } finally {
    starting = false
  }
}

async function startOnce(): Promise<void> {
  if (child || (await answering())) return
  const entry = script()
  if (!existsSync(entry)) {
    lastError = app.isPackaged ? 'This install has no remote connector (resources/mcp/remote.mjs).' : 'The connector is not built: run npm run build in the mcp folder.'
    return
  }
  lastError = null
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    VELLUM_USER_DATA: app.getPath('userData'),
    VELLUM_REMOTE_DIR: dir(),
    VELLUM_PORT: String(bridgePort())
  }
  const c = spawn(process.execPath, [entry], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  child = c
  let tail = ''
  const keep = (d: Buffer): void => {
    tail = (tail + d.toString()).slice(-2000)
  }
  c.stdout?.on('data', keep)
  c.stderr?.on('data', keep)
  c.on('exit', (code) => {
    if (child === c) child = null
    if (code && readConfig().enabled === true) lastError = (tail.trim().split('\n').pop() || `The connector stopped (exit code ${code}).`).replace(/^\[vellum-remote\]\s*/, '')
  })
  // wait until its admin API answers (it writes admin-token first)
  for (let i = 0; i < 25 && child === c; i++) {
    if (await answering()) return
    await new Promise((r) => setTimeout(r, 200))
  }
}

function stop(): void {
  const c = child
  child = null
  c?.kill()
}

async function setEnabled(on: boolean): Promise<RemoteState> {
  writeConfig({ enabled: on })
  if (on) await start()
  else {
    lastError = null
    stop()
  }
  return state()
}

async function act(a: RemoteAction): Promise<{ display: string; expiresAt: string } | null> {
  switch (a.kind) {
    case 'code':
      return adminCall<{ display: string; expiresAt: string }>('/api/code', {})
    case 'cancelCode':
      await adminCall('/api/code/cancel', {})
      return null
    case 'approve':
      await adminCall('/api/apps/approve', { id: String(a.id) })
      return null
    case 'remove':
      await adminCall('/api/apps/remove', { id: String(a.id) })
      return null
    case 'disconnect':
      await adminCall('/api/disconnect', a.id ? { id: String(a.id) } : {})
      return null
    case 'public':
      if ((await answering()) === false) writeConfig({ publicHost: String(a.host).trim() || null, tunnel: a.tunnel })
      else await adminCall('/api/public', { host: String(a.host), tunnel: a.tunnel === 'cloudflare' ? 'cloudflare' : 'tailscale' })
      return null
  }
  return null
}

export function registerRemoteIpc(trusted: (e: IpcMainInvokeEvent) => boolean): void {
  const guard = (e: IpcMainInvokeEvent): void => {
    if (!trusted(e)) throw new Error('Not allowed')
  }
  ipcMain.handle(IPC.remoteState, (e) => (guard(e), state()))
  ipcMain.handle(IPC.remoteSetEnabled, (e, on: unknown) => (guard(e), setEnabled(on === true)))
  ipcMain.handle(IPC.remoteAct, (e, a: unknown) => (guard(e), act(a as RemoteAction)))
  if (readConfig().enabled === true) void start()
  app.on('will-quit', stop)
}
