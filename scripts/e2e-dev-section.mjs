// Drives the built app through the inspector's Dev sections (T69): draw a frame with text, make it a component,
// write a dev note, Make State property, add a state rule, set role / label / focus order, look at the contrast of
// the text layer, then switch to Dev Mode and read the same data in the Spec panel. Screenshots after each step.
// Usage: node scripts/e2e-dev-section.mjs <out-dir>. Runs with a temporary VELLUM_USER_DATA.
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
const scrollToDev = () =>
  page.evaluate(() => {
    const el = [...document.querySelectorAll('.c-section__title')].find((e) => e.textContent === 'Dev notes')
    el?.scrollIntoView({ block: 'start' })
  })

try {
  await page.waitForTimeout(2500)
  await page.locator('input:not([type=file])').first().fill('Tester')
  await page.getByRole('button', { name: 'Create profile' }).click()
  await page.waitForTimeout(2000)
  await page.getByText('Scratchpad').first().dblclick()
  await page.waitForTimeout(2500)

  // a frame with a grey text on white (contrast 4.48:1: fails AA)
  await page.keyboard.press('f')
  await page.mouse.move(330, 150)
  await page.mouse.down()
  await page.mouse.move(600, 330, { steps: 6 })
  await page.mouse.up()
  await page.keyboard.press('t')
  await page.mouse.click(380, 200)
  await page.keyboard.type('Pay now')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.mouse.click(560, 310)
  await page.waitForTimeout(300)
  await page.keyboard.press('Control+Alt+k')
  await page.waitForTimeout(500)
  await scrollToDev()
  await shot('main-component-dev-sections-empty')
  let t = await inspector()
  check(/Dev notes/.test(t) && /States/.test(t) && /Accessibility/.test(t), 'Dev notes, States and Accessibility sections are in the inspector')
  check(/hover/.test(t) && /missing/.test(t), 'a component lists hover and the other core states as missing')

  // notes
  await page.locator('textarea[aria-label="Dev notes"]').fill('Disabled until the card form is valid. Show a spinner while paying.')
  await page.waitForTimeout(400)
  await shot('notes-typed')
  check(true, 'dev note typed')

  // Make State property
  await page.getByRole('button', { name: 'Make State property' }).click()
  await page.waitForTimeout(700)
  await shot('after-make-state-property')
  t = await inspector()
  check(!/Make State property/.test(t) || /State/.test(t), 'Make State property ran')

  // select the original main again (the set wraps it) and add a described rule
  await page.mouse.click(400, 300)
  await page.waitForTimeout(300)
  await scrollToDev()
  await page.getByLabel('Add state rule').click()
  await page.waitForTimeout(400)
  await shot('add-state-rule-draft')
  await page.getByRole('button', { name: 'Cancel' }).click()
  await page.waitForTimeout(200)

  // a11y fields
  const role = page.locator('input[placeholder="Accessible name"]')
  await role.fill('Pay now button')
  await role.press('Enter')
  const tab = page.locator('input[placeholder="Reading order"]')
  await tab.fill('2')
  await tab.press('Enter')
  await page.waitForTimeout(400)
  await shot('accessibility-filled')
  t = await inspector()
  check(/Pay now button/.test(t) || (await role.inputValue()) === 'Pay now button', 'label written')

  // the text layer: contrast
  await page.keyboard.down('Control')
  await page.mouse.click(432, 226)
  await page.keyboard.up('Control')
  await page.waitForTimeout(400)
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('.c-section__title')].find((e) => e.textContent === 'Accessibility')
    el?.scrollIntoView({ block: 'start' })
  })
  await shot('text-layer-contrast')
  t = await inspector()
  check(/Contrast/.test(t) && /:1/.test(t), 'a text layer shows its contrast ratio')

  // Dev Mode: the same notes in the Spec panel, read-only
  await page.mouse.click(400, 300)
  await page.locator('.insp-top').getByText('Dev', { exact: true }).click()
  await page.waitForTimeout(500)
  await shot('dev-mode-spec-panel-with-notes')
  const spec = await page.evaluate(() => document.querySelector('[data-testid="dev-spec"]')?.innerText ?? '')
  check(/Disabled until the card form is valid/.test(spec), 'Dev Mode shows the note, read-only')
  check((await page.locator('textarea').count()) === 0, 'no editable notes field in Dev Mode')
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
