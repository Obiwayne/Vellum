// Starts the PACKAGED app (npm run pack first: release/win-unpacked/Vellum.exe) with a temp data folder and checks that
// it really is the packaged build and opens: app.isPackaged, the version from package.json, a profile can be created, a
// file opens, and the window shows the dashboard and the editor. Usage: node scripts/smoke-packaged.mjs [out-dir] [exe]
// Not named e2e-*.mjs on purpose: `npm run e2e` runs the dev build and must not need a packed app.
import { _electron as electron } from 'playwright'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = process.argv[2] ?? '.muster-evidence/smoke-packaged'
const exe = process.argv[3] ?? 'release/win-unpacked/Vellum.exe'
const version = JSON.parse(readFileSync('package.json', 'utf8')).version
mkdirSync(out, { recursive: true })
const results = []
const check = (ok, label) => results.push(`${ok ? 'passed' : 'FAILED'}: ${label}`)
if (!existsSync(exe)) {
  console.log(`FAILED: ${exe} not found (run npm run pack)`)
  process.exit(1)
}
const ud = mkdtempSync(join(tmpdir(), 'vellum-packaged-'))
const app = await electron.launch({ executablePath: exe, args: [], env: { ...process.env, VELLUM_USER_DATA: ud } })
let n = 0
try {
  const page = await app.firstWindow()
  page.setDefaultTimeout(10000)
  const info = await app.evaluate(({ app: a }) => ({ packaged: a.isPackaged, version: a.getVersion(), name: a.getName(), appPath: a.getAppPath() }))
  check(info.packaged === true, `app.isPackaged is true (${info.appPath})`)
  check(info.version === version, `app version ${info.version} equals package.json ${version}`)
  check(info.name === 'Vellum', `product name is ${info.name}`)
  await page.waitForTimeout(2500)
  await page.locator('input:not([type=file])').first().fill('Tester')
  await page.getByRole('button', { name: 'Create profile' }).click()
  await page.waitForTimeout(2000)
  await page.screenshot({ path: join(out, `${String(++n).padStart(2, '0')}-dashboard.png`) })
  check((await page.getByText('Scratchpad').count()) > 0, 'the dashboard shows the Scratchpad file')
  await page.getByText('Scratchpad').first().dblclick()
  await page.waitForTimeout(2500)
  await page.keyboard.press('f')
  await page.mouse.move(330, 150)
  await page.mouse.down()
  await page.mouse.move(700, 330, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(out, `${String(++n).padStart(2, '0')}-editor.png`) })
  check((await page.locator('[data-node-id]').count()) >= 1, 'the editor draws a frame (renderer, fonts and canvas work in the packaged app)')
  const fonts = await page.evaluate(() => document.fonts.check('12px Inter'))
  check(fonts === true, 'the bundled Inter font is available')
  const bridge = await page.evaluate(async () => (await window.canvasApi?.bridgePort?.()) ?? null)
  check(typeof bridge === 'number' && bridge > 0, `the MCP bridge port is open (${bridge})`)
} catch (e) {
  results.push(`FAILED: script error: ${String(e.message).slice(0, 200)}`)
} finally {
  console.log(results.join('\n'))
  await Promise.race([app.close(), new Promise((r) => setTimeout(r, 8000))])
  try {
    rmSync(ud, { recursive: true, force: true })
  } catch {
    /* temp dir may still be locked */
  }
  process.exit(results.some((r) => r.startsWith('FAILED')) ? 1 : 0)
}
