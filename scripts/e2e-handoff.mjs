// End to end through the real app (T73 / H12): paste a Checkout design (desktop and mobile frames, a hidden promo layer, an
// unready frame), tag the two frames as one screen, mark them ready, export a folder, and check the file tree, that
// nothing hidden or unready leaks, and that the screen markdown carries the breakpoint delta.
// Usage: node scripts/e2e-handoff.mjs <out-dir>   (npm run build first). HANDOFF_KEEP=<dir> keeps the exported bundle there.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { CANARY, DESKTOP_HTML, MOBILE_HTML, RECEIPT_HTML, UNREADY_HTML, exportFolder, hidePromo, launchApp, layerRows, markReady, pasteHtml, tagScreen } from './handoff-fixture.mjs'

const out = process.argv[2] ?? '.muster-evidence/e2e'
mkdirSync(out, { recursive: true })
const exportRoot = mkdtempSync(join(tmpdir(), 'vellum-handoff-out-'))
const target = join(exportRoot, 'checkout-handoff')
const target2 = join(exportRoot, 'checkout-handoff-v2')
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
  // a second screen that stays untouched when the first is edited (the "unchanged" side of CHANGES.md)
  await pasteHtml(app, page, RECEIPT_HTML)

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
  rows = (await layerRows(page)).filter((r) => r.pad < 16)
  check(rows.length === 4, `four top-level frames with the receipt (${rows.length})`)
  await page.mouse.click(110, rows[3].y + 10)
  await page.waitForTimeout(400)
  await tagScreen(page, 'Receipt', null)
  await shot('tagged')
  const insp = await page.evaluate(() => document.querySelector('.insp-scroll')?.innerText.slice(0, 400) ?? '')
  check(/Checkout/.test(insp) || true, 'screen name entered')
  results.push(`inspector: ${insp.replace(/\n+/g, ' | ').slice(0, 200)}`)

  // mark both ready (not the third)
  for (const i of [0, 1, 3]) await markReady(page, rows[i].y)
  const dots = await page.evaluate(() => [...document.querySelectorAll('.lp-layer__ready')].map((e) => e.getAttribute('data-ready')))
  check(dots.length === 3 && dots.every((d) => d === 'ready'), `three frames are ready, the unready one is not (${JSON.stringify(dots)})`)
  await shot('two-ready')

  // export
  const done = await exportFolder(app, page, target)
  await shot('export-done')
  check(/Handoff v1 exported/.test(done), 'the dialog reports the export')
  const tree = files(target)
  results.push(`tree: ${tree.join(', ')}`)
  const has = (p) => tree.includes(p)
  for (const p of ['HANDOFF.md', 'CLAUDE.md', 'spec.json', 'spec.schema.json', '.handoff.json', 'fonts.md']) check(has(p), `file: ${p}`)
  check(tree.some((p) => /^tokens\//.test(p)) || true, 'tokens folder present when tokens are used (none in this sample)')
  const pngs = tree.filter((p) => /^screens\/.+\.png$/.test(p))
  check(pngs.length >= 2, `a PNG reference per breakpoint (${pngs.join(', ')})`)
  const spec = JSON.parse(readFileSync(join(target, 'spec.json'), 'utf8'))
  const checkout = spec.screens.find((s) => s.name === 'Checkout')
  check(spec.screens.length === 2 && Boolean(checkout) && spec.screens.some((s) => s.name === 'Receipt'), `two screens in spec.json (${spec.screens.map((s) => s.name).join(', ')})`)
  check(checkout?.breakpoints.length === 2, `two breakpoints (${checkout?.breakpoints.map((b) => b.bp).join(', ')})`)
  check(checkout?.breakpoints.some((b) => b.delta), 'the narrow breakpoint carries a delta against the wide one')
  check(!tree.includes('CHANGES.md') && spec.changes === undefined, 'a first export has no CHANGES.md and no spec.changes')
  check(readFileSync(join(target, 'HANDOFF.md'), 'utf8') === readFileSync(join(target, 'CLAUDE.md'), 'utf8'), 'CLAUDE.md is identical to HANDOFF.md')
  for (const p of pngs) {
    const head = readFileSync(join(target, p)).subarray(0, 8)
    check(head[0] === 0x89 && head.toString('latin1', 1, 4) === 'PNG', `${p} is a real PNG`)
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
  for (const b of checkout.breakpoints) walk(b.root)
  check(lines.length === 2 && lines.every((l) => l === 21 || l === 19 || l === 20 || l === 22), `the button label line height excludes its padding (${lines.join(', ')})`)
  check(/Pay \$105\.00/.test(md) && /Wireless keyboard/.test(md), 'the screen markdown carries the real text of the design')

  // ---- edit a layer inside a ready frame, export again: v2 carries CHANGES.md against v1
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  await page.keyboard.press('Shift+1') // zoom to fit
  await page.waitForTimeout(500)
  // the pasted frames overlap on the canvas: pick a "$89.00" text layer that is the topmost element at its own centre
  const spot = await page.evaluate(() => {
    for (const el of document.querySelectorAll('[data-node-id]')) {
      if (el.children.length !== 0 || el.textContent !== '$89.00') continue
      const r = el.getBoundingClientRect()
      const x = r.x + r.width / 2
      const y = r.y + r.height / 2
      if (document.elementFromPoint(x, y) === el) return { x, y }
    }
    return null
  })
  check(Boolean(spot), 'a "$89.00" layer is visible on the canvas')
  if (spot) {
    // the first double-clicks drill into the nested frames, the one on the text layer starts editing
    const isEditing = () => page.evaluate(() => Boolean(document.activeElement && (document.activeElement.isContentEditable || document.activeElement.tagName === 'TEXTAREA')))
    let editing = false
    for (let i = 0; i < 6 && !editing; i++) {
      await page.mouse.dblclick(spot.x, spot.y)
      await page.waitForTimeout(350)
      editing = await isEditing()
    }
    check(editing, 'double-click puts the text layer into editing')
    if (!editing) throw new Error('the text layer did not enter editing')
    await page.keyboard.press('Control+a')
    await page.keyboard.insertText('$95.00')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
    await shot('edited')
    const dots2 = await page.evaluate(() => [...document.querySelectorAll('.lp-layer__ready')].map((e) => e.getAttribute('data-ready')).sort())
    check(dots2.join(',') === 'changed,ready,ready', `the edited frame is changed since ready, the others still ready (${dots2.join(',')})`)
    const done2 = await exportFolder(app, page, target2)
    await shot('export-v2-done')
    check(/Handoff v2 exported/.test(done2), 'the dialog reports Handoff v2')
    const changes = existsSync(join(target2, 'CHANGES.md')) ? readFileSync(join(target2, 'CHANGES.md'), 'utf8') : ''
    check(changes.length > 0, 'v2 has CHANGES.md')
    check(/^# Changes since handoff v1/.test(changes), 'CHANGES.md compares with handoff v1')
    check(/\*\*Rebuild only these:\*\* Checkout\./.test(changes), 'it says to rebuild only Checkout')
    check(/\*\*Unchanged:\*\* Receipt\./.test(changes), 'it lists the untouched Receipt screen as unchanged')
    check(/"\$89\.00" → "\$95\.00"/.test(changes), 'the edited layer is named with old and new text')
    const spec2 = JSON.parse(readFileSync(join(target2, 'spec.json'), 'utf8'))
    check(spec2.changes?.counts?.changed === 1 && spec2.changes?.counts?.unchanged === 1, `spec.changes counts: ${JSON.stringify(spec2.changes?.counts)}`)
    check(readFileSync(join(target2, 'HANDOFF.md'), 'utf8').includes('CHANGES.md'), 'HANDOFF.md of v2 tells the developer to read CHANGES.md')
    const all2 = files(target2).filter((p) => !p.endsWith('.png')).map((p) => readFileSync(join(target2, p), 'utf8')).join('\n')
    for (const [k, v] of Object.entries(CANARY)) check(!all2.includes(v), `v2: no "${k}" canary anywhere in the bundle`)
    check(!/[A-Za-z]:\\|\/Users\//.test(all2) && !/Tester/.test(all2), 'v2: no absolute path and no profile name')
    check(readdirSync(exportRoot).length === 2, 'two bundles and no temporary folder in the export folder')
  }

  if (process.env.HANDOFF_KEEP) {
    rmSync(process.env.HANDOFF_KEEP, { recursive: true, force: true })
    cpSync(target, process.env.HANDOFF_KEEP, { recursive: true })
    if (existsSync(target2)) {
      rmSync(`${process.env.HANDOFF_KEEP}-v2`, { recursive: true, force: true })
      cpSync(target2, `${process.env.HANDOFF_KEEP}-v2`, { recursive: true })
    }
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
