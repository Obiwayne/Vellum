// One-command MCP regression run:  npm run test:mcp   (from the repo root)
// Builds the MCP server, seeds a throwaway data folder with one unprotected profile (it auto-opens),
// starts the app on a free port against that folder, runs profiles, e2e, regress and security in turn,
// prints a summary and always stops the app and deletes the folder. Exit code 1 if anything failed.
//   KEEP=1       keep the data folder and leave artboards in the test files
//   ONLY=e2e,... run just these suites (profiles, e2e, regress, security)
//   APP_BOOT_MS  how long to wait for the app to come up (default 120000)
// Needs the repo's `npm install` and `cd mcp && npm install` done once.
import { spawn, spawnSync } from 'node:child_process'
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { createServer, connect } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const mcpDir = join(here, '..')
const root = join(mcpDir, '..')
const isWin = process.platform === 'win32'
const bootMs = Number(process.env.APP_BOOT_MS) || 120_000
const only = process.env.ONLY ? new Set(process.env.ONLY.split(',').map((s) => s.trim())) : null

const log = (m) => console.log(`[test:mcp] ${m}`)
const freePort = () =>
  new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })
const portOpen = (port) =>
  new Promise((resolve) => {
    const c = connect(port, '127.0.0.1')
    c.once('connect', () => (c.destroy(), resolve(true)))
    c.once('error', () => resolve(false))
  })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Run a command to completion with inherited output; resolves to its exit code. */
const run = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: 'inherit', shell: isWin && opts.shell, ...opts })
    p.on('error', () => resolve(127))
    p.on('exit', (code) => resolve(code ?? 1))
  })

const dataDir = mkdtempSync(join(tmpdir(), 'vellum-test-mcp-'))
const exportDir = join(dataDir, 'export')
const appLog = join(tmpdir(), `vellum-test-mcp-app-${process.pid}.log`)
let app = null
const results = []

function stopApp() {
  if (!app || app.exitCode !== null) return
  if (isWin) spawnSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' })
  else process.kill(-app.pid, 'SIGKILL')
}
function showAppLog() {
  try {
    const lines = readFileSync(appLog, 'utf8').trimEnd().split('\n')
    console.log(['----- app output (last 60 lines) -----', ...lines.slice(-60), '-----'].join('\n'))
  } catch {
    log('no app output captured')
  }
}
function cleanup() {
  stopApp()
  if (!process.env.KEEP) {
    rmSync(appLog, { force: true })
    try {
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
    } catch {
      log(`could not delete ${dataDir}`)
    }
  } else log(`kept ${dataDir}`)
}
process.on('SIGINT', () => (cleanup(), process.exit(130)))

async function main() {
  if (!existsSync(join(root, 'node_modules')) || !existsSync(join(mcpDir, 'node_modules'))) {
    log('missing node_modules: run `npm install` in the repo root and in mcp/ first')
    return 2
  }
  log('building the MCP server')
  if ((await run('npx', ['tsc', '-p', 'tsconfig.json'], { cwd: mcpDir, shell: true })) !== 0) return 2

  const port = String(await freePort())
  const env = {
    ...process.env,
    VELLUM_USER_DATA: dataDir,
    VELLUM_PORT: port,
    VELLUM_NO_UPDATE_CHECK: '1',
    VELLUM_EXPORT_DIR: exportDir
  }
  const want = (name) => !only || only.has(name)

  // the profile store needs no app
  if (want('profiles')) results.push(['profiles', await run(process.execPath, ['--experimental-strip-types', '--no-warnings', join(here, 'profiles.mjs')], { cwd: mcpDir, env })])

  const appSuites = ['e2e', 'regress', 'security'].filter(want)
  if (appSuites.length) {
    // one unprotected profile: the app opens it by itself, no window interaction needed
    const { Vault } = await import(pathToFileURL(join(root, 'src', 'main', 'vault.ts')).href)
    await new Vault(dataDir).create({ name: 'Test' })

    // Electron 4x ships no install script: without this its binary is never downloaded and the app dies at once
    if (!existsSync(join(root, 'node_modules', 'electron', 'path.txt'))) {
      log('downloading the Electron binary')
      if ((await run(process.execPath, [join(root, 'node_modules', 'electron', 'install.js')], { cwd: root })) !== 0) return 2
    }

    log(`starting the app (port ${port}, data ${dataDir})`)
    const out = openSync(appLog, 'w')
    app = spawn(isWin ? 'npx.cmd' : 'npx', ['electron-vite', 'dev'], { cwd: root, env, stdio: ['ignore', out, out], shell: isWin, detached: !isWin })
    closeSync(out)
    app.on('error', (e) => log(`app failed to start: ${e.message}`))
    const t0 = Date.now()
    while (Date.now() - t0 < bootMs && !(await portOpen(Number(port)))) {
      if (app.exitCode !== null) break
      await sleep(500)
    }
    if (!(await portOpen(Number(port)))) {
      log(`the app did not open its bridge on port ${port} within ${bootMs / 1000}s (exit code ${app.exitCode})`)
      showAppLog()
      return 2
    }
    // the bridge answers before the profile is open; wait until a tool works
    const ready = await waitForProfile(env)
    if (!ready) {
      log('the app is up but no profile opened (tools still report "locked")')
      showAppLog()
      return 2
    }
    for (const name of appSuites) {
      log(`running ${name}`)
      results.push([name, await run(process.execPath, [join(here, `${name}.mjs`), ...(name === 'e2e' ? [join(exportDir, 'e2e')] : [])], { cwd: mcpDir, env })])
    }
  }
  return 0
}

async function waitForProfile(env) {
  const { Client } = await import(pathToFileURL(join(mcpDir, 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'esm', 'client', 'index.js')).href)
  const { StdioClientTransport } = await import(pathToFileURL(join(mcpDir, 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'esm', 'client', 'stdio.js')).href)
  const client = new Client({ name: 'test-mcp-ready', version: '0.0.1' })
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(mcpDir, 'dist', 'index.js')], env, stderr: 'ignore' }))
  try {
    const t0 = Date.now()
    while (Date.now() - t0 < 60_000) {
      const res = await client.callTool({ name: 'list_files', arguments: {} }).catch(() => null)
      if (res && !res.isError) return true
      await sleep(1000)
    }
    return false
  } finally {
    await client.close().catch(() => {})
  }
}

let code = 2
try {
  code = await main()
} catch (e) {
  log(`runner error: ${e instanceof Error ? e.stack : e}`)
} finally {
  cleanup()
}
console.log('\n[test:mcp] summary')
for (const [name, c] of results) console.log(`  ${c === 0 ? 'PASS' : 'FAIL'}  ${name}${c === 0 ? '' : ` (exit ${c})`}`)
const failed = results.some(([, c]) => c !== 0)
if (code !== 0) console.log('  runner did not complete (see above)')
process.exit(code !== 0 || failed || results.length === 0 ? 1 : 0)
