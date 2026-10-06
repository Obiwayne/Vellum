// How an agent starts Vellum's MCP server, and the snippets that register it: one place for both Connect-agent dialogs.
// An installed (packaged) build runs the bundle with its own Electron as Node (ELECTRON_RUN_AS_NODE=1 Vellum.exe
// resources/mcp/index.mjs); a clone runs `node mcp/dist/index.js`. Keep this file free of runtime imports.

/** command + arguments + environment that start the MCP server over stdio */
export interface McpEntry {
  command: string
  args: string[]
  env?: Record<string, string>
}

export interface McpEntryInput {
  isPackaged: boolean
  /** process.execPath: Vellum.exe when packaged */
  execPath: string
  /** app.getAppPath(): the clone's folder (a clone runs from source) */
  appPath: string
  /** process.resourcesPath: where electron-builder put resources/mcp/index.mjs */
  resourcesPath: string
}

const slashes = (p: string): string => p.split('\\').join('/')
const trimEnd = (p: string): string => p.replace(/\/+$/, '')

export function mcpEntryFor(i: McpEntryInput): McpEntry {
  if (i.isPackaged) {
    return { command: slashes(i.execPath), args: [`${trimEnd(slashes(i.resourcesPath))}/mcp/index.mjs`], env: { ELECTRON_RUN_AS_NODE: '1' } }
  }
  return { command: 'node', args: [`${trimEnd(slashes(i.appPath))}/mcp/dist/index.js`] }
}

/** Used when the app did not provide an entry (a plain browser tab, tests). */
export const FALLBACK_MCP_ENTRY: McpEntry = { command: 'node', args: ['<path-to-Vellum>/mcp/dist/index.js'] }

/** One shell word: quoted when it has spaces, quotes or &. A path such as "C:/Users/First Last/..." is the usual case. */
export function shellWord(s: string): string {
  return /[\s"&]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s
}

const envFlags = (env: Record<string, string> | undefined, flag: string): string =>
  Object.entries(env ?? {})
    .map(([k, v]) => `${flag} ${shellWord(`${k}=${v}`)} `)
    .join('')

const launch = (e: McpEntry): string => [e.command, ...e.args].map(shellWord).join(' ')

/** `claude mcp add vellum [-e K=V] -- <command> <args>` */
export function claudeCommand(e: McpEntry): string {
  return `claude mcp add vellum ${envFlags(e.env, '-e')}-- ${launch(e)}`
}

/** `codex mcp add vellum [--env K=V] -- <command> <args>` */
export function codexCommand(e: McpEntry): string {
  return `codex mcp add vellum ${envFlags(e.env, '--env')}-- ${launch(e)}`
}

const json = (o: unknown): string => JSON.stringify(o, null, 2)
const stdio = (e: McpEntry): { command: string; args: string[]; env?: Record<string, string> } => ({
  command: e.command,
  args: e.args,
  ...(e.env && Object.keys(e.env).length ? { env: e.env } : {})
})

/** Claude Desktop, Cursor and most other clients: { mcpServers: { vellum: … } } */
export const mcpServersJson = (e: McpEntry): string => json({ mcpServers: { vellum: stdio(e) } })

/** VS Code .vscode/mcp.json */
export const vscodeJson = (e: McpEntry): string => json({ servers: { vellum: { type: 'stdio', ...stdio(e) } } })

const toml = (s: string): string => JSON.stringify(s) // a TOML basic string takes the same escapes for paths

/** ~/.codex/config.toml */
export function codexToml(e: McpEntry): string {
  const lines = ['[mcp_servers.vellum]', `command = ${toml(e.command)}`, `args = [${e.args.map(toml).join(', ')}]`]
  const env = Object.entries(e.env ?? {})
  if (env.length) lines.push('', '[mcp_servers.vellum.env]', ...env.map(([k, v]) => `${k} = ${toml(v)}`))
  return lines.join('\n')
}
