// Renderer side of the MCP bridge. Main forwards `{id, tool, args}` from the WebSocket; we run the
// handler against the store and reply `{id, result|error}`. Tools live in the sibling files and
// register themselves with registerHandler() (see docs/MCP.md for the full list).
import type { BridgeRequest } from '@shared/api'
import { handlers, settle } from './registry'
import { getStore } from '../model/store'
import { markActivity } from '../profile/profile'
import './tools-files'
import './tools-read'
import './tools-write'
import './tools-components'
import './tools-styles'
import './tools-render'

export { registerHandler, resolveDocId, handlers } from './registry'
export type { BridgeHandler } from './registry'

handlers.ping = () => ({ pong: true, app: 'Vellum', time: Date.now() })

let installed = false
/** True while an MCP tool runs (agentDriven.ts leaves those edits to the tool's own working marks). */
export let inBridgeCall = false

export function installBridge(): void {
  const api = window.canvasApi
  if (installed || !api) return
  installed = true
  // run requests one at a time so each tool sees the previous tool's result (and its render)
  let chain: Promise<void> = Promise.resolve()
  api.onBridgeRequest((req: BridgeRequest) => {
    chain = chain.then(async () => {
      if (!getStore().ready) {
        api.bridgeRespond({ id: req.id, error: 'Vellum is locked — open your profile in the app first' })
        return
      }
      markActivity()
      // own properties only: "constructor", "__proto__", "toString"… are not tools
      const fn = typeof req.tool === 'string' && Object.prototype.hasOwnProperty.call(handlers, req.tool) ? handlers[req.tool] : undefined
      if (typeof fn !== 'function') {
        api.bridgeRespond({ id: req.id, error: `Unknown tool: ${req.tool}` })
        return
      }
      try {
        // let React commit renders from earlier mutations so DOM measurements are current
        await settle()
        await settle()
        inBridgeCall = true
        let result: unknown
        try {
          result = await fn(req.args ?? {})
        } finally {
          inBridgeCall = false
        }
        api.bridgeRespond({ id: req.id, result: result === undefined ? null : JSON.parse(JSON.stringify(result)) })
      } catch (err) {
        api.bridgeRespond({ id: req.id, error: err instanceof Error ? err.message : String(err) })
      }
    })
  })
}
