// Drives the built app (npm run build first) through the component flow: create a component, place
// an instance, change the main's fill (instance follows), override the instance's text (survives another
// main edit), detach, undo. Usage: node scripts/e2e-components.mjs <out-dir>. Needs `npm i -D playwright`.
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
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(out, `${String(++n).padStart(2, '0')}-${name}.png`) })
}
const check = (ok, label) => results.push(`${ok ? 'passed' : 'FAILED'}: ${label}`)
// canvas nodes by background and text, and the diamond icons in Layers, read from the DOM
const state = () =>
  page.evaluate(() => {
    const nodes = [...document.querySelectorAll('[data-node-id]')].map((e) => ({ bg: getComputedStyle(e).backgroundColor, text: e.children.length === 0 ? e.textContent : null }))
    const icons = [...document.querySelectorAll('.lp-layer--component svg.lucide-diamond')]
    return {
      redFrames: nodes.filter((x) => x.bg === 'rgb(255, 0, 0)').length,
      hellos: nodes.filter((x) => x.text === 'Hello').length,
      edited: nodes.filter((x) => x.text === 'Edited').length,
      mainIcons: icons.filter((s) => s.getAttribute('fill') === 'currentColor').length,
      instIcons: icons.filter((s) => s.getAttribute('fill') === 'none').length
    }
  })
try {
  await page.waitForTimeout(2500)
  await page.locator('input:not([type=file])').first().fill('Tester')
  await page.getByRole('button', { name: 'Create profile' }).click()
  await page.waitForTimeout(2000)
  await page.getByText('Scratchpad').first().dblclick()
  await page.waitForTimeout(2500)

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
  await page.mouse.click(560, 310) // empty part of the frame: selects the frame
  await page.waitForTimeout(300)
  await shot('before-component')
  results.push(`before: ${JSON.stringify(await state())}`)

  await page.keyboard.press('Control+Alt+k')
  await page.waitForTimeout(500)
  await shot('after-create-component')
  const made = await state()
  results.push(`made: ${JSON.stringify(made)}`)
  check(made.mainIcons >= 1, 'Ctrl+Alt+K: Layers shows a filled diamond for the main')
  await page.getByRole('button', { name: 'Create instance' }).click()
  await page.waitForTimeout(600)
  await shot('after-create-instance')
  const inst = await state()
  results.push(`instance: ${JSON.stringify(inst)}`)
  check(inst.hellos === 2, `instance placed: two "Hello" texts on canvas (${inst.hellos})`)
  check(inst.instIcons >= 1, `Layers shows a hollow diamond for the instance (${inst.instIcons})`)
  const setFill = async (hex) => {
    const box = page.locator('input[value="FFFFFF"], input[value="FF0000"], input[value="0000FF"]').first()
    await box.fill(hex)
    await box.press('Enter')
    await page.evaluate(() => document.activeElement?.blur())
    await page.waitForTimeout(400)
  }
  // select the main (first frame, empty corner) and change its fill: the instance follows
  await page.mouse.click(560, 310)
  await page.waitForTimeout(300)
  await setFill('FF0000')
  await shot('main-fill-red')
  const red = await state()
  results.push(`red: ${JSON.stringify(red)}`)
  check(red.redFrames === 2, `main fill red: main and instance both red (${red.redFrames} red frames)`)

  // override the instance's text, then edit the main again: the override survives
  await page.locator('[data-node-id]', { hasText: /^Hello$/ }).last().dblclick({ force: true })
  await page.waitForTimeout(300)
  await page.keyboard.press('Control+a')
  await page.keyboard.type('Edited')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  await shot('instance-text-overridden')
  const ov = await state()
  results.push(`override: ${JSON.stringify(ov)}`)
  check(ov.edited === 1 && ov.hellos === 1, `instance text overridden, main keeps Hello (${ov.edited} Edited, ${ov.hellos} Hello)`)
  await page.mouse.click(560, 310)
  await page.waitForTimeout(300)
  await setFill('0000FF')
  await shot('main-fill-blue-override-survives')
  const after = await state()
  results.push(`after second main edit: ${JSON.stringify(after)}`)
  check(after.edited === 1 && after.hellos === 1 && after.redFrames === 0, `override survives a later main edit (${after.edited} Edited)`)

  // detach the instance (select its frame: the Edited text's parent) with Ctrl+Alt+B, then undo
  const t = await page.locator('[data-node-id]', { hasText: /^Edited$/ }).last().boundingBox()
  await page.keyboard.press('Escape')
  await page.mouse.click(t.x + t.width / 2 + 150, t.y + 100)
  await page.waitForTimeout(300)
  const preDetach = await state()
  await page.keyboard.press('Control+Alt+b')
  await page.waitForTimeout(500)
  await shot('after-detach')
  const det = await state()
  results.push(`detach: before ${JSON.stringify(preDetach)} after ${JSON.stringify(det)}`)
  check(det.instIcons < preDetach.instIcons, `Ctrl+Alt+B: instance became plain frames (${preDetach.instIcons} -> ${det.instIcons} hollow diamonds)`)
  check(det.edited === 1, 'detached copy keeps the overridden text')
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(500)
  await shot('after-undo-detach')
  const und = await state()
  check(und.instIcons === preDetach.instIcons, `one undo re-links the instance (${und.instIcons} hollow diamonds)`)
} finally {
  console.log(results.join('\n'))
  await Promise.race([app.close(), new Promise((r) => setTimeout(r, 8000))])
  try {
    rmSync(ud, { recursive: true, force: true })
  } catch {
    /* temp dir may still be locked */
  }
  process.exit(0)
}
