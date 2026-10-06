// Drives the built app (npm run build first) through a crash (T45): edit, kill the app (taskkill /F) before the save
// flushes, restart, get the prompt "Unsaved changes found" (body: "...Restore them?"), restore and find the edit back; then corrupt the saved file and
// start again: it opens from its .bak with a note.
// Usage: node scripts/e2e-crash.mjs <out-dir>. Needs `npm i -D playwright`. Windows (taskkill) or any OS with `kill -9`.
import { _electron as electron } from 'playwright'
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = process.argv[2] ?? '.muster-evidence/e2e-crash'
mkdirSync(out, { recursive: true })
const ud = mkdtempSync(join(tmpdir(), 'vellum-e2e-crash-'))
const results = []
let n = 0
const check = (ok, label) => {
  results.push(`${ok ? 'passed' : 'FAILED'}: ${label}`)
  if (process.env.E2E_VERBOSE) console.log(results[results.length - 1])
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const launch = () => electron.launch({ args: ['out/main/index.js'], env: { ...process.env, VELLUM_USER_DATA: ud } })
const shot = async (page, name) => {
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(out, `${String(++n).padStart(2, '0')}-${name}.png`) })
}
const profileFiles = () => {
  const root = join(ud, 'profiles')
  const id = readdirSync(root).find((d) => existsSync(join(root, d, 'files')))
  return join(root, id, 'files')
}
/** the Scratchpad's file: the .json that mentions "Scratchpad" */
const scratchFile = () => {
  const dir = profileFiles()
  const f = readdirSync(dir).filter((x) => x.endsWith('.json')).find((x) => readFileSync(join(dir, x), 'utf8').includes('"scratchpad":true'))
  return join(dir, f)
}
const frameCount = (path) => Object.values(JSON.parse(readFileSync(path, 'utf8')).nodes).filter((n) => n.type === 'frame' && n.parent && !n.name.startsWith('Page')).length
const framesOnCanvas = (page) => page.evaluate(() => [...document.querySelectorAll('[data-canvas-world] [data-node-id]')].length)
/**
 * Every process of the app that uses this data folder (main + children), found while it is idle: the pid the test
 * driver reports is a launcher, so killing it alone can leave the real main process running (and saving).
 */
const processesOf = (app) => {
  const pids = new Set([app.process().pid])
  if (process.platform !== 'win32') return [...pids]
  const ps = "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'electron.exe' -and $_.CommandLine -like '*" + ud + "*' } | ForEach-Object { $_.ProcessId; $_.ParentProcessId }"
  try {
    const text = execSync('powershell -NoProfile -Command "' + ps.split('"').join('\\"') + '"', { encoding: 'utf8' })
    for (const l of text.split(/\s+/)) if (/^\d+$/.test(l)) pids.add(Number(l))
  } catch {
    /* fall back to the launcher pid */
  }
  return [...pids]
}
/** end the app the hard way (taskkill /F: no shutdown code runs, like a crash or power loss) */
const kill = (pids) => {
  if (process.platform === 'win32') execSync('taskkill /F ' + pids.map((p) => '/PID ' + p).join(' '), { stdio: 'ignore' })
  else for (const p of pids) process.kill(p, 'SIGKILL')
}
/** close the app the normal way, and make sure nothing is left holding the data folder */
const closeApp = async (app) => {
  await Promise.race([app.close().catch(() => undefined), wait(8000)])
  try {
    kill(processesOf(app))
  } catch {
    /* already gone */
  }
  await wait(500)
}
const drawFrame = async (page, x1, y1, x2, y2) => {
  await page.keyboard.press('f')
  await page.mouse.move(x1, y1)
  await page.mouse.down()
  await page.mouse.move(x2, y2, { steps: 5 })
  await page.mouse.up()
}
const openScratchpad = async (page) => {
  await page.getByText('Scratchpad').first().dblclick()
  await page.waitForTimeout(2500)
}
try {
  // ---- run A: two edits, the second killed before it is saved
  let app = await launch()
  let page = await app.firstWindow()
  page.setDefaultTimeout(8000)
  await page.waitForTimeout(2500)
  await page.locator('input:not([type=file])').first().fill('Tester')
  await page.getByRole('button', { name: 'Create profile' }).click()
  await page.waitForTimeout(2000)
  await openScratchpad(page)
  await drawFrame(page, 330, 150, 500, 280)
  await page.waitForTimeout(1500) // saved
  const savedOnce = frameCount(scratchFile())
  check(savedOnce === 1, `first edit is on disk (${savedOnce} frame)`)
  const pids = processesOf(app) // looked up while idle: the kill itself must be instant
  void page.keyboard.press('Control+d') // duplicate the frame: a quick, single edit (the new frame is selected)
  // the recovery copy lands ~150 ms after the edit, the save only after ~500 ms: kill the moment the copy is on disk
  const sawRecovery = async () => {
    for (let i = 0; i < 300; i++) {
      if (readdirSync(profileFiles()).some((x) => x.endsWith('.recovery'))) return true
      await wait(5)
    }
    return false
  }
  check(await sawRecovery(), 'a recovery copy appears within ~150 ms of the edit, before the save')
  kill(pids)
  await wait(800)
  const dir = profileFiles()
  const recFiles = readdirSync(dir).filter((x) => x.endsWith('.recovery'))
  check(recFiles.length === 1, `a recovery copy was left by the crash (${recFiles.join(', ') || 'none'})`)
  check(frameCount(scratchFile()) === 1, 'the saved file still has only the first edit')
  check(recFiles.length === 1 && frameCount(join(dir, recFiles[0])) === 2, 'the recovery copy has both edits')

  // ---- run B: restart, the prompt, restore
  app = await launch()
  page = await app.firstWindow()
  page.setDefaultTimeout(8000)
  await page.waitForTimeout(3500)
  const prompt = await page.locator('[data-recovery-prompt]').textContent().catch(() => null)
  await shot(page, 'restore-prompt')
  check(Boolean(prompt) && prompt.includes('last changes to Scratchpad were saved. Restore them?'), `the restore prompt appears (${prompt})`)
  await page.locator('[data-recovery="restore"]').click()
  await page.waitForTimeout(500)
  await openScratchpad(page)
  const restoredOnCanvas = await framesOnCanvas(page)
  await shot(page, 'restored')
  check(restoredOnCanvas >= 2, `both frames are back on the canvas (${restoredOnCanvas} nodes)`)
  await page.waitForTimeout(1200)
  check(readdirSync(dir).filter((x) => x.endsWith('.recovery')).length === 0, 'the save after the restore deleted the recovery copy')
  check(frameCount(scratchFile()) === 2, 'and the restored edit is in the saved file')
  await closeApp(app)
  await wait(500)

  // ---- run C: a normal restart offers nothing
  app = await launch()
  page = await app.firstWindow()
  page.setDefaultTimeout(8000)
  await page.waitForTimeout(3000)
  check((await page.locator('[data-recovery-prompt]').count()) === 0, 'a clean restart shows no prompt')
  await closeApp(app)
  await wait(500)

  // ---- run D: a damaged file falls back to its .bak
  const f = scratchFile()
  check(existsSync(`${f}.bak`), 'the file has a .bak copy')
  writeFileSync(f, readFileSync(f).subarray(0, 40)) // what a half-written file looks like
  app = await launch()
  page = await app.firstWindow()
  page.setDefaultTimeout(8000)
  await page.waitForTimeout(3500)
  const note = await page.locator('[data-recovery-notice]').first().textContent().catch(() => null)
  await shot(page, 'restored-from-backup-note')
  check(Boolean(note) && note.includes('restored from its last backup'), `a damaged file opens from its backup with a note (${note})`)
  await page.locator('[data-recovery="ok"]').click()
  await openScratchpad(page)
  const fromBak = await framesOnCanvas(page)
  await shot(page, 'opened-from-backup')
  check(fromBak >= 1, `the design opens with the backup's content (${fromBak} nodes)`)
  await page.waitForTimeout(1200)
  check(frameCount(f) >= 1, 'and the next save wrote a healthy file again')
  await closeApp(app)
} catch (e) {
  results.push(`FAILED: script error: ${String(e.stack).split('\n').slice(0, 4).join(' | ')}`)
} finally {
  console.log(results.join('\n'))
  try {
    rmSync(ud, { recursive: true, force: true })
  } catch {
    /* temp dir may still be locked */
  }
  process.exit(0)
}
