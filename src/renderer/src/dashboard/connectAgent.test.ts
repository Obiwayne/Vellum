// @vitest-environment jsdom
// The Connect-agent dialogs show the command for this copy of Vellum: the packaged bundle for an installed build.
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const installed = {
  command: 'C:/Users/First Last/AppData/Local/Programs/Vellum/Vellum.exe',
  args: ['C:/Users/First Last/AppData/Local/Programs/Vellum/resources/mcp/index.mjs'],
  env: { ELECTRON_RUN_AS_NODE: '1' }
}

async function bodyText(entry: unknown): Promise<string> {
  vi.resetModules()
  ;(window as unknown as { canvasApi?: unknown }).canvasApi = entry ? { mcpEntry: entry } : undefined
  const { ConnectAgentBody } = await import('./ConnectAgentModal')
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => root.render(createElement(ConnectAgentBody)))
  const text = host.textContent ?? ''
  act(() => root.unmount())
  host.remove()
  return text
}

afterEach(() => {
  delete (window as unknown as { canvasApi?: unknown }).canvasApi
})

describe('Connect your agent (dashboard / Learn page)', () => {
  it('an installed build shows the command that runs the bundle with the app\'s Electron', async () => {
    const text = await bodyText(installed)
    expect(text).toContain('claude mcp add vellum -e ELECTRON_RUN_AS_NODE=1 -- "C:/Users/First Last/AppData/Local/Programs/Vellum/Vellum.exe" "C:/Users/First Last/AppData/Local/Programs/Vellum/resources/mcp/index.mjs"')
    expect(text).not.toContain('claude mcp add vellum -- node')
  })
  it('a clone shows node and mcp/dist/index.js', async () => {
    expect(await bodyText({ command: 'node', args: ['C:/dev/Vellum/mcp/dist/index.js'] })).toContain('claude mcp add vellum -- node C:/dev/Vellum/mcp/dist/index.js')
  })
  it('without the app (a plain browser) it falls back to the placeholder path', async () => {
    expect(await bodyText(undefined)).toContain('claude mcp add vellum -- node <path-to-Vellum>/mcp/dist/index.js')
  })
})
