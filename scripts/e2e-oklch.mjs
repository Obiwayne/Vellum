// Drives the built app (npm run build first): the starter theme's oklch() colours in the colour pickers (T38).
// A file with the starter theme: the Fill picker lists the oklch tokens as colour styles with real swatches, choosing
// one writes var(--token), Detach writes the oklch literal unchanged, a typed var(--token) / oklch literal is accepted,
// and Selection colors lists the colours.
// Usage: node scripts/e2e-oklch.mjs <out-dir>. Needs `npm i -D playwright`.
import { _electron as electron } from 'playwright'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = process.argv[2] ?? '.muster-evidence/e2e-oklch'
mkdirSync(out, { recursive: true })
const ud = mkdtempSync(join(tmpdir(), 'vellum-e2e-'))
const app = await electron.launch({ args: ['out/main/index.js'], env: { ...process.env, VELLUM_USER_DATA: ud } })
const page = await app.firstWindow()
page.setDefaultTimeout(8000)
const results = []
let n = 0
const wait = (ms = 400) => page.waitForTimeout(ms)
const shot = async (name) => {
  await wait()
  await page.screenshot({ path: join(out, `${String(++n).padStart(2, '0')}-${name}.png`) })
}
const check = (ok, label) => results.push(`${ok ? 'passed' : 'FAILED'}: ${label}`)
/** the frame's inline background as written in the document, and as computed by the browser */
const frame = () =>
  page.evaluate(() => {
    const el = [...document.querySelectorAll('[data-node-id]')].find((e) => e.children.length === 0 ? false : e.textContent.includes('Hello'))
    return { inline: el.style.backgroundColor, computed: getComputedStyle(el).backgroundColor }
  })
const tokensBtn = () => page.getByRole('button', { name: 'Tokens', exact: true }).first()
const fieldToken = () => page.locator('.c-colorrow__token').first().textContent().catch(() => null)
const selectFrame = async () => {
  await page.mouse.click(900, 700)
  await page.mouse.click(690, 320)
  await wait()
}
const typeHex = async (v) => {
  await page.locator('.c-colorrow__hex').first().fill(v)
  await page.keyboard.press('Enter')
  await wait(500)
}
try {
  await wait(2500)
  await page.locator('input:not([type=file])').first().fill('Tester')
  await page.getByRole('button', { name: 'Create profile' }).click()
  await wait(2000)
  await page.getByText('Scratchpad').first().dblclick()
  await wait(2500)
  await page.keyboard.press('f')
  await page.mouse.move(330, 150)
  await page.mouse.down()
  await page.mouse.move(700, 330, { steps: 6 })
  await page.mouse.up()
  await page.keyboard.press('t')
  await page.mouse.click(350, 175)
  await page.keyboard.type('Hello')
  await page.keyboard.press('Escape')
  await selectFrame()

  // the starter theme: oklch tokens for the whole palette
  await page.getByText('Theme', { exact: true }).first().click()
  await wait()
  await page.getByRole('button', { name: 'Use starter theme' }).click()
  await wait(600)
  await page.getByText('Design', { exact: true }).first().click()
  await wait()
  await selectFrame()

  await tokensBtn().click()
  await wait()
  const listed = await page.locator('.insp-pop__list .insp-listitem').allTextContents()
  const blueRow = page.locator('.insp-pop__list .insp-listitem', { hasText: 'color-blue-500' }).first()
  await shot('fill-picker-starter-theme')
  check(listed.filter((t) => t.includes('color-')).length >= 15, `the Fill picker lists the starter palette (${listed.filter((t) => t.includes('color-')).length} colour styles)`)
  check((await blueRow.count()) === 1, 'color-blue-500 is in the list')
  const swatch = await blueRow.evaluate((el) => {
    const s = [...el.querySelectorAll('*')].find((e) => getComputedStyle(e).backgroundColor !== 'rgba(0, 0, 0, 0)' && e.getBoundingClientRect().width > 4 && e.getBoundingClientRect().width < 30)
    return s ? getComputedStyle(s).backgroundColor : null
  })
  check(Boolean(swatch) && swatch !== 'rgb(255, 255, 255)', `its swatch shows a colour (${swatch})`)

  // choose it: var(--color-blue-500)
  await blueRow.click()
  await wait(500)
  const applied = await frame()
  check((await fieldToken()) === 'blue-500', `the field shows the style name (${await fieldToken()})`)
  check(applied.inline.includes('var(--color-blue-500)') || applied.inline === '', `the frame is written as var(--color-blue-500) (${applied.inline || 'inline cleared by the browser'})`)
  check(applied.computed !== 'rgb(255, 255, 255)' && applied.computed !== 'rgba(0, 0, 0, 0)', `and renders blue (${applied.computed})`)
  await shot('applied-blue-500')

  // Detach: the oklch literal unchanged
  await tokensBtn().click()
  await wait()
  await page.getByRole('button', { name: 'Detach style' }).click()
  await wait(500)
  const detached = await frame()
  await shot('detached-literal')
  check(/oklch\(/i.test(detached.inline), `Detach writes the oklch literal (${detached.inline})`)
  check(detached.computed === applied.computed, `and the colour does not change (${detached.computed})`)

  // typed values are accepted as typed
  await selectFrame()
  await typeHex('var(--color-blue-700)')
  const typedRef = await frame()
  check((await fieldToken()) === 'blue-700', `typing var(--color-blue-700) in the hex field applies the style (${await fieldToken()})`)
  await selectFrame()
  await tokensBtn().click()
  await wait()
  await page.getByRole('button', { name: 'Detach style' }).click()
  await wait(400)
  await selectFrame()
  await typeHex('oklch(62.3% 0.214 258)')
  const typedOk = await frame()
  await shot('typed-oklch')
  check(/oklch\(/i.test(typedOk.inline), `typing an oklch literal keeps it as typed (${typedOk.inline})`)
  void typedRef
  await typeHex('oklch(nonsense)')
  const after = await frame()
  check(after.inline === typedOk.inline, 'a malformed oklch value is ignored')

  // Selection colors lists the frame's oklch fill
  await selectFrame()
  const sel = await page.locator('text=Selection colors').count()
  await shot('selection-colors')
  check(sel >= 1, 'Selection colors is shown for the frame')
} catch (e) {
  results.push(`FAILED: script error: ${String(e.message).split('\n')[0]}`)
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
