// Drives the built app (npm run build first) through the Dev Mode redlines: draw a frame with two rectangles, switch to
// Dev with the top-bar switch, select one rectangle (distances to its parent's edges), hover the other (the gap
// between them), zoom (labels keep their size), and check that Design mode draws no redlines.
// Usage: node scripts/e2e-redlines.mjs <out-dir>. The app runs with a temporary VELLUM_USER_DATA.
import { _electron as electron } from 'playwright'
import { mkdirSync, mkdtempSync } from 'node:fs'
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
const redlines = () =>
  page.evaluate(() => [...document.querySelectorAll('[data-testid="redlines"] .cv-redline')].map((e) => `${e.className.replace('cv-redline ', '')}=${e.getAttribute('data-value')}`))
const labelSize = () =>
  page.evaluate(() => {
    const l = document.querySelector('[data-testid="redlines"] .cv-redline-label')
    return l ? Math.round(l.getBoundingClientRect().height) : null
  })
const nodeRects = () =>
  page.evaluate(() => [...document.querySelectorAll('[data-node-id]')].map((e) => ({ id: e.getAttribute('data-node-id'), r: e.getBoundingClientRect().toJSON() })))

try {
  await page.waitForTimeout(2500)
  await page.locator('input:not([type=file])').first().fill('Tester')
  await page.getByRole('button', { name: 'Create profile' }).click()
  await page.waitForTimeout(2000)
  await page.getByText('Scratchpad').first().dblclick()
  await page.waitForTimeout(2500)

  // a frame with two rectangles inside
  await page.keyboard.press('f')
  await page.mouse.move(330, 150)
  await page.mouse.down()
  await page.mouse.move(760, 420, { steps: 6 })
  await page.mouse.up()
  for (const [x1, x2] of [
    [370, 480],
    [600, 710]
  ]) {
    await page.keyboard.press('r')
    await page.mouse.move(x1, 200)
    await page.mouse.down()
    await page.mouse.move(x2, 290, { steps: 5 })
    await page.mouse.up()
    await page.keyboard.press('Escape')
  }
  await page.waitForTimeout(300)
  const rects = await nodeRects()
  const small = rects.filter((x) => x.r.width > 40 && x.r.width < 200 && x.r.height < 150).sort((p, q) => p.r.x - q.r.x)
  check(small.length >= 2, `two rectangles exist inside the frame (${small.length} found of ${rects.length} nodes)`)
  const [a, b] = small

  // Design mode: select one and hover the other: no redlines
  await page.mouse.click(a.r.x + 10, a.r.y + 10)
  await page.mouse.move(b.r.x + 10, b.r.y + 10)
  await page.waitForTimeout(300)
  await shot('design-mode-selected-hovered')
  check((await redlines()).length === 0, 'Design mode: no redlines')

  // Dev Mode
  await page.locator('.insp-top').getByText('Dev', { exact: true }).click()
  await page.waitForTimeout(500)
  await page.mouse.click(a.r.x + 10, a.r.y + 10)
  await page.mouse.move(40, 40)
  await page.waitForTimeout(300)
  await shot('dev-mode-selected-parent-insets')
  const insets = await redlines()
  results.push(`parent insets: ${insets.join(', ')}`)
  check(insets.filter((x) => x.startsWith('cv-redline--inset')).length >= 3, 'selected layer: distances to the parent frame')

  await page.mouse.move(b.r.x + 10, b.r.y + 10)
  await page.waitForTimeout(300)
  await shot('dev-mode-hovered-gap')
  const both = await redlines()
  results.push(`selected + hovered: ${both.join(', ')}`)
  check(
    both.some((x) => x.startsWith('cv-redline--gap')),
    'hovering the other rectangle shows the gap between them'
  )
  const size1 = await labelSize()

  // zoom: the labels keep their size
  await page.keyboard.press('Control+-')
  await page.keyboard.press('Control+-')
  await page.waitForTimeout(500)
  await page.mouse.move(b.r.x + 10, b.r.y + 10)
  await shot('dev-mode-zoomed')
  const size2 = await labelSize()
  results.push(`label height at 100%: ${size1}px, zoomed: ${size2}px`)
  check(size1 !== null && size1 === size2, 'label size is the same at another zoom level')
  await page.keyboard.press('Control+0')

  // back to Design: gone again
  await page.keyboard.press('d')
  await page.waitForTimeout(400)
  await shot('design-mode-again')
  check((await redlines()).length === 0, 'back in Design mode: no redlines')
} catch (e) {
  results.push(`FAILED: script error: ${String(e.message).slice(0, 300)}`)
} finally {
  console.log(results.join('\n'))
  await Promise.race([app.close().catch(() => undefined), new Promise((r) => setTimeout(r, 5000))])
  process.exit(results.some((r) => r.startsWith('FAILED')) ? 1 : 0)
}
