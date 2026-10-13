// End to end through the real app (T73 / H12): paste a Checkout design (desktop and mobile frames, a hidden promo layer, an
// unready frame), tag the two frames as one screen, mark them ready, export a folder, and check the file tree, that
// nothing hidden or unready leaks, and that the screen markdown carries the breakpoint delta.
// Usage: node scripts/e2e-handoff.mjs <out-dir>   (npm run build first). HANDOFF_KEEP=<dir> keeps the exported bundle there.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { CANARY, DESKTOP_HTML, MOBILE_HTML, UNREADY_HTML, exportFolder, hidePromo, launchApp, layerRows, markReady, pasteHtml, tagScreen } from './handoff-fixture.mjs'

const out = process.argv[2] ?? '.muster-evidence/e2e'
mkdirSync(out, { recursive: true })
const exportRoot = mkdtempSync(join(tmpdir(), 'vellum-handoff-out-'))
const target = join(exportRoot, 'checkout-handoff')
const results = []
const check = (ok, label) => results.push(`${ok ? 'passed' : 'FAILED'}: ${label}`)
let n = 0
let page
const shot = async (name) => {
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(out, `${String(++n).padStart(2, '0')}-${name}.png`) })
}
const files = (dir) => {
  const acc = []
  const walk = (d) => {
    for (const f of readdirSync(d).sort()) {
      const p = join(d, f)
      if (statSync(p).isDirectory()) walk(p)
      else acc.push(relative(dir, p).replace(/\\/g, '/'))
    }
  }
  if (existsSync(dir)) walk(dir)
  return acc
}
let app
let ud
/** pixels of the promo's amber background (#FEF3C7) in a PNG (Electron bitmaps are BGRA) */
const countAmber = (b64) =>
  app.evaluate(({ nativeImage }, data) => {
    const bm = nativeImage.createFromBuffer(Buffer.from(data, 'base64')).toBitmap()
    let n = 0
    for (let i = 0; i + 3 < bm.length; i += 4) if (bm[i] === 0xc7 && bm[i + 1] === 0xf3 && bm[i + 2] === 0xfe) n++
    return n
  }, b64)
try {
  ;({ app, page, ud } = await launchApp(out))

  // a design: two frames of one screen, plus an unrelated one
  await pasteHtml(app, page, DESKTOP_HTML)
  await pasteHtml(app, page, MOBILE_HTML)
  await pasteHtml(app, page, UNREADY_HTML)
  let rows = (await layerRows(page)).filter((r) => r.pad < 16)
  results.push(`top-level rows: ${rows.map((r) => r.text.slice(0, 18)).join(' | ')}`)
  check(rows.length === 3, `three top-level frames pasted (${rows.length})`)
  await shot('three-frames-pasted')

  // control for the picture check below: the detector does see the promo while it is visible
  const visible = await countAmber((await page.screenshot()).toString('base64'))
  check(visible > 100, `control: the promo's amber background is visible on the canvas before it is hidden (${visible} px)`)

  // hide the promo layer (it must not reach the bundle, the PNGs or the markdown)
  check(await hidePromo(page), 'the promo layer was found in the Layers panel and hidden')

  // tag the first two frames as screen "Checkout": the wide one Desktop, the narrow one Mobile
  rows = (await layerRows(page)).filter((r) => r.pad < 16)
  const widths = await page.evaluate(() => [...document.querySelectorAll('[data-node-id]')].map((e) => ({ id: e.getAttribute('data-node-id'), w: Math.round(e.getBoundingClientRect().width) })))
  results.push(`some widths: ${JSON.stringify(widths.filter((x) => x.w > 300).slice(0, 6))}`)
  for (let i = 0; i < 2; i++) {
    await page.mouse.click(110, rows[i].y + 10)
    await page.waitForTimeout(400)
    await tagScreen(page, 'Checkout', null)
  }
  await shot('tagged')
  const insp = await page.evaluate(() => document.querySelector('.insp-scroll')?.innerText.slice(0, 400) ?? '')
  results.push(`inspector: ${insp.replace(/\n+/g, ' | ').slice(0, 200)}`)

  // mark both ready (not the third)
  for (let i = 0; i < 2; i++) await markReady(page, rows[i].y)
  const dots = await page.evaluate(() => [...document.querySelectorAll('.lp-layer__ready')].map((e) => e.getAttribute('data-ready')))
  check(dots.length === 2 && dots.every((d) => d === 'ready'), `two frames are ready, the third is not (${JSON.stringify(dots)})`)
  await shot('two-ready')

  // export
  const done = await exportFolder(app, page, target)
  await shot('export-done')
  check(/Handoff v1 exported/.test(done), 'the dialog reports the export')
  const tree = files(target)
  results.push(`tree: ${tree.join(', ')}`)
  const has = (p) => tree.includes(p)
  for (const p of ['HANDOFF.md', 'CLAUDE.md', 'spec.json', 'spec.schema.json', '.handoff.json', 'fonts.md']) check(has(p), `file: ${p}`)
  for (const p of ['tokens/tokens.css', 'tokens/tokens.json', 'tokens/tailwind.css']) check(has(p), `file: ${p}`)
  const pngs = tree.filter((p) => /^screens\/.+\.png$/.test(p))
  check(pngs.length >= 2, `a PNG reference per breakpoint (${pngs.join(', ')})`)
  const spec = JSON.parse(readFileSync(join(target, 'spec.json'), 'utf8'))
  check(spec.screens.length === 1, `one screen in spec.json (${spec.screens.map((s) => s.name).join(', ')})`)
  check(spec.screens[0]?.breakpoints.length === 2, `two breakpoints (${spec.screens[0]?.breakpoints.map((b) => b.bp).join(', ')})`)
  check(spec.screens[0]?.breakpoints.some((b) => b.delta), 'the narrow breakpoint carries a delta against the wide one')
  check(readFileSync(join(target, 'HANDOFF.md'), 'utf8') === readFileSync(join(target, 'CLAUDE.md'), 'utf8'), 'CLAUDE.md is identical to HANDOFF.md')
  for (const p of pngs) {
    const head = readFileSync(join(target, p)).subarray(0, 8)
    check(head[0] === 0x89 && head.toString('latin1', 1, 4) === 'PNG', `${p} is a real PNG`)
  }

  // the hidden promo's amber background (#FEF3C7) is not in any reference picture either (BGRA bitmap)
  for (const p of pngs) {
    const hits = await countAmber(readFileSync(join(target, p)).toString('base64'))
    check(hits === 0, `${p}: the hidden promo is not drawn (${hits} amber pixels)`)
  }

  // nothing hidden, unready or foreign anywhere in the text files
  const textFiles = tree.filter((p) => !p.endsWith('.png'))
  const all = textFiles.map((p) => readFileSync(join(target, p), 'utf8')).join('\n')
  for (const [k, v] of Object.entries(CANARY)) check(!all.includes(v), `no "${k}" canary anywhere in the bundle`)
  check(!/[A-Za-z]:\\|\/Users\//.test(all), 'no absolute path or user folder in any text file')
  check(!/Tester/.test(all), 'the profile name is not in the bundle')
  check(readdirSync(exportRoot).length === 1, 'no temporary folder left next to the bundle')
  const md = existsSync(join(target, 'screens/checkout.md')) ? readFileSync(join(target, 'screens/checkout.md'), 'utf8') : ''
  check(/Compared with/.test(md), 'screens/checkout.md has the breakpoint comparison')
  // numbers a developer will copy: found wrong by the dogfood run, so pinned here
  const handoffMd = readFileSync(join(target, 'HANDOFF.md'), 'utf8')
  check(!/Pay \$105\.00.*contrast/i.test(handoffMd), 'a white label on its own blue background is not reported as low contrast')
  const lines = []
  const walk = (n) => {
    if (n.text && n.name === 'Pay $105.00') lines.push(n.text.lineHeightPx)
    n.children.forEach(walk)
  }
  for (const b of spec.screens[0].breakpoints) walk(b.root)
  check(lines.length === 2 && lines.every((l) => l === 21 || l === 19 || l === 20 || l === 22), `the button label line height excludes its padding (${lines.join(', ')})`)
  check(/Pay \$105\.00/.test(md) && /Wireless keyboard/.test(md), 'the screen markdown carries the real text of the design')

  if (process.env.HANDOFF_KEEP) {
    rmSync(process.env.HANDOFF_KEEP, { recursive: true, force: true })
    cpSync(target, process.env.HANDOFF_KEEP, { recursive: true })
    results.push(`kept: ${process.env.HANDOFF_KEEP}`)
  }
} catch (e) {
  results.push(`FAILED: exception ${e && e.message}`)
  await shot('failure').catch(() => {})
} finally {
  console.log(results.join('\n'))
  await Promise.race([app?.close().catch(() => {}), new Promise((r) => setTimeout(r, 8000))])
  try {
    app?.process().kill()
  } catch {}
  try {
    rmSync(ud, { recursive: true, force: true })
    rmSync(exportRoot, { recursive: true, force: true })
  } catch {}
  process.exit(results.some((r) => r.startsWith('FAILED')) ? 1 : 0)
}
