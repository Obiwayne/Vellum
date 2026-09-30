// WebSocket client for the Vellum app bridge (src/main/bridge.ts).
// Protocol: we send {id, tool, args}; the app replies {id, result} or {id, error}.
// The connection is opened lazily and re-opened on demand, so the MCP server can start before
// the app and keep working across app restarts.
import WebSocket from 'ws'

/** VELLUM_PORT; CANVAS_PORT (the pre-rename name) is still accepted as a fallback. */
const PORT_ENV = process.env.VELLUM_PORT || process.env.CANVAS_PORT
export const VELLUM_PORT = Number(PORT_ENV) || 29170
const URL = `ws://127.0.0.1:${VELLUM_PORT}`
const CONNECT_TIMEOUT_MS = 2500
const DEFAULT_CALL_TIMEOUT_MS = 60_000

export const NOT_RUNNING =
  'Vellum app is not running — start it with npm run dev (or the built app) in F:\\Vellum' +
  (PORT_ENV ? ` (expected on port ${VELLUM_PORT})` : '')

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: NodeJS.Timeout
}

export class VellumBridge {
  private ws: WebSocket | null = null
  private connecting: Promise<WebSocket> | null = null
  private pending = new Map<string, Pending>()
  private seq = 0

  private connect(): Promise<WebSocket> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return Promise.resolve(this.ws)
    if (this.connecting) return this.connecting
    this.connecting = new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(URL)
      const timer = setTimeout(() => {
        ws.terminate()
        reject(new Error(NOT_RUNNING))
      }, CONNECT_TIMEOUT_MS)
      ws.once('open', () => {
        clearTimeout(timer)
        this.ws = ws
        resolve(ws)
      })
      ws.once('error', () => {
        clearTimeout(timer)
        reject(new Error(NOT_RUNNING))
      })
      ws.on('message', (raw) => this.onMessage(raw.toString()))
      ws.on('close', () => {
        if (this.ws === ws) this.ws = null
        for (const [id, p] of this.pending) {
          clearTimeout(p.timer)
          p.reject(new Error('Connection to the Vellum app was closed (was the app restarted?)'))
          this.pending.delete(id)
        }
      })
    }).finally(() => {
      this.connecting = null
    })
    return this.connecting
  }

  private onMessage(text: string): void {
    let msg: { id?: string; result?: unknown; error?: string }
    try {
      msg = JSON.parse(text)
    } catch {
      return
    }
    const p = msg.id ? this.pending.get(msg.id) : undefined
    if (!p) return
    this.pending.delete(msg.id as string)
    clearTimeout(p.timer)
    if (msg.error !== undefined) p.reject(new Error(msg.error))
    else p.resolve(msg.result)
  }

  async call<T = unknown>(tool: string, args: Record<string, unknown> = {}, timeoutMs = DEFAULT_CALL_TIMEOUT_MS): Promise<T> {
    let ws: WebSocket
    try {
      ws = await this.connect()
    } catch {
      // one quick retry — the app may just be starting up
      await new Promise((r) => setTimeout(r, 300))
      ws = await this.connect()
    }
    const id = `m${++this.seq}`
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Timed out waiting for Vellum to answer "${tool}"`))
      }, timeoutMs)
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
      ws.send(JSON.stringify({ id, tool, args }), (err) => {
        if (err) {
          clearTimeout(timer)
          this.pending.delete(id)
          reject(new Error(NOT_RUNNING))
        }
      })
    })
  }

  close(): void {
    this.ws?.close()
  }
}
