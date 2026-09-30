// Offscreen HTML rasteriser for MCP screenshots/exports. The MCP server sends a complete HTML
// document (node markup + tokens + font links) through the bridge as `main:render_png`; we load it
// in a hidden offscreen BrowserWindow, wait for fonts/images, measure the node and capture it.
// Works regardless of whether the node is visible, zoomed or on another page in the editor.
import { BrowserWindow, nativeImage, type NativeImage } from 'electron'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { pathToFileURL } from 'url'

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
let tempDir: string | null = null
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
      partition: 'canvas-render'
    }
  })
  win.webContents.setFrameRate(60)
  win.webContents.setAudioMuted(true)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())
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
  const w = getWindow()
  if (!tempDir) tempDir = await mkdtemp(join(tmpdir(), 'canvas-render-'))
  const file = join(tempDir, `r${++seq}.html`)
  // apply the scale with CSS zoom on the root so layout stays in CSS px and text renders crisp
  let scale = args.scale && args.scale > 0 ? args.scale : 1

  await writeFile(file, args.html, 'utf8')
  try {
    w.setContentSize(MEASURE_VIEWPORT, MEASURE_VIEWPORT)
    await w.loadURL(pathToFileURL(file).href)
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
        if (wrap) { wrap.style.width = ${m.wrapWidth} + 'px'; wrap.style.height = ${m.wrapHeight} + 'px'; wrap.style.display = 'flex'; }
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
    void rm(file, { force: true })
  }
}

/** Serialised: one render at a time through the shared hidden window. */
export function renderHtml(args: RenderArgs): Promise<RenderResult> {
  if (typeof args?.html !== 'string' || !args.html) return Promise.reject(new Error('render: missing html'))
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
  if (tempDir) void rm(tempDir, { recursive: true, force: true })
  tempDir = null
}

/** Tools handled in the main process (prefix `main:`), called through the WebSocket bridge. */
export async function handleMainTool(tool: string, args: Record<string, unknown>): Promise<unknown> {
  switch (tool) {
    case 'main:render_png':
      return renderHtml(args as unknown as RenderArgs)
    case 'main:ping':
      return { pong: true }
    default:
      throw new Error(`Unknown main tool: ${tool}`)
  }
}
