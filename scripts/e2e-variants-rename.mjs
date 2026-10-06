// Drives the built app (npm run build first): binding a boolean and a text property leaves every instance looking the
// same; renaming the variant property (State) and a value (Hover) with two instances on that value; one undo per
// rename; a duplicate value name is refused.
// Usage: node scripts/e2e-variants-rename.mjs <out-dir>. Needs `npm i -D playwright`.
import { _electron as electron } from 'playwright'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = process.argv[2] ?? '.muster-evidence/e2e-variants-rename'
mkdirSync(out, { recursive: true })
const ud = mkdtempSync(join(tmpdir(), 'vellum-e2e-'))
const app = await electron.launch({ args: ['out/main/index.js'], env: { ...process.env, VELLUM_USER_DATA: ud } })
const page = await app.firstWindow()
const results = []
let n = 0
const wait = (ms = 400) => page.waitForTimeout(ms)
const shot = async (name) => {
  await wait()
  await page.screenshot({ path: join(out, `${String(++n).padStart(2, '0')}-${name}.png`) })
}
const check = (ok, label) => results.push(`${ok ? 'passed' : 'FAILED'}: ${label}`)
const blur = () => page.evaluate(() => document.activeElement?.blur())
const ctrlClick = (loc) => loc.click({ force: true, modifiers: ['Control'] })
/** per button-like frame (a frame holding a text leaf): its text and whether its grey icon is visible, in screen order */
const looks = () =>
  page.evaluate(() => {
    const visible = (e) => {
      const r = e.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && getComputedStyle(e).display !== 'none'
    }
    return [...document.querySelectorAll('[data-node-id]')]
      .map((f) => ({ f, t: [...f.children].find((c) => c.hasAttribute('data-node-id') && c.children.length === 0 && c.textContent) }))
      .filter((x) => x.t)
      .map(({ f, t }) => {
        const r = f.getBoundingClientRect()
        return { text: t.textContent, icon: [...f.children].some((c) => c.hasAttribute('data-node-id') && getComputedStyle(c).backgroundColor === 'rgb(217, 217, 217)' && visible(c)), y: Math.round(r.y), x: Math.round(r.x) }
      })
      .sort((a, b) => a.y - b.y || a.x - b.x)
  })
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const pick = async (scope, name) => {
  await page.locator(`${scope} button`).first().click()
  await page.getByRole('menuitem', { name }).click()
  await wait()
}
const toastText = () => page.locator('.cv-toast--show').first().textContent({ timeout: 1500 }).catch(() => null)
const undo = async () => {
  await blur()
  await page.keyboard.press('Control+z')
  await wait(500)
}
const commit = async (loc, value) => {
  await loc.fill(value)
  await page.keyboard.press('Enter')
  await wait()
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
  const v2 = mains.last()

  // two instances of Variant 2 (the selected variant), the second moved down
  await v2.click({ position: { x: 5, y: 75 }, force: true })
  await page.getByRole('button', { name: 'Create instance' }).click()
  await wait(500)
  await page.keyboard.press('Escape')
  await v2.click({ position: { x: 5, y: 75 }, force: true })
  await page.getByRole('button', { name: 'Create instance' }).click()
  await wait(500)
  for (let i = 0; i < 12; i++) await page.keyboard.press('Shift+ArrowDown')
  await wait()
  const beforeBinding = await looks()
  check(beforeBinding.length === 4, `a set of two variants and two instances (${beforeBinding.length} frames)`)

  // add a boolean and a text property on the variant main and bind them to its layers
  await v2.click({ position: { x: 5, y: 75 }, force: true })
  await wait()
  await page.getByRole('button', { name: '+ Boolean' }).click()
  await page.getByRole('button', { name: '+ Text' }).click()
  await wait()
  await ctrlClick(v2.locator(':scope > [data-node-id]').first())
  await wait()
  await pick('[data-bind-aspect="text"]', 'Label')
  await ctrlClick(v2.locator(':scope > [data-node-id]').nth(1))
  await wait()
  await pick('[data-bind-aspect="visible"]', 'Show')
  const afterBinding = await looks()
  await shot('after-binding')
  check(same(beforeBinding, afterBinding), `binding a text property and a boolean leaves every frame looking the same (${JSON.stringify(afterBinding.map((x) => [x.text, x.icon]))})`)
  await v2.click({ position: { x: 5, y: 75 }, force: true })
  await wait()
  const labelDefault = await page.locator('.insp-prop[data-prop-type="text"] input[aria-label^="Default of"]').inputValue()
  check(labelDefault === 'Click', `the text property's default is the layer's text (${labelDefault})`)

  // rename the variant property and the values
  await v2.click({ position: { x: 5, y: 75 }, force: true })
  await wait()
  await commit(page.locator('input[aria-label="Variant property name Variant"]'), 'State')
  const stepsBefore = await page.evaluate(() => document.title)
  await commit(page.locator('input[aria-label="Value of State"]'), 'Hover')
  await shot('renamed-state-hover')
  const meta = await page.locator('.insp-comp__meta').first().textContent()
  check(meta === 'State=Hover', `the variant is renamed to State=Hover (${meta})`)
  void stepsBefore

  // both instances stay on Hover, and their dropdown shows State / Hover
  const instances = page.locator('[data-node-id]:has(> [data-node-id]:text-is("Click"))')
  const total = await instances.count()
  check(total === 4, `all four frames are still there (${total})`)
  const lower = (await looks()).filter((x) => x.y > 250)
  check(lower.length === 2, `two instances below the set (${lower.length})`)
  for (const which of [0, 1]) {
    const frame = page.locator('[data-node-id]:has(> [data-node-id]:text-is("Click"))').nth(2 + which)
    await frame.click({ position: { x: 5, y: 75 }, force: true })
    await wait()
    const header = await page.locator('[data-variant]').first().textContent()
    const row = await page.locator('.insp-prop__row[data-prop-type="variant"]').first().textContent()
    check(header === 'State=Hover' && row.includes('State') && row.includes('Hover'), `instance ${which + 1} still on Hover: dropdown "${row}", header "${header}"`)
    if (which === 0) await shot('instance-controls')
  }

  // one undo per rename
  await undo()
  const afterUndo1 = await page.locator('[data-variant]').first().textContent()
  check(afterUndo1 === 'State=Variant 2', `one undo reverts the value rename only (${afterUndo1})`)
  await undo()
  const afterUndo2 = await page.locator('[data-variant]').first().textContent()
  check(afterUndo2 === 'Variant=Variant 2', `a second undo reverts the property rename (${afterUndo2})`)
  await page.keyboard.press('Control+Shift+z')
  await page.keyboard.press('Control+Shift+z')
  await wait(500)

  // a duplicate value name is refused
  await v2.click({ position: { x: 5, y: 75 }, force: true })
  await wait()
  await page.locator('input[aria-label="Value of State"]').fill('Default')
  await page.keyboard.press('Enter')
  await wait()
  const toast = await toastText()
  const kept = await page.locator('input[aria-label="Value of State"]').inputValue()
  await shot('duplicate-refused')
  check(toast === '"Default" already exists', `a duplicate value name is refused with a toast (${toast})`)
  check(kept === 'Hover', `and the field keeps the old value (${kept})`)
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
