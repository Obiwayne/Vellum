// Drives the built app (npm run build first): a text layer inside a Fit-height flex frame, font size
// 16 -> 48 in the inspector, measuring the frame, the text and the size badge before, after and
// after one undo. Usage: node scripts/e2e-fit-grow.mjs <out-dir>. Needs `npm i -D playwright`.
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
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(out, `${String(++n).padStart(2, '0')}-${name}.png`) })
}
// sizes of the text layer and the flex frame around it, and the selection badge text
const read = () =>
  page.evaluate(() => {
    const els = [...document.querySelectorAll('[data-node-id]')].map((el) => {
      const r = el.getBoundingClientRect()
      const leaf = el.children.length === 0 && el.textContent === 'Hello'
      return { leaf, flex: getComputedStyle(el).display === 'flex', h: Math.round(r.height), w: Math.round(r.width) }
    })
    return { text: els.find((e) => e.leaf), flex: els.find((e) => e.flex), badge: document.querySelector('.cv-badge')?.textContent ?? null }
  })
const log = (label, v) => results.push(`${label}: text ${v.text?.w}x${v.text?.h}, flex frame ${v.flex?.w}x${v.flex?.h}, badge ${v.badge}`)
try {
  await page.waitForTimeout(2500)
  await page.locator('input:not([type=file])').first().fill('Tester')
  await page.getByRole('button', { name: 'Create profile' }).click()
  await page.waitForTimeout(2000)
  await page.getByText('Scratchpad').first().dblclick()
  await page.waitForTimeout(2500)

  await page.keyboard.press('f')
  await page.mouse.move(330, 150)
  await page.mouse.down()
  await page.mouse.move(900, 600, { steps: 6 })
  await page.mouse.up()
  await page.keyboard.press('t')
  await page.mouse.click(420, 230)
  await page.keyboard.type('Hello')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  await page.keyboard.press('Shift+A') // wrap the selected text in a flex frame (Fit height)
  await page.waitForTimeout(500)
  // select the text layer itself (Ctrl+click picks the deepest layer)
  await page.locator('[data-node-id]', { hasText: /^Hello$/ }).last().click({ force: true, modifiers: ['Control'] })
  await page.waitForTimeout(300)
  await shot('before-16')
  const before = await read()
  log('before', before)
  // one change from the inspector's Font size field (a single undo step)
  const size = page.locator('[title="Font size"] input')
  await size.fill('48')
  await size.press('Enter')
  await page.waitForTimeout(400)
  await shot('after-48')
  const after = await read()
  log('after 16 -> 48', after)
  results.push(`${after.flex && before.flex && after.flex.h > before.flex.h ? 'passed' : 'FAILED'}: frame grew (${before.flex?.h} -> ${after.flex?.h})`)
  results.push(`${after.text && before.text && after.text.h > before.text.h ? 'passed' : 'FAILED'}: text grew (${before.text?.h} -> ${after.text?.h})`)
  await page.evaluate(() => document.activeElement?.blur()) // so Ctrl+Z reaches the editor, not the input
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(400)
  await shot('after-undo')
  const undone = await read()
  log('after one undo', undone)
  results.push(`${undone.flex?.h === before.flex?.h && undone.text?.h === before.text?.h ? 'passed' : 'FAILED'}: one undo restores the sizes`)
  // line-height field: the Fit frame follows, the fixed artboard around it does not
  const artboard = () =>
    page.evaluate(() => Math.max(...[...document.querySelectorAll('[data-node-id]')].map((el) => Math.round(el.getBoundingClientRect().height))))
  const artH = await artboard()
  await page.locator('[data-node-id]', { hasText: /^Hello$/ }).last().click({ force: true, modifiers: ['Control'] })
  const lh = page.locator('[title="Line height"] input')
  await lh.fill('80')
  await lh.press('Enter')
  await page.waitForTimeout(400)
  await shot('after-line-height-80')
  const lhRead = await read()
  log('line height 80', lhRead)
  results.push(`${lhRead.flex?.h === 80 ? 'passed' : 'FAILED'}: Fit frame follows the line-height field (${lhRead.flex?.h})`)
  results.push(`${(await artboard()) === artH ? 'passed' : 'FAILED'}: fixed artboard stays fixed (${artH})`)
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
