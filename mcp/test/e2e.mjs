// End-to-end test: spawns the Vellum MCP server over stdio and drives a running Vellum app.
// Usage: start the app (VELLUM_PORT=29174 npm run dev), then: VELLUM_PORT=29174 node mcp/test/e2e.mjs [outDir]
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { mkdirSync, writeFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = process.argv[2] || join(tmpdir(), 'canvas-mcp-e2e')
mkdirSync(outDir, { recursive: true })

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(here, '..', 'dist', 'index.js')],
  // exports are only written inside the export folder: point it at outDir
  env: { ...process.env, VELLUM_PORT: process.env.VELLUM_PORT || process.env.CANVAS_PORT || '29170', VELLUM_EXPORT_DIR: outDir },
  stderr: 'inherit'
})
const client = new Client({ name: 'canvas-e2e', version: '0.0.1' })

let failures = 0
const ok = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`)
  if (!cond) failures++
}

/** Call a tool; returns {header, body, raw}. Body is parsed JSON when possible. */
async function call(name, args = {}) {
  const res = await client.callTool({ name, arguments: args })
  if (res.isError) throw new Error(`${name} failed: ${res.content?.[0]?.text}`)
  const texts = res.content.filter((c) => c.type === 'text').map((c) => c.text)
  const parse = (t) => {
    try {
      return JSON.parse(t)
    } catch {
      return t
    }
  }
  const parsed = texts.map(parse)
  const hasHeader = parsed.length > 1 && parsed[0] && typeof parsed[0] === 'object' && parsed[0].file
  return { header: hasHeader ? parsed[0] : null, body: hasHeader ? parsed[1] : parsed[0], raw: res }
}

async function main() {
  await client.connect(transport)
  const { tools } = await client.listTools()
  const names = tools.map((t) => t.name)
  ok(names.length >= 30, `listTools returned ${names.length} tools`)
  for (const t of ['get_guide', 'get_basic_info', 'create_artboard', 'write_html', 'get_screenshot', 'export', 'finish_working_on_nodes']) {
    ok(names.includes(t), `tool ${t} registered`)
  }
  const instr = client.getInstructions?.() ?? ''
  ok(instr.includes('vellum-mcp-instructions'), 'server instructions reference the guide')

  const guide = await call('get_guide', { topic: 'vellum-mcp-instructions' })
  ok(typeof guide.body === 'string' && guide.body.includes('finish_working_on_nodes'), 'get_guide returns the Vellum guide')

  const files = await call('list_files')
  ok(Array.isArray(files.body.files) && files.body.files.length > 0, `list_files → ${files.body.files?.length} file(s)`)
  const fileId = files.body.files[0].id
  const opened = await call('open_file', { fileId })
  ok(opened.header?.file?.id === fileId, 'open_file returns header for the opened file')

  const info = await call('get_basic_info')
  ok(info.header?.file?.id === fileId && typeof info.header?.contentHash?.tokens === 'string', 'get_basic_info header {file, contentHash}')
  ok(typeof info.body.pageId === 'string' && Array.isArray(info.body.artboards) && Array.isArray(info.body.pages), 'get_basic_info body shape')
  const before = info.body.artboardCount

  await call('create_tokens', { tokens: [{ name: '--color-e2e-accent', value: '#1F4FD8', type: 'color' }] })
  const toks = await call('get_tokens', { namePattern: '--color-e2e-*' })
  ok(toks.body.tokens?.length === 1, 'create_tokens + get_tokens(namePattern)')

  const fonts = await call('get_font_family_info', { familyNames: ['Inter', 'Arial', 'NoSuchFontXYZ'] })
  ok(fonts.body.fontsPerFamily?.Inter?.length > 0, 'get_font_family_info finds Inter (Google)')
  ok(fonts.body.fontsPerFamily?.Arial?.length > 0, 'get_font_family_info finds Arial (local)')
  ok(fonts.body.notFound?.includes('NoSuchFontXYZ'), 'get_font_family_info reports unknown family')

  const ab = await call('create_artboard', {
    name: 'E2E Card',
    styles: { width: '480px', height: '320px', backgroundColor: '#F4F1EA', padding: '32px', gap: '16px' }
  })
  const artboardId = ab.body.id
  ok(typeof artboardId === 'string', `create_artboard → ${artboardId} at (${ab.body.worldX}, ${ab.body.worldY})`)

  const card = await call('write_html', {
    targetNodeId: artboardId,
    mode: 'insert-children',
    html: `<div data-name="Card" style="display:flex;flex-direction:column;gap:12px;padding:24px;background-color:#FFFFFF;border-radius:16px;width:100%;box-shadow:0 1px 2px rgba(0,0,0,0.08)">
  <div style="font-family:Inter;font-size:28px;line-height:34px;font-weight:700;letter-spacing:-0.02em;color:#141414">Hello from Claude</div>
  <div style="font-family:Inter;font-size:16px;line-height:24px;color:#5A5A5A">A small card written through the Vellum MCP server.</div>
</div>`
  })
  const cardId = card.body.createdNodeIds?.[0]
  ok(typeof cardId === 'string' && card.body.nodeCount === 3, `write_html created ${card.body.nodeCount} nodes`)
  console.log(card.body.tree)

  const btn = await call('write_html', {
    targetNodeId: cardId,
    mode: 'insert-children',
    html: `<div data-name="Button" style="display:flex;padding:10px 16px;background-color:var(--color-e2e-accent);border-radius:8px;width:fit-content"><span style="font-family:Inter;font-size:14px;line-height:20px;font-weight:600;color:#FFFFFF">Get started</span></div>`
  })
  const buttonId = btn.body.createdNodeIds?.[0]
  ok(typeof buttonId === 'string', 'write_html into nested node')

  const upd = await call('update_styles', { updates: [{ nodeIds: [artboardId], styles: { height: 'fit-content', backgroundColor: '#EDE7DA' } }] })
  ok(upd.body.updatedNodeIds?.includes(artboardId), 'update_styles')

  const node = await call('get_node_info', { nodeId: cardId })
  const titleId = node.body.childIds?.[0]
  ok(node.body.component === 'Frame' && node.body.childCount === 3, 'get_node_info')
  const st = await call('set_text_content', { updates: [{ nodeId: titleId, textContent: 'Hello from Vellum' }] })
  ok(st.body.results?.[0]?.result === 'updated', 'set_text_content')
  await call('rename_nodes', { updates: [{ nodeId: titleId, name: 'Title' }] })

  const dup = await call('duplicate_nodes', { nodes: [{ id: buttonId }] })
  const dupId = dup.body.duplicates?.[0]?.newId
  ok(typeof dupId === 'string' && Object.keys(dup.body.duplicates[0].descendantIdMap).length === 1, 'duplicate_nodes with descendantIdMap')
  const mv = await call('move_nodes', { moves: [{ nodeId: dupId, before: buttonId }] })
  ok(mv.body.results?.[0]?.result === 'moved' && mv.body.affectedParents?.[cardId]?.[2] === dupId, 'move_nodes (before sibling)')
  const del = await call('delete_nodes', { nodeIds: [dupId] })
  ok(del.body.deletedNodeIds?.includes(dupId), 'delete_nodes')

  const tree = await call('get_tree_summary', { nodeId: artboardId })
  console.log(tree.body.summary)
  ok(typeof tree.body.summary === 'string' && tree.body.summary.startsWith('Frame "E2E Card"') && tree.body.summary.includes('Hello from Vellum'), 'get_tree_summary')

  const children = await call('get_children', { nodeId: artboardId })
  ok(children.body.count === 1 && children.body.children[0].id === cardId, 'get_children')

  const found = await call('find_nodes', { textValue: 'hello*' })
  ok(found.body.nodes?.some((n) => n.id === titleId), 'find_nodes(textValue)')
  const byToken = await call('find_nodes', { filters: [{ styleValue: '#1F4FD8' }] })
  ok(byToken.body.nodes?.some((n) => n.id === buttonId), 'find_nodes(color literal finds token usage)')

  const jsx = await call('get_jsx', { nodeId: artboardId })
  console.log(jsx.body)
  ok(typeof jsx.body === 'string' && jsx.body.includes('className=') && jsx.body.includes('Hello from Vellum'), 'get_jsx tailwind')
  const jsxInline = await call('get_jsx', { nodeId: cardId, format: 'inline-styles' })
  ok(jsxInline.body.includes('style={{'), 'get_jsx inline-styles')

  const cs = await call('get_computed_styles', { nodeIds: [artboardId, titleId] })
  ok(cs.body.styles?.[titleId]?.fontSize === '28px', 'get_computed_styles')

  const shot = await client.callTool({ name: 'get_screenshot', arguments: { nodeId: artboardId, scale: 1 } })
  const img = shot.content.find((c) => c.type === 'image')
  ok(!shot.isError && img && img.mimeType === 'image/png', 'get_screenshot returns PNG image content')
  if (img) {
    const buf = Buffer.from(img.data, 'base64')
    const w = buf.readUInt32BE(16)
    const h = buf.readUInt32BE(20)
    const p = join(outDir, 'screenshot.png')
    writeFileSync(p, buf)
    ok(w === 480 && h > 100, `screenshot is ${w}×${h} (${buf.length} bytes) → ${p}`)
  } else console.log(shot.content)
  const shot2 = await client.callTool({ name: 'get_screenshot', arguments: { nodeId: cardId, scale: 2 } })
  const img2 = shot2.content.find((c) => c.type === 'image')
  if (img2) {
    const buf = Buffer.from(img2.data, 'base64')
    writeFileSync(join(outDir, 'screenshot-card@2x.png'), buf)
    ok(buf.readUInt32BE(16) === 832, `2x screenshot of nested card is ${buf.readUInt32BE(16)}×${buf.readUInt32BE(20)}`)
  }

  const exp = await call('export', {
    outputDir: 'export',
    nodes: { [artboardId]: [{ format: 'png', scale: '2x' }, { format: 'svg' }, { format: 'html' }, { format: 'jsx' }] }
  })
  ok(exp.body.exported?.length === 4 && !exp.body.errors, `export wrote ${exp.body.exported?.length} files`)
  for (const e of exp.body.exported ?? []) {
    const size = statSync(e.path).size
    ok(size > 100, `  ${e.format}: ${e.path} (${size} bytes${e.width ? `, ${e.width}×${e.height}` : ''})`)
  }

  const sel = await call('get_selection')
  ok(Array.isArray(sel.body.selectedNodes), 'get_selection')

  const threads = await call('list_comment_threads')
  ok(threads.body.count === 0, 'list_comment_threads (empty)')

  const fin = await call('finish_working_on_nodes')
  ok(fin.body.released?.includes(artboardId) && fin.body.remaining.length === 0, 'finish_working_on_nodes releases the artboard')

  const info2 = await call('get_basic_info')
  ok(info2.body.artboardCount === before + 1, 'artboard count increased by one')

  // components, variants and properties
  const comp = await call('create_component', { nodeIds: [cardId], name: 'E2E Card' })
  ok(comp.body.componentId === cardId, 'create_component turns the card frame into a component')
  const inst = await call('create_instance', { componentId: cardId, parentId: artboardId })
  const instId = inst.body.instanceId
  ok(typeof instId === 'string', 'create_instance')
  const instInfo = await call('get_node_info', { nodeId: instId })
  ok(instInfo.body.instanceOf === cardId, 'get_node_info reports instanceOf')
  ok((await call('get_node_info', { nodeId: cardId })).body.isComponent === true, 'get_node_info reports isComponent')
  const textProp = await call('add_component_prop', { componentId: cardId, name: 'Heading', type: 'text', defaultValue: 'Hello from Vellum' })
  await call('bind_component_prop', { nodeId: titleId, aspect: 'text', property: 'Heading' })
  const setP = await call('set_instance_props', { nodeId: instId, props: { Heading: 'Hi there' } })
  ok(setP.body.instanceProperties?.Heading === 'Hi there' && textProp.body.propertyId, 'add/bind/set component text property')
  const instTree = await call('get_tree_summary', { nodeId: instId })
  ok(instTree.body.summary.includes('Hi there') && !(await call('get_tree_summary', { nodeId: cardId })).body.summary.includes('Hi there'), 'the instance shows the property value, the main keeps its text')
  const compJsx = await call('get_jsx', { nodeId: instId })
  ok(typeof compJsx.body === 'string' && compJsx.body.includes('<E2ECard heading="Hi there" />') && compJsx.body.includes('function E2ECard('), 'get_jsx exports the instance as component usage plus a definition')
  let refused = ''
  try {
    await call('write_html', { targetNodeId: instId, mode: 'insert-children', html: '<div style="width:10px;height:10px"></div>' })
  } catch (e) {
    refused = e.message
  }
  ok(refused.includes('Detach instance to change structure'), `write_html into an instance is refused (${refused || 'no error'})`)
  const variant = await call('create_variant', { componentId: cardId })
  ok(variant.body.variants?.length === 2 && variant.body.properties?.[0]?.type === 'variant', 'create_variant wraps the component in a set')
  const det = await call('detach_instance', { nodeId: instId })
  ok(det.body.detachedNodeId === instId && (await call('get_node_info', { nodeId: instId })).body.instanceOf === undefined, 'detach_instance')

  // text styles: two texts follow one style; errors change nothing; plain CSS comes out
  const second = await call('write_html', { targetNodeId: cardId, mode: 'insert-children', html: '<span style="font-size:14px">Second line</span>' })
  const secondId = second.body.createdNodeIds?.[0]
  const ts = await call('create_text_style', { name: 'E2E/Heading', style: { fontSize: 40, fontWeight: 700 } })
  ok(typeof ts.body.id === 'string' && ts.body.name === 'E2E/Heading', 'create_text_style')
  const ap = await call('apply_text_style', { nodeIds: [titleId, secondId], styleId: 'e2e/heading' })
  ok(ap.body.appliedNodeIds?.length === 2, 'apply_text_style to two texts (by name)')
  const fs2 = async () => (await call('get_computed_styles', { nodeIds: [titleId, secondId] })).body.styles
  const csA = await fs2()
  ok(csA[titleId]?.fontSize === '40px' && csA[secondId]?.fontSize === '40px', 'both texts show the style typography')
  ok((await call('get_node_info', { nodeId: titleId })).body.textStyle?.name === 'E2E/Heading', 'get_node_info reports textStyle')
  await call('update_text_style', { styleId: ts.body.id, style: { fontSize: 48 } })
  const csB = await fs2()
  ok(csB[titleId]?.fontSize === '48px' && csB[secondId]?.fontSize === '48px', 'editing the style updates BOTH linked texts')
  ok((await call('get_text_styles')).body.styles?.some((s) => s.id === ts.body.id && s.linkedNodeCount === 2), 'get_text_styles lists it with 2 linked nodes')
  // plain CSS comes out of the export tools: no style objects or links
  const jsxOut = await call('get_jsx', { nodeId: titleId, format: 'inline-styles' })
  ok(typeof jsxOut.body === 'string' && jsxOut.body.includes('fontSize: 48') && !/textStyle/i.test(jsxOut.body), 'get_jsx outputs plain CSS for a styled text')
  // bad ids and non-text nodes change nothing and say why
  const snap = async () => JSON.stringify([(await fs2()), (await call('get_text_styles')).body.styles])
  const beforeBad = await snap()
  let badStyle = ''
  try {
    await call('apply_text_style', { nodeIds: [titleId], styleId: 'No such style' })
  } catch (e) {
    badStyle = e.message
  }
  ok(/not found.*Available: E2E\/Heading/.test(badStyle), `a bad style id is refused with the available names (${badStyle.slice(0, 90)})`)
  const nonText = await call('apply_text_style', { nodeIds: [cardId, 'nope'], styleId: ts.body.id })
  ok(nonText.body.appliedNodeIds?.length === 0 && nonText.body.skipped?.length === 2, 'a frame and an unknown node are skipped and listed')
  ok((await snap()) === beforeBad, 'refused calls changed nothing')
  // a manual typography edit unlinks one text only
  const detached = await call('update_styles', { updates: [{ nodeIds: [titleId], styles: { fontSize: '30px' } }] })
  ok(detached.body.detachedTextStyles?.[0] === 'E2E/Heading', 'update_styles fontSize on one text detaches it and says so')
  ok((await call('get_node_info', { nodeId: titleId })).body.textStyle === undefined, 'get_node_info: the edited text no longer follows the style')
  await call('update_text_style', { styleId: ts.body.id, style: { fontSize: 52 } })
  const csC = await fs2()
  ok(csC[titleId]?.fontSize === '30px' && csC[secondId]?.fontSize === '52px', 'later style edits reach the linked text only')
  const delStyle = await call('delete_text_style', { styleId: ts.body.id })
  ok(delStyle.body.deletedStyleId === ts.body.id && delStyle.body.unlinkedNodeIds?.length === 1, 'delete_text_style unlinks the remaining text')
  ok((await fs2())[secondId]?.fontSize === '52px', 'the unlinked text keeps its look')

  // leave the file as we found it
  if (!process.env.KEEP) {
    await call('delete_nodes', { nodeIds: [artboardId] })
    await call('set_tokens', { tokens: [{ name: '--color-e2e-accent', delete: true }] })
  }
}

main()
  .catch((err) => {
    console.error('ERROR', err.message)
    failures++
  })
  .finally(async () => {
    await client.close().catch(() => undefined)
    console.log(failures ? `\n${failures} check(s) FAILED` : '\nALL CHECKS PASSED')
    process.exit(failures ? 1 : 0)
  })
