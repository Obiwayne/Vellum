// Offscreen HTML rasteriser for MCP screenshots/exports. The MCP server sends a complete HTML
// document (node markup + tokens + font links) through the bridge as `main:render_png`; we load it
// in a hidden offscreen BrowserWindow, wait for fonts/images, measure the node and capture it.
// Works regardless of whether the node is visible, zoomed or on another page in the editor.
// The document is served from memory through the `vellum-render:` scheme on the window's own
// in-memory session, so design content never touches the disk.
import { BrowserWindow, nativeImage, protocol, session, type NativeImage } from 'electron'
import { readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const SCHEME = 'vellum-render'
const PARTITION = 'vellum-render' // no "persist:" prefix → in-memory session (no disk cache)
/** documents being rendered, by id; removed as soon as the page has loaded */
const docs = new Map<string, string>()

/**
 * CSP for rendered documents. Design content never runs script here (the page's own scripts,
 * inline handlers and javascript: URLs are blocked; our measuring code is injected with
 * executeJavaScript, which CSP doesn't apply to), can't frame or submit anything, and may only
 * load images, fonts and stylesheets (Google Fonts, https images, data:/blob: URLs).
 */
const RENDER_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'unsafe-inline' https:",
  'font-src https: data:',
  'img-src https: http: data: blob:',
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "worker-src 'none'",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'"
].join('; ')

/** Largest HTML document accepted for rendering (embedded data: images make these big). */
const MAX_HTML = 100 * 1024 * 1024

/** Must run before app ready: a standard scheme behaves like http (relative URLs, fonts, CORS). */
export function registerRenderScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, supportFetchAPI: true, corsEnabled: true } }])
}

let schemeReady = false
function ensureScheme(): void {
  if (schemeReady) return
  schemeReady = true
  session.fromPartition(PARTITION).protocol.handle(SCHEME, (req) => {
    const id = new URL(req.url).hostname
    const html = docs.get(id)
    if (html === undefined) return new Response('Not found', { status: 404 })
    return new Response(html, {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': RENDER_CSP }
    })
  })
  const ses = session.fromPartition(PARTITION)
  // rendered content needs no permissions at all (camera, notifications, clipboard, …)
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
  ses.setPermissionCheckHandler(() => false)
  ses.on('will-download', (e) => e.preventDefault())
}

/** Older versions wrote render HTML to %TEMP%\canvas-render-*; remove any leftovers. */
export function cleanStaleRenderTemp(): void {
  try {
    const t = tmpdir()
    for (const n of readdirSync(t)) {
      if (n.startsWith('canvas-render-')) rmSync(join(t, n), { recursive: true, force: true })
    }
  } catch {
    /* ignore */
  }
}

export interface RenderArgs {
  html: string
  /** device pixels per CSS pixel (default 1) */
  scale?: number
  format?: 'png' | 'jpeg'
  quality?: number
  /** clamp the longest output side (scale is reduced to fit) */
  maxDimension?: number
  /** only measure; don't capture */
  measureOnly?: boolean
  /** flatten onto this colour (e.g. JPEG) */
  background?: string
}

export interface RenderResult {
  base64: string
  width: number
  height: number
  cssWidth: number
  cssHeight: number
}

const MAX_TEXTURE = 16000

let win: BrowserWindow | null = null
let queue: Promise<unknown> = Promise.resolve()
let seq = 0

function getWindow(): BrowserWindow {
  if (win && !win.isDestroyed()) return win
  win = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      offscreen: true,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: true,
      backgroundThrottling: false,
      spellcheck: false,
      partition: PARTITION
    }
  })
  win.webContents.setFrameRate(60)
  win.webContents.setAudioMuted(true)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  // only our own vellum-render: documents may load (no meta refresh, links, form posts or redirects away)
  const onlyRender = (e: { preventDefault(): void }, url: string): void => {
    if (!url.startsWith(`${SCHEME}://`)) e.preventDefault()
  }
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.on('will-redirect', (e) => onlyRender(e, e.url))
  win.webContents.on('will-frame-navigate', (e) => onlyRender(e, e.url))
  win.webContents.on('will-attach-webview', (e) => e.preventDefault())
  win.on('closed', () => {
    win = null
  })
  return win
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const WAIT_AND_MEASURE = `
(async () => {
  const deadline = new Promise((r) => setTimeout(r, 6000));
  const imgs = Array.from(document.images).map((img) =>
    img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; }));
  await Promise.race([Promise.all([document.fonts.ready, ...imgs]), deadline]);
  // fonts referenced by the content may only start loading after layout
  await Promise.race([document.fonts.ready, deadline]);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const wrap = document.getElementById('__canvas_wrap');
  const el = (wrap && wrap.firstElementChild) || wrap || document.body;
  const r = el.getBoundingClientRect();
  const w = wrap ? wrap.getBoundingClientRect() : r;
  return { x: r.left, y: r.top, width: Math.max(r.width, 1), height: Math.max(r.height, 1),
    wrapWidth: w.width, wrapHeight: w.height };
})()
`

/** Viewport used for measuring: wide enough that unsized content doesn't wrap. */
const MEASURE_VIEWPORT = 4000
/** Largest capture tile (device px). Bigger nodes are captured in tiles and stitched. */
const TILE = 2048

/** No scrollbars, ever: content larger than the viewport is reached by translating it (tiles). */
const NO_SCROLLBARS = 'html,body{overflow:hidden!important}::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}'

const nextFrames = `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`

async function renderOnce(args: RenderArgs): Promise<RenderResult> {
  ensureScheme()
  const w = getWindow()
  const docId = `r${++seq}`
  // apply the scale with CSS zoom on the root so layout stays in CSS px and text renders crisp
  let scale = args.scale && args.scale > 0 ? args.scale : 1

  docs.set(docId, args.html)
  try {
    w.setContentSize(MEASURE_VIEWPORT, MEASURE_VIEWPORT)
    await w.loadURL(`${SCHEME}://${docId}/`)
    docs.delete(docId)
    await w.webContents.insertCSS(NO_SCROLLBARS)
    const m = (await w.webContents.executeJavaScript(WAIT_AND_MEASURE, true)) as {
      x: number
      y: number
      width: number
      height: number
      wrapWidth: number
      wrapHeight: number
    }
    const cssWidth = m.width
    const cssHeight = m.height
    if (args.measureOnly) return { base64: '', width: 0, height: 0, cssWidth, cssHeight }

    const maxDim = Math.min(args.maxDimension ?? MAX_TEXTURE, MAX_TEXTURE)
    const longest = Math.max(cssWidth, cssHeight) * scale
    if (longest > maxDim) scale = maxDim / Math.max(cssWidth, cssHeight)

    // Freeze the layout at the measured size so shrinking the viewport to a tile can't reflow
    // unsized content, then apply the scale and the background.
    await w.webContents.executeJavaScript(
      `(() => {
        const wrap = document.getElementById('__canvas_wrap');
        if (wrap) { wrap.style.width = ${m.wrapWidth} + 'px'; wrap.style.height = ${m.wrapHeight} + 'px'; if (getComputedStyle(wrap).display === 'inline-flex') wrap.style.display = 'flex'; }
        document.body.style.width = document.body.style.minWidth = ${Math.ceil(m.x + m.wrapWidth)} + 'px';
        document.documentElement.style.zoom = ${JSON.stringify(String(scale))};
        ${args.background ? `document.body.style.background = ${JSON.stringify(args.background)};` : ''}
      })()`,
      true
    )

    // output size in device px
    const W = Math.max(1, Math.round(cssWidth * scale))
    const H = Math.max(1, Math.round(cssHeight * scale))
    const tileW = Math.min(W, TILE)
    const tileH = Math.min(H, TILE)
    w.setContentSize(tileW, tileH)
    await sleep(30)
    const [cw, ch] = w.getContentSize()
    const vw = Math.max(1, Math.min(tileW, cw))
    const vh = Math.max(1, Math.min(tileH, ch))

    // capture each tile: translate the content so the tile's top-left sits at the viewport origin
    const tiles: { x: number; y: number; img: NativeImage }[] = []
    for (let ty = 0; ty < H; ty += vh) {
      for (let tx = 0; tx < W; tx += vw) {
        // translate is in (unzoomed) CSS px; the root zoom scales it to device px
        const dx = m.x + tx / scale
        const dy = m.y + ty / scale
        await w.webContents.executeJavaScript(
          `(async () => { document.body.style.transform = 'translate(${-dx}px, ${-dy}px)'; await ${nextFrames}; })()`,
          true
        )
        w.webContents.invalidate()
        await sleep(40)
        const tw = Math.min(vw, W - tx)
        const th = Math.min(vh, H - ty)
        let img = await w.webContents.capturePage({ x: 0, y: 0, width: tw, height: th })
        // guarantee the exact tile size (offscreen DPR may differ from 1)
        const size = img.getSize()
        if (size.width !== tw || size.height !== th) img = img.resize({ width: tw, height: th, quality: 'best' })
        tiles.push({ x: tx, y: ty, img })
      }
    }

    let img: NativeImage
    if (tiles.length === 1) img = tiles[0].img
    else {
      // stitch the BGRA bitmaps
      const out = Buffer.alloc(W * H * 4)
      for (const t of tiles) {
        const { width: tw, height: th } = t.img.getSize()
        const bmp = t.img.toBitmap()
        if (bmp.length < tw * th * 4) continue
        for (let row = 0; row < th; row++) {
          bmp.copy(out, ((t.y + row) * W + t.x) * 4, row * tw * 4, (row + 1) * tw * 4)
        }
      }
      img = nativeImage.createFromBitmap(out, { width: W, height: H })
    }
    if (img.isEmpty()) img = nativeImage.createEmpty()
    const buf = args.format === 'jpeg' ? img.toJPEG(args.quality ?? 92) : img.toPNG()
    return { base64: buf.toString('base64'), width: W, height: H, cssWidth, cssHeight }
  } finally {
    docs.delete(docId)
  }
}

const num = (v: unknown, min: number, max: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined

/** Validate untrusted render arguments (from IPC or the WebSocket bridge). */
function cleanArgs(raw: unknown): RenderArgs {
  const a = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  if (typeof a.html !== 'string' || !a.html) throw new Error('render: missing html')
  if (a.html.length > MAX_HTML) throw new Error('render: html is too large')
  const bg = typeof a.background === 'string' && a.background.length <= 200 ? a.background : undefined
  return {
    html: a.html,
    scale: num(a.scale, 0.01, 16),
    format: a.format === 'jpeg' ? 'jpeg' : 'png',
    quality: num(a.quality, 1, 100),
    maxDimension: num(a.maxDimension, 1, MAX_TEXTURE),
    measureOnly: a.measureOnly === true,
    background: bg
  }
}

/** Serialised: one render at a time through the shared hidden window. */
export function renderHtml(raw: unknown): Promise<RenderResult> {
  let args: RenderArgs
  try {
    args = cleanArgs(raw)
  } catch (err) {
    return Promise.reject(err)
  }
  const run = queue.then(
    () => renderOnce(args),
    () => renderOnce(args)
  )
  queue = run.catch(() => undefined)
  return run
}

export function disposeRenderer(): void {
  if (win && !win.isDestroyed()) win.destroy()
  win = null
  docs.clear()
}

/** Tools handled in the main process (prefix `main:`), called through the WebSocket bridge. */
export async function handleMainTool(tool: string, args: Record<string, unknown>): Promise<unknown> {
  switch (tool) {
    case 'main:render_png':
      return renderHtml(args)
    case 'main:ping':
      return { pong: true }
    default:
      throw new Error(`Unknown main tool: ${tool}`)
  }
}
