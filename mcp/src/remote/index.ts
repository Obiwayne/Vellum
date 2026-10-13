#!/usr/bin/env node
// Vellum remote connector: lets claude.ai (web, desktop, phone) use the Vellum MCP tools through a tunnel.
// Usage: node mcp/dist/remote/index.js   (or VellumRemote.cmd). See docs/REMOTE.md.
import { mkdirSync, readFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { userDataDir } from '../bridge.js'
import { prefetchFonts } from '../fonts.js'
import { bridge } from '../server.js'
import { DEFAULT_ADMIN_PORT, startAdmin } from './admin.js'
import { DEFAULT_REMOTE_PORT, startConnector, type Tunnel } from './connector.js'
import { writePrivate } from './util.js'

interface Config {
  publicHost?: string | null
  tunnel?: Tunnel | null
}

const log = (line: string) => console.log(`[vellum-remote] ${new Date().toLocaleTimeString()} ${line}`)

async function main(): Promise<void> {
  const dir = process.env.VELLUM_REMOTE_DIR || join(userDataDir(), 'remote')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const configFile = join(dir, 'config.json')
  let config: Config = {}
  try {
    config = JSON.parse(readFileSync(configFile, 'utf8')) as Config
  } catch {
    /* first run */
  }
  const tunnelEnv = process.env.VELLUM_REMOTE_TUNNEL
  prefetchFonts()
  const connector = await startConnector({
    dir,
    port: Number(process.env.VELLUM_REMOTE_PORT) || DEFAULT_REMOTE_PORT,
    publicHost: process.env.VELLUM_REMOTE_HOST ?? config.publicHost ?? null,
    tunnel: tunnelEnv === 'cloudflare' || tunnelEnv === 'tailscale' ? tunnelEnv : (config.tunnel ?? null),
    pcName: hostname(),
    log,
    onAppWaiting: ({ app, ip }) => log(`"${app}" (${ip}) signed in with a correct code and waits for Approve on the admin page`)
  })
  const admin = await startAdmin(connector, {
    port: Number(process.env.VELLUM_REMOTE_ADMIN_PORT) || DEFAULT_ADMIN_PORT,
    savePublic: (publicHost, tunnel) => writePrivate(configFile, JSON.stringify({ ...config, publicHost, tunnel }, null, 2)),
    log
  })
  const shutdown = (): void => {
    bridge.close()
    void Promise.all([connector.close(), admin.close()]).then(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error('[vellum-remote] fatal:', err)
  process.exit(1)
})
