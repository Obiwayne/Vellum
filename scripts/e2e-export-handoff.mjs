// Drives the built app (npm run build first) through Export handoff: an empty file (nothing ready), mark a frame ready
// from the Layers menu, see the dot, the inspector row and the dialog, export a folder (the native save dialog is
// replaced with a fixed path in the main process, so the run is unattended), check the files on disk, edit the frame
// and see "Changed since ready". Usage: node scripts/e2e-export-handoff.mjs <out-dir>.
// The app runs with a temporary VELLUM_USER_DATA, never the real profile folder; exports go to a temp folder.
import { _electron as electron } from 'playwright'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = process.argv[2] ?? '.muster-evidence/e2e'
mkdirSync(out, { recursive: true })
const ud = mkdtempSync(join(tmpdir(), 'vellum-e2e-'))
const exportRoot = mkdtempSync(join(tmpdir(), 'vellum-handoff-'))
const target = join(exportRoot, 'acme-handoff-v1')
const app = await electron.launch({ args: ['out/main/index.js'], env: { ...process.env, VELLUM_USER_DATA: ud } })
const page = await app.firstWindow()
const results = []
let n = 0
const shot = async (name) => {
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(out, `${String(++n).padStart(2, '0')}-${name}.png`) })
}
const check = (ok, label) => results.push(`${ok ? 'passed' : 'FAILED'}: ${label}`)
const text = () => page.evaluate(() => document.body.innerText)
// the top bar's own button (next to Share); the Share popover keeps an item too
const openDialog = async () => {
  await page.locator('.insp-top').getByRole('button', { name: 'Export handoff…' }).click()
  await page.waitForTimeout(500)
}
const dots = () => page.evaluate(() => [...document.querySelectorAll('.lp-layer__ready')].map((e) => e.getAttribute('data-ready')))

try {
  // the native save dialog answers with a fixed path
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, target)

  await page.waitForTimeout(2500)
  await page.locator('input:not([type=file])').first().fill('Tester')
  await page.getByRole('button', { name: 'Create profile' }).click()
  await page.waitForTimeout(2000)
  await page.getByText('Scratchpad').first().dblclick()
  await page.waitForTimeout(2500)

  // a frame with a text
  await page.keyboard.press('f')
  await page.mouse.move(330, 150)
  await page.mouse.down()
  await page.mouse.move(700, 380, { steps: 6 })
  await page.mouse.up()
  await page.keyboard.press('t')
  await page.mouse.click(380, 200)
  await page.keyboard.type('Pay now')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  // top bar: the button sits next to Share and both fit in the panel
  const bar = await page.evaluate(() => {
    const top = document.querySelector('.insp-top')
    const btn = top?.querySelector('button[aria-label="Export handoff…"]')?.getBoundingClientRect()
    const share = [...(top?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim() === 'Share')?.getBoundingClientRect()
    const panel = top?.getBoundingClientRect()
    return btn && share && panel ? { btnRight: btn.right, shareLeft: share.left, shareRight: share.right, panelRight: panel.right, panelLeft: panel.left, btnLeft: btn.left } : null
  })
  results.push(`top bar: ${JSON.stringify(bar)}`)
  check(Boolean(bar && bar.btnLeft >= bar.panelLeft && bar.shareRight <= bar.panelRight + 1 && bar.btnRight <= bar.shareLeft), 'top bar: Export handoff button next to Share, both inside the panel')
  await page.screenshot({ path: join(out, `${String(++n).padStart(2, '0')}-top-bar.png`), clip: { x: 1160, y: 40, width: 280, height: 60 } })
  // the Share popover keeps its item
  await page.getByRole('button', { name: 'Share' }).click()
  check(await page.getByRole('button', { name: 'Export handoff…' }).count() >= 2, 'Share popover still has Export handoff…')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)

  // empty state: nothing is ready
  await openDialog()
  await shot('dialog-empty-nothing-ready')
  check(/No screens are ready for dev/.test(await text()), 'dialog: nothing ready shows the empty state')
  await page.getByRole('button', { name: 'Close' }).last().click()

  // mark ready from the Layers context menu (the frame's row)
  await page.mouse.click(62, 207)
  await page.mouse.click(62, 207, { button: 'right' })
  await page.waitForTimeout(300)
  await shot('layers-menu-mark-ready')
  await page.getByText('Mark ready for dev', { exact: true }).click()
  await page.waitForTimeout(600)
  const d1 = await dots()
  check(d1.length === 1 && d1[0] === 'ready', `Layers: a ready dot on the frame (${JSON.stringify(d1)})`)
  await shot('layers-ready-dot-and-inspector-row')
  check(/Ready for dev/.test(await text()) && /Marked at v1/.test(await text()), 'inspector: Ready for dev row shows the mark')

  // the dialog with the ready frame ticked
  await openDialog()
  await page.waitForTimeout(1000)
  await shot('dialog-filled')
  const body = await text()
  check(/Export handoff · v1/.test(body) && /Ready/.test(body) && /Writes a decrypted copy/.test(body), 'dialog: title with the number, Ready badge, decrypted-copy line')
  check(/HANDOFF\.md/.test(body) && /screens\//.test(body), 'dialog: file tree preview')
  await page.getByRole('button', { name: 'Export folder…' }).click()
  await page.waitForFunction(() => /Handoff v\d+ exported|Could not export/.test(document.body.innerText), null, { timeout: 60000 })
  await shot('dialog-done')
  const done = await text()
  check(/Handoff v1 exported/.test(done), 'dialog: done state')
  check(existsSync(join(target, 'HANDOFF.md')) && existsSync(join(target, 'spec.json')), 'files on disk: HANDOFF.md and spec.json')
  const tree = existsSync(target) ? readdirSync(target).sort().join(', ') : '(missing)'
  results.push(`tree: ${tree}`)
  check(existsSync(join(target, 'screens')) && readdirSync(join(target, 'screens')).some((f) => f.endsWith('.png')), 'a PNG reference was rendered')
  check(readdirSync(exportRoot).length === 1, 'no temporary folder is left next to the bundle')
  if (existsSync(join(target, 'spec.json'))) check(JSON.parse(readFileSync(join(target, 'spec.json'), 'utf8')).handoff.version === 1, 'spec.json carries handoff version 1')
  await page.getByRole('button', { name: 'Open folder' }).waitFor()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  // the version was recorded: the next export is v2, and an edit shows as changed
  await page.mouse.click(520, 250)
  await page.waitForTimeout(200)
  await page.mouse.dblclick(400, 205)
  await page.keyboard.type(' later')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  const d2 = await dots()
  results.push(`dots after edit: ${JSON.stringify(d2)}`)
  await shot('layers-changed-since-ready')
  check(d2[0] === 'changed', 'Layers: the dot turns amber (changed since ready) after an edit')
  await openDialog()
  await page.waitForTimeout(1000)
  await shot('dialog-changed-badge-v2')
  const b2 = await text()
  check(/Export handoff · v2/.test(b2) && /Changed since ready/.test(b2), 'dialog: next number is v2 and the frame shows Changed since ready')
} catch (e) {
  results.push(`FAILED: script error: ${String(e.message).slice(0, 300)}`)
} finally {
  console.log(results.join('\n'))
  await Promise.race([app.close().catch(() => undefined), new Promise((r) => setTimeout(r, 5000))])
  process.exit(results.some((r) => r.startsWith('FAILED')) ? 1 : 0)
}
