// More crash cases in the built app (T45 test station): a password-protected profile (the recovery copy is encrypted on
// disk, Discard keeps the saved file, Restore brings the edit back), a half-written .tmp left by a crash, a clean close
// leaving no .recovery behind, and two designs with unsaved changes both being offered.
// Usage: node scripts/e2e-crash-more.mjs <out-dir>. Needs `npm i -D playwright`.
import { _electron as electron } from 'playwright'
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = process.argv[2] ?? '.muster-evidence/e2e-crash-more'
mkdirSync(out, { recursive: true })
const results = []
let n = 0
const check = (ok, label) => {
  results.push(`${ok ? 'passed' : 'FAILED'}: ${label}`)
  if (process.env.E2E_VERBOSE) console.log(results[results.length - 1])
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const dirs = []
const newDir = () => {
  const d = mkdtempSync(join(tmpdir(), 'vellum-e2e-crash2-'))
  dirs.push(d)
  return d
}
const launch = (ud) => electron.launch({ args: ['out/main/index.js'], env: { ...process.env, VELLUM_USER_DATA: ud } })
const shot = async (page, name) => {
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(out, `${String(++n).padStart(2, '0')}-${name}.png`) })
}
const filesDir = (ud) => {
  const root = join(ud, 'profiles')
  const id = readdirSync(root).find((d) => existsSync(join(root, d, 'files')))
  return join(root, id, 'files')
}
const names = (ud, ext) => readdirSync(filesDir(ud)).filter((x) => x.endsWith(ext))
/** every process of the app that uses this data folder, found while it is idle (the driver's pid is only a launcher) */
const processesOf = (app, ud) => {
  const pids = new Set([app.process().pid])
  if (process.platform !== 'win32') return [...pids]
  const ps = "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'electron.exe' -and $_.CommandLine -like '*" + ud + "*' } | ForEach-Object { $_.ProcessId; $_.ParentProcessId }"
  try {
    const text = execSync('powershell -NoProfile -Command "' + ps.split('"').join('\\"') + '"', { encoding: 'utf8' })
    for (const l of text.split(/\s+/)) if (/^\d+$/.test(l)) pids.add(Number(l))
  } catch {
    /* launcher pid only */
  }
  return [...pids]
}
const kill = (pids) => {
  if (process.platform === 'win32') execSync('taskkill /F ' + pids.map((p) => '/PID ' + p).join(' '), { stdio: 'ignore' })
  else for (const p of pids) process.kill(p, 'SIGKILL')
}
const closeApp = async (app, ud) => {
  await Promise.race([app.close().catch(() => undefined), wait(8000)])
  try {
    kill(processesOf(app, ud))
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
const nodesOnCanvas = (page) => page.evaluate(() => document.querySelectorAll('[data-canvas-world] [data-node-id]').length)
const openScratchpad = async (page) => {
  await page.getByText('Scratchpad').first().dblclick()
  await page.waitForTimeout(2500)
}
/** edit with Ctrl+D, then kill the app the moment the recovery copy is on disk (before the 500 ms save) */
const crashAfterEdit = async (page, app, ud) => {
  const pids = processesOf(app, ud)
  const before = names(ud, '.recovery').length
  void page.keyboard.press('Control+d')
  let seen = false
  for (let i = 0; i < 300 && !seen; i++) {
    seen = names(ud, '.recovery').length > before
    if (!seen) await wait(5)
  }
  kill(pids)
  await wait(800)
  return seen
}
const unlock = async (page, pw) => {
  await page.getByText('Tester', { exact: true }).first().click().catch(() => undefined) // the profile card, when the picker lists it
  await page.waitForTimeout(500)
  await page.getByPlaceholder('Password').fill(pw)
  await page.getByRole('button', { name: 'Unlock' }).click()
  await page.waitForTimeout(3500)
}
const PW = 'e2e crash pw 1'
try {
  // ---------------------------------------------------------------- A: password-protected profile
  {
    const ud = newDir()
    let app = await launch(ud)
    let page = await app.firstWindow()
    page.setDefaultTimeout(8000)
    await page.waitForTimeout(2500)
    await page.getByPlaceholder('Your name').fill('Tester')
    await page.getByPlaceholder('No password').fill(PW)
    await page.getByPlaceholder('Confirm password').fill(PW)
    await page.getByRole('button', { name: 'Create profile' }).click()
    await page.waitForTimeout(3000)
    await page.getByRole('checkbox').click()
    await page.getByRole('button', { name: 'Open Vellum' }).click()
    await page.waitForTimeout(2500)
    await openScratchpad(page)
    await drawFrame(page, 330, 150, 500, 280)
    await page.waitForTimeout(1500)
    const saw = await crashAfterEdit(page, app, ud)
    check(saw, 'protected profile: a recovery copy appears before the save')
    const rec = names(ud, '.recovery')
    check(rec.length === 1, `protected profile: the crash leaves one recovery copy (${rec.join(', ')})`)
    const bytes = readFileSync(join(filesDir(ud), rec[0]))
    check(bytes.subarray(0, 4).toString() === 'VLME' && !bytes.includes(Buffer.from('Scratchpad')) && !bytes.includes(Buffer.from('"nodes"')), 'the recovery copy is encrypted on disk (VLME header, no plain design text)')

    // restart: unlock, Discard keeps the saved file
    app = await launch(ud)
    page = await app.firstWindow()
    page.setDefaultTimeout(8000)
    await page.waitForTimeout(2500)
    await unlock(page, PW)
    const prompt = await page.locator('[data-recovery-prompt]').textContent().catch(() => null)
    await shot(page, 'protected-restore-prompt')
    check(Boolean(prompt) && prompt.includes('last changes to Scratchpad were saved. Restore them?'), 'protected profile: after unlocking, the restore prompt appears')
    await page.locator('[data-recovery="discard"]').click()
    await page.waitForTimeout(600)
    check(names(ud, '.recovery').length === 0, 'Discard deletes the recovery copy')
    await openScratchpad(page)
    const afterDiscard = await nodesOnCanvas(page)
    await shot(page, 'protected-after-discard')
    check(afterDiscard === 1, `Discard leaves the saved design as it was (${afterDiscard} frame)`)

    // crash again, this time Restore
    await page.mouse.click(415, 215) // select the frame so Ctrl+D has something to duplicate
    await page.waitForTimeout(300)
    const saw2 = await crashAfterEdit(page, app, ud)
    check(saw2 && names(ud, '.recovery').length === 1, 'protected profile: a second crash leaves a copy again')
    app = await launch(ud)
    page = await app.firstWindow()
    page.setDefaultTimeout(8000)
    await page.waitForTimeout(2500)
    await unlock(page, PW)
    await page.locator('[data-recovery="restore"]').click()
    await page.waitForTimeout(500)
    await openScratchpad(page)
    const afterRestore = await nodesOnCanvas(page)
    await shot(page, 'protected-after-restore')
    check(afterRestore === 2, `Restore brings the edit back (${afterRestore} frames)`)
    await page.waitForTimeout(1200)
    check(names(ud, '.recovery').length === 0, 'and the save after it removes the recovery copy')
    await closeApp(app, ud)
  }

  // ---------------------------------------------------------------- B + C: half-written .tmp, clean close
  {
    const ud = newDir()
    let app = await launch(ud)
    let page = await app.firstWindow()
    page.setDefaultTimeout(8000)
    await page.waitForTimeout(2500)
    await page.locator('input:not([type=file])').first().fill('Tester')
    await page.getByRole('button', { name: 'Create profile' }).click()
    await page.waitForTimeout(2000)
    await openScratchpad(page)
    await drawFrame(page, 330, 150, 500, 280)
    await page.waitForTimeout(300)
    await closeApp(app, ud) // a normal close right after an edit: the save is flushed on the way out
    check(names(ud, '.recovery').length === 0, 'a clean close leaves no .recovery behind')
    const json = names(ud, '.json')[0]
    const original = readFileSync(join(filesDir(ud), json), 'utf8')
    check(JSON.parse(original).nodes && Object.keys(JSON.parse(original).nodes).length >= 2, 'and the edit made just before closing is saved')

    // a crash in the middle of a write leaves <file>.tmp half-written next to the intact file
    writeFileSync(join(filesDir(ud), `${json}.tmp`), original.slice(0, Math.floor(original.length / 2)))
    writeFileSync(join(ud, 'profiles', readdirSync(join(ud, 'profiles')).find((d) => existsSync(join(ud, 'profiles', d, 'files'))), 'index.json.tmp'), '{"recents":["a')
    app = await launch(ud)
    page = await app.firstWindow()
    page.setDefaultTimeout(8000)
    await page.waitForTimeout(3500)
    check((await page.locator('[data-recovery-prompt]').count()) === 0, 'a leftover .tmp offers no restore and shows no error')
    await openScratchpad(page)
    const nodes = await nodesOnCanvas(page)
    await shot(page, 'opens-with-leftover-tmp')
    check(nodes === 1, `the old file still opens with its content (${nodes} frame)`)
    check(names(ud, '.tmp').length === 0, 'the stale .tmp files are cleaned up at start')
    await closeApp(app, ud)
  }

  // ---------------------------------------------------------------- D: two designs with unsaved changes
  {
    const ud = newDir()
    let app = await launch(ud)
    let page = await app.firstWindow()
    page.setDefaultTimeout(8000)
    await page.waitForTimeout(2500)
    await page.locator('input:not([type=file])').first().fill('Tester')
    await page.getByRole('button', { name: 'Create profile' }).click()
    await page.waitForTimeout(2000)
    await openScratchpad(page)
    await drawFrame(page, 330, 150, 500, 280)
    await page.waitForTimeout(1500)
    await closeApp(app, ud)
    const dir = filesDir(ud)
    const base = JSON.parse(readFileSync(join(dir, names(ud, '.json')[0]), 'utf8'))
    // a second design (as the app would save it), and a newer unsaved copy for each
    const second = { ...base, id: 'second1', name: 'Second design', scratchpad: undefined, updatedAt: base.updatedAt }
    writeFileSync(join(dir, 'second1.json'), JSON.stringify(second))
    writeFileSync(join(dir, `${base.id}.recovery`), JSON.stringify({ ...base, name: 'Scratchpad', updatedAt: base.updatedAt + 5000 }))
    writeFileSync(join(dir, 'second1.recovery'), JSON.stringify({ ...second, updatedAt: second.updatedAt + 5000 }))
    app = await launch(ud)
    page = await app.firstWindow()
    page.setDefaultTimeout(8000)
    await page.waitForTimeout(3500)
    const first = await page.locator('[data-recovery-prompt]').textContent().catch(() => null)
    await shot(page, 'two-recoveries-first')
    check(Boolean(first) && first.includes('1 more after this one'), `two designs with unsaved changes: the prompt says one more follows (${first})`)
    const firstName = /last changes to (.*?) were saved/.exec(first ?? '')?.[1]
    await page.locator('[data-recovery="discard"]').click()
    await page.waitForTimeout(500)
    const next = await page.locator('[data-recovery-prompt]').textContent().catch(() => null)
    await shot(page, 'two-recoveries-second')
    const nextName = /last changes to (.*?) were saved/.exec(next ?? '')?.[1]
    check(Boolean(nextName) && nextName !== firstName && !next.includes('more after'), `the other design is offered next (${firstName} then ${nextName})`)
    await page.locator('[data-recovery="restore"]').click()
    await page.waitForTimeout(1500)
    check((await page.locator('[data-recovery-prompt]').count()) === 0, 'both decisions made: no prompt left')
    check(names(ud, '.recovery').length === 0, 'and no recovery copy is left on disk (Discard removed one, the save after Restore the other)')
    await closeApp(app, ud)
  }
} catch (e) {
  results.push(`FAILED: script error: ${String(e.stack).split('\n').slice(0, 3).join(' | ')}`)
} finally {
  console.log(results.join('\n'))
  for (const d of dirs) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      /* temp dir may still be locked */
    }
  }
  process.exit(0)
}
