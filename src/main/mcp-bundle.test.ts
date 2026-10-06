// The MCP server bundle (scripts/build-mcp-bundle.mjs -> resources-out/mcp/index.mjs): one file, no node_modules needed, speaks MCP over
// stdio and offers the same tools as the source. (The packaged app runs it with its own Electron as Node: scripts/smoke-packaged-mcp.mjs.)
// Needs the mcp dependencies (`cd mcp && npm ci`). Without them the suite is skipped locally, but fails when CI is set, so a CI
// run can never go green without building and running the bundle.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const haveMcpDeps = existsSync('mcp/node_modules/@modelcontextprotocol')
const bundle = 'resources-out/mcp/index.mjs'

it.runIf(!haveMcpDeps && Boolean(process.env.CI))('mcp/node_modules is installed (needed to build and test the bundle)', () => {
  throw new Error('mcp/node_modules is missing: run `cd mcp && npm ci` before `npm test` in CI, otherwise the MCP bundle tests are skipped')
})

describe.skipIf(!haveMcpDeps)('MCP server bundle', () => {
  it('builds into one file that does not import any package from node_modules', () => {
    const r = spawnSync(process.execPath, ['scripts/build-mcp-bundle.mjs'], { encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect(statSync(bundle).size).toBeGreaterThan(200_000)
    const src = readFileSync(bundle, 'utf8')
    const imports = [...src.matchAll(/^import .* from ['"]([^'"]+)['"]/gm)].map((m) => m[1])
    expect(imports.filter((i) => !i.startsWith('node:'))).toEqual([]) // only node: built-ins; the SDK, zod and ws are inlined
    expect(src).not.toMatch(/from ['"]ws['"]/)
  }, 60_000)

  it('runs from a folder without node_modules and lists every tool the source registers', async () => {
    const src = readFileSync('mcp/src/index.ts', 'utf8')
    const expected = [...src.matchAll(/registerTool\(\s*'([^']+)'/g)].map((m) => m[1]).sort()
    expect(expected.length).toBeGreaterThan(40)
    const ud = mkdtempSync(join(tmpdir(), 'vellum-bundle-test-'))
    try {
      const child = spawn(process.execPath, [join(process.cwd(), bundle)], { cwd: ud, env: { ...process.env, VELLUM_USER_DATA: ud }, stdio: ['pipe', 'pipe', 'pipe'] })
      let buf = ''
      const replies = new Map<number, { result?: { tools?: { name: string }[] }; error?: unknown }>()
      child.stdout.on('data', (d) => {
        buf += d
        let i
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim()
          buf = buf.slice(i + 1)
          if (line.startsWith('{')) {
            const m = JSON.parse(line)
            if (typeof m.id === 'number') replies.set(m.id, m)
          }
        }
      })
      const send = (o: unknown): void => void child.stdin.write(JSON.stringify(o) + '\n')
      const waitFor = async (id: number): Promise<{ result?: { tools?: { name: string }[] } }> => {
        for (let i = 0; i < 200 && !replies.has(id); i++) await new Promise((r) => setTimeout(r, 50))
        return replies.get(id) ?? {}
      }
      send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'bundle-test', version: '0' } } })
      expect((await waitFor(1)).result).toBeTruthy()
      send({ jsonrpc: '2.0', method: 'notifications/initialized' })
      send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
      const tools = ((await waitFor(2)).result?.tools ?? []).map((t) => t.name).sort()
      const exited = new Promise((r) => child.once('exit', r))
      child.kill()
      await exited // the child runs with the temp folder as cwd: release it before deleting
      expect(tools).toEqual(expected)
    } finally {
      rmSync(ud, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  }, 60_000)
})
