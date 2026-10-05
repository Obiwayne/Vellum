// Drives the built app (npm run build first) through the inspector's text style row: none, create from a
// text layer (linked), pick it for a second text, manual size edit detaches (toast), undo relinks.
// Usage: node scripts/e2e-text-styles.mjs <out-dir>. Needs `npm i -D playwright`.
import { _electron as electron } from 'playwright'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = process.argv[2] ?? '.muster-evidence/e2e-text-styles'
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
const state = () => page.locator('.insp-tstyle').first().getAttribute('data-text-style')
const label = () => page.locator('.insp-tstyle .c-select__value').first().textContent()
const typeText = async (x, y, text) => {
  await page.keyboard.press('t')
  await page.mouse.click(x, y)
  await page.keyboard.type(text)
  await page.keyboard.press('Escape')
}
try {
  await page.waitForTimeout(1500)
  await page.reload()
  await page.waitForTimeout(2500)
  await page.locator('input:not([type=file])').first().fill('Tester')
  await page.getByRole('button', { name: 'Create profile' }).click()
  await page.waitForTimeout(2000)
  await page.getByText('Scratchpad').first().dblclick()
  await page.waitForTimeout(2500)

  await page.keyboard.press('f')
  await page.mouse.move(330, 150)
  await page.mouse.down()
  await page.mouse.move(700, 330, { steps: 6 })
  await page.mouse.up()
  await typeText(350, 175, 'Heading')
  await typeText(350, 260, 'Body copy')
  await page.waitForTimeout(500)
  await shot('second-text-selected-none')
  check((await state()) === 'none' && (await label()) === 'None', `no style yet: row says None (${await label()})`)

  // select the first text, give it a bigger size, then create a style from it
  await page.mouse.click(360, 178)
  await page.waitForTimeout(300)
  await page.getByTitle('Font size').locator('input').first().fill('32')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'Create text style from selection' }).click()
  await page.waitForTimeout(500)
  await shot('created-and-linked')
  check((await label()) === 'Text style', `create from selection links the layer (${await label()})`)
  check((await page.getByRole('button', { name: 'Detach from text style' }).count()) === 1, 'a detach button appears when linked')

  // apply to the second text through the picker
  await page.mouse.click(360, 263)
  await page.waitForTimeout(300)
  await page.locator('.insp-tstyle .c-select').click()
  await page.getByRole('menuitem', { name: 'Text style' }).click()
  await page.waitForTimeout(500)
  await shot('picked-for-second-text')
  check((await label()) === 'Text style', `picking the style links the second text (${await label()})`)

  // manual edit detaches and toasts
  await page.getByTitle('Font size').locator('input').first().fill('20')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  await shot('detached-after-manual-edit')
  check((await state()) === 'none', `a manual size edit detaches (${await state()})`)
  const toast = (await page.locator('.cv-toast').textContent()) ?? ''
  check(toast.includes('Detached from text style Text style'), `toast says so (${toast})`)

  await page.mouse.click(900, 600)
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(400)
  await page.mouse.click(360, 263)
  await page.waitForTimeout(300)
  await shot('after-undo-relinked')
  check((await state()) !== 'none', `undo relinks the second text (${await label()})`)
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
