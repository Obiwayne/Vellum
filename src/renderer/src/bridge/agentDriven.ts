// Agent-driven windows (launched by a Muster crew agent's scripts, or VELLUM_AGENT_DRIVEN=1): the
// agent clicks and types instead of calling MCP tools, so every edit shows the working indicator
// the MCP tools show (blue outlines + twinkling dots). It clears once the edits stop.
import type { Patch } from 'immer'
import { getStore, onDocEdit } from '../model/store'
import { inBridgeCall } from './handlers'
import { markWorking } from './registry'

const IDLE_MS = 2000

let installed = false

export function installAgentDriven(): void {
  if (installed || !window.canvasApi?.agentDriven) return
  installed = true
  const added = new Map<string, Set<string>>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  onDocEdit((docId, patches) => {
    if (inBridgeCall) return
    const ids = editedNodes(patches)
    if (!ids.length) return
    const working = (): string[] => getStore().editors[docId]?.workingNodes ?? []
    const before = new Set(working())
    markWorking(docId, ids)
    const mine = added.get(docId) ?? new Set<string>()
    for (const id of working()) if (!before.has(id)) mine.add(id)
    added.set(docId, mine)

    clearTimeout(timers.get(docId))
    timers.set(
      docId,
      setTimeout(() => {
        const drop = added.get(docId) ?? new Set<string>()
        added.delete(docId)
        timers.delete(docId)
        getStore().setWorkingNodes(docId, working().filter((id) => !drop.has(id)))
      }, IDLE_MS)
    )
  })
}

/** Nodes an edit created or changed. A parent whose only change is its child list is left out. */
function editedNodes(patches: Patch[]): string[] {
  const ids = new Set<string>()
  for (const p of patches) {
    if (p.path[0] !== 'nodes' || p.path.length < 2) continue
    if (p.path.length === 2 && p.op === 'remove') continue
    if (p.path[2] === 'children') continue
    ids.add(String(p.path[1]))
  }
  return [...ids]
}
