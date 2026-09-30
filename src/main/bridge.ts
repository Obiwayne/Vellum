import { app, ipcMain, type BrowserWindow } from 'electron'
import { WebSocketServer, WebSocket } from 'ws'
import { randomBytes, timingSafeEqual } from 'crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { IncomingMessage } from 'http'
import { IPC, type BridgeRequest, type BridgeResponse } from '@shared/api'
import { handleMainTool } from './offscreen'
import { getVault } from './storage'
import { LOCKED_ERROR } from './vault'

const TIMEOUT_MS = 30_000
/** Largest message accepted from a client (write_html with embedded data: images can be big). */
const MAX_PAYLOAD = 100 * 1024 * 1024
/** Concurrent connections (the MCP server uses one; tests may open a few). */
const MAX_CLIENTS = 8
/** Requests a single connection may have waiting on the renderer at once. */
const MAX_PENDING_PER_SOCKET = 64
const MAX_TOOL_NAME = 64

/** Name of the file (in userData) that holds the bridge secret; the MCP server reads the same file. */
export const TOKEN_FILE = 'bridge-token'
/** Header the MCP server sends the secret in. Browsers cannot set custom headers on a WebSocket. */
export const TOKEN_HEADER = 'x-vellum-token'

interface Pending {
  socket: WebSocket
  clientId: unknown
  timer: NodeJS.Timeout
}

/** VELLUM_PORT (CANVAS_PORT is still accepted from before the rename), default 29170. */
export const bridgePort = (): number => Number(process.env.VELLUM_PORT) || Number(process.env.CANVAS_PORT) || 29170

/**
 * The per-install bridge secret: 32 random bytes as hex in <userData>/bridge-token, created on first
 * run and reused afterwards. %APPDATA% is only readable by the current Windows user (and admins),
 * which is what makes the file a usable shared secret between the app and the MCP server.
 */
function loadOrCreateToken(): Buffer {
  const file = join(app.getPath('userData'), TOKEN_FILE)
  try {
    if (existsSync(file)) {
      const hex = readFileSync(file, 'utf8').trim()
      if (/^[0-9a-f]{64}$/.test(hex)) return Buffer.from(hex, 'utf8')
    }
  } catch {
    /* unreadable: regenerate */
  }
  const hex = randomBytes(32).toString('hex')
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, hex, { encoding: 'utf8', mode: 0o600 })
  renameSync(tmp, file)
  return Buffer.from(hex, 'utf8')
}

function tokenMatches(expected: Buffer, given: string | string[] | undefined): boolean {
  if (typeof given !== 'string') return false
  const g = Buffer.from(given.trim(), 'utf8')
  // constant-time compare; the length is public (always 64 hex chars)
  return g.length === expected.length && timingSafeEqual(g, expected)
}

type HandshakeResult = { ok: true } | { ok: false; code: number; reason: string }

/**
 * Handshake check. Rejects:
 *  - any request with an Origin header: browsers always send one on a WebSocket handshake and
 *    don't apply CORS to it, so this stops web pages (cross-site WebSocket hijacking, DNS rebinding);
 *    the MCP server (Node `ws`) sends none;
 *  - a Host other than 127.0.0.1/localhost:<port> (DNS rebinding);
 *  - a missing or wrong secret token (any other local process that can't read the user's userData).
 */
function checkHandshake(req: IncomingMessage, token: Buffer, port: number): HandshakeResult {
  if (req.headers.origin !== undefined) return { ok: false, code: 403, reason: 'Browser origins are not allowed' }
  const host = String(req.headers.host ?? '').toLowerCase()
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return { ok: false, code: 403, reason: 'Bad host' }
  if (!tokenMatches(token, req.headers[TOKEN_HEADER])) return { ok: false, code: 401, reason: 'Missing or invalid Vellum bridge token' }
  return { ok: true }
}

/**
 * WebSocket bridge: MCP server sends `{id, tool, args}`, we forward to the renderer as
 * `bridge:request` with an internal id, and relay `{id, result|error}` back to the socket.
 * Only authenticated local clients get in (see checkHandshake).
 */
export function startBridge(getWindow: () => BrowserWindow | null): WebSocketServer {
  const pending = new Map<string, Pending>()
  let seq = 0
  const port = bridgePort()
  const token = loadOrCreateToken()

  const send = (socket: WebSocket, msg: unknown): void => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg))
  }

  ipcMain.on(IPC.bridgeRespond, (e, res: BridgeResponse) => {
    const win = getWindow()
    if (!win || win.isDestroyed() || e.sender !== win.webContents) return
    if (!res || typeof res !== 'object' || typeof res.id !== 'string') return
    const p = pending.get(res.id)
    if (!p) return
    clearTimeout(p.timer)
    pending.delete(res.id)
    send(p.socket, res.error !== undefined ? { id: p.clientId, error: String(res.error) } : { id: p.clientId, result: res.result ?? null })
  })
  ipcMain.handle(IPC.bridgePort, () => port)

  const wss: WebSocketServer = new WebSocketServer({
    host: '127.0.0.1',
    port,
    maxPayload: MAX_PAYLOAD,
    perMessageDeflate: false,
    verifyClient: (info, cb) => {
      if (wss.clients.size >= MAX_CLIENTS) return cb(false, 503, 'Too many connections')
      const r = checkHandshake(info.req, token, port)
      if (r.ok) return cb(true)
      console.warn(`[bridge] rejected connection: ${r.reason}`)
      cb(false, r.code, r.reason)
    }
  })
  wss.on('error', (err) => console.error('[bridge] server error:', err.message))
  wss.on('listening', () => console.log(`[bridge] listening on ws://127.0.0.1:${port}`))

  wss.on('connection', (socket) => {
    socket.on('error', () => socket.terminate())
    socket.on('message', (raw, isBinary) => {
      if (isBinary) {
        send(socket, { id: null, error: 'Binary messages are not supported' })
        return
      }
      let msg: unknown
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        send(socket, { id: null, error: 'Invalid JSON' })
        return
      }
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
        send(socket, { id: null, error: 'Expected a JSON object {id, tool, args}' })
        return
      }
      const m = msg as { id?: unknown; tool?: unknown; args?: unknown }
      const clientId = typeof m.id === 'string' || typeof m.id === 'number' ? m.id : null
      const tool = m.tool
      if (typeof tool !== 'string' || !tool || tool.length > MAX_TOOL_NAME || !/^[\w:.-]+$/.test(tool)) {
        send(socket, { id: clientId, error: 'Missing or invalid "tool"' })
        return
      }
      const args = (m.args && typeof m.args === 'object' && !Array.isArray(m.args) ? m.args : {}) as Record<string, unknown>
      // tools only ever see the open profile; while the picker / lock screen shows, refuse everything
      if (!getVault().isOpen()) {
        send(socket, { id: clientId, error: LOCKED_ERROR })
        return
      }
      // `main:*` tools (offscreen rendering for screenshots/export) run here, not in the renderer
      if (tool.startsWith('main:')) {
        handleMainTool(tool, args).then(
          (result) => send(socket, { id: clientId, result: result ?? null }),
          (err: unknown) => send(socket, { id: clientId, error: err instanceof Error ? err.message : String(err) })
        )
        return
      }
      const win = getWindow()
      if (!win || win.isDestroyed()) {
        send(socket, { id: clientId, error: 'Vellum window is not available' })
        return
      }
      let mine = 0
      for (const p of pending.values()) if (p.socket === socket) mine++
      if (mine >= MAX_PENDING_PER_SOCKET) {
        send(socket, { id: clientId, error: 'Too many requests in flight' })
        return
      }
      const id = `b${++seq}`
      const timer = setTimeout(() => {
        pending.delete(id)
        send(socket, { id: clientId, error: `Timed out after ${TIMEOUT_MS / 1000}s waiting for "${tool}"` })
      }, TIMEOUT_MS)
      pending.set(id, { socket, clientId, timer })
      const req: BridgeRequest = { id, tool, args }
      win.webContents.send(IPC.bridgeRequest, req)
    })
    socket.on('close', () => {
      for (const [id, p] of pending) {
        if (p.socket === socket) {
          clearTimeout(p.timer)
          pending.delete(id)
        }
      }
    })
  })
  return wss
}
