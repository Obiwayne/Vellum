// Drives the built app (npm run build first): a Button set (Default / Variant 2 without the icon, a Show icon
// boolean and a Label text property), two instances, flipping properties on one instance only, a variant switch
// that carries a text-colour override, a switch that drops an override on a layer the other variant lacks (toast),
// the bound-field marker and editing a bound field, one undo per change.
// Usage: node scripts/e2e-variants-switch.mjs <out-dir>. Needs `npm i -D playwright`.
import { _electron as electron } from 'playwright'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = process.argv[2] ?? '.muster-evidence/e2e-variants-switch'
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
const blur = () => page.evaluate(() => document.activeElement?.blur())
const wait = (ms = 400) => page.waitForTimeout(ms)
/** every button-like frame that holds a text leaf: its text, whether it has a visible grey icon, the text colour */
const frames = () =>
  page.evaluate(() => {
    const visible = (e) => {
      const r = e.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && getComputedStyle(e).display !== 'none'
    }
    return [...document.querySelectorAll('[data-node-id]')]
      .map((f) => ({ f, t: [...f.children].find((c) => c.hasAttribute('data-node-id') && c.children.length === 0 && c.textContent) }))
      .filter((x) => x.t)
      .map(({ f, t }) => ({
        text: t.textContent,
        color: getComputedStyle(t).color,
        icon: [...f.children].some((c) => c.hasAttribute('data-node-id') && getComputedStyle(c).backgroundColor === 'rgb(217, 217, 217)' && visible(c)),
        x: Math.round(f.getBoundingClientRect().x),
        y: Math.round(f.getBoundingClientRect().y)
      }))
      .sort((a, b) => a.y - b.y || a.x - b.x)
  })
const pick = async (scope, name) => {
  await page.locator(`${scope} button`).first().click()
  await page.getByRole('menuitem', { name }).click()
  await wait()
}
const toastText = () => page.locator('.cv-toast--show').first().textContent({ timeout: 1500 }).catch(() => null)
const setFill = async (current, hex) => {
  const box = page.locator(`input[value="${current}"]`).first()
  await box.fill(hex)
  await page.keyboard.press('Enter')
  await blur()
  await wait()
}
const undo = async () => {
  await blur()
  await page.keyboard.press('Control+z')
  await wait(500)
}
const ctrlClick = (loc) => loc.click({ force: true, modifiers: ['Control'] })
try {
  await wait(2500)
  await page.locator('input:not([type=file])').first().fill('Tester')
  await page.getByRole('button', { name: 'Create profile' }).click()
  await wait(2000)
  await page.getByText('Scratchpad').first().dblclick()
  await wait(2500)

  // Button frame with "Click" and an icon, made a component with a second variant that has no icon
  await page.keyboard.press('f')
  await page.mouse.move(330, 150)
  await page.mouse.down()
  await page.mouse.move(520, 230, { steps: 6 })
  await page.mouse.up()
  await page.keyboard.press('t')
  await page.mouse.click(345, 170)
  await page.keyboard.type('Click')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.keyboard.press('r')
  await page.mouse.move(470, 175)
  await page.mouse.down()
  await page.mouse.move(500, 205, { steps: 4 })
  await page.mouse.up()
  await page.keyboard.press('Escape')
  await page.mouse.click(340, 225)
  await page.keyboard.press('Control+Alt+k')
  await wait()
  await page.getByRole('button', { name: 'Add variant' }).click()
  await wait(600)
  const mains = page.locator('[data-component-set] > [data-node-id]')
  const def = mains.first()
  const v2 = mains.last()
  await ctrlClick(v2.locator(':scope > [data-node-id]').nth(1)) // Variant 2's icon
  await page.keyboard.press('Delete')
  await wait()
  await shot('variant-2-has-no-icon')
  let f = await frames()
  check(f.length === 2 && f[0].icon && !f[1].icon, `Default has the icon, Variant 2 does not (${JSON.stringify(f.map((x) => x.icon))})`)

  // properties on the set, bound in both variants (text) and in Default (icon)
  await ctrlClick(v2.locator(':scope > [data-node-id]').first())
  await page.getByRole('button', { name: 'Create instance' }).count() // (inspector shows the layer here)
  await def.click({ position: { x: 5, y: 75 }, force: true })
  await wait()
  await page.getByRole('button', { name: '+ Boolean' }).click()
  await page.getByRole('button', { name: '+ Text' }).click()
  await wait()
  await shot('properties-added')
  await ctrlClick(def.locator(':scope > [data-node-id]').first())
  await wait()
  await pick('[data-bind-aspect="text"]', 'Label')
  await ctrlClick(def.locator(':scope > [data-node-id]').nth(1))
  await wait()
  await pick('[data-bind-aspect="visible"]', 'Show')
  await ctrlClick(v2.locator(':scope > [data-node-id]').first())
  await wait()
  await pick('[data-bind-aspect="text"]', 'Label')

  // two instances of Default, the second moved down
  await def.click({ position: { x: 5, y: 75 }, force: true })
  await page.getByRole('button', { name: 'Create instance' }).click()
  await wait(500)
  await page.getByRole('button', { name: 'Create instance' }).count()
  await page.keyboard.press('Escape')
  await def.click({ position: { x: 5, y: 75 }, force: true })
  await page.getByRole('button', { name: 'Create instance' }).click()
  await wait(500)
  for (let i = 0; i < 12; i++) await page.keyboard.press('Shift+ArrowDown')
  await wait()
  await shot('two-instances')
  f = await frames()
  const insts = f.filter((x) => x.y > f[1].y + 90) // the two below the set
  check(insts.length === 2, `two instances placed (${insts.length})`)

  // flip the boolean on the selected instance (B) only
  const rowBool = '.insp-prop__row[data-prop-type="boolean"] [role=checkbox]'
  await page.locator(rowBool).click()
  await wait()
  await shot('show-off-on-one-instance')
  f = (await frames()).filter((x) => x.y > 250)
  check(f.length === 2 && f.filter((x) => x.icon).length === 1, `Show off on one instance: the other keeps its icon (${JSON.stringify(f.map((x) => x.icon))})`)
  await undo()
  f = (await frames()).filter((x) => x.y > 250)
  check(f.every((x) => x.icon), 'one undo brings the icon back')
  await page.locator(rowBool).click() // off again for the rest
  await wait()

  // Label on B only
  const label = page.locator('.insp-prop__row[data-prop-type="text"] input')
  await label.fill('Go')
  await label.press('Enter')
  await wait()
  f = (await frames()).filter((x) => x.y > 250)
  check(f.map((x) => x.text).sort().join() === 'Click,Go', `Label changes one instance only; the other keeps the text it had (${f.map((x) => x.text)})`)
  await shot('label-on-one-instance')
  await undo()
  f = (await frames()).filter((x) => x.y > 250)
  check(f.every((x) => x.text === 'Click'), 'one undo restores the label')
  await label.fill('Go')
  await label.press('Enter')
  await wait()

  // the bound text layer shows the marker; editing it on the canvas edits the property
  const instB = page.locator('[data-node-id]:has(> [data-node-id]:text-is("Go"))').first()
  await ctrlClick(instB.locator(':scope > [data-node-id]').first())
  await wait()
  const marker = await page.locator('[data-bound="text"]').first().textContent().catch(() => null)
  await shot('bound-marker')
  check(Boolean(marker) && marker.includes('Label'), `a bound layer shows the marker (${marker})`)
  await instB.locator(':scope > [data-node-id]').first().dblclick({ force: true })
  await page.keyboard.press('Control+a')
  await page.keyboard.type('Edited')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await wait()
  await page.locator('[data-node-id]:has(> [data-node-id]:text-is("Edited"))').first().click({ position: { x: 5, y: 75 }, force: true })
  await wait()
  const labelNow = await page.locator('.insp-prop__row[data-prop-type="text"] input').inputValue()
  check(labelNow === 'Edited', `editing the bound text on the canvas edits the property (Label field: ${labelNow})`)

  // text colour override on B's text, switch Size: carried over
  const instE = page.locator('[data-node-id]:has(> [data-node-id]:text-is("Edited"))').first()
  await ctrlClick(instE.locator(':scope > [data-node-id]').first())
  await wait()
  await setFill('000000', 'FF0000')
  let colors = (await frames()).filter((x) => x.y > 250).map((x) => x.color)
  check(colors.includes('rgb(255, 0, 0)') && colors.includes('rgb(0, 0, 0)'), `text colour override on one instance (${colors})`)
  await instE.click({ position: { x: 5, y: 75 }, force: true })
  await wait()
  const variantRow = '.insp-prop__row[data-prop-type="variant"]'
  await pick(variantRow, 'Variant 2')
  await shot('switched-keeps-text-override')
  f = (await frames()).filter((x) => x.y > 250)
  check(f.some((x) => x.color === 'rgb(255, 0, 0)' && x.text === 'Edited'), `the text override is carried over the switch (${JSON.stringify(f.map((x) => [x.text, x.color]))})`)
  check((await toastText()) === null, 'no toast when nothing is dropped')
  await undo()
  const back = await page.locator('[data-variant]').first().textContent()
  check(back === 'Variant=Default', `one undo reverts the switch (${back})`)

  // override on the icon (the other variant lacks it): the switch drops it and says so
  await instE.click({ position: { x: 5, y: 75 }, force: true })
  await wait()
  await page.locator(rowBool).click() // Show icon back on, so the icon can be selected
  await wait()
  await ctrlClick(instE.locator(':scope > [data-node-id]').nth(1))
  await wait()
  await setFill('D9D9D9', '0000FF')
  await instE.click({ position: { x: 5, y: 75 }, force: true })
  await wait()
  await pick(variantRow, 'Variant 2')
  const toast = await toastText()
  await shot('dropped-override-toast')
  check(toast === '1 override could not carry over', `dropping an override shows the toast (${toast})`)
  await undo()
  const back2 = await page.locator('[data-variant]').first().textContent()
  check(back2 === 'Variant=Default', `one undo reverts the dropping switch (${back2})`)
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
