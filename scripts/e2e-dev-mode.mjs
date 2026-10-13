// Drives the built app (npm run build first) through Dev Mode: draw a frame with text, make it a component and an
// instance, switch Design -> Dev with the top-bar switch, select a frame, a text and the instance and save the Spec
// panel, try the edit paths (Delete, drag, double-click text, Ctrl+G, nudge) and check nothing changed, then D back
// to Design and check that editing works as before. Usage: node scripts/e2e-dev-mode.mjs <out-dir>.
// The app runs with a temporary VELLUM_USER_DATA, never the real profile folder.
import { _electron as electron } from 'playwright'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = process.argv[2] ?? '.muster-evidence/e2e'
mkdirSync(out, { recursive: true })
const ud = mkdtempSync(join(tmpdir(), 'vellum-e2e-'))
const app = await electron.launch({ args: ['out/main/index.js'], env: { ...process.env, VELLUM_USER_DATA: ud } })
const page = await app.firstWindow()
const results = []
let n = 0
const shot = async (name) => {
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(out, `${String(++n).padStart(2, '0')}-${name}.png`) })
}
const check = (ok, label) => results.push(`${ok ? 'passed' : 'FAILED'}: ${label}`)
/** every canvas node: id, text, rect (the document as the canvas shows it) */
const canvas = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-node-id]')]
      .map((e) => {
        const r = e.getBoundingClientRect()
        return `${e.getAttribute('data-node-id')}|${e.children.length === 0 ? e.textContent : ''}|${[r.x, r.y, r.width, r.height].map(Math.round).join(',')}`
      })
      .join('\n')
  )
const panel = () => page.evaluate(() => document.querySelector('[data-testid="dev-spec"]')?.innerText ?? '')
const bodyText = () => page.evaluate(() => document.body.innerText)
/** text of the toast while it is showing (the element stays in the DOM after it fades) */
const toastShown = () => page.evaluate(() => { const t = document.querySelector('.cv-toast'); return t && t.classList.contains('cv-toast--show') ? t.textContent : '' })
const modeIsDev = () => page.evaluate(() => !!document.querySelector('.insp-top--dev'))

try {
  await page.waitForTimeout(2500)
  await page.locator('input:not([type=file])').first().fill('Tester')
  await page.getByRole('button', { name: 'Create profile' }).click()
  await page.waitForTimeout(2000)
  await page.getByText('Scratchpad').first().dblclick()
  await page.waitForTimeout(2500)

  // ---- build content in Design mode: frame + text, component, instance
  await page.keyboard.press('f')
  await page.mouse.move(330, 150)
  await page.mouse.down()
  await page.mouse.move(600, 330, { steps: 6 })
  await page.mouse.up()
  await page.keyboard.press('t')
  await page.mouse.click(380, 200)
  await page.keyboard.type('Hello')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.mouse.click(560, 310)
  await page.waitForTimeout(300)
  await page.keyboard.press('Control+Alt+k')
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'Create instance' }).click()
  await page.waitForTimeout(600)
  await page.keyboard.press('Escape')
  await shot('design-mode-before')
  check(!(await modeIsDev()), 'starts in Design mode')
  const designCanvas = await canvas()
  const designSelectors = await page.evaluate(() => document.querySelectorAll('input').length)
  results.push(`design-mode inputs in inspector area: ${designSelectors}`)

  // ---- switch to Dev with the top-bar segmented control
  await page.locator('.insp-top').getByText('Dev', { exact: true }).click()
  await page.waitForTimeout(500)
  check(await modeIsDev(), 'top-bar Dev switch turns Dev Mode on')
  await shot('dev-mode-nothing-selected-page-summary')
  const summary = await bodyText()
  check(/Select a layer to see its measurements/.test(summary), 'nothing selected: page summary with the hint')

  // ---- frame, text, instance selected
  const nodes = await page.evaluate(() =>
    [...document.querySelectorAll('[data-node-id]')].map((e) => ({ id: e.getAttribute('data-node-id'), text: e.children.length === 0 ? e.textContent : null, r: e.getBoundingClientRect().toJSON() }))
  )
  const texts = nodes.filter((x) => x.text === 'Hello')
  const frames = nodes.filter((x) => x.text === null).sort((a, b) => a.r.x - b.r.x)
  results.push(`nodes: ${nodes.length}, hello texts: ${texts.length}, frames: ${frames.length}`)
  const sel = async (r, dx = 4, dy = 4) => {
    await page.mouse.click(r.x + dx, r.y + dy)
    await page.waitForTimeout(400)
  }
  // main frame (first, left)
  await sel(frames[0].r, frames[0].r.width - 10, frames[0].r.height - 10)
  await shot('dev-mode-frame-selected')
  let p = await panel()
  check(/Layout/.test(p) && /Box/.test(p) && /Width/.test(p), 'frame: Spec panel shows Box and Layout')
  check(/Main component/.test(p) && /Kind/.test(p), 'main component: header badge and Component section say Main component')
  await shot('dev-mode-main-component-selected-detail')
  // text inside the main
  await sel(texts[0].r, 6, 6)
  await shot('dev-mode-text-selected')
  p = await panel()
  check(/Typography/.test(p) && /Size/.test(p) && /Weight/.test(p), 'text: Spec panel shows Typography')
  // the instance (right-most frame)
  const inst = frames[frames.length - 1]
  await sel(inst.r, inst.r.width - 10, inst.r.height - 10)
  await shot('dev-mode-instance-selected')
  p = await panel()
  check(/Instance/.test(p) && /Component/.test(p), 'instance: header says Instance and a Component section is shown')
  await page.getByRole('button', { name: 'Tailwind' }).click().catch(() => {})
  await shot('dev-mode-instance-code-tab')

  // ---- edit paths must change nothing
  const before = await canvas()
  await page.mouse.move(inst.r.x + 20, inst.r.y + 20)
  await page.mouse.down()
  await page.mouse.move(inst.r.x + 120, inst.r.y + 90, { steps: 5 })
  await page.mouse.up()
  await page.waitForTimeout(300)
  check((await canvas()) === before, 'drag in Dev Mode does not move anything')
  check((await toastShown()).includes('Dev Mode is read-only'), 'drag in Dev Mode shows the read-only toast')
  await shot('dev-mode-drag-toast')
  await page.waitForTimeout(4000)
  check(!(await toastShown()), 'toast fades away')
  await page.keyboard.press('Delete')
  await page.waitForTimeout(250)
  check((await toastShown()).includes('Dev Mode is read-only'), 'Delete in Dev Mode shows the read-only toast')
  await shot('dev-mode-delete-toast')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Shift+ArrowDown')
  await page.keyboard.press('Control+g')
  await page.keyboard.press('Control+d')
  await page.waitForTimeout(300)
  check((await canvas()) === before, 'Delete, nudge, Ctrl+G and Ctrl+D change nothing')
  await page.mouse.dblclick(texts[0].r.x + 6, texts[0].r.y + 6)
  await page.keyboard.type('XYZ')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  check((await canvas()) === before && !(await bodyText()).includes('XYZ'), 'double-click text does not start editing; typing changes nothing')
  await shot('dev-mode-after-edit-attempts')
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(300)
  check((await canvas()) === before, 'undo in Dev Mode changes nothing')
  
  // ---- back to Design with D: editing works as before
  await page.keyboard.press('Escape')
  await page.keyboard.press('d')
  await page.waitForTimeout(500)
  check(!(await modeIsDev()), 'D returns to Design mode')
  await shot('design-mode-after')
  check((await canvas()) === designCanvas, 'Design mode shows the same canvas as before Dev Mode')
  await page.mouse.click(inst.r.x + inst.r.width - 10, inst.r.y + inst.r.height - 10)
  await page.waitForTimeout(300)
  await page.mouse.move(inst.r.x + inst.r.width - 10, inst.r.y + inst.r.height - 10)
  await page.mouse.down()
  await page.mouse.move(inst.r.x + inst.r.width + 30, inst.r.y + inst.r.height + 20, { steps: 5 })
  await page.mouse.up()
  await page.waitForTimeout(400)
  check((await canvas()) !== designCanvas, 'Design mode: dragging the instance moves it again')
  await shot('design-mode-edited')
} catch (e) {
  results.push(`FAILED: exception ${e && e.message}`)
  await shot('failure').catch(() => {})
} finally {
  console.log(results.join('\n'))
  await Promise.race([app.close().catch(() => {}), new Promise((r) => setTimeout(r, 8000))])
  app.process().kill()
  try {
    rmSync(ud, { recursive: true, force: true })
  } catch {}
  process.exit(results.some((r) => r.startsWith('FAILED')) ? 1 : 0)
}
