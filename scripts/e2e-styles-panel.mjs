// Drives the built app (npm run build first) through the Theme tab's Styles view: create a text style from a
// selected text, apply it to a second text (context menu), edit its size 16 -> 48 and see both texts grow,
// then create a colour style from a frame's fill. Screenshots of the panel with both lists.
// Usage: node scripts/e2e-styles-panel.mjs <out-dir>. Needs `npm i -D playwright`.
import { _electron as electron } from 'playwright'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = process.argv[2] ?? '.muster-evidence/e2e-styles-panel'
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
const typeText = async (x, y, text) => {
  await page.keyboard.press('t')
  await page.mouse.click(x, y)
  await page.keyboard.type(text)
  await page.keyboard.press('Escape')
}
/** computed font size and height of the canvas element showing `word` */
const fontOf = (word) =>
  page.evaluate((w) => {
    const el = [...document.querySelectorAll('[data-node-id]')].find((e) => e.children.length === 0 && e.textContent === w)
    return el ? { size: parseFloat(getComputedStyle(el).fontSize), h: Math.round(el.getBoundingClientRect().height) } : null
  }, word)
const typeInto = async (locator, value) => {
  await locator.fill(value)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
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

  // Theme tab > Styles
  await page.getByRole('button', { name: 'Theme' }).first().click().catch(() => {})
  await page.getByText('Theme', { exact: true }).first().click()
  await page.waitForTimeout(500)
  await page.getByRole('tab', { name: 'Styles' }).click()
  await page.waitForTimeout(400)
  await shot('styles-empty')
  check((await page.locator('[data-styles="text"]').textContent()).includes('No text styles yet'), 'empty Styles view shows the hint')

  // select the first text on the canvas and press + (create from selection)
  await page.mouse.click(360, 178)
  await page.waitForTimeout(300)
  await page.locator('[data-styles="text"] .lp-styles__head button').click()
  await page.waitForTimeout(400)
  await page.keyboard.type('Heading/H1')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)
  check((await page.locator('[data-styles="text"] .lp-style').count()) === 1, 'a text style row exists after +')
  check((await page.locator('[data-styles="text"] .lp-style__name').textContent()) === 'H1', 'slash name "Heading/H1" shows as H1 under a Heading group')

  // apply it to the second text via the context menu
  await page.mouse.click(360, 263)
  await page.waitForTimeout(300)
  await page.locator('[data-styles="text"] .lp-style').first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Apply to selection' }).click()
  await page.waitForTimeout(500)
  check((await page.locator('[data-styles="text"] .lp-style__count').textContent()) === '2', 'two layers follow the style')

  // edit the style size 16 -> 48 in place: both texts grow
  const before1 = await fontOf('Heading')
  const before2 = await fontOf('Body copy')
  await page.locator('[data-styles="text"] .lp-style').first().click()
  await page.waitForTimeout(400)
  await shot('style-editor-open')
  const size = page.locator('.lp-style-editor .lp-token-editor__field', { hasText: 'Size' }).locator('input')
  await typeInto(size, '48')
  await shot('both-texts-grew')
  const after1 = await fontOf('Heading')
  const after2 = await fontOf('Body copy')
  check(after1 && after1.size === 48 && after2 && after2.size === 48, `editing the style to 48 resizes both texts (${before1?.size},${before2?.size} -> ${after1?.size},${after2?.size})`)
  check(after1 && after2 && after1.h > before1.h && after2.h > before2.h, `the text boxes grow with it (${before1?.h},${before2?.h} -> ${after1?.h},${after2?.h})`)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(500)
  const undone = await fontOf('Heading')
  const undone2 = await fontOf('Body copy')
  check(undone?.size === before1?.size && undone2?.size === before2?.size, `one undo restores both sizes (${undone?.size},${undone2?.size})`)

  // colour style from the frame's fill
  await page.mouse.click(600, 300)
  await page.waitForTimeout(300)
  await page.locator('[data-styles="colour"] .lp-styles__head button').click()
  await page.waitForTimeout(300)
  await page.keyboard.type('surface')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)
  check((await page.locator('[data-styles="colour"] .lp-style').count()) >= 1, 'a colour style row exists')
  await shot('styles-with-text-and-colour')
  // a duplicate name is refused
  await page.locator('[data-styles="colour"] .lp-styles__head button').click()
  await page.waitForTimeout(300)
  await page.keyboard.type('surface')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  const alert = (await page.locator('.lp-styles__msg').textContent().catch(() => '')) ?? ''
  check(/already|style/.test(alert), `a duplicate colour style name is refused (${alert})`)
  await shot('duplicate-refused')
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
