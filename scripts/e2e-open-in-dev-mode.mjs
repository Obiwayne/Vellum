// Drives the built app (npm run build first): the dashboard file card menu's "Open in Dev Mode" opens the file straight
// into read-only Dev Mode (Dev switch on, drawing is refused), and the Learn page has the "Developer handoff and Dev
// Mode" section. Usage: node scripts/e2e-open-in-dev-mode.mjs <out-dir>.
// The app runs with a temporary VELLUM_USER_DATA, never the real data folder.
import { _electron as electron } from 'playwright'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = process.argv[2] ?? '.muster-evidence/e2e'
mkdirSync(out, { recursive: true })
const ud = mkdtempSync(join(tmpdir(), 'vellum-e2e-'))
const app = await electron.launch({ args: ['out/main/index.js'], env: { ...process.env, VELLUM_USER_DATA: ud, VELLUM_AGENT_DRIVEN: '0' } })
const page = await app.firstWindow()
const results = []
let n = 0
const shot = async (name) => {
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(out, `${String(++n).padStart(2, '0')}-${name}.png`) })
}
const check = (ok, label) => results.push(`${ok ? 'passed' : 'FAILED'}: ${label}`)
const modeIsDev = () => page.evaluate(() => !!document.querySelector('.insp-top--dev'))
const body = () => page.evaluate(() => document.body.innerText)

try {
  await page.waitForTimeout(2500)
  await page.locator('input:not([type=file])').first().fill('Tester')
  await page.getByRole('button', { name: 'Create profile' }).click()
  await page.waitForTimeout(2000)

  // the card's context menu
  await page.locator('.db-card').first().click({ button: 'right' })
  await page.waitForTimeout(300)
  await shot('file-menu-open-in-dev-mode')
  check(/Open in Dev Mode/.test(await body()), 'file menu has Open in Dev Mode')
  await page.getByText('Open in Dev Mode', { exact: true }).click()
  await page.waitForTimeout(2500)
  await shot('opened-in-dev-mode')
  check(await modeIsDev(), 'the file opened with the Dev switch on')
  // drawing is refused: no frame appears
  const before = await page.evaluate(() => document.querySelectorAll('[data-node-id]').length)
  await page.keyboard.press('f')
  await page.mouse.move(330, 150)
  await page.mouse.down()
  await page.mouse.move(600, 330, { steps: 5 })
  await page.mouse.up()
  await page.waitForTimeout(400)
  const after = await page.evaluate(() => document.querySelectorAll('[data-node-id]').length)
  check(before === after && /read-only/.test(await body()), `drawing a frame in Dev Mode adds nothing (${before} layers before, ${after} after) and the read-only toast shows`)
  await shot('edit-refused-in-dev-mode')

  // Learn page
  await page.keyboard.press('Control+Shift+D')
  await page.waitForTimeout(600)
  await page.getByText('Learn', { exact: true }).first().click()
  await page.waitForTimeout(600)
  const learn = await body()
  check(/Developer handoff and Dev Mode/.test(learn), 'Learn page has the Developer handoff and Dev Mode section')
  check(/Open in Dev Mode/.test(learn) && /Export handoff…/.test(learn) && /docs\/HANDOFF\.md/.test(learn), 'section names the menu entry, the export button and docs/HANDOFF.md')
  await page.getByText('Developer handoff and Dev Mode').scrollIntoViewIfNeeded()
  await shot('learn-developer-handoff')
} catch (e) {
  results.push(`FAILED: script error: ${String(e.message).slice(0, 300)}`)
} finally {
  console.log(results.join('\n'))
  await Promise.race([app.close().catch(() => undefined), new Promise((r) => setTimeout(r, 5000))])
  process.exit(results.some((r) => r.startsWith('FAILED')) ? 1 : 0)
}
