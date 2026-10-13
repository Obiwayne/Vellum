// Screenshots of the inspector's Screen section (Name field) and the Layout section's Min / Max fields for a
// top-level frame, to check the spacing between caption and value. Drives the built app (npm run build first).
// Usage: node scripts/e2e-inspector-captions.mjs <out-dir> <prefix>   e.g. before / after.
// The app runs with a temporary VELLUM_USER_DATA, never the real profile folder.
import { _electron as electron } from 'playwright'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = process.argv[2] ?? '.muster-evidence/e2e'
const prefix = process.argv[3] ?? 'shot'
mkdirSync(out, { recursive: true })
const ud = mkdtempSync(join(tmpdir(), 'vellum-e2e-'))
const app = await electron.launch({ args: ['out/main/index.js'], env: { ...process.env, VELLUM_USER_DATA: ud } })
const page = await app.firstWindow()
const results = []
const check = (ok, label) => results.push(`${ok ? 'passed' : 'FAILED'}: ${label}`)

/** gap in px between a caption element's right edge and the input that follows it */
const gapOf = (captionText) =>
  page.evaluate((text) => {
    // the innermost caption element: a label that wraps a caption span is measured through the span
    const caps = [...document.querySelectorAll('.c-field__label, .insp-scr__flabel, .insp-limit__label')].filter((e) => e.textContent?.trim() === text && !e.querySelector('.insp-limit__label'))
    const out = []
    for (const cap of caps) {
      const holder = cap.closest('.c-field') ?? cap.parentElement
      const input = holder?.querySelector('input')
      if (!input) continue
      const a = cap.getBoundingClientRect()
      const b = input.getBoundingClientRect()
      const styles = getComputedStyle(input)
      // the text starts after the input's left padding
      out.push(Math.round((b.left + parseFloat(styles.paddingLeft) - a.right) * 10) / 10)
    }
    return out
  }, captionText)

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
  await page.mouse.move(700, 380, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(500)

  // tag the frame so the Name field has a value, as in the report ("NameHome")
  const name = page.getByPlaceholder('Frame').first()
  await name.fill('Home')
  await name.press('Enter')
  await page.waitForTimeout(400)
  await page.evaluate(() => document.querySelector('[data-testid="screen-section"]')?.scrollIntoView({ block: 'center' }))
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(out, `${prefix}-screen-section.png`), clip: { x: 1160, y: 40, width: 280, height: 860 } })
  const limits = page.locator('[data-testid="size-limits"]')
  await limits.scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(out, `${prefix}-min-max.png`), clip: { x: 1160, y: 40, width: 280, height: 860 } })

  const nameGap = await gapOf('Name')
  const minGap = await gapOf('Min W')
  const maxGap = await gapOf('Max H')
  results.push(`gap between caption and value text: Name ${JSON.stringify(nameGap)}, Min W ${JSON.stringify(minGap)}, Max H ${JSON.stringify(maxGap)}`)
  check(nameGap.length > 0 && nameGap.every((g) => g >= 4), 'Name caption is at least 4px from the value')
  check(minGap.length > 0 && minGap.every((g) => g >= 4), 'Min W caption is at least 4px from the value')
  check(maxGap.length > 0 && maxGap.every((g) => g >= 4), 'Max H caption is at least 4px from the value')
} catch (e) {
  results.push(`FAILED: script error: ${String(e.message).slice(0, 300)}`)
} finally {
  console.log(results.join('\n'))
  await Promise.race([app.close().catch(() => undefined), new Promise((r) => setTimeout(r, 5000))])
  process.exit(results.some((r) => r.startsWith('FAILED')) ? 1 : 0)
}
