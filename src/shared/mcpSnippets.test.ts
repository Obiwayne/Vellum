// How an agent starts the MCP server and the snippets that register it, for an installed build and for a clone.
import { describe, expect, it } from 'vitest'
import { claudeCommand, codexCommand, codexToml, mcpEntryFor, mcpServersJson, shellWord, vscodeJson, type McpEntry } from './mcpSnippets'

const raw = String.raw
const installed = mcpEntryFor({
  isPackaged: true,
  execPath: raw`C:\Users\First Last\AppData\Local\Programs\Vellum\Vellum.exe`,
  appPath: raw`C:\Users\First Last\AppData\Local\Programs\Vellum\resources\app.asar`,
  resourcesPath: raw`C:\Users\First Last\AppData\Local\Programs\Vellum\resources`
})
const clone = mcpEntryFor({ isPackaged: false, execPath: raw`C:\x\electron.exe`, appPath: raw`C:\dev\Vellum`, resourcesPath: raw`C:\dev\Vellum\node_modules\electron\dist\resources` })
const spacedClone = mcpEntryFor({ isPackaged: false, execPath: 'x', appPath: raw`C:\My Projects\Vellum`, resourcesPath: 'x' })

describe('mcpEntryFor', () => {
  it('an installed build runs the bundle with its own Electron as Node', () => {
    expect(installed).toEqual({
      command: 'C:/Users/First Last/AppData/Local/Programs/Vellum/Vellum.exe',
      args: ['C:/Users/First Last/AppData/Local/Programs/Vellum/resources/mcp/index.mjs'],
      env: { ELECTRON_RUN_AS_NODE: '1' }
    })
  })
  it('a clone runs node on mcp/dist/index.js, with no environment', () => {
    expect(clone).toEqual({ command: 'node', args: ['C:/dev/Vellum/mcp/dist/index.js'] })
  })
  it('a trailing slash on the resources folder does not double up', () => {
    expect(mcpEntryFor({ isPackaged: true, execPath: raw`C:\V\Vellum.exe`, appPath: '', resourcesPath: raw`C:\V\resources` + '\\' }).args).toEqual(['C:/V/resources/mcp/index.mjs'])
  })
})

describe('shellWord', () => {
  it('quotes only what needs it', () => {
    expect(shellWord('C:/dev/Vellum/mcp/dist/index.js')).toBe('C:/dev/Vellum/mcp/dist/index.js')
    expect(shellWord('C:/First Last/x')).toBe('"C:/First Last/x"')
    expect(shellWord('ELECTRON_RUN_AS_NODE=1')).toBe('ELECTRON_RUN_AS_NODE=1')
    expect(shellWord('R&D/x')).toBe('"R&D/x"')
    expect(shellWord('a"b')).toBe(['"a', 'b"'].join(String.fromCharCode(92, 34)))
  })
})

describe('Claude and Codex commands', () => {
  const exe = '"C:/Users/First Last/AppData/Local/Programs/Vellum/Vellum.exe" "C:/Users/First Last/AppData/Local/Programs/Vellum/resources/mcp/index.mjs"'
  it('installed: the environment goes in as a flag, and the paths with spaces are quoted', () => {
    expect(claudeCommand(installed)).toBe(`claude mcp add vellum -e ELECTRON_RUN_AS_NODE=1 -- ${exe}`)
    expect(codexCommand(installed)).toBe(`codex mcp add vellum --env ELECTRON_RUN_AS_NODE=1 -- ${exe}`)
  })
  it('clone: unchanged from before, node and the script path', () => {
    expect(claudeCommand(clone)).toBe('claude mcp add vellum -- node C:/dev/Vellum/mcp/dist/index.js')
    expect(codexCommand(clone)).toBe('codex mcp add vellum -- node C:/dev/Vellum/mcp/dist/index.js')
  })
  it('clone in a folder with spaces: the script path is quoted', () => {
    expect(claudeCommand(spacedClone)).toBe('claude mcp add vellum -- node "C:/My Projects/Vellum/mcp/dist/index.js"')
  })
  it('the placeholder path of the fallback is not quoted', () => {
    expect(claudeCommand({ command: 'node', args: ['<path-to-Vellum>/mcp/dist/index.js'] })).toBe('claude mcp add vellum -- node <path-to-Vellum>/mcp/dist/index.js')
  })
})

describe('config snippets', () => {
  const parse = (s: string): { mcpServers?: { vellum: McpEntry }; servers?: { vellum: McpEntry & { type: string } } } => JSON.parse(s)
  it('JSON for Claude Desktop, Cursor and other clients carries command, args and env', () => {
    expect(parse(mcpServersJson(installed)).mcpServers?.vellum).toEqual(installed)
    expect(parse(mcpServersJson(clone)).mcpServers?.vellum).toEqual({ command: 'node', args: ['C:/dev/Vellum/mcp/dist/index.js'] }) // no empty env
  })
  it('VS Code: type stdio next to the same fields', () => {
    expect(parse(vscodeJson(installed)).servers?.vellum).toEqual({ type: 'stdio', ...installed })
  })
  it('Codex TOML: command, args and an env table for an installed build; none for a clone', () => {
    expect(codexToml(installed)).toBe(
      [
        '[mcp_servers.vellum]',
        'command = "C:/Users/First Last/AppData/Local/Programs/Vellum/Vellum.exe"',
        'args = ["C:/Users/First Last/AppData/Local/Programs/Vellum/resources/mcp/index.mjs"]',
        '',
        '[mcp_servers.vellum.env]',
        'ELECTRON_RUN_AS_NODE = "1"'
      ].join('\n')
    )
    expect(codexToml(clone)).toBe('[mcp_servers.vellum]\ncommand = "node"\nargs = ["C:/dev/Vellum/mcp/dist/index.js"]')
  })
})
