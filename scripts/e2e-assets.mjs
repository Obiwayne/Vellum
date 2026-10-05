// Drives the built app (npm run build first) through the Assets panel: make a component, search the list,
// drag a component onto the canvas and click one to insert, count instances.
// Usage: node scripts/e2e-assets.mjs <out-dir>. Needs `npm i -D playwright`.
import { _electron as electron } from 'playwright'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = process.argv[2] ?? '.muster-evidence/e2e-assets'
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
const hellos = () =>
  page.evaluate(() => [...document.querySelectorAll('[data-node-id]')].filter((e) => e.children.length === 0 && e.textContent === 'Hello').length)
const rows = () => page.locator('.lp-component').count()
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
  await page.mouse.move(520, 280, { steps: 6 })
  await page.mouse.up()
  await page.keyboard.press('t')
  await page.mouse.click(360, 190)
  await page.keyboard.type('Hello')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.mouse.click(500, 265)
  await page.keyboard.press('Control+Alt+k')
  await page.waitForTimeout(500)
  await shot('assets-after-create')
  check((await rows()) === 1, `the Assets panel lists the new component (${await rows()} rows)`)
  check(await page.locator('.lp-components__title', { hasText: 'Assets' }).isVisible(), 'the section is titled Assets')

  const search = page.locator('.lp-components__search input')
  await search.fill('zzz')
  await page.waitForTimeout(300)
  await shot('assets-search-no-match')
  check((await rows()) === 0 && (await page.locator('.lp-components__empty').count()) === 1, 'a search without hits shows "No components match"')
  await search.fill('fra')
  await page.waitForTimeout(300)
  check((await rows()) === 1, `a matching search keeps the row (${await rows()} rows)`)
  await search.fill('')

  // click inserts an instance, drag drops one at the pointer
  const before = await hellos()
  await page.locator('.lp-component').first().click()
  await page.waitForTimeout(500)
  check((await hellos()) === before + 1, `click inserts an instance (${before} -> ${await hellos()} Hello texts)`)
  const row = page.locator('.lp-component').first()
  const box = await row.boundingBox()
  const afterClick = await hellos()
  await page.mouse.move(box.x + 40, box.y + 12)
  await page.mouse.down()
  await page.mouse.move(700, 450, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(600)
  await shot('assets-after-drag')
  check((await hellos()) === afterClick + 1, `dragging onto the canvas inserts an instance (${afterClick} -> ${await hellos()} Hello texts)`)
  const count = await page.locator('.lp-component__count').first().textContent()
  check(count === '2', `the row shows 2 instances (${count})`)
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
