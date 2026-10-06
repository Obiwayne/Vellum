// Bundles the MCP server (mcp/src/index.ts, with @modelcontextprotocol/sdk, zod and ws inlined) into one file,
// resources-out/mcp/index.mjs, which electron-builder copies next to the app (extraResources, outside the asar). The packaged
// app runs it with its own Electron as Node:  ELECTRON_RUN_AS_NODE=1 Vellum.exe resources/mcp/index.mjs
// Needs mcp/node_modules (cd mcp && npm ci). Usage: node scripts/build-mcp-bundle.mjs   (npm run build:mcp)
import { build } from 'esbuild'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const entry = join(root, 'mcp', 'src', 'index.ts')
const outfile = join(root, 'resources-out', 'mcp', 'index.mjs')

if (!existsSync(join(root, 'mcp', 'node_modules', '@modelcontextprotocol'))) {
  console.error('mcp/node_modules is missing: run `cd mcp && npm ci` first')
  process.exit(1)
}
mkdirSync(dirname(outfile), { recursive: true })
await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // the SDK and ws contain CommonJS code that calls require(): give the ES module one
  banner: { js: "import { createRequire as __vellumCreateRequire } from 'node:module'; const require = __vellumCreateRequire(import.meta.url);" },
  // ws loads these native speed-ups only if they are installed (it falls back without them)
  external: ['bufferutil', 'utf-8-validate'],
  nodePaths: [join(root, 'mcp', 'node_modules')],
  legalComments: 'none',
  logLevel: 'warning'
})
console.log(`wrote ${outfile} (${Math.round(statSync(outfile).size / 1024)} KB)`)
