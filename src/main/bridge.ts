import { ipcMain, type BrowserWindow } from 'electron'
import { WebSocketServer, WebSocket } from 'ws'
import { IPC, type BridgeRequest, type BridgeResponse } from '@shared/api'
import { handleMainTool } from './offscreen'

const TIMEOUT_MS = 30_000

interface Pending {
  socket: WebSocket
  clientId: unknown
  timer: NodeJS.Timeout
}

/** VELLUM_PORT (CANVAS_PORT is still accepted from before the rename), default 29170. */
export const bridgePort = (): number => Number(process.env.VELLUM_PORT) || Number(process.env.CANVAS_PORT) || 29170

/**
 * WebSocket bridge: MCP server sends `{id, tool, args}`, we forward to the renderer as
 * `bridge:request` with an internal id, and relay `{id, result|error}` back to the socket.
 */
export function startBridge(getWindow: () => BrowserWindow | null): WebSocketServer {
  const pending = new Map<string, Pending>()
  let seq = 0

  const send = (socket: WebSocket, msg: unknown): void => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg))
  }

  ipcMain.on(IPC.bridgeRespond, (_e, res: BridgeResponse) => {
    const p = pending.get(res.id)
    if (!p) return
    clearTimeout(p.timer)
    pending.delete(res.id)
    send(p.socket, res.error !== undefined ? { id: p.clientId, error: res.error } : { id: p.clientId, result: res.result ?? null })
  })
  ipcMain.handle(IPC.bridgePort, () => bridgePort())

  const wss = new WebSocketServer({ host: '127.0.0.1', port: bridgePort() })
  wss.on('error', (err) => console.error('[bridge] server error:', err.message))
  wss.on('listening', () => console.log(`[bridge] listening on ws://127.0.0.1:${bridgePort()}`))

  wss.on('connection', (socket) => {
    socket.on('message', (raw) => {
      let msg: { id?: unknown; tool?: unknown; args?: unknown }
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        send(socket, { id: null, error: 'Invalid JSON' })
        return
      }
      const clientId = msg.id ?? null
      if (typeof msg.tool !== 'string') {
        send(socket, { id: clientId, error: 'Missing "tool"' })
        return
      }
      // `main:*` tools (offscreen rendering for screenshots/export) run here, not in the renderer
      if (msg.tool.startsWith('main:')) {
        const args = (msg.args && typeof msg.args === 'object' ? msg.args : {}) as Record<string, unknown>
        handleMainTool(msg.tool, args).then(
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
      const id = `b${++seq}`
      const timer = setTimeout(() => {
        pending.delete(id)
        send(socket, { id: clientId, error: `Timed out after ${TIMEOUT_MS / 1000}s waiting for "${msg.tool}"` })
      }, TIMEOUT_MS)
      pending.set(id, { socket, clientId, timer })
      const req: BridgeRequest = {
        id,
        tool: msg.tool,
        args: (msg.args && typeof msg.args === 'object' ? msg.args : {}) as Record<string, unknown>
      }
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
