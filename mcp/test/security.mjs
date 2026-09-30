// Security checks for the WebSocket bridge and for content sanitising. Needs a running Vellum with a
// profile open; use a test instance, e.g. (cmd):
//   set VELLUM_USER_DATA=%TEMP%\vellum-sec && set VELLUM_PORT=29190 && npx electron .
//   cd mcp && npm run build && set VELLUM_USER_DATA=%TEMP%\vellum-sec && set VELLUM_PORT=29190 && node test/security.mjs
// The script reads the bridge secret from <VELLUM_USER_DATA or %APPDATA%\Vellum>\bridge-token, like the MCP server.
// It writes into a "security (temp)" file and deletes the artboards afterwards (KEEP=1 keeps them).
import WebSocket from 'ws'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.VELLUM_PORT) || 29170
const URL = `ws://127.0.0.1:${PORT}`
const userData = process.env.VELLUM_USER_DATA || join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Vellum')
const TOKEN = readFileSync(join(userData, 'bridge-token'), 'utf8').trim()

let failed = 0
let passed = 0
function check(label, cond, detail) {
  if (cond) {
    passed++
    console.log(`  ok   ${label}`)
  } else {
    failed++
    console.log(`  FAIL ${label}${detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 400) : ''}`)
  }
}

/** Try a handshake; resolves {open:true, ws} or {open:false, status}. */
function handshake(opts = {}) {
  return new Promise((resolve) => {
    const ws = new WebSocket(opts.url ?? URL, { headers: opts.headers ?? {}, ...(opts.origin ? { origin: opts.origin } : {}) })
    ws.once('open', () => resolve({ open: true, ws }))
    ws.once('unexpected-response', (_req, res) => {
      resolve({ open: false, status: res.statusCode })
      ws.terminate()
    })
    ws.once('error', (e) => resolve({ open: false, status: 0, error: e.message }))
  })
}

/** Send one raw frame and wait for the next reply. */
function rawCall(ws, data) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('no reply')), 15000)
    ws.once('message', (m) => {
      clearTimeout(t)
      resolve(JSON.parse(m.toString()))
    })
    ws.send(typeof data === 'string' ? data : JSON.stringify(data))
  })
}

console.log('bridge authentication')
{
  const none = await handshake()
  check('no token → rejected (401)', !none.open && none.status === 401, none)
  const wrong = await handshake({ headers: { 'x-vellum-token': 'a'.repeat(64) } })
  check('wrong token → rejected (401)', !wrong.open && wrong.status === 401, wrong)
  const short = await handshake({ headers: { 'x-vellum-token': TOKEN.slice(0, 10) } })
  check('truncated token → rejected', !short.open && short.status === 401, short)
  const browser = await handshake({ headers: { 'x-vellum-token': TOKEN }, origin: 'https://evil.example' })
  check('browser Origin (even with the token) → rejected (403)', !browser.open && browser.status === 403, browser)
  const nullOrigin = await handshake({ headers: { 'x-vellum-token': TOKEN }, origin: 'null' })
  check('Origin: null → rejected', !nullOrigin.open && nullOrigin.status === 403, nullOrigin)
  const rebinding = await handshake({ headers: { 'x-vellum-token': TOKEN, host: `evil.example:${PORT}` } })
  check('foreign Host header (DNS rebinding) → rejected', !rebinding.open && rebinding.status === 403, rebinding)

  const ok = await handshake({ headers: { 'x-vellum-token': TOKEN } })
  check('correct token, no Origin → accepted', ok.open, ok)
  if (ok.open) {
    const ws = ok.ws
    const bad = await rawCall(ws, '{not json')
    check('malformed JSON → error reply, connection stays up', bad.error === 'Invalid JSON', bad)
    const nul = await rawCall(ws, 'null')
    check('JSON null → error reply (no crash)', typeof nul.error === 'string', nul)
    const arr = await rawCall(ws, '[1,2]')
    check('JSON array → error reply', typeof arr.error === 'string', arr)
    const proto = await rawCall(ws, { id: 'p1', tool: '__proto__', args: {} })
    check('tool "__proto__" → unknown tool', /Unknown tool|invalid/i.test(proto.error ?? ''), proto)
    const ctor = await rawCall(ws, { id: 'p2', tool: 'constructor', args: {} })
    check('tool "constructor" → unknown tool', /Unknown tool/.test(ctor.error ?? ''), ctor)
    const weird = await rawCall(ws, { id: 'p3', tool: '<script>', args: {} })
    check('invalid tool name → error', typeof weird.error === 'string', weird)
    const ping = await rawCall(ws, { id: 'p4', tool: 'ping', args: {} })
    check('ping still answers afterwards', ping.id === 'p4' && ping.result?.pong === true, ping)
    ws.close()
  }
}

// ------------------------------------------------------------------------------------------------
const client = new Client({ name: 'vellum-security', version: '0.0.1' })
await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(here, '..', 'dist', 'index.js')], env: process.env }))
async function call(name, args) {
  const res = await client.callTool({ name, arguments: args })
  const texts = res.content.filter((c) => c.type === 'text').map((c) => c.text)
  if (res.isError) throw new Error(`${name}: ${texts.join(' ')}`)
  const body = texts.length > 1 ? texts[texts.length - 1] : texts[0]
  try {
    return JSON.parse(body)
  } catch {
    return body
  }
}

console.log('MCP server (authenticated through the token file)')
const files = await call('list_files', { limit: 200 })
check('list_files works', Array.isArray(files.files), files)

// a raw authenticated socket for the internal render payload
const auth = await handshake({ headers: { 'x-vellum-token': TOKEN } })
const ws = auth.ws
let rid = 0
async function internal(tool, args) {
  const r = await rawCall(ws, { id: `s${++rid}`, tool, args })
  if (r.error) throw new Error(`${tool}: ${r.error}`)
  return r.result
}

console.log('content sanitising (write_html → stored nodes → render/export)')
const fileId = files.files.find((f) => f.name === 'security (temp)')?.id ?? (await call('create_file', { name: 'security (temp)' })).fileId
const ab = (await call('create_artboard', { fileId, name: 'sec', styles: { width: 400, height: 300 } })).id
const PNG1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const evil = `
<div data-name="evil" style="width:300px;height:200px;background:linear-gradient(90deg,#f00,#00f)">
  <script>window.__pwned = 1</script>
  <img data-name="img1" src="x" onerror="window.__pwned=2" style="width:10px;height:10px" />
  <img data-name="img2" src="javascript:alert(1)" style="width:10px;height:10px" />
  <img data-name="img3" src="${PNG1}" style="width:10px;height:10px" />
  <img data-name="img4" src="https://example.com/a.png" style="width:10px;height:10px" />
  <a data-name="link1" href="javascript:alert(1)" onclick="alert(1)">bad link</a>
  <a data-name="link2" href="https://example.com/" target="_blank">good link</a>
  <iframe src="javascript:alert(1)"></iframe>
  <object data="evil.swf"></object>
  <embed src="evil.swf" />
  <base href="https://evil.example/" />
  <meta http-equiv="refresh" content="0;url=https://evil.example/" />
  <button data-name="btn" onmouseover="alert(1)" style="color:#fff">Hover</button>
  <svg data-name="icon" viewBox="0 0 24 24" width="24" height="24" onload="alert(1)" fill="none">
    <defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient>
      <filter id="f"><feGaussianBlur stdDeviation="1"/></filter></defs>
    <script>alert(1)</script>
    <circle cx="12" cy="12" r="10" fill="url(#g)" filter="url(#f)" onclick="alert(1)"/>
    <use href="#g"/>
    <use href="https://evil.example/sprite.svg#x"/>
    <use xlink:href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=#x"/>
    <image href="javascript:alert(1)" width="5" height="5"/>
    <image href="${PNG1}" width="5" height="5"/>
    <a href="javascript:alert(1)"><rect width="4" height="4"/></a>
    <set attributeName="href" to="javascript:alert(1)"/>
    <animate attributeName="xlink:href" values="javascript:alert(1)"/>
    <animate attributeName="opacity" values="0;1" dur="1s"/>
    <foreignObject width="10" height="10"><img src="x" onerror="alert(1)"/></foreignObject>
    <style>@import url(https://evil.example/x.css); .a{fill:red}</style>
    <style>.b{fill:blue}</style>
    <path d="M0 0L24 24" stroke="currentColor" style="stroke-width:2"/>
    </svg><img src="x" onerror="alert('breakout')">
  </svg>
</div>`
const w = await call('write_html', { fileId, targetNodeId: ab, mode: 'insert-children', html: evil })
check('write_html accepted the content', Array.isArray(w.createdNodeIds) && w.createdNodeIds.length > 0, w)
const root = w.createdNodeIds[0]
const payload = (await internal('_render_node', { fileId, nodeId: ab })).body
const jsx = await call('get_jsx', { fileId, nodeId: root, format: 'inline-styles' })
const tw = await call('get_jsx', { fileId, nodeId: root, format: 'tailwind' })
for (const [label, text] of [
  ['canvas/render markup', payload.html],
  ['export HTML', payload.exportHtml],
  ['JSX (inline styles)', jsx],
  ['JSX (tailwind)', tw]
]) {
  const t = String(text)
  check(`${label}: no <script>`, !/<script/i.test(t))
  check(`${label}: no event handler attributes`, !/\son[a-z]+\s*=/i.test(t), t.match(/\son[a-z]+\s*=[^>]*/i)?.[0])
  check(`${label}: no javascript: URLs`, !/javascript:/i.test(t))
  check(`${label}: no iframe/object/embed/base/meta`, !/<(iframe|object|embed|base|meta)\b/i.test(t))
  check(`${label}: no foreignObject`, !/foreignObject/i.test(t))
  check(`${label}: no external <use>`, !/evil\.example\/sprite/.test(t) && !/<use[^>]*data:image/i.test(t))
  check(`${label}: no href animation`, !/attributeName="(xlink:)?href"/i.test(t))
  check(`${label}: no @import`, !/@import/i.test(t))
  check(`${label}: keeps gradient + filter + shapes`, /linearGradient/.test(t) && /feGaussianBlur/.test(t) && /<circle/.test(t) && /<path/.test(t))
  check(`${label}: keeps same-document <use href="#g">`, /<use href="#g"/.test(t))
  check(`${label}: keeps data:image and https images`, t.includes(PNG1) && t.includes('https://example.com/a.png'))
  check(`${label}: keeps safe https link`, t.includes('https://example.com/'))
  check(`${label}: keeps harmless <style> and SMIL opacity`, /\.b\{fill:blue\}/.test(t) && /attributeName="opacity"/.test(t))
  check(`${label}: keeps inline styles/gradients`, /linear-gradient/.test(t))
}

console.log('style/token injection into rendered documents')
{
  await call('create_tokens', { fileId, tokens: [{ name: '--sec-evil', value: '1px}</style><script>window.__pwned=3</script><style>' }] })
  await call('update_styles', { fileId, updates: [{ nodeIds: [root], styles: { fontFamily: 'x</style><script>alert(1)</script>' } }] })
  const p = (await internal('_render_node', { fileId, nodeId: root })).body
  check('tokensCss cannot close <style>', !/<\/style/i.test(p.tokensCss), p.tokensCss)
  const child = (await call('get_children', { fileId, nodeId: root })).children?.[0]?.id
  const pc = child ? (await internal('_render_node', { fileId, nodeId: child })).body : { inheritedCss: '' }
  check('inheritedCss cannot close <style>', !/<\/style/i.test(pc.inheritedCss), pc.inheritedCss)
  await call('set_tokens', { fileId, tokens: [{ name: '--sec-evil', delete: true }] })
}

console.log('offscreen renderer: design content cannot run script')
{
  const doc = (extra) => `<!doctype html><html><body><div id="__canvas_wrap" style="display:inline-flex"><div id="box" style="width:10px;height:10px;background:#00f"></div></div>${extra}</body></html>`
  const base = await internal('main:render_png', { html: doc(''), measureOnly: true })
  check('baseline render measures 10px', base.cssWidth === 10, base)
  const s1 = await internal('main:render_png', { html: doc(`<script>document.getElementById('box').style.width='500px'</script>`), measureOnly: true })
  check('<script> does not run', s1.cssWidth === 10, s1)
  const s2 = await internal('main:render_png', { html: doc(`<img src="data:," onerror="document.getElementById('box').style.width='500px'">`), measureOnly: true })
  check('inline event handler does not run', s2.cssWidth === 10, s2)
  const png = await internal('main:render_png', { html: doc(''), scale: 2 })
  check('rendering still works (PNG 20×20 at 2x)', png.width === 20 && png.height === 20 && png.base64.length > 50, { w: png.width, h: png.height })
  let threw = ''
  try {
    await internal('main:render_png', { html: 42 })
  } catch (e) {
    threw = e.message
  }
  check('render rejects non-string html', /missing html/.test(threw), threw)
}

if (!process.env.KEEP) await call('delete_nodes', { fileId, nodeIds: [ab] })
ws.close()
await client.close()
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
