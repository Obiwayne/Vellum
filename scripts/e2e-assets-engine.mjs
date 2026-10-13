// T64: runs the assets pipeline's real engine inside the built app: canvasEngine().resize (OffscreenCanvas) and a PNG
// render through window.canvasApi.renderHtml (the main process's offscreen renderer) at 1x and 2x.
// Usage: node scripts/e2e-assets-engine.mjs <out-dir>   (needs `npm run build` first). Temporary VELLUM_USER_DATA.
import { _electron as electron } from 'playwright'
import { build } from 'esbuild'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = process.argv[2] ?? '.muster-evidence/e2e'
mkdirSync(out, { recursive: true })
const bundle = await build({
  entryPoints: ['src/renderer/src/handoff/assets/run.ts'],
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'AssetsRun',
  platform: 'browser',
  logLevel: 'silent'
})
const code = bundle.outputFiles[0].text
const ud = mkdtempSync(join(tmpdir(), 'vellum-e2e-'))
const app = await electron.launch({ args: ['out/main/index.js'], env: { ...process.env, VELLUM_USER_DATA: ud } })
const page = await app.firstWindow()
const results = []
const check = (ok, label) => results.push(`${ok ? 'passed' : 'FAILED'}: ${label}`)
try {
  await page.waitForTimeout(2500)
  await page.evaluate(code)
  const r = await page.evaluate(async () => {
    const png = async (w, h, color) => {
      const c = new OffscreenCanvas(w, h)
      const x = c.getContext('2d')
      x.fillStyle = color
      x.fillRect(0, 0, w, h)
      x.fillStyle = '#000'
      x.fillRect(0, 0, w / 2, h / 2)
      return new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())
    }
    const size = async (bytes, mime) => {
      const bmp = await createImageBitmap(new Blob([bytes], { type: mime }))
      const s = [bmp.width, bmp.height]
      bmp.close()
      return s
    }
    const renderPng = async (_doc, _id, scale) => {
      const res = await window.canvasApi.renderHtml({
        html: '<!doctype html><html><body style="margin:0"><div id="__canvas_wrap" style="width:300px;height:200px;background:#2563eb"></div></body></html>',
        scale,
        format: 'png'
      })
      const bin = atob(res.base64)
      return Uint8Array.from(bin, (ch) => ch.charCodeAt(0))
    }
    const engine = AssetsRun.canvasEngine({}, renderPng)
    const src = await png(400, 400, '#ff0000')
    const resized = await engine.resize({ path: 'a@2x.png', from: src, mime: 'image/png', width: 200, height: 200, quality: 0.9 })
    const pngBytes = await engine.renderPng('x', 1)
    const png2 = await engine.renderPng('x', 2)
    const c = new OffscreenCanvas(300, 300)
    c.getContext('2d').fillRect(0, 0, 300, 300)
    const jpg = new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 })).arrayBuffer())
    const jr = await engine.resize({ path: 'b@2x.jpg', from: jpg, mime: 'image/jpeg', width: 100, height: 100, quality: 0.9 })
    return {
      resizedSize: await size(resized, 'image/png'),
      resizedMagic: Array.from(resized.slice(0, 4)),
      png1: await size(pngBytes, 'image/png'),
      png2: await size(png2, 'image/png'),
      jpegMagic: Array.from(jr.slice(0, 3)),
      jpegSize: await size(jr, 'image/jpeg')
    }
  })
  results.push(JSON.stringify(r))
  check(r.resizedSize[0] === 200 && r.resizedSize[1] === 200, `resize: 400x400 PNG becomes 200x200 (${r.resizedSize})`)
  check(r.resizedMagic.join() === '137,80,78,71', 'resize keeps PNG')
  check(r.png1[0] === 300 && r.png1[1] === 200, `render 1x: 300x200 (${r.png1})`)
  check(r.png2[0] === 600 && r.png2[1] === 400, `render 2x: 600x400 (${r.png2})`)
  check(r.jpegMagic.join() === '255,216,255' && r.jpegSize[0] === 100, `JPEG resample stays JPEG at 100x100 (${r.jpegSize})`)
  writeFileSync(join(out, 'engine-results.txt'), results.join('\n'))
} catch (e) {
  results.push(`FAILED: exception ${e && e.message}`)
} finally {
  console.log(results.join('\n'))
  await Promise.race([app.close().catch(() => {}), new Promise((r) => setTimeout(r, 8000))])
  try {
    app.process().kill()
  } catch {}
  try {
    rmSync(ud, { recursive: true, force: true })
  } catch {}
  process.exit(results.some((r) => r.startsWith('FAILED')) ? 1 : 0)
}
