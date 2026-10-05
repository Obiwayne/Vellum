// Drives the built app (npm run build first) through the variants UI: make a component, Add variant,
// check the set on the canvas and in Layers, the Assets row, and an instance's variant label.
// Usage: node scripts/e2e-variants-ui.mjs <out-dir>. Needs `npm i -D playwright`.
import { _electron as electron } from 'playwright'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = process.argv[2] ?? '.muster-evidence/e2e-variants-ui'
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
const layers = () =>
  page.evaluate(() => ({
    sets: document.querySelectorAll('.lp-layer svg.lucide-component').length,
    mains: [...document.querySelectorAll('.lp-layer svg.lucide-diamond')].filter((s) => s.getAttribute('fill') === 'currentColor').length,
    instances: [...document.querySelectorAll('.lp-layer svg.lucide-diamond')].filter((s) => s.getAttribute('fill') === 'none').length
  }))
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
  await page.mouse.move(480, 230, { steps: 6 })
  await page.mouse.up()
  await page.keyboard.press('t')
  await page.mouse.click(350, 175)
  await page.keyboard.type('Hello')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.mouse.click(470, 222)
  await page.keyboard.press('Control+Alt+k')
  await page.waitForTimeout(500)
  await shot('component-created')
  check((await page.getByRole('button', { name: 'Add variant' }).count()) === 1, 'the inspector offers Add variant on a main')
  check((await page.locator('[data-component-set]').count()) === 0, 'no set on the canvas yet')

  await page.getByRole('button', { name: 'Add variant' }).click()
  await page.waitForTimeout(600)
  await shot('after-add-variant')
  const l = await layers()
  check(l.sets === 1, `Layers shows the set icon (${l.sets})`)
  check(l.mains === 2, `Layers shows two variant mains (${l.mains} filled diamonds)`)
  check((await page.locator('[data-component-set]').count()) === 1, 'the set frame is marked on the canvas')
  const hellos = await page.evaluate(() => [...document.querySelectorAll('[data-node-id]')].filter((e) => e.children.length === 0 && e.textContent === 'Hello').length)
  check(hellos === 2, `both variants are on the canvas (${hellos} Hello texts)`)
  const meta = await page.locator('.insp-comp__meta').first().textContent()
  check(meta === 'Variant=Variant 2', `the new variant is selected and labelled (${meta})`)
  const assets = await page.locator('.lp-component').count()
  const badge = await page.locator('.lp-component__count').first().textContent()
  check(assets === 1 && badge === '2 variants', `Assets lists the set once with "2 variants" (${assets} rows, ${badge})`)

  // an instance of the selected variant shows its variant in the inspector header
  await page.getByRole('button', { name: 'Create instance' }).click()
  await page.waitForTimeout(600)
  await shot('instance-of-variant-2')
  const header = await page.locator('[data-variant]').first().textContent()
  check(header === 'Variant=Variant 2', `the instance header shows its variant (${header})`)
  check((await layers()).instances === 1, 'Layers shows a hollow diamond for the instance')

  // one undo removes the instance, another the variant (set goes back to a lone main on undo of the wrap)
  await page.evaluate(() => document.activeElement?.blur())
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(500)
  await shot('after-undo')
  const after = await layers()
  check(after.sets === 0 && after.mains === 1, `two undos back to a lone component (${after.sets} sets, ${after.mains} mains)`)
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
