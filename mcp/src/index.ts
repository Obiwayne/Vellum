#!/usr/bin/env node
// Vellum MCP server — exposes design tools over stdio and forwards them to the
// running Vellum app over WebSocket (see docs/MCP.md).
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { prefetchFonts } from './fonts.js'
import { bridge, createVellumServer } from './server.js'

async function main(): Promise<void> {
  prefetchFonts()
  const server = createVellumServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
  const shutdown = (): void => {
    bridge.close()
    process.exit(0)
  }
  process.stdin.on('close', shutdown)
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error('[vellum-mcp] fatal:', err)
  process.exit(1)
})
