// Drives the built app (npm run build first) through components: make a component, place an instance,
// change the main's fill, override the instance's text, edit the main again, detach, undo, and a
// refused structural edit (toast). Saves a screenshot per step and checks the DOM.
// Usage: node scripts/e2e-components.mjs <out-dir>. Needs `npm i -D playwright`.
// NOTE: written without being run (agents here may not drive the app); selectors for the inspector
// fill field are best effort, everything else uses layer rows and the Components list.
import { _electron as electron } from 'playwright'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = process.argv[2] ?? '.muster-evidence/e2e-components'
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
const expectThat = (ok, label, detail = '') => results.push(`${ok ? 'passed' : 'FAILED'}: ${label}${detail ? ` (${detail})` : ''}`)

const marks = () => page.locator('.lp-layer--component').count()
/** background colours and text of every canvas node that shows "Hello"/"Mine" or is a frame with a fill */
const canvas = () =>
  page.evaluate(() => {
    const els = [...document.querySelectorAll('[data-node-id]')]
    const texts = els.filter((el) => el.children.length === 0 && /^(Hello|Mine)$/.test(el.textContent ?? '')).map((el) => el.textContent)
    const fills = els.map((el) => getComputedStyle(el).backgroundColor).filter((c) => c !== 'rgba(0, 0, 0, 0)')
    return { texts, fills }
  })
const setFill = async (hex) => {
  // best effort: the first text input in the Fill section holds the hex value
  const input = page.locator('section:has-text("Fill") input').first()
  await input.fill(hex)
  await input.press('Enter')
  await page.evaluate(() => document.activeElement?.blur())
  await page.waitForTimeout(300)
}
const toastText = () => page.locator('.cv-toast--show').first().textContent({ timeout: 1500 }).catch(() => null)

try {
  await page.waitForTimeout(2500)
  await page.locator('input:not([type=file])').first().fill('Tester')
  await page.getByRole('button', { name: 'Create profile' }).click()
  await page.waitForTimeout(2000)
  await page.getByText('Scratchpad').first().dblclick()
  await page.waitForTimeout(2500)

  // 1. a frame holding a text layer
  await page.keyboard.press('f')
  await page.mouse.move(330, 150)
  await page.mouse.down()
  await page.mouse.move(600, 330, { steps: 6 })
  await page.mouse.up()
  await page.keyboard.press('t')
  await page.mouse.click(360, 190)
  await page.keyboard.type('Hello')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  await page.mouse.click(560, 300) // empty part of the frame selects it
  await shot('01-frame-with-text')
  expectThat((await marks()) === 0, 'no component yet')

  // 2. make it a component
  await page.keyboard.press('Control+Alt+k')
  await shot('02-component-created')
  expectThat((await marks()) === 1, 'Ctrl+Alt+K marks one layer as a component', `marks ${await marks()}`)
  expectThat((await page.locator('.lp-component').count()) === 1, 'the Components list shows it')

  // 3. place an instance from the Components list
  await page.locator('.lp-component').first().click()
  await page.waitForTimeout(400)
  await shot('03-instance-placed')
  let c = await canvas()
  expectThat((await marks()) === 2, 'an instance layer appears', `marks ${await marks()}`)
  expectThat(c.texts.filter((t) => t === 'Hello').length === 2, 'the instance shows the main text', JSON.stringify(c.texts))
  expectThat((await page.locator('text=Instance').count()) > 0, 'the inspector shows the Instance section')

  // 4. change the main's fill: the instance follows
  await page.locator('.lp-layer--component').nth(0).click()
  await setFill('#ff0000')
  await shot('04-main-fill-red')
  c = await canvas()
  expectThat(c.fills.filter((f) => f === 'rgb(255, 0, 0)').length === 2, 'main and instance are both red', JSON.stringify(c.fills))

  // 5. override the instance's text
  await page.keyboard.press('Escape')
  await page.locator('[data-node-id]', { hasText: /^Hello$/ }).last().dblclick({ force: true })
  await page.keyboard.press('Control+a')
  await page.keyboard.type('Mine')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await shot('05-instance-text-override')
  c = await canvas()
  expectThat(c.texts.includes('Hello') && c.texts.includes('Mine'), 'main keeps Hello, instance shows Mine', JSON.stringify(c.texts))

  // 6. edit the main again: the override survives
  await page.locator('.lp-layer--component').nth(0).click()
  await setFill('#0000ff')
  await shot('06-main-fill-blue')
  c = await canvas()
  expectThat(c.fills.filter((f) => f === 'rgb(0, 0, 255)').length === 2, 'both follow the new fill', JSON.stringify(c.fills))
  expectThat(c.texts.includes('Mine'), 'the instance text override survived the main edit', JSON.stringify(c.texts))

  // 7. detach the instance, then undo it
  await page.locator('.lp-layer--component').nth(1).click()
  await page.keyboard.press('Control+Alt+b')
  await shot('07-detached')
  expectThat((await marks()) === 1, 'Ctrl+Alt+B detaches: only the main is marked', `marks ${await marks()}`)
  await page.evaluate(() => document.activeElement?.blur())
  await page.keyboard.press('Control+z')
  await shot('08-detach-undone')
  expectThat((await marks()) === 2, 'one undo re-links the instance', `marks ${await marks()}`)

  // 8. a structural edit inside the instance is refused with a toast
  await page.locator('[data-node-id]', { hasText: /^Mine$/ }).last().click({ force: true, modifiers: ['Control'] })
  await page.keyboard.press('Delete')
  await page.waitForTimeout(300)
  await shot('09-structure-refused-toast')
  const toast = await toastText()
  expectThat(toast === 'Detach instance to change structure', 'deleting a layer inside an instance shows the toast', String(toast))
  c = await canvas()
  expectThat(c.texts.includes('Mine'), 'the layer was not deleted', JSON.stringify(c.texts))
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
