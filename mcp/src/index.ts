#!/usr/bin/env node
// Vellum MCP server — exposes design tools over stdio and forwards them to the
// running Vellum app over WebSocket (see docs/MCP.md).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { VellumBridge } from './bridge.js'
import { GUIDES, GUIDE_TOPICS_DESCRIPTION, SERVER_INSTRUCTIONS } from './guide.js'
import { fontFamilyInfo, prefetchFonts } from './fonts.js'
import { buildDocument, buildExportHtml, buildPdfDocument, buildSvg, type RenderPayload } from './render.js'

const bridge = new VellumBridge()

const server = new McpServer(
  { name: 'vellum', version: '0.1.0' },
  { instructions: SERVER_INSTRUCTIONS, capabilities: { tools: {} } }
)

// ------------------------------------------------------------------------------------------------
// helpers

type Content = CallToolResult['content']

interface Scoped {
  __header: Record<string, unknown>
  body: unknown
}

const isScoped = (v: unknown): v is Scoped => Boolean(v && typeof v === 'object' && '__header' in (v as object))

const text = (t: string): Content[number] => ({ type: 'text', text: t })
const asText = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v, null, 2))

function format(result: unknown): CallToolResult {
  if (isScoped(result)) return { content: [text(asText(result.__header)), text(asText(result.body))] }
  return { content: [text(asText(result ?? null))] }
}

function fail(err: unknown): CallToolResult {
  return { isError: true, content: [text(err instanceof Error ? err.message : String(err))] }
}

/** Forward a tool to the renderer and format the response (header + body). */
async function forward(tool: string, args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    return format(await bridge.call(tool, stripUndefined(args)))
  } catch (err) {
    return fail(err)
  }
}

function stripUndefined(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))
}

const fileId = z.string().optional().describe('The file ID that the tool should operate on. When omitted the file the user is viewing is used.')
const pageId = z
  .string()
  .optional()
  .describe('The page ID that the tool should operate on. When omitted the active page will be used. The active page can change between tool calls, prefer passing explicit page IDs.')
const styleValue = z.union([z.string(), z.number()])
const styles = z.record(z.string(), styleValue)

// ------------------------------------------------------------------------------------------------
// rendering (screenshots / export)

interface Rendered {
  base64: string
  width: number
  height: number
  cssWidth: number
  cssHeight: number
}

async function renderPayload(args: { fileId?: string; nodeId: string }): Promise<{ header: Record<string, unknown>; payload: RenderPayload }> {
  const res = await bridge.call<Scoped>('_render_node', stripUndefined(args))
  return { header: res.__header, payload: res.body as RenderPayload }
}

/** Image limits of MCP clients (Claude rejects images over 8000 px per side or 5 MB). */
const SCREENSHOT_MAX_SIDE = 8000
const SCREENSHOT_MAX_BYTES = 4_900_000

async function rasterize(
  payload: RenderPayload,
  opts: { scale?: number; format?: 'png' | 'jpeg' | 'webp'; maxDimension?: number; measureOnly?: boolean; background?: string }
): Promise<Rendered> {
  const html = await buildDocument(payload)
  return bridge.call<Rendered>('main:render_png', { html, ...opts }, 90_000)
}

/** Scale strings: "2x", "512w", "512h", "720p"; or a plain number. */
function resolveScale(scale: unknown, cssWidth: number, cssHeight: number): number {
  if (typeof scale === 'number' && scale > 0) return scale
  if (typeof scale !== 'string') return 1
  const m = /^(\d+(?:\.\d+)?)(x|w|h|p)?$/.exec(scale.trim())
  if (!m) return 1
  const v = parseFloat(m[1])
  switch (m[2]) {
    case 'w':
      return v / Math.max(1, cssWidth)
    case 'h':
      return v / Math.max(1, cssHeight)
    case 'p':
      return v / Math.max(1, Math.min(cssWidth, cssHeight))
    default:
      return v
  }
}

// ------------------------------------------------------------------------------------------------
// export folder policy
//
// `export` writes files, and its arguments (outputDir, and node names used as file names) come from
// the agent / the design, so: files only ever land inside the export folder (VELLUM_EXPORT_DIR,
// default %USERPROFILE%\Downloads\Vellum) or inside a folder the user listed in VELLUM_EXPORT_ROOTS
// (separated by ";" on Windows, ":" elsewhere). A relative outputDir is taken relative to the export
// folder. Symlinks/junctions can't be used to step outside, and existing files are never
// overwritten (a " (2)" suffix is added instead).

const exportDir = (): string => resolve(process.env.VELLUM_EXPORT_DIR || process.env.CANVAS_EXPORT_DIR || join(homedir(), 'Downloads', 'Vellum'))

function exportRoots(): string[] {
  const extra = (process.env.VELLUM_EXPORT_ROOTS || '')
    .split(delimiter)
    .map((s) => s.trim())
    .filter((s) => s && isAbsolute(s))
    .map((s) => resolve(s))
  return [exportDir(), ...extra]
}

/** `child` is `root` or inside it (path.relative is case-insensitive on Windows; other drives / UNC are outside). */
function within(root: string, child: string): boolean {
  const rel = relative(root, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** realpath of the deepest existing ancestor of `p` (+ the not-yet-existing rest). */
async function realish(p: string): Promise<string> {
  let cur = p
  const rest: string[] = []
  for (;;) {
    try {
      return join(await realpath(cur), ...rest.reverse())
    } catch {
      const up = dirname(cur)
      if (up === cur) return p
      rest.push(cur.slice(up.length).replace(/^[\\/]+/, ''))
      cur = up
    }
  }
}

/** Resolve and authorise the folder an export writes into (creating it). Throws when it's not allowed. */
async function resolveExportDir(outputDir: string | undefined): Promise<string> {
  const base = exportDir()
  const roots = exportRoots()
  if (outputDir !== undefined && (typeof outputDir !== 'string' || outputDir.includes('\0'))) throw new Error('Invalid outputDir')
  const target = outputDir ? resolve(base, outputDir) : base
  const root = roots.find((r) => within(r, target))
  if (!root) {
    throw new Error(
      `outputDir must be inside the export folder ${base}` +
        (roots.length > 1 ? ` or one of ${roots.slice(1).join(', ')}` : '') +
        '. Pass a relative outputDir (a subfolder of the export folder), or ask the user to add the folder to VELLUM_EXPORT_ROOTS in the MCP server config.'
    )
  }
  // symlinks / junctions: compare real locations (before creating anything, and again after)
  const realRoot = await realish(root)
  if (!within(realRoot, await realish(target))) throw new Error('outputDir resolves outside the export folder (symlink or junction)')
  await mkdir(target, { recursive: true })
  if (!within(await realpath(root), await realpath(target))) throw new Error('outputDir resolves outside the export folder (symlink or junction)')
  return target
}

/** A file name from a layer name: no separators, control chars, device names, or leading/trailing dots and spaces. */
function safeName(s: string): string {
  let n = String(s ?? '')
    .replace(/[<>:"/\\|?*\x00-\x1f\x7f]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .replace(/^[.\s]+|[.\s]+$/g, '')
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i.test(n)) n = `_${n}`
  return n || 'node'
}

/** Write a new file `<base>.<ext>` (or `<base> (n).<ext>`) in `dir`, never overwriting anything. */
async function writeNew(dir: string, base: string, ext: string, data: string | Buffer): Promise<string> {
  for (let i = 1; i < 10_000; i++) {
    const p = join(dir, i === 1 ? `${base}.${ext}` : `${base} (${i}).${ext}`)
    try {
      await writeFile(p, data, { flag: 'wx' }) // O_EXCL: fails on any existing file or symlink
      return p
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
  }
  throw new Error('Too many files with that name in the export folder')
}

type ExportFormat = 'png' | 'jpg' | 'webp' | 'svg' | 'html' | 'jsx' | 'pdf'
const EXPORT_FORMATS = ['png', 'jpg', 'webp', 'svg', 'html', 'jsx', 'pdf'] as const

/** Print nodes to one PDF through the app (`main:render_pdf`): one page per node, each sized to it. */
async function renderPdf(payloads: RenderPayload[]): Promise<{ data: Buffer; pages: { width: number; height: number }[] }> {
  const html = await buildPdfDocument(payloads)
  const res = await bridge.call<{ base64: string; pages: { width: number; height: number }[] }>('main:render_pdf', { html }, 90_000)
  return { data: Buffer.from(res.base64, 'base64'), pages: res.pages }
}

async function exportNode(
  fileIdArg: string | undefined,
  nodeId: string,
  fmt: ExportFormat,
  scale: unknown,
  dir: string
): Promise<{ nodeId: string; name: string; format: string; path: string; width?: number; height?: number }> {
  const { payload } = await renderPayload({ fileId: fileIdArg, nodeId })
  const base = safeName(payload.name)
  if (fmt === 'pdf') {
    const pdf = await renderPdf([payload])
    const path = await writeNew(dir, base, 'pdf', pdf.data)
    return { nodeId, name: payload.name, format: fmt, path, width: pdf.pages[0]?.width, height: pdf.pages[0]?.height }
  }
  if (fmt === 'html') {
    const path = await writeNew(dir, base, 'html', await buildExportHtml(payload))
    return { nodeId, name: payload.name, format: fmt, path }
  }
  if (fmt === 'jsx') {
    const res = await bridge.call<Scoped>('get_jsx', stripUndefined({ fileId: fileIdArg, nodeId, format: 'tailwind' }))
    const code = typeof res.body === 'string' ? res.body : String((res.body as { jsx?: string })?.jsx ?? '')
    const comp = base.replace(/[^A-Za-z0-9]+(.)?/g, (_m, c: string | undefined) => (c ? c.toUpperCase() : '')).replace(/^[^A-Za-z]+/, '') || 'Design'
    const name = comp[0].toUpperCase() + comp.slice(1)
    const path = await writeNew(dir, base, 'jsx', `export default function ${name}() {\n  return ${code.trim()}\n}\n`)
    return { nodeId, name: payload.name, format: fmt, path }
  }
  // measure once so w/h/p scales can be resolved
  const measured = await rasterize(payload, { measureOnly: true })
  if (fmt === 'svg') {
    const path = await writeNew(dir, base, 'svg', await buildSvg(payload, Math.ceil(measured.cssWidth), Math.ceil(measured.cssHeight)))
    return { nodeId, name: payload.name, format: fmt, path, width: Math.ceil(measured.cssWidth), height: Math.ceil(measured.cssHeight) }
  }
  const s = resolveScale(scale ?? '1x', measured.cssWidth, measured.cssHeight)
  const img = await rasterize(payload, {
    scale: s,
    format: fmt === 'jpg' ? 'jpeg' : fmt === 'webp' ? 'webp' : 'png',
    maxDimension: 16000,
    // JPG has no alpha: flatten onto the artboard's fill (or the page background)
    background: fmt === 'jpg' ? payload.background || '#FFFFFF' : undefined
  })
  const path = await writeNew(dir, base, fmt, Buffer.from(img.base64, 'base64'))
  return { nodeId, name: payload.name, format: fmt, path, width: img.width, height: img.height }
}

// ------------------------------------------------------------------------------------------------
// tools

server.registerTool(
  'get_guide',
  {
    description:
      'Read a detailed guide on a specific topic. Call with topic "vellum-mcp-instructions" before using other Vellum tools for best results. Other topics: "mobile-status-bar".',
    inputSchema: { topic: z.string().describe(GUIDE_TOPICS_DESCRIPTION) }
  },
  async ({ topic }) => {
    const g = GUIDES[topic]
    if (!g) return fail(`Unknown guide topic "${topic}". Available: ${Object.keys(GUIDES).filter((k) => !k.startsWith('canvas')).join(', ')}`)
    return { content: [text(g)] }
  }
)

server.registerTool(
  'get_basic_info',
  {
    description: `Get essential context about the current design: file name, page name, node count, artboards with their dimensions, font families used, a compact list of design tokens.
Call get_basic_info first to understand the canvas situation.
- When no fileId is provided the file the user is viewing is used.
- Pass pageId to inspect a specific page; omit to use the page the user is viewing.
- worldX/worldY properties are the world position of the node
- worldX/worldY/width/height are null when the size or position depends on layout (e.g. fit-content, flex children) and the node was not measured (i.e. the page is inactive)
- pages lists every page in the file; the one with isActive is what the user sees`,
    inputSchema: { fileId, pageId }
  },
  (args) => forward('get_basic_info', args)
)

server.registerTool(
  'list_files',
  {
    description: 'Lists Vellum files: open tabs first, then recently accessed files. Sorted by updatedAt, most recent first.',
    inputSchema: { limit: z.number().int().min(1).max(200).optional().describe('Maximum number of files to return. Defaults to 50.') }
  },
  (args) => forward('list_files', args)
)

server.registerTool(
  'open_file',
  {
    description:
      'Opens a Vellum file by its ID (as a tab in the app and makes it active). Optional pageId is applied only when the file was not already open. Returns a get_basic_info response.',
    inputSchema: { fileId: z.string().min(1).describe('The Vellum file ID to open.'), pageId: z.string().optional() }
  },
  (args) => forward('open_file', args)
)

server.registerTool(
  'create_file',
  {
    description: "Create a new Vellum file and return the new file's ID. To start working in the new file, call open_file with the returned ID.",
    inputSchema: {
      name: z.string().optional().describe('Optional display name for the new file.'),
      cloneFileId: z.string().optional().describe('Optional file ID to clone from. If provided, the new file is a copy of this one.')
    }
  },
  (args) => forward('create_file', args)
)

server.registerTool(
  'create_page',
  {
    description: 'Creates a new page in the file and returns its ID. To work on the new page use the returned pageId in subsequent tool calls.',
    inputSchema: { fileId, name: z.string().optional().describe('Optional display name for the new page. Defaults to "Page N".') }
  },
  (args) => forward('create_page', args)
)

server.registerTool(
  'rename_pages',
  {
    description: 'Rename one or more pages in the file. Does not switch which page the user is viewing. Supports batch renames.',
    inputSchema: {
      fileId,
      updates: z.array(z.object({ pageId: z.string(), name: z.string() })).describe('Array of {pageId, name}.')
    }
  },
  (args) => forward('rename_pages', args)
)

server.registerTool(
  'create_artboard',
  {
    description: `Creates a new artboard (top-level frame) on the canvas.
- Returns the node ID which you can then use with write_html({mode:'insert-children'}) to add content.
- Use the styles property to set the artboard size and styles.
- Artboards default to \`display: "flex", flexDirection: "column"\`
- The artboard is placed to the right of existing artboards (80px gap) unless you pass left/top.
- Pass pageId to create the artboard on a specific page. Omit to use the page the user is viewing.

**Default sizes by device** (when the user doesn't specify a size):
  - **Desktop**: 1440 x 900px
  - **Tablet**: 768 x 1024px
  - **Mobile**: 390 x 844px — include a status bar at the top (get_guide({ topic: "mobile-status-bar" })).

The suggested height is a starting point. When wrapping up, if content clips, switch the artboard to \`height: "fit-content"\` via update_styles instead of guessing a new fixed height.`,
    inputSchema: {
      fileId,
      pageId,
      name: z.string().describe('Name for the artboard (shown in the layer tree).'),
      styles: styles.describe(
        'CSS styles for the artboard as a JSON object with camelCase property names. width and height are required — use whole pixel values. Example: {"width": "1440px", "height": "900px", "backgroundColor": "#f5f5f5", "padding": "20px"}'
      )
    }
  },
  (args) => forward('create_artboard', args)
)

server.registerTool(
  'write_html',
  {
    description: `IMPORTANT: Write incrementally. The user sees you write on the canvas in real-time. Show them visual progress every few seconds.
Each write_html call should create one visual item: a header, a single list row, a button bar, or a paragraph block.
Even simple components should be incremental: a card = container/header, then each row, then the footer.
For repeated elements: create the container first, then add each item as a separate write_html call into the container or use duplicate_nodes on the first child.

HTML and CSS rules:
- Always use inline styles (style="..")
- Enforce consistency with design tokens as CSS variables if available
- All Google Fonts and locally installed fonts are available in font-family
- All CSS color formats are supported: hex, rgb(a), hsl(a), oklch, oklab etc
- Use flex as the primary layout mode. Flexbox, padding, and gap are the core layout tools
- Absolute position is fully supported. Use it for decorative elements
- Do NOT use: margin, display: inline, display: grid, HTML tables. Use padding and gap for spacing
- Assume border-box sizing everywhere
- Use <pre> or white-space: pre for code blocks or indented text
- Do NOT use emojis as icons. Use SVG icons or images
- Rich text isn't supported; a text element should have one style
- Use the data-name (or layer-name) attribute to name layers, e.g. <div data-name="Hero">`,
    inputSchema: {
      fileId,
      html: z.string().describe('HTML string to parse into design nodes. Supports standard HTML elements with inline CSS styles.'),
      targetNodeId: z
        .string()
        .describe('The ID of the target node. In "insert-children" mode, new nodes are added as children of this node. In "replace" mode, this node is removed and replaced by the parsed HTML.'),
      mode: z
        .enum(['insert-children', 'replace'])
        .describe('"insert-children" adds the HTML as children of the target node. "replace" removes the target node and puts the parsed HTML in its place.')
    }
  },
  (args) => forward('write_html', args)
)

server.registerTool(
  'update_styles',
  {
    description: `Update styles on one or more nodes. Use this for targeted style changes. Supports design tokens as CSS variables. Supports batch updates in a single call.
- Setting the top / left styles of an artboard changes its position on the canvas.
- Pass an empty string or null to remove a style.`,
    inputSchema: {
      fileId,
      updates: z
        .array(
          z.object({
            nodeIds: z.array(z.string()).describe('The IDs of the nodes to update.'),
            styles: z
              .record(z.string(), z.union([z.string(), z.number(), z.null()]))
              .describe('Styles as a JSON object with camelCase property names (e.g. {"backgroundColor": "#fff", "padding": "20px"}), like React.CSSProperties.')
          })
        )
        .describe('Array of style updates to apply. Each item specifies node IDs and styles to apply to all of them.')
    }
  },
  (args) => forward('update_styles', args)
)

server.registerTool(
  'set_text_content',
  {
    description: 'Set the text content of one or more Text nodes. Use this instead of write_html replace when you only need to change text. Supports batch updates in a single call.',
    inputSchema: {
      fileId,
      updates: z
        .array(
          z.object({
            nodeId: z.string().describe('The ID of the Text node to update.'),
            textContent: z.string().optional().describe('The new text content.'),
            text: z.string().optional().describe('Alias of textContent.')
          })
        )
        .describe('Array of text updates to apply.')
    }
  },
  (args) => forward('set_text_content', args)
)

server.registerTool(
  'rename_nodes',
  {
    description: 'Rename one or more layers in the design. Names longer than 50 characters are truncated. Supports batch renames.',
    inputSchema: {
      fileId,
      updates: z.array(z.object({ nodeId: z.string(), name: z.string() })).describe('Array of {nodeId, name}.')
    }
  },
  (args) => forward('rename_nodes', args)
)

server.registerTool(
  'duplicate_nodes',
  {
    description:
      'Duplicate one or more nodes (deep clone including descendants). Duplicated artboards are positioned to the right to avoid overlap. Returns the source and new node IDs plus a descendantIdMap mapping every original descendant ID to its clone, so you can immediately edit cloned nodes.',
    inputSchema: {
      fileId,
      nodes: z
        .array(
          z.object({
            id: z.string().describe('The ID of the node to duplicate.'),
            parentId: z.string().optional().describe('Optional parent for the duplicate. Defaults to the source node\'s parent.')
          })
        )
        .describe('Array of nodes to duplicate.')
    }
  },
  (args) => forward('duplicate_nodes', args)
)

server.registerTool(
  'move_nodes',
  {
    description: `Move one or more existing nodes. Preserves node IDs.
Each move is one of:
1. Sibling-relative: { nodeId, before: siblingId } or { nodeId, after: siblingId }.
2. Parent-absolute: { nodeId, parentId, index? } — index is clamped to [0, childCount]; omit to append. parentId 'root' = the page root.
Alternatively pass { nodeIds, targetParentId, index? } to move several nodes into one parent.
For flex parents this changes visual order; for freeform parents it changes stacking and keeps world position.
Returns resolved parentId/index per move plus affectedParents (post-move children lists).`,
    inputSchema: {
      fileId,
      moves: z
        .array(
          z.object({
            nodeId: z.string(),
            before: z.string().optional(),
            after: z.string().optional(),
            parentId: z.string().optional(),
            index: z.number().int().min(0).optional()
          })
        )
        .optional()
        .describe('Move operations, applied sequentially.'),
      nodeIds: z.array(z.string()).optional().describe('Shorthand: nodes to move into targetParentId.'),
      targetParentId: z.string().optional(),
      index: z.number().int().min(0).optional()
    }
  },
  (args) => forward('move_nodes', args)
)

server.registerTool(
  'delete_nodes',
  {
    description:
      'Delete one or more nodes from the design (and all their descendants).\nIMPORTANT: Before deleting nodes that you think have an incorrect parent verify using get_node_info first.',
    inputSchema: { fileId, nodeIds: z.array(z.string()).describe('Array of node IDs to delete.') }
  },
  (args) => forward('delete_nodes', args)
)

server.registerTool(
  'get_selection',
  {
    description:
      'Get detailed information about the currently selected nodes, including IDs, names, component types, size, and which artboard they belong to. When no fileId is provided the file the user is viewing is used.',
    inputSchema: { fileId }
  },
  (args) => forward('get_selection', args)
)

server.registerTool(
  'get_children',
  {
    description:
      "Get the direct children of a node: IDs, names, component types, child counts, worldX/worldY and x/y (relative to parent). Positions are null when they depend on layout and the node isn't measured (inactive page).",
    inputSchema: { fileId, nodeId: z.string().describe('The ID of the parent node to get children from') }
  },
  (args) => forward('get_children', args)
)

server.registerTool(
  'get_node_info',
  {
    description:
      "Get detailed information about a node: size, visibility, lock state, parent, children IDs, text content (for text nodes), worldX/worldY and x/y. Values are null when they depend on layout and the node isn't measured.",
    inputSchema: { fileId, nodeId: z.string().describe('The ID of the node to inspect') }
  },
  (args) => forward('get_node_info', args)
)

server.registerTool(
  'get_tree_summary',
  {
    description: `Get a compact text summary of a node's subtree hierarchy.
- Returns an indented tree showing each node's component type, name, ID, and dimensions
- Sizes show '?' when they depend on layout and the node is not measured
- Much cheaper than get_jsx for understanding structure.`,
    inputSchema: {
      fileId,
      nodeId: z.string().describe('The ID of the root node to summarize'),
      depth: z.number().optional().describe('Maximum depth to traverse (default 3, max 10).')
    }
  },
  (args) => forward('get_tree_summary', args)
)

server.registerTool(
  'find_nodes',
  {
    description: `Find nodes by name, type, text content and/or style. Searches every page in the file by default; pass pageId to search a page or nodeId to search a subtree (nodeId wins).
- query / name: case-insensitive substring match on layer name ("*" wildcards anchor to the whole value)
- type: frame | text | image | svg | rect (or component names: Frame, Text, Image, SVG, Rectangle)
- textValue: match Text content, case-insensitive, "*" wildcards anchored to the whole value
- filters: [{styleName, styleValue}] AND-combined; "*" wildcards; token names match var(--token) usages`,
    inputSchema: {
      fileId,
      pageId: z.string().optional(),
      nodeId: z.string().optional(),
      query: z.string().optional(),
      name: z.string().optional(),
      type: z.string().optional(),
      textValue: z.string().optional(),
      filters: z.array(z.object({ styleName: z.string().optional(), styleValue: z.string().optional() })).optional()
    }
  },
  (args) => forward('find_nodes', args)
)

server.registerTool(
  'get_jsx',
  {
    description: 'Get the JSX code representation of a node and its descendants. Supports two styling formats: Tailwind CSS classes (default) or inline styles.',
    inputSchema: {
      fileId,
      nodeId: z.string().describe('The ID of the node to generate JSX from'),
      format: z.enum(['tailwind', 'inline-styles']).optional().describe('"tailwind" (default) or "inline-styles"')
    }
  },
  (args) => forward('get_jsx', args)
)

server.registerTool(
  'get_computed_styles',
  {
    description: 'Get the computed CSS styles for one or more nodes. Returns a map of nodeId to CSSProperties object. Supports batch requests.',
    inputSchema: { fileId, nodeIds: z.array(z.string()).describe('Array of node IDs to get styles from') }
  },
  (args) => forward('get_computed_styles', args)
)

server.registerTool(
  'get_screenshot',
  {
    description:
      'Capture a screenshot of a specific node by ID. Returns the image as base64-encoded PNG. Images are capped to fit API size limits. Defaults to 1x scale which is sufficient for verifying layout, spacing, and visual appearance. Use scale=2 only to read small text or inspect fine details.',
    inputSchema: {
      fileId,
      nodeId: z.string().describe('The ID of the node to capture'),
      scale: z.number().optional().describe('Render scale factor. 1 (default) or 2.')
    }
  },
  async ({ fileId: f, nodeId, scale }) => {
    try {
      const { header, payload } = await renderPayload({ fileId: f, nodeId })
      // Rendered at full size (tiled in the app, no scrollbars). The only clamp is the MCP image
      // limit: at most SCREENSHOT_MAX_SIDE px per side and SCREENSHOT_MAX_BYTES per image.
      let maxDimension = SCREENSHOT_MAX_SIDE
      let img = await rasterize(payload, { scale: scale && scale > 0 ? Math.min(scale, 4) : 1, maxDimension })
      for (let i = 0; i < 3 && img.base64.length * 0.75 > SCREENSHOT_MAX_BYTES; i++) {
        const factor = Math.sqrt(SCREENSHOT_MAX_BYTES / (img.base64.length * 0.75)) * 0.9
        maxDimension = Math.max(256, Math.floor(Math.max(img.width, img.height) * factor))
        img = await rasterize(payload, { scale: scale && scale > 0 ? Math.min(scale, 4) : 1, maxDimension })
      }
      return {
        content: [
          text(asText(header)),
          { type: 'image', data: img.base64, mimeType: 'image/png' },
          text(asText({ nodeId, width: img.width, height: img.height }))
        ]
      }
    } catch (err) {
      return fail(err)
    }
  }
)

const exportSetting = z.object({
  format: z.enum(EXPORT_FORMATS),
  scale: z.union([z.string(), z.number()]).optional().describe('"1x", "2x", "512w", "512h", "720p" or a number')
})

server.registerTool(
  'export',
  {
    description: `Export nodes to files on disk. Returns the written paths. Files go to the export folder (%USERPROFILE%\\Downloads\\Vellum unless the user set VELLUM_EXPORT_DIR). outputDir may be a subfolder of it (relative path) or an absolute folder inside it or inside a folder the user allowed with VELLUM_EXPORT_ROOTS; other folders are refused. Existing files are never overwritten.
Pass either:
- nodeId (+ format, scale), or
- nodes: { [nodeId]: [{format, scale}] } ([] = PNG 1x), or
- pageId alone (or nothing) to export every artboard on that page. With format "pdf" this writes ONE multi-page PDF (one page per artboard, each page sized to its artboard).
Formats: png (default), jpg (flattened onto the artboard/page background), webp, svg (HTML in foreignObject), html (standalone page), jsx (React component), pdf (vector, selectable text, page = node size; scale is ignored).`,
    inputSchema: {
      fileId,
      pageId: z.string().optional(),
      nodeId: z.string().optional(),
      format: z.enum(EXPORT_FORMATS).optional(),
      scale: z.union([z.string(), z.number()]).optional(),
      nodes: z.record(z.string(), z.array(exportSetting)).optional(),
      outputDir: z.string().max(1024).optional().describe('Subfolder of the export folder (relative), or an absolute folder inside an allowed export root.')
    }
  },
  async (args) => {
    try {
      const dir = await resolveExportDir(args.outputDir || undefined)
      const jobs: { nodeId: string; format: ExportFormat; scale: unknown }[] = []
      let header: Record<string, unknown> | null = null
      if (args.nodes && Object.keys(args.nodes).length) {
        for (const [id, settings] of Object.entries(args.nodes)) {
          if (!settings.length) jobs.push({ nodeId: id, format: 'png', scale: '1x' })
          for (const s of settings) jobs.push({ nodeId: id, format: s.format, scale: s.scale })
        }
      } else if (args.nodeId) {
        jobs.push({ nodeId: args.nodeId, format: args.format ?? 'png', scale: args.scale })
      } else {
        const info = await bridge.call<Scoped>('get_basic_info', stripUndefined({ fileId: args.fileId, pageId: args.pageId }))
        header = info.__header
        const artboards = ((info.body as { artboards?: { id: string }[] }).artboards ?? []).map((a) => a.id)
        if (!artboards.length) throw new Error('Nothing to export: the page has no artboards')
        if (args.format === 'pdf') {
          // all visible artboards of the page in one PDF (the in-app export skips hidden ones too)
          const b = info.body as { fileName?: string; pageName?: string; artboards?: { id: string; isVisible?: boolean }[] }
          const shown = (b.artboards ?? []).filter((a) => a.isVisible !== false).map((a) => a.id)
          if (!shown.length) throw new Error('Nothing to export: every artboard on the page is hidden')
          const payloads = []
          for (const id of shown) payloads.push((await renderPayload({ fileId: args.fileId, nodeId: id })).payload)
          const pdf = await renderPdf(payloads)
          const path = await writeNew(dir, safeName(`${b.fileName ?? 'Vellum'} - ${b.pageName ?? 'Page'}`), 'pdf', pdf.data)
          const exported = [{ nodeIds: shown, name: b.pageName, format: 'pdf', path, pages: pdf.pages }]
          return { content: [text(asText(header)), text(asText({ outputDir: dir, exported }))] }
        }
        for (const id of artboards) jobs.push({ nodeId: id, format: args.format ?? 'png', scale: args.scale })
      }
      const exported = []
      const errors = []
      for (const j of jobs) {
        try {
          exported.push(await exportNode(args.fileId, j.nodeId, j.format, j.scale, dir))
        } catch (err) {
          errors.push({ nodeId: j.nodeId, format: j.format, error: err instanceof Error ? err.message : String(err) })
        }
      }
      if (!header) {
        const info = await bridge.call<Scoped>('get_basic_info', stripUndefined({ fileId: args.fileId }))
        header = info.__header
      }
      return { content: [text(asText(header)), text(asText({ outputDir: dir, exported, ...(errors.length ? { errors } : {}) }))] }
    } catch (err) {
      return fail(err)
    }
  }
)

const tokenTypes = z.enum(['breakpoint', 'color', 'container', 'fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'lineHeight', 'opacity', 'radius', 'spacing'])

server.registerTool(
  'get_tokens',
  {
    description:
      'List the file\'s design tokens (colors, spacing, typography, etc). format "json" (default) returns structured tokens, "css" a `:root { ... }` stylesheet, "tailwind" a Tailwind v4 `@theme { ... }` block. When the file has theme modes (e.g. Light/Dark), json includes each token\'s per-mode values and css/tailwind add a `[data-mode="Dark"] { ... }` block per mode.',
    inputSchema: {
      fileId,
      format: z.enum(['json', 'css', 'tailwind']).optional(),
      types: z.array(tokenTypes).optional().describe('Filter by design token type(s).'),
      namePattern: z.string().optional().describe('Glob pattern against the full CSS variable name, e.g. "--color-*", "*brand*".')
    }
  },
  (args) => forward('get_tokens', args)
)

const tokenName = z.string().regex(/^--[a-zA-Z0-9_-]+$/)

server.registerTool(
  'set_tokens',
  {
    description: `Update, rename or delete existing design tokens by their full CSS variable name. Each entry needs name; newName, value, delete are optional.
Alternatively pass replace: true with the full token list to replace the whole token set.
Returns one result per input entry.`,
    inputSchema: {
      fileId,
      tokens: z
        .array(
          z.object({
            name: tokenName,
            newName: tokenName.optional(),
            value: z.union([z.string(), z.number()]).optional().describe('Value in the base mode.'),
            modes: z
              .record(z.string(), z.union([z.string(), z.number(), z.null()]))
              .optional()
              .describe('Values in other theme modes, e.g. {"Dark": "#0B0B0C"}; null removes a mode value. Unknown modes are created.'),
            delete: z.boolean().optional(),
            description: z.string().optional()
          })
        )
        .min(1),
      replace: z.boolean().optional().describe('Replace the entire token set with `tokens` (each needs a value).')
    }
  },
  (args) => forward('set_tokens', args)
)

server.registerTool(
  'create_tokens',
  {
    description: `Create (or upsert) one or more design tokens. Each entry needs name and value (type is optional but recommended).
Use var(--other-token) as the value to alias another token. For colors define neutrals first, then primary, secondary, accent; other types smallest value first.
Theme modes: pass modes: {"Dark": "#0B0B0C"} for a token's value in another mode. The first use creates the modes (the base mode is called "Light" unless the file already has modes). Then put a frame in a mode with set_theme_mode, or write_html with data-mode="Dark" on the artboard.`,
    inputSchema: {
      fileId,
      tokens: z
        .array(
          z.object({
            name: tokenName,
            value: z.union([z.string(), z.number()]).describe('Value in the base mode.'),
            modes: z.record(z.string(), z.union([z.string(), z.number()])).optional().describe('Values in other theme modes, e.g. {"Dark": "#0B0B0C"}.'),
            type: tokenTypes.optional(),
            description: z.string().optional()
          })
        )
        .min(1)
    }
  },
  (args) => forward('create_tokens', args)
)

server.registerTool(
  'set_theme_mode',
  {
    description:
      'Put frames (usually artboards) into a theme mode such as "Dark": the frame and everything inside it use that mode\'s token values. Pass mode null to inherit again. See get_basic_info → themeModes; create modes with create_tokens (modes: {...}).',
    inputSchema: {
      fileId,
      nodeIds: z.array(z.string()).min(1),
      mode: z.string().nullable().describe('Mode name, or null to inherit from the parent.')
    }
  },
  (args) => forward('set_theme_mode', args)
)

server.registerTool(
  'get_font_family_info',
  {
    description:
      'Get information about whether a font family is available to the user and detailed information about all weights and styles in the family. Looks up fonts installed on the user\'s machine and Google Fonts.',
    inputSchema: { familyNames: z.array(z.string()).describe('Names of the font families to look up.') }
  },
  async ({ familyNames }) => {
    try {
      return { content: [text(asText(await fontFamilyInfo(familyNames)))] }
    } catch (err) {
      return fail(err)
    }
  }
)

server.registerTool(
  'finish_working_on_nodes',
  {
    description:
      'MUST call this when done working. Removes the working indicator from nodes/artboards you were editing. Call with no arguments to release all, or pass nodeIds to release only some.',
    inputSchema: { fileId, nodeIds: z.array(z.string()).optional() }
  },
  (args) => forward('finish_working_on_nodes', args)
)

server.registerTool(
  'list_comment_threads',
  {
    description:
      'List comment threads in the file. The user leaves comments by pinning them to layers with the Comment tool, usually as change requests for you ("make this say Get started", "more padding here"). Each thread includes the node it is pinned to (id, name, type, text, parent, artboard) and the comment text. Defaults to open threads. To address comments: make the change on the node, then reply_to_comment_thread with a short note of what you did and resolve: true.',
    inputSchema: {
      fileId,
      pageId: z.string().optional().describe('Only threads on this page.'),
      nodeId: z.string().optional().describe('Only threads pinned to this node or its descendants.'),
      status: z.enum(['open', 'resolved', 'all']).optional().describe('Default "open".'),
      limit: z.number().int().optional(),
      offset: z.number().int().optional()
    }
  },
  (args) => forward('list_comment_threads', args)
)

server.registerTool(
  'get_comment_thread',
  {
    description: 'Get a comment thread with all its messages (user comments and earlier agent replies) and the node it is pinned to.',
    inputSchema: { fileId, threadId: z.string().describe('Thread id, or its number as shown on the pin (e.g. "3").') }
  },
  (args) => forward('get_comment_thread', args)
)

server.registerTool(
  'reply_to_comment_thread',
  {
    description:
      'Reply to a comment thread as the AI; the reply shows in the thread on the canvas. Say briefly what you changed (or ask a clarifying question and leave it open). Pass resolve: true when the request is done.',
    inputSchema: {
      fileId,
      threadId: z.string().describe('Thread id, or its number as shown on the pin.'),
      body: z.string().describe('Reply text (plain text, max 4000 characters).'),
      resolve: z.boolean().optional().describe('Also mark the thread resolved.')
    }
  },
  (args) => forward('reply_to_comment_thread', args)
)

server.registerTool(
  'set_comment_thread_status',
  {
    description: 'Mark a comment thread as open or resolved.',
    inputSchema: { fileId, threadId: z.string(), status: z.enum(['open', 'resolved']) }
  },
  (args) => forward('set_comment_thread_status', args)
)

server.registerTool(
  'list_comment_thread_authors',
  {
    description: 'List the names of everyone who wrote in the comment threads of the file.',
    inputSchema: { fileId }
  },
  (args) => forward('list_comment_thread_authors', args)
)

// ------------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  prefetchFonts()
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
