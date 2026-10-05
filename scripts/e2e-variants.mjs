// Drives the built app (npm run build first) through variant sets and component properties: a Button set with a
// boolean (Show icon) and a text (Label) property, an instance, flipping each property, switching variant with an
// override present, undo. Screenshots plus DOM checks.
// Usage: node scripts/e2e-variants.mjs <out-dir>. Needs `npm i -D playwright`.
import { _electron as electron } from 'playwright'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = process.argv[2] ?? '.muster-evidence/e2e-variants'
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
/** visible grey rects (the icons) and the text leaves on the canvas */
const canvas = () =>
  page.evaluate(() => {
    const els = [...document.querySelectorAll('[data-node-id]')]
    const visible = (e) => {
      const r = e.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && getComputedStyle(e).display !== 'none'
    }
    return {
      icons: els.filter((e) => getComputedStyle(e).backgroundColor === 'rgb(217, 217, 217)' && visible(e)).length,
      texts: els.filter((e) => e.children.length === 0 && e.textContent && visible(e)).map((e) => e.textContent).sort()
    }
  })
const pick = async (scope, name) => {
  await page.locator(`${scope} button`).first().click()
  await page.getByRole('menuitem', { name }).click()
  await page.waitForTimeout(400)
}
const blur = () => page.evaluate(() => document.activeElement?.blur())
try {
  await page.waitForTimeout(2500)
  await page.locator('input:not([type=file])').first().fill('Tester')
  await page.getByRole('button', { name: 'Create profile' }).click()
  await page.waitForTimeout(2000)
  await page.getByText('Scratchpad').first().dblclick()
  await page.waitForTimeout(2500)

  // a Button frame: text + icon rect
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
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'Add variant' }).click()
  await page.waitForTimeout(600)
  await shot('button-set-with-two-variants')
  let c = await canvas()
  check(c.icons === 2, `a Button set with two variants, each with an icon (${c.icons} icons)`)

  // properties on the selected variant main (shared by the set)
  await page.getByRole('button', { name: '+ Boolean' }).click()
  await page.getByRole('button', { name: '+ Text' }).click()
  await page.waitForTimeout(400)
  check((await page.locator('.insp-prop').count()) === 2, `two properties added (${await page.locator('.insp-prop').count()})`)
  const nameInput = page.locator('input[aria-label="Property name Show"]')
  await nameInput.fill('Show icon')
  await nameInput.press('Enter')
  await page.waitForTimeout(300)
  check((await page.locator('input[aria-label="Property name Show icon"]').count()) === 1, 'the boolean property is renamed to "Show icon"')
  await shot('properties-defined')

  // bind the icon's visibility and the text to them (Ctrl+click picks the layer inside the Variant 2 main)
  const mains = page.locator('[data-component-set] > [data-node-id]')
  const v2 = mains.last()
  const box = await v2.boundingBox()
  await v2.locator(':scope > [data-node-id]').first().click({ force: true, modifiers: ['Control'] }) // the "Click" text
  await page.waitForTimeout(300)
  await pick('[data-bind-aspect="text"]', 'Label')
  await v2.locator(':scope > [data-node-id]').nth(1).click({ force: true, modifiers: ['Control'] }) // the icon
  await page.waitForTimeout(300)
  await pick('[data-bind-aspect="visible"]', 'Show icon')
  await shot('layers-bound')
  check((await page.locator('[data-bind-aspect]').count()) >= 1, 'the layer inspector offers bindings')

  // instance of Variant 2
  await v2.click({ position: { x: 5, y: box.height - 4 }, force: true })
  await page.getByRole('button', { name: 'Create instance' }).click()
  await page.waitForTimeout(600)
  await shot('instance-placed')
  check((await page.locator('.insp-prop__row').count()) === 3, `the instance shows a control per property (${await page.locator('.insp-prop__row').count()}: variant, boolean, text)`)
  c = await canvas()
  const icons0 = c.icons

  // flip the boolean: the instance's icon disappears
  await page.locator('.insp-prop__row[data-prop-type="boolean"] [role=checkbox]').click()
  await page.waitForTimeout(400)
  await shot('show-icon-off')
  c = await canvas()
  check(c.icons === icons0 - 1, `Show icon off hides the instance's icon (${icons0} -> ${c.icons})`)

  // text property
  const label = page.locator('.insp-prop__row[data-prop-type="text"] input')
  await label.fill('Go')
  await label.press('Enter')
  await page.waitForTimeout(400)
  await shot('label-go')
  c = await canvas()
  check(c.texts.filter((t) => t === 'Go').length === 1, `the Label text reaches the instance (${c.texts.join(', ')})`)

  // an override on the instance's icon (opacity) is carried over by a variant switch
  await page.evaluate(() => document.activeElement?.blur())
  await page.locator('.insp-prop__row[data-prop-type="boolean"] [role=checkbox]').click() // icon back on
  await page.waitForTimeout(300)
  // an override on the instance root (red fill) must survive the switch
  const inst = page.locator('[data-node-id]:has(> [data-node-id]:text-is("Go"))').first()
  const ib = await inst.boundingBox()
  await page.keyboard.press('Escape')
  await page.mouse.click(ib.x + 6, ib.y + ib.height - 5)
  await page.waitForTimeout(300)
  const fill = page.locator('input[value="FFFFFF"]').first()
  await fill.fill('FF0000')
  await fill.press('Enter')
  await blur()
  await page.waitForTimeout(400)
  const reds = () => page.evaluate(() => [...document.querySelectorAll('[data-node-id]')].filter((e) => getComputedStyle(e).backgroundColor === 'rgb(255, 0, 0)').length)
  check((await reds()) === 1, `an override: the instance has a red fill (${await reds()} red frame)`)
  const variantRow = '.insp-prop__row[data-prop-type="variant"]'
  const before = await page.locator('[data-variant]').first().textContent()
  await pick(variantRow, 'Default')
  await shot('switched-to-default')
  const after = await page.locator('[data-variant]').first().textContent()
  check(before === 'Variant=Variant 2' && after === 'Variant=Default', `variant switch re-points the instance (${before} -> ${after})`)
  check((await reds()) === 1, `the override is carried over by the switch (${await reds()} red frame)`)

  // one undo reverts the switch
  await blur()
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(500)
  await shot('after-undo-switch')
  const undone = await page.locator('[data-variant]').first().textContent()
  check(undone === 'Variant=Variant 2', `one undo reverts the switch (${undone})`)

  // delete a property: its controls and bindings go
  await page.locator('[data-component-set] > [data-node-id]').last().click({ position: { x: 5, y: box.height - 4 }, force: true })
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'Delete Show icon' }).click()
  await page.waitForTimeout(400)
  await shot('property-deleted')
  check((await page.locator('.insp-prop').count()) === 1, `deleting a property removes its row (${await page.locator('.insp-prop').count()} left)`)
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
