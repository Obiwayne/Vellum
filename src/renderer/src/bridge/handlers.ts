// Renderer side of the MCP bridge. Main forwards `{id, tool, args}` from the WebSocket; we run the
// handler against the store and reply `{id, result|error}`. Tools live in the sibling files and
// register themselves with registerHandler() (see docs/MCP.md for the full list).
import type { BridgeRequest } from '@shared/api'
import { handlers, settle } from './registry'
import './tools-files'
import './tools-read'
import './tools-write'
import './tools-render'

export { registerHandler, resolveDocId, handlers } from './registry'
export type { BridgeHandler } from './registry'

handlers.ping = () => ({ pong: true, app: 'Vellum', time: Date.now() })

let installed = false

export function installBridge(): void {
  const api = window.canvasApi
  if (installed || !api) return
  installed = true
  // run requests one at a time so each tool sees the previous tool's result (and its render)
  let chain: Promise<void> = Promise.resolve()
  api.onBridgeRequest((req: BridgeRequest) => {
    chain = chain.then(async () => {
      const fn = handlers[req.tool]
      if (!fn) {
        api.bridgeRespond({ id: req.id, error: `Unknown tool: ${req.tool}` })
        return
      }
      try {
        // let React commit renders from earlier mutations so DOM measurements are current
        await settle()
        await settle()
        const result = await fn(req.args ?? {})
        api.bridgeRespond({ id: req.id, result: result === undefined ? null : JSON.parse(JSON.stringify(result)) })
      } catch (err) {
        api.bridgeRespond({ id: req.id, error: err instanceof Error ? err.message : String(err) })
      }
    })
  })
}
