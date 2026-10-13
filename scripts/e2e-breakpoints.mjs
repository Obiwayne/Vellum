// Drives the built app through breakpoint tagging (T71): draw two frames, tag them as Home / Desktop and
// Home / Mobile in the Screen section, set Min / Max width in the Layout section, and read the result back from the
// inspector. Screenshots after each step. Usage: node scripts/e2e-breakpoints.mjs <out-dir>.
// Runs with a temporary VELLUM_USER_DATA.
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
const inspector = () => page.evaluate(() => document.querySelector('.insp-scroll')?.innerText ?? '')
const draw = async (x1, y1, x2, y2) => {
  await page.keyboard.press('f')
  await page.mouse.move(x1, y1)
  await page.mouse.down()
  await page.mouse.move(x2, y2, { steps: 6 })
  await page.mouse.up()
  await page.keyboard.press('Escape')
}

try {
  await page.waitForTimeout(2500)
  await page.locator('input:not([type=file])').first().fill('Tester')
  await page.getByRole('button', { name: 'Create profile' }).click()
  await page.waitForTimeout(2000)
  await page.getByText('Scratchpad').first().dblclick()
  await page.waitForTimeout(2500)

  await draw(330, 150, 700, 330) // wide frame
  await draw(760, 150, 880, 330) // narrow frame
  // wide frame: tag as Home / Desktop
  await page.mouse.click(500, 250)
  await page.waitForTimeout(400)
  let t = await inspector()
  check(/Screen/.test(t) && /Breakpoint/.test(t), 'a top-level frame has a Screen section')
  await shot('screen-section-untagged')
  const name = page.locator('[data-testid="screen-section"] input').first()
  await name.fill('Home')
  await name.press('Enter')
  await page.waitForTimeout(400)
  // the frame is only 370 px wide, so the guess is Mobile: pick Desktop by hand
  await page.locator('[data-testid="screen-section"]').getByText(/Mobile . 390/).click()
  await page.getByText('Desktop · 1280').click()
  await page.waitForTimeout(400)
  await shot('tagged-desktop')
  t = await inspector()
  check(/Desktop . 1280/.test(t), 'the wide frame is tagged Desktop from the breakpoint menu')

  // narrow frame: Home / Mobile
  await page.mouse.click(820, 250)
  await page.waitForTimeout(400)
  const name2 = page.locator('[data-testid="screen-section"] input').first()
  await name2.fill('Home')
  await name2.press('Enter')
  await page.waitForTimeout(400)
  await shot('tagged-mobile')
  t = await inspector()
  check(/Mobile/.test(t) && /2 breakpoints/.test(t), 'the narrow frame is Mobile and the section lists both breakpoints')

  // min / max
  const limits = page.locator('[data-testid="size-limits"] input')
  await limits.nth(0).fill('120')
  await limits.nth(0).press('Enter')
  await limits.nth(1).fill('480')
  await limits.nth(1).press('Enter')
  await page.waitForTimeout(400)
  await page.evaluate(() => document.querySelector('[data-testid="size-limits"]')?.scrollIntoView({ block: 'center' }))
  await shot('min-max-width')
  const vals = await limits.evaluateAll((els) => els.map((e) => e.value))
  check(vals[0] === '120' && vals[1] === '480', `Min W and Max W are set (${vals.join(', ')})`)
  const css = await page.evaluate(() => {
    const el = [...document.querySelectorAll('[data-node-id]')].find((e) => e.getBoundingClientRect().width > 100 && e.getBoundingClientRect().width < 130)
    return el ? getComputedStyle(el).minWidth + ' / ' + getComputedStyle(el).maxWidth : ''
  })
  results.push(`computed on the canvas element: ${css}`)
  check(/120px \/ 480px/.test(css), 'the canvas applies min-width and max-width')
} catch (e) {
  results.push(`FAILED: exception ${e && e.message}`)
  await shot('failure').catch(() => {})
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
