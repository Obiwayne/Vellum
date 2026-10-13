// Dogfood (T73 / H12): export the sample Checkout screen from the running app, hand the bundle to Claude Code in a
// throwaway folder OUTSIDE the repo with nothing else to look at, let it build the screen as plain HTML/CSS, render that
// page at each breakpoint's design width and compare it with the bundle's PNG references.
// Usage: node scripts/dogfood-handoff.mjs <out-dir>   (npm run build first; needs the `claude` CLI on PATH)
// Output in <out-dir>: prompt.txt, claude-output.txt, index.html (what Claude wrote), <bp>-reference.png, <bp>-render.png,
// <bp>-diff.png, report.json, report.md. Runs on a temporary VELLUM_USER_DATA; the throwaway folder is under the temp dir.
import { _electron as electron } from 'playwright'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DESKTOP_HTML, MOBILE_HTML, UNREADY_HTML, exportFolder, hidePromo, launchApp, layerRows, markReady, pasteHtml, tagScreen } from './handoff-fixture.mjs'

const out = resolve(process.argv[2] ?? '.muster-evidence/dogfood')
mkdirSync(out, { recursive: true })
const work = mkdtempSync(join(tmpdir(), 'vellum-dogfood-'))
const bundle = join(work, 'handoff')
const log = (m) => console.log(m)

// ---- 1. export the sample from the app
let app, page, ud
const exportRoot = mkdtempSync(join(tmpdir(), 'vellum-dogfood-export-'))
try {
  ;({ app, page, ud } = await launchApp(out))
  await pasteHtml(app, page, DESKTOP_HTML)
  await pasteHtml(app, page, MOBILE_HTML)
  await pasteHtml(app, page, UNREADY_HTML)
  log('promo hidden: ' + (await hidePromo(page)))
  const rows = (await layerRows(page)).filter((r) => r.pad < 16)
  for (let i = 0; i < 2; i++) {
    await page.mouse.click(110, rows[i].y + 10)
    await page.waitForTimeout(400)
    await tagScreen(page, 'Checkout', null)
  }
  for (let i = 0; i < 2; i++) await markReady(page, rows[i].y)
  const done = await exportFolder(app, page, join(exportRoot, 'checkout-handoff'))
  log('export: ' + done.split('\n').filter((l) => /exported|screens,/.test(l)).join(' | '))
  cpSync(join(exportRoot, 'checkout-handoff'), bundle, { recursive: true })
} finally {
  await Promise.race([app?.close().catch(() => {}), new Promise((r) => setTimeout(r, 8000))])
  try {
    app?.process().kill()
  } catch {}
  try {
    rmSync(ud, { recursive: true, force: true })
  } catch {}
}
if (!existsSync(join(bundle, 'HANDOFF.md'))) throw new Error('the export did not produce a bundle')
const spec = JSON.parse(readFileSync(join(bundle, 'spec.json'), 'utf8'))
const bps = spec.screens[0].breakpoints.map((b) => ({ bp: b.bp, width: Math.round(b.width), height: Math.round(b.height), png: b.png }))
log('breakpoints: ' + JSON.stringify(bps))

// ---- 2. Claude Code builds it in the throwaway folder
const widths = bps.map((b) => `${b.bp} at ${b.width}px wide (reference: ${b.png})`).join(', ')
const prompt = `You are the developer in this folder. The folder "handoff" is a design handoff bundle exported from a design tool. Read handoff/HANDOFF.md first and follow it.
Task: build the screen "Checkout" described in handoff/screens/checkout.md as ONE plain HTML file with inline CSS at ./index.html. No framework, no JavaScript, no external fonts, images or network. It must look like the reference PNGs in handoff/screens/ at these widths: ${widths}. Use the layout rules in the markdown (flex, gap, padding, sizing) and a media query for the narrow layout; use the exact colours, sizes and text from the bundle. When you are done, say in one line what you built. Only use the files in this folder.`
writeFileSync(join(out, 'prompt.txt'), prompt)
log('running claude -p in ' + work)
const run = spawnSync('claude', ['-p', '--allowedTools', 'Read,Write,Edit,Glob,Grep', '--max-turns', '25', '--output-format', 'text', '--strict-mcp-config'], {
  cwd: work,
  input: prompt, // on stdin: a multi-line prompt does not survive the Windows shell as an argument
  encoding: 'utf8',
  shell: process.platform === 'win32',
  timeout: 9 * 60_000,
  env: { ...process.env, MUSTER_AGENT: '', MUSTER_TOKEN: '', MUSTER_URL: '' }
})
writeFileSync(join(out, 'claude-output.txt'), `exit=${run.status}\n--- stdout ---\n${run.stdout}\n--- stderr ---\n${run.stderr}`)
log('claude exit ' + run.status + ': ' + (run.stdout || '').trim().slice(0, 300))
const html = join(work, 'index.html')
if (!existsSync(html)) {
  log('FAILED: Claude did not write index.html')
  process.exit(1)
}
cpSync(html, join(out, 'index.html'))

// ---- 3. render + compare in a hidden Electron window (no network, no profile)
const mainFile = join(work, 'render-main.cjs')
writeFileSync(
  mainFile,
  `const { app, BrowserWindow, nativeImage } = require('electron')
const fs = require('fs')
// never the default user-data folder: this process only renders and compares
app.setPath('userData', ${JSON.stringify(join(work, 'render-user-data'))})
app.disableHardwareAcceleration()
app.on('window-all-closed', () => {}) // keep the process alive between renders
app.whenReady().then(() => {
  globalThis.render = async (file, width, height) => {
    const win = new BrowserWindow({ show: false, width, height, useContentSize: true, webPreferences: { offscreen: false } })
    await win.loadFile(file)
    await new Promise((r) => setTimeout(r, 400))
    const img = await win.webContents.capturePage({ x: 0, y: 0, width, height })
    const png = img.toPNG()
    win.destroy()
    return png.toString('base64')
  }
  globalThis.compare = (refB64, renB64, a) => {
    const ref = nativeImage.createFromBuffer(Buffer.from(refB64, 'base64'))
    const ren = nativeImage.createFromBuffer(Buffer.from(renB64, 'base64'))
    const rs = ref.getSize(), ns = ren.getSize()
    const w = Math.min(rs.width, ns.width), h = Math.min(rs.height, ns.height)
    const rb = ref.toBitmap(), nb = ren.toBitmap()
    const diff = Buffer.alloc(w * h * 4)
    let over = 0, sum = 0
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * rs.width + x) * 4, j = (y * ns.width + x) * 4, k = (y * w + x) * 4
      const d = Math.max(Math.abs(rb[i] - nb[j]), Math.abs(rb[i + 1] - nb[j + 1]), Math.abs(rb[i + 2] - nb[j + 2]))
      sum += d
      if (d > a.threshold) over++
      diff[k] = d > a.threshold ? 255 : nb[j]; diff[k + 1] = d > a.threshold ? 0 : nb[j + 1]; diff[k + 2] = d > a.threshold ? 80 : nb[j + 2]; diff[k + 3] = 255
    }
    const dpng = nativeImage.createFromBitmap(diff, { width: w, height: h }).toPNG()
    return { refSize: rs, renderSize: ns, compared: { w, h }, pixelsOver: over, fractionOver: over / (w * h), meanAbsDiff: sum / (w * h), diffPng: dpng.toString('base64') }
  }
})
`
)
const rapp = await electron.launch({ args: [mainFile] })
const report = { prompt: 'prompt.txt', tolerance: { perChannel: 24, note: 'a pixel differs when any channel differs by more than 24/255 (anti-aliasing and font hinting stay below that)' }, breakpoints: [] }
try {
  await rapp.evaluate(() => new Promise((r) => setTimeout(r, 800)))
  for (const b of bps) {
    const ref = readFileSync(join(bundle, b.png))
    writeFileSync(join(out, `${b.bp.toLowerCase()}-reference.png`), ref)
    // render the page in a window of the design width and height (the narrow layout follows the media query)
    const renB64 = await rapp.evaluate(async (_e, a) => globalThis.render(a.file, a.width, a.height), { file: html, width: b.width, height: b.height })
    writeFileSync(join(out, `${b.bp.toLowerCase()}-render.png`), Buffer.from(renB64, 'base64'))
    const cmp = await rapp.evaluate((_e, a) => globalThis.compare(a.ref, a.ren, { threshold: 24 }), { ref: ref.toString('base64'), ren: renB64 })
    writeFileSync(join(out, `${b.bp.toLowerCase()}-diff.png`), Buffer.from(cmp.diffPng, 'base64'))
    delete cmp.diffPng
    report.breakpoints.push({ ...b, ...cmp })
    log(`${b.bp}: ref ${cmp.refSize.width}x${cmp.refSize.height}, render ${cmp.renderSize.width}x${cmp.renderSize.height}, ${(cmp.fractionOver * 100).toFixed(2)}% of pixels differ, mean abs diff ${cmp.meanAbsDiff.toFixed(2)}/255`)
  }
} finally {
  await rapp.close().catch(() => {})
}
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2))
const md = ['# Dogfood result', '', `Tolerance: ${report.tolerance.note}.`, '', '| Breakpoint | Reference | Render | Pixels over tolerance | Mean abs diff |', '|---|---|---|---|---|']
for (const b of report.breakpoints) md.push(`| ${b.bp} | ${b.refSize.width}x${b.refSize.height} | ${b.renderSize.width}x${b.renderSize.height} | ${(b.fractionOver * 100).toFixed(2)}% | ${b.meanAbsDiff.toFixed(2)} |`)
writeFileSync(join(out, 'report.md'), md.join('\n') + '\n')
try {
  rmSync(work, { recursive: true, force: true })
  rmSync(exportRoot, { recursive: true, force: true })
} catch {}
process.exit(0)
