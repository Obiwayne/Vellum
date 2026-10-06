// Runs the MCP server bundle INSIDE the packaged app the way an agent would: start the packaged Vellum.exe (npm run pack first),
// then start the bundle with the app's own Electron as Node (ELECTRON_RUN_AS_NODE=1 Vellum.exe resources/mcp/index.mjs) over stdio,
// list its tools (same names as the dev server mcp/dist/index.js), and call real tools against the running app.
// Usage: node scripts/smoke-packaged-mcp.mjs [out-dir] [exe]
import { _electron as electron } from 'playwright'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const out = process.argv[2] ?? '.muster-evidence/smoke-packaged-mcp'
const exe = resolve(process.argv[3] ?? 'release/win-unpacked/Vellum.exe')
const bundle = join(dirname(exe), 'resources', 'mcp', 'index.mjs')
const sdk = (p) => import(pathToFileURL(resolve('mcp/node_modules/@modelcontextprotocol/sdk/dist/esm', p)).href)
const results = []
const check = (ok, label) => results.push(`${ok ? 'passed' : 'FAILED'}: ${label}`)
mkdirSync(out, { recursive: true })
if (!existsSync(exe) || !existsSync(bundle)) {
  console.log(`FAILED: ${exe} or ${bundle} not found (run npm run pack)`)
  process.exit(1)
}
const freePort = () =>
  new Promise((res) => {
    const s = createServer()
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => res(port))
    })
  })
const port = await freePort()
const ud = mkdtempSync(join(tmpdir(), 'vellum-packaged-mcp-'))
const env = { ...process.env, VELLUM_USER_DATA: ud, VELLUM_PORT: String(port), VELLUM_EXPORT_DIR: join(ud, 'export') }
const app = await electron.launch({ executablePath: exe, args: [], env })
let client
let dev
try {
  const page = await app.firstWindow()
  page.setDefaultTimeout(10000)
  await page.waitForTimeout(2500)
  await page.locator('input:not([type=file])').first().fill('Tester')
  await page.getByRole('button', { name: 'Create profile' }).click()
  await page.waitForTimeout(2000)
  await page.getByText('Scratchpad').first().dblclick()
  await page.waitForTimeout(2500)

  const { Client } = await sdk('client/index.js')
  const { StdioClientTransport } = await sdk('client/stdio.js')
  client = new Client({ name: 'packaged-smoke', version: '0.0.1' })
  await client.connect(new StdioClientTransport({ command: exe, args: [bundle], env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, stderr: 'pipe' }))
  const tools = (await client.listTools()).tools.map((t) => t.name).sort()
  check(tools.length >= 40, `the bundle served by the app's own Electron lists ${tools.length} tools`)

  // same tools as the dev server (mcp/dist/index.js) when it is built, else the registerTool calls in the source
  let expected
  if (existsSync('mcp/dist/index.js')) {
    dev = new Client({ name: 'dev-smoke', version: '0.0.1' })
    await dev.connect(new StdioClientTransport({ command: process.execPath, args: ['mcp/dist/index.js'], env, stderr: 'pipe' }))
    expected = (await dev.listTools()).tools.map((t) => t.name).sort()
  } else {
    expected = [...readFileSync('mcp/src/index.ts', 'utf8').matchAll(/registerTool\(\s*'([^']+)'/g)].map((m) => m[1]).sort()
  }
  check(JSON.stringify(tools) === JSON.stringify(expected), `the tool list equals the dev server's (${expected.length} tools${tools.length === expected.length ? '' : `, bundle has ${tools.length}`})`)

  const text = (r) => r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n')
  const info = await client.callTool({ name: 'get_basic_info', arguments: {} })
  check(!info.isError && /Scratchpad/.test(text(info)), 'get_basic_info reaches the running packaged app (file name Scratchpad)')
  const ab = await client.callTool({ name: 'create_artboard', arguments: { name: 'From packaged MCP', styles: { width: '320px', height: '200px', backgroundColor: '#e8f0ff' } } })
  check(!ab.isError, 'create_artboard through the bundle')
  await page.waitForTimeout(800)
  check((await page.locator('[data-node-id]').count()) >= 1, 'the artboard shows up on the canvas of the packaged app')
  await page.screenshot({ path: join(out, '01-artboard-from-bundle.png') })
  const id = [...text(ab).matchAll(/"(?:nodeId|id)"\s*:\s*"([^"]+)"/g)].map((m) => m[1]).at(-1) ?? '' // the file header comes first, the node id last
  check(Boolean(id), `create_artboard returned a node id (${id})`)
  if (id) {
    const shot = await client.callTool({ name: 'get_screenshot', arguments: { nodeId: id } })
    check(!shot.isError && shot.content.some((c) => c.type === 'image'), `get_screenshot returns an image (offscreen render works in the packaged app) ${shot.isError ? text(shot).slice(0, 200) : ''}`)
  }
  // the bundle sits next to the app, outside app.asar (any process can read it; Node cannot import from inside an asar)
  try {
    const asar = await import('@electron/asar')
    const inside = asar.listPackage(join(dirname(exe), 'resources', 'app.asar')).filter((f) => /mcp[\\/]index\.mjs$/.test(f))
    check(inside.length === 0, 'the bundle is not packed into app.asar')
  } catch (e) {
    results.push(`skipped: could not read app.asar (${String(e.message).slice(0, 80)})`)
  }
  // an install folder with spaces in its path (C:\Users\First Last\...): the bundle still starts and lists the same tools
  const spaced = join(ud, 'Program Files', 'Vellum App')
  cpSync(dirname(exe), spaced, { recursive: true })
  const sc = new Client({ name: 'spaced-path', version: '0.0.1' })
  try {
    await sc.connect(new StdioClientTransport({ command: join(spaced, 'Vellum.exe'), args: [join(spaced, 'resources', 'mcp', 'index.mjs')], env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, stderr: 'pipe' }))
    const spacedTools = (await sc.listTools()).tools.map((t) => t.name).sort()
    check(JSON.stringify(spacedTools) === JSON.stringify(tools), `from a folder with spaces in its path the bundle lists the same ${tools.length} tools`)
  } finally {
    await sc.close().catch(() => undefined)
  }
  // the bundle keeps the security behaviour: no bridge token = no access
  const bad = await new Promise((res) => {
    const c = new Client({ name: 'no-token', version: '0.0.1' })
    const t = new StdioClientTransport({ command: exe, args: [bundle], env: { ...env, ELECTRON_RUN_AS_NODE: '1', VELLUM_USER_DATA: join(ud, 'elsewhere') }, stderr: 'pipe' })
    c.connect(t)
      .then(() => c.callTool({ name: 'get_basic_info', arguments: {} }))
      .then((r) => res(Boolean(r.isError)))
      .catch(() => res(true))
      .finally(() => c.close().catch(() => undefined))
  })
  check(bad === true, 'a bundle started without the app data folder (no bridge token) is refused')
} catch (e) {
  results.push(`FAILED: script error: ${String(e.message).slice(0, 300)}`)
} finally {
  console.log(results.join('\n'))
  await client?.close().catch(() => undefined)
  await dev?.close().catch(() => undefined)
  await Promise.race([app.close(), new Promise((r) => setTimeout(r, 8000))])
  try {
    rmSync(ud, { recursive: true, force: true })
  } catch {
    /* temp dir may still be locked */
  }
  process.exit(results.some((r) => r.startsWith('FAILED')) ? 1 : 0)
}
