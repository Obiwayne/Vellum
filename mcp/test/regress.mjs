// Regression checks for the bugs in docs/BUGS.md. Needs the Vellum app running (npm run dev).
//   cd mcp && npm run build && node test/regress.mjs
// Creates a temporary file, writes HTML cases into it, asserts via get_computed_styles /
// get_node_info / get_screenshot, then deletes the artboards. KEEP=1 keeps them.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const client = new Client({ name: 'vellum-regress', version: '0.0.1' })
await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(here, '..', 'dist', 'index.js')], env: process.env }))

async function call(name, args) {
  const res = await client.callTool({ name, arguments: args })
  const texts = res.content.filter((c) => c.type === 'text').map((c) => c.text)
  if (res.isError) throw new Error(`${name}: ${texts.join(' ')}`)
  const body = texts.length > 1 ? texts[texts.length - 1] : texts[0]
  try {
    return { json: JSON.parse(body), image: res.content.find((c) => c.type === 'image') }
  } catch {
    return { json: body, image: res.content.find((c) => c.type === 'image') }
  }
}

let failed = 0
let passed = 0
function check(label, cond, detail) {
  if (cond) {
    passed++
    console.log(`  ok   ${label}`)
  } else {
    failed++
    console.log(`  FAIL ${label}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`)
  }
}
const near = (a, b, tol = 1) => typeof a === 'number' && Math.abs(a - b) <= tol
const pngSize = (b64) => {
  const buf = Buffer.from(b64, 'base64')
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

// reuse the temp file of an earlier run (there is no delete_file tool), else create it
const existing = (await call('list_files', { limit: 200 })).json.files?.find((f) => f.name === 'regress (temp)')
const fileId = existing?.id ?? (await call('create_file', { name: 'regress (temp)' })).json.fileId
const artboards = []
async function artboard(name, styles) {
  const r = (await call('create_artboard', { fileId, name, styles })).json
  artboards.push(r.id)
  return r.id
}
async function write(target, html) {
  return (await call('write_html', { fileId, targetNodeId: target, mode: 'insert-children', html })).json.createdNodeIds
}
async function styles(ids) {
  return (await call('get_computed_styles', { fileId, nodeIds: ids })).json.styles
}
async function info(id) {
  return (await call('get_node_info', { fileId, nodeId: id })).json
}
async function kids(id) {
  return (await info(id)).childIds
}

try {
  const ab = await artboard('Regress', { width: '400px', height: 'fit-content', backgroundColor: '#FFFFFF', padding: '20px', gap: '10px' })

  // 1. write_html text without line-height keeps line-height normal (not a fixed 20px)
  console.log('1. text line-height')
  {
    const [t] = await write(ab, '<div style="font-size:40px;font-family:Segoe UI">#7C5CFF</div>')
    const s = (await styles([t]))[t]
    check('no fixed 20px line-height', s.lineHeight !== '20px', s.lineHeight)
    const i = await info(t)
    check('40px text is taller than 40px (normal ≈ 1.33em)', i.height > 45 && i.height < 60, i.height)
  }

  // 3. block containers (no display) behave like browser block flow
  console.log('3. block containers')
  {
    const [card] = await write(ab, '<div style="width:350px;display:flex;flex-direction:column"><div style="padding:4px 0 12px"><div style="font-size:12.5px;line-height:17px">Fires your events exactly as a real viewer would, without going LIVE. It wraps onto two lines.</div></div><div style="font-size:12px;line-height:16px">Viewer name</div></div>')
    const [wrap, label] = await kids(card)
    const w = await info(wrap)
    check('wrapper grows to wrapped text (2+ lines + padding)', w.height >= 17 * 2 + 16, w.height)
    const l = await info(label)
    check('next sibling sits below the wrapper', near(l.y, w.y + w.height), { wrapperBottom: w.y + w.height, labelY: l.y })
    const [text] = await kids(wrap)
    const ts = (await styles([text]))[text]
    check('child of block wrapper is not absolutely positioned', ts.position !== 'absolute', ts)

    const [row] = await write(ab, '<div style="display:flex;align-items:center;height:36px;width:300px"><div style="width:20px;height:20px;background:#333"></div><div style="flex:1;padding-left:17px"><div style="font-size:14px;line-height:20px">Coffee · 1 coin</div></div></div>')
    const [, cell] = await kids(row)
    const c = await info(cell)
    check('text cell is vertically centred in the 36px row', near(c.y, 8) && near(c.height, 20), c)

    const [hero] = await write(ab, '<div style="width:340px;border-radius:10px;background:#222;overflow:hidden"><div style="display:flex;gap:24px;padding:22px"><div style="width:60px;height:80px;background:#555"></div></div></div>')
    const h = await info(hero)
    check('overflow:hidden block parent grows to its child (80 + 44)', near(h.height, 124), h.height)

    const [tile] = await write(ab, '<div style="padding:3px;border:2px solid #000;width:fit-content"><div style="width:100px;height:60px;background:#f00"></div></div>')
    const ti = await info(tile)
    check('fit-content bordered wrapper hugs its child (100+10 × 60+10)', near(ti.width, 110) && near(ti.height, 70), ti)

    const [inline] = await write(ab, '<div style="width:300px;text-align:center"><span style="font-size:14px">A</span><span style="font-size:14px">B</span></div>')
    const [a, b] = await kids(inline)
    const ai = await info(a)
    const bi = await info(b)
    check('inline children sit on one line', near(ai.y, bi.y) && bi.x > ai.x, { a: ai, b: bi })
    check('text-align:center centres the line', ai.x > 100, ai.x)
  }

  // 4. position:absolute; left; top survives write_html into a flex parent
  console.log('4. absolute left/top')
  {
    const [box] = await write(ab, '<div style="position:relative;width:300px;height:120px;display:flex;background:#eee"><div style="flex:1;background:#ccc"></div></div>')
    const [ov] = await write(box, '<div style="position:absolute;left:10px;top:15px;width:100px;height:50px;background:#f0f"></div>')
    const s = (await styles([ov]))[ov]
    check('position absolute kept', s.position === 'absolute', s)
    check('left/top kept', (s.left === 10 || s.left === '10px') && (s.top === 15 || s.top === '15px'), s)
    const i = await info(ov)
    const bi = await info(box)
    check('rendered at left/top inside the parent', near(i.worldX - bi.worldX, 10) && near(i.worldY - bi.worldY, 15), { i, bi })
    const [filler] = await kids(box)
    const fi = await info(filler)
    check('sibling flex item keeps the full width', near(fi.width, 300), fi.width)

    const [cover] = await write(box, '<div style="position:absolute;left:0px;top:0px;width:100%;height:100%;background:rgba(0,0,0,.5)"></div>')
    const ci = await info(cover)
    check('100% cover overlay covers the parent', near(ci.width, 300) && near(ci.height, 120) && near(ci.worldX, bi.worldX), ci)
  }

  // 5. absolute element with only right/bottom stays anchored there
  console.log('5. right/bottom anchoring')
  {
    const [frame] = await write(ab, '<div style="position:relative;width:240px;height:160px;background:#ddd"><div style="position:absolute;right:0;top:0;width:9px;height:160px;background:#000"></div><div style="position:absolute;right:10px;bottom:5px;width:20px;height:20px;background:#00f"></div></div>')
    const [bar, dot] = await kids(frame)
    const s = (await styles([bar]))[bar]
    check('no left:0 added', s.left === undefined || s.left === 'auto', s)
    const fi = await info(frame)
    const b = await info(bar)
    check('scrollbar pinned to the right edge', near(b.worldX - fi.worldX, 231), b.worldX - fi.worldX)
    const d = await info(dot)
    check('right/bottom box pinned bottom-right', near(d.worldX - fi.worldX, 210) && near(d.worldY - fi.worldY, 135), { x: d.worldX - fi.worldX, y: d.worldY - fi.worldY })
  }

  // 6. get_node_info measures fit-content nodes (file is not open / page not on screen)
  console.log('6. node info for fit-content nodes')
  {
    const [col] = await write(ab, '<div style="display:flex;flex-direction:column;width:249px;height:fit-content;padding:8px;gap:4px;background:#eee"><div style="height:100px;background:#999"></div><div style="font-size:14px;line-height:20px">Title</div></div>')
    const i = await info(col)
    check('width/height measured', near(i.width, 249) && near(i.height, 100 + 20 + 4 + 16), i)
    check('x/y/worldX/worldY measured', [i.x, i.y, i.worldX, i.worldY].every((v) => typeof v === 'number'), i)
    const tree = (await call('get_tree_summary', { fileId, nodeId: col })).json.summary
    check('tree summary has no ?×?', !tree.includes('?'), tree)
  }

  // 10. product name: guide topic + aliases
  console.log('10. guide topics')
  {
    for (const topic of ['vellum-mcp-instructions', 'canvas-mcp-instructions']) {
      const g = (await call('get_guide', { topic })).json
      check(`get_guide("${topic}") returns the Vellum guide`, typeof g === 'string' && g.startsWith('# Vellum MCP'), String(g).slice(0, 40))
    }
  }

  // 7. backslashes in text are literal (write_html and set_text_content); only real newlines break lines
  console.log('7. literal backslashes')
  {
    const path = 'C:\\nonexistent\\TikFinity.exe' // the characters C : \ n o n e … (no newline)
    const [t] = await write(ab, `<div style="font-size:13px;line-height:18px">${path}</div>`)
    const i = await info(t)
    check('write_html keeps backslashes literally', i.textContent === path, i.textContent)
    check('no line break from "\\n" in the text (one line)', near(i.height, 18), i.height)
    const other = 'C:\\Users\\wayne\\AppData\\Roaming\\GiftDeck'
    await call('set_text_content', { fileId, updates: [{ nodeId: t, textContent: other }] })
    check('set_text_content keeps backslashes literally', (await info(t)).textContent === other, (await info(t)).textContent)
    await call('set_text_content', { fileId, updates: [{ nodeId: t, textContent: 'a\\tb\nc' }] })
    const two = await info(t)
    check('a real newline still breaks the line (and \\t stays literal)', two.textContent === 'a\\tb\nc' && near(two.height, 36), two)
    const [e] = await write(ab, '<div style="font-size:13px;line-height:18px">&#92;n and \\\\ and \\"</div>')
    check('entity and doubled backslashes are kept as written', (await info(e)).textContent === '\\n and \\\\ and \\"', (await info(e)).textContent)
  }

  // 8. &nbsp;-only and empty text elements become one-line Text nodes
  console.log('8. nbsp / empty text')
  {
    const [col] = await write(ab, '<div style="display:flex;flex-direction:column;width:100px"><div style="font-size:11.5px;line-height:15px">&nbsp;</div><div style="font-size:11.5px;line-height:15px">x</div></div>')
    const [blank, x] = await kids(col)
    const bi = await info(blank)
    check('&nbsp; div is a Text node', bi.component === 'Text', bi.component)
    check('nbsp is preserved', bi.textContent === '\u00a0', JSON.stringify(bi.textContent))
    check('&nbsp; line is 15px tall', near(bi.height, 15), bi.height)
    check('next line sits at y=15', near((await info(x)).y, 15), (await info(x)).y)
    check('parent is 30px tall', near((await info(col)).height, 30), (await info(col)).height)

    const [box] = await write(ab, '<div style="display:flex;width:200px;padding:4px;border:1px solid #999"><div style="font-family:Segoe UI;font-size:13px;flex:1"></div></div>')
    const [empty] = await kids(box)
    const ei = await info(empty)
    check('empty typography div is a Text node', ei.component === 'Text', ei.component)
    check('empty text keeps one line of height (normal line-height)', ei.height >= 15 && ei.height <= 20, ei.height)
    const es = (await styles([empty]))[empty]
    check('no min-height leaks into computed styles', es.minHeight === undefined, es)
    const r = (await call('set_text_content', { fileId, updates: [{ nodeId: empty, textContent: 'filled' }] })).json
    check('set_text_content works on it', r.results?.[0]?.result === 'updated', r)

    const [spacer] = await write(ab, '<div style="display:flex;flex-direction:column"><div style="height:15px;flex-shrink:0"></div><div style="width:8px;height:8px;background:#f00;border-radius:50%"></div></div>')
    const [sp, dot] = await kids(spacer)
    check('empty spacer / dot stay Frames', (await info(sp)).component === 'Frame' && (await info(dot)).component === 'Frame', [(await info(sp)).component, (await info(dot)).component])
  }

  // 9. finish_working_on_nodes with nodeIds releases only those marks
  console.log('9. finish_working_on_nodes(nodeIds)')
  {
    const a = await artboard('Regress mark A', { width: '100px', height: '100px' })
    const b = await artboard('Regress mark B', { width: '100px', height: '100px' })
    const [ak] = await write(a, '<div style="width:10px;height:10px;background:#000"></div>')
    await write(b, '<div style="width:10px;height:10px;background:#000"></div>')
    const r1 = (await call('finish_working_on_nodes', { fileId, nodeIds: [ak] })).json
    check('releases the artboard of the given node', r1.released?.includes(a) && !r1.remaining?.includes(a), r1)
    check("keeps the other agent's mark", r1.remaining?.includes(b) && !r1.released?.includes(b), r1)
    const r2 = (await call('finish_working_on_nodes', { fileId })).json
    check('no args releases everything', r2.remaining?.length === 0 && r2.released?.includes(b), r2)
  }

  // 2. screenshots of tall/wide nodes are full size (no downscale, no scrollbars)
  console.log('2. large screenshots')
  {
    const tall = await artboard('Regress tall', { width: '600px', height: '5200px', backgroundColor: '#FF0000' })
    const r = await call('get_screenshot', { fileId, nodeId: tall })
    const size = pngSize(r.image.data)
    check('5200px tall node → 600×5200 image', size.width === 600 && size.height === 5200, size)
    check('reported size matches', r.json.width === 600 && r.json.height === 5200, r.json)
    const wide = await artboard('Regress wide', { width: '4500px', height: '300px', backgroundColor: '#00FF00' })
    const w = pngSize((await call('get_screenshot', { fileId, nodeId: wide })).image.data)
    check('4500px wide node → 4500×300 image', w.width === 4500 && w.height === 300, w)
    // no scrollbar: the last column/row of a solid artboard must be the fill colour
    const out = join((await import('node:os')).tmpdir(), 'vellum-regress-export')
    const ex = (await call('export', { fileId, nodeId: tall, format: 'png', scale: 1, outputDir: out })).json
    check('export is full size too', ex.exported?.[0]?.width === 600 && ex.exported?.[0]?.height === 5200, ex.exported)
    const px = await solidEdges(r.image.data)
    check('no scrollbars / seams (edges and tile rows are solid red)', px.ok, px)
  }
} catch (err) {
  failed++
  console.error('ERROR', err)
} finally {
  if (!process.env.KEEP && artboards.length) await call('delete_nodes', { fileId, nodeIds: artboards }).catch(() => {})
  await client.close()
}

console.log(`\n${passed} passed, ${failed} failed${process.env.KEEP ? ` (kept file ${fileId})` : ` (temp file ${fileId}: artboards deleted)`}`)
process.exitCode = failed ? 1 : 0

/** Decode an RGBA/RGB PNG (8-bit) and check the right column, bottom row and tile seams are pure red. */
async function solidEdges(b64) {
  const { inflateSync } = await import('node:zlib')
  const buf = Buffer.from(b64, 'base64')
  let pos = 8
  let width = 0
  let height = 0
  let ctype = 0
  const idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      ctype = data[9]
    } else if (type === 'IDAT') idat.push(data)
    pos += 12 + len
  }
  const bpp = ctype === 6 ? 4 : 3
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * bpp
  const img = Buffer.alloc(height * stride)
  let prev = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const cur = img.subarray(y * stride, (y + 1) * stride)
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0
      const b = prev[i]
      const c = i >= bpp ? prev[i - bpp] : 0
      let v = line[i]
      if (f === 1) v += a
      else if (f === 2) v += b
      else if (f === 3) v += (a + b) >> 1
      else if (f === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      cur[i] = v & 255
    }
    prev = cur
  }
  const at = (x, y) => Array.from(img.subarray(y * stride + x * bpp, y * stride + x * bpp + bpp))
  const red = (p) => p[0] > 240 && p[1] < 15 && p[2] < 15
  const samples = []
  for (let y = 0; y < height; y += 97) samples.push([width - 1, y], [width - 12, y])
  for (let x = 0; x < width; x += 37) samples.push([x, height - 1], [x, height - 12], [x, 2047], [x, 2048], [x, 4095], [x, 4096])
  const bad = samples.filter(([x, y]) => y < height && !red(at(x, y)))
  return { ok: bad.length === 0, bad: bad.slice(0, 5).map(([x, y]) => ({ x, y, px: at(x, y) })) }
}
