// Call one Vellum MCP tool: node mcp/test/call.mjs <tool> '<json args>'|@args.json [imageOut.png]
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { writeFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url))
const [tool, json = '{}', imgOut] = process.argv.slice(2)
const client = new Client({ name: 'vellum-cli', version: '0.0.1' })
await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(here, '..', 'dist', 'index.js')], env: process.env }))
// args: inline JSON, or @path/to/args.json
const argText = json.startsWith('@') ? readFileSync(json.slice(1), 'utf8') : json
const res = await client.callTool({ name: tool, arguments: JSON.parse(argText) })
for (const c of res.content) {
  if (c.type === 'text') console.log(c.text)
  else if (c.type === 'image') { if (imgOut) { writeFileSync(imgOut, Buffer.from(c.data, 'base64')); console.log('image ->', imgOut) } else console.log('[image]') }
}
if (res.isError) process.exitCode = 1
await client.close()
