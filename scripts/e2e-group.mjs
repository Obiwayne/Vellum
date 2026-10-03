// Drives the built app (npm run build first) through group / frame selection / ungroup and saves
// screenshots. Usage: node scripts/e2e-group.mjs <out-dir>. Needs `npm i -D playwright`.
import { _electron as electron } from 'playwright'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = process.argv[2] ?? '.muster-evidence/e2e'
mkdirSync(out, { recursive: true })
const ud = mkdtempSync(join(tmpdir(), 'vellum-e2e-'))
const app = await electron.launch({ args: ['out/main/index.js'], env: { ...process.env, VELLUM_USER_DATA: ud } })
const page = await app.firstWindow()
let n = 0
const results = []
// on-screen rects of the two grey rectangles (read from the DOM)
const rects = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-node-id]')]
      .filter((el) => getComputedStyle(el).backgroundColor === 'rgb(217, 217, 217)')
      .map((el) => {
        const r = el.getBoundingClientRect()
        return [r.x, r.y, r.width, r.height].map(Math.round).join(',')
      })
      .sort()
      .join(' | ')
  )
let baseline = ''
const check = async (label) => {
  const now = await rects()
  const ok = now === baseline && now.split(' | ').length === 2
  results.push(`${ok ? 'passed' : 'FAILED'}: ${label} (${now})`)
}
const shot = async (name) => {
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(out, `${String(++n).padStart(2, '0')}-${name}.png`) })
}
const drag = async (tool, x1, y1, x2, y2) => {
  await page.keyboard.press(tool)
  await page.mouse.move(x1, y1)
  await page.mouse.down()
  await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 4 })
  await page.mouse.move(x2, y2, { steps: 4 })
  await page.mouse.up()
  await page.waitForTimeout(300)
}
try {
  await page.waitForTimeout(2500)
  await page.locator('input:not([type=file])').first().fill('Tester')
  await page.getByRole('button', { name: 'Create profile' }).click()
  await page.waitForTimeout(2000)
  await page.getByText('Scratchpad').first().dblclick()
  await page.waitForTimeout(2500)

  await drag('f', 330, 150, 900, 600) // artboard
  await drag('r', 400, 220, 500, 320) // rect 1 inside it
  await drag('r', 650, 380, 780, 480) // rect 2 inside it
  await page.keyboard.press('Escape')
  await shot('before-loose-layers')
  const selectTwo = async () => {
    await page.keyboard.press('Escape')
    await page.mouse.click(450, 270)
    await page.keyboard.down('Shift')
    await page.mouse.click(715, 430)
    await page.keyboard.up('Shift')
  }
  baseline = await rects()
  results.push(`baseline rects: ${baseline}`)
  await selectTwo()
  await shot('selected-two')

  await page.keyboard.press('Control+g')
  await shot('after-group')
  await check('Ctrl+G: layers did not move')
  await page.keyboard.press('Control+z')
  await shot('after-undo-group')
  await check('Ctrl+Z after group: layers did not move')
  await selectTwo()
  await page.keyboard.press('Control+Alt+g')
  await shot('after-frame-selection')
  await check('Ctrl+Alt+G: layers did not move')
  await page.keyboard.press('Control+Shift+g')
  await shot('after-ungroup-frame')
  await check('Ctrl+Shift+G: layers did not move')
  await page.keyboard.press('Control+g')
  await shot('regrouped')
  await check('Ctrl+G again: layers did not move')
  await page.keyboard.press('Shift+Backspace')
  await shot('after-shift-backspace-ungroup')
  await check('Shift+Backspace ungroup: layers did not move')
  const layers = await page.locator('text=Group').count()
  results.push(`${layers === 0 ? 'passed' : 'FAILED'}: Shift+Backspace removed the Group layer (${layers} left)`)
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
