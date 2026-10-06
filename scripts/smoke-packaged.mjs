// Starts the PACKAGED app (npm run pack first: release/win-unpacked/Vellum.exe) with a temp data folder and checks that
// it really is the packaged build and opens: app.isPackaged, the version from package.json, a profile can be created, a
// file opens, and the window shows the dashboard and the editor. Usage: node scripts/smoke-packaged.mjs [out-dir] [exe]
// Not named e2e-*.mjs on purpose: `npm run e2e` runs the dev build and must not need a packed app.
import { _electron as electron } from 'playwright'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

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
const app = await electron.launch({ executablePath: exe, args: [], env: { ...process.env, VELLUM_USER_DATA: ud, VELLUM_UPDATE_URL: 'http://127.0.0.1:65000/feed' } }) // an update feed nobody listens on
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
  // The installed build runs electron-updater (never git or npm): against a feed nobody listens on its check ends as an error from
  // the network, not "unsupported" (that is what a build without electron-updater in app.asar used to say).
  const upd = await page.evaluate(async () => {
    const s = await window.canvasApi.updates.check()
    return { state: s.state, message: s.message ?? '', commits: s.commits.length, behind: s.behind }
  })
  check(upd.state === 'error' && !/could not be loaded|installer/i.test(upd.message) && upd.commits === 0 && upd.behind === 0, `the update engine is running: a check against an unreachable feed is a network error, not "unsupported" (${JSON.stringify(upd)})`)
  try {
    const asar = await import('@electron/asar')
    const inside = asar.listPackage(join(dirname(exe), 'resources', 'app.asar')).filter((f) => /node_modules[\\/]electron-updater[\\/]package\.json$/.test(f))
    check(inside.length === 1, 'electron-updater is packed into app.asar')
  } catch (e) {
    results.push(`skipped: could not read app.asar (${String(e.message).slice(0, 80)})`)
  }
  // work is saved inside the temp data folder
  await page.waitForTimeout(2500) // autosave debounce
  const files = []
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else files.push(p)
    }
  }
  walk(ud)
  const saved = files.filter((f) => /files[\\/].+\.json$/.test(f) || /profiles[\\/].+\.json$/.test(f))
  check(saved.length >= 1, `the file was saved under the temp data dir (${files.length} files, e.g. ${saved[0] ? saved[0].slice(ud.length + 1) : 'none'})`)
  const withFrame = saved.some((f) => readFileSync(f, 'utf8').includes('"type":"frame"') || readFileSync(f, 'utf8').includes('"type": "frame"'))
  check(withFrame, 'the saved file contains the frame that was drawn')
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
