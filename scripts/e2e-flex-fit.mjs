// Drives the built app (npm run build first): new flex frames start at Fit height.
//  A) Shift+A on a text wraps it in a flex frame that hugs it; font 16 -> 48 grows the frame; undo restores.
//  B) Shift+A on a fixed-size frame with a text inside: height becomes Fit (shrinks to the text), width stays;
//     font 16 -> 48 grows it; one undo restores the fixed size.
// Usage: node scripts/e2e-flex-fit.mjs <out-dir>. Needs `npm i -D playwright`.
import { _electron as electron } from 'playwright'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = process.argv[2] ?? '.muster-evidence/e2e-flex'
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
/** the text leaf, the nearest frame around it (the flex frame in A), and that frame's computed height/width/display */
const read = (word) =>
  page.evaluate((w) => {
    const leaf = [...document.querySelectorAll('[data-node-id]')].find((e) => e.children.length === 0 && e.textContent === w)
    const frame = leaf?.parentElement?.closest('[data-node-id]')
    const r = frame?.getBoundingClientRect()
    const t = leaf?.getBoundingClientRect()
    return { text: t ? Math.round(t.height) : null, frameH: r ? Math.round(r.height) : null, frameW: r ? Math.round(r.width) : null, display: frame ? getComputedStyle(frame).display : null }
  }, word)
const setFontSize = async (v) => {
  const size = page.locator('[title="Font size"] input')
  await size.fill(String(v))
  await size.press('Enter')
  await page.evaluate(() => document.activeElement?.blur())
  await page.waitForTimeout(400)
}
const ctrlClickText = async (word) => {
  await page.locator('[data-node-id]', { hasText: new RegExp(`^${word}$`) }).last().click({ force: true, modifiers: ['Control'] })
  await page.waitForTimeout(300)
}
const draw = async (key, x1, y1, x2, y2) => {
  await page.keyboard.press(key)
  await page.mouse.move(x1, y1)
  await page.mouse.down()
  await page.mouse.move(x2, y2, { steps: 6 })
  await page.mouse.up()
}
try {
  await page.waitForTimeout(2500)
  await page.locator('input:not([type=file])').first().fill('Tester')
  await page.getByRole('button', { name: 'Create profile' }).click()
  await page.waitForTimeout(2000)
  await page.getByText('Scratchpad').first().dblclick()
  await page.waitForTimeout(2500)

  // ---- A: Shift+A on a text -------------------------------------------------------------------------
  await draw('f', 330, 150, 560, 330) // a fixed artboard 230x180
  await page.keyboard.press('t')
  await page.mouse.click(360, 190)
  await page.keyboard.type('Alpha')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  await shot('A-before-wrap')
  await page.keyboard.press('Shift+A')
  await page.waitForTimeout(500)
  const a1 = await read('Alpha')
  await shot('A-wrapped')
  check(a1.display === 'flex', `Shift+A on a text makes a flex frame (${a1.display})`)
  check(a1.frameH !== null && a1.frameH <= a1.text + 2, `the wrapper hugs the text: frame ${a1.frameH}px, text ${a1.text}px`)
  await ctrlClickText('Alpha')
  await setFontSize(48)
  const a2 = await read('Alpha')
  await shot('A-font-48')
  check(a2.frameH > a1.frameH && a2.frameH === a2.text, `font 16 -> 48: the wrapper grows with the text (${a1.frameH} -> ${a2.frameH})`)
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(400)
  const a3 = await read('Alpha')
  check(a3.frameH === a1.frameH, `one undo takes the font size back and the frame with it (${a3.frameH})`)

  // ---- B: Shift+A on a fixed frame with a text inside ---------------------------------------------------
  await page.keyboard.press('Escape')
  await draw('f', 620, 150, 960, 490) // a fixed 340x340 artboard
  await page.keyboard.press('t')
  await page.mouse.click(650, 190)
  await page.keyboard.type('Beta')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.mouse.click(930, 470) // empty corner of the artboard selects the frame
  await page.waitForTimeout(300)
  const b0 = await read('Beta')
  await shot('B-fixed-frame')
  check(b0.frameH >= 330, `the frame starts fixed (${b0.frameW}x${b0.frameH})`)
  await page.keyboard.press('Shift+A')
  await page.waitForTimeout(500)
  const b1 = await read('Beta')
  await shot('B-add-flex')
  check(b1.display === 'flex', `Shift+A on a frame adds flex (${b1.display})`)
  check(b1.frameH < b0.frameH && b1.frameH <= b1.text + 40, `height is now Fit: ${b0.frameH} -> ${b1.frameH}px around a ${b1.text}px text (+ padding)`)
  check(b1.frameW === b0.frameW, `width stays (${b0.frameW} -> ${b1.frameW})`)
  await ctrlClickText('Beta')
  await setFontSize(48)
  const b2 = await read('Beta')
  await shot('B-font-48')
  check(b2.frameH > b1.frameH, `font 16 -> 48: the frame grows (${b1.frameH} -> ${b2.frameH})`)
  await page.keyboard.press('Control+z') // font size
  await page.waitForTimeout(300)
  await page.keyboard.press('Control+z') // add flex
  await page.waitForTimeout(500)
  const b3 = await read('Beta')
  await shot('B-undo-add-flex')
  check(b3.frameH === b0.frameH && b3.display !== 'flex', `undo restores the fixed size (${b3.frameH}) and removes flex (${b3.display})`)
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
