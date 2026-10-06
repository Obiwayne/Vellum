// Real update test: an INSTALLED old version updates itself to the next one from a local feed, then everything is cleaned up.
//   npm run dist:update-test   (builds release-update/old and release-update/new for the TEST product)
//   npm run test:update        (runs this script)
// What it does, in temp folders only (the test product has its own appId, product name, data folder and updater cache, so it never
// meets a real Vellum install or its data):
//   1. silent-installs the old version with /D=<temp>, starts it with VELLUM_UPDATE_URL = a local server (its data folder is the test product's own %APPDATA%VellumInstallTest, which must not exist yet)
//   2. checks the update states over IPC: checking -> available -> downloading -> ready; nothing is installed before install()
//   3. calls updates.install() (quitAndInstall): the installer runs, the new version replaces the old one in the same folder and is
//      started again; the registry entry, shortcuts and the old instance's data folder are intact
//   4. silently uninstalls and removes everything it made.  Exit code 0 = all checks passed, 1 = a check failed, 2 = refused to run.
// Usage: node scripts/test-update.mjs [--old <setup.exe>] [--new <folder with latest.yml and the new setup.exe>] [--out <log folder>]
import { _electron as electron } from 'playwright'
import { spawnSync } from 'node:child_process'
import http from 'node:http'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, parse, resolve } from 'node:path'

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : dflt
}
const PRODUCT = 'VellumInstallTest'
const APP_ID = 'com.vellum.app.installertest'
const CACHE_DIR = 'vellum-installtest-updater' // electron-updater's download cache folder for the test build (set in build-update-test.mjs)
const root = process.cwd()
const out = resolve(arg('out', join(root, '.muster-evidence', 'test-update')))
const newDir = resolve(arg('new', join(root, 'release-update', 'new')))
const oldSetup = resolve(
  arg('old', (() => {
    const d = join(root, 'release-update', 'old')
    const f = existsSync(d) ? readdirSync(d).find((n) => /^Vellum-Setup-.*\.exe$/.test(n)) : undefined
    return f ? join(d, f) : join(d, 'missing.exe')
  })())
)
mkdirSync(out, { recursive: true })
const results = []
const log = []
const say = (m) => {
  console.log(m)
  log.push(m)
}
const check = (ok, label) => {
  const line = `${ok ? 'passed' : 'FAILED'}: ${label}`
  say(line)
  results.push(ok)
}
const ps = (script) => spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { encoding: 'utf8' }).stdout.trim()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const finish = (code) => {
  writeFileSync(join(out, 'test-update.log'), log.join('\n') + '\n')
  process.exit(code)
}

if (!existsSync(oldSetup) || !existsSync(join(newDir, 'latest.yml'))) {
  say(`FAILED: need ${oldSetup} and ${join(newDir, 'latest.yml')} (run npm run dist:update-test)`)
  finish(2)
}
const newSetupName = readFileSync(join(newDir, 'latest.yml'), 'utf8').match(/^path:\s*(\S+)/m)?.[1]
const newVersion = readFileSync(join(newDir, 'latest.yml'), 'utf8').match(/^version:\s*(\S+)/m)?.[1]
const oldVersion = oldSetup.match(/Setup-(\d+\.\d+\.\d+)\.exe$/)?.[1]
if (!newSetupName || !newVersion || !oldVersion || newVersion === oldVersion) {
  say(`FAILED: could not read the versions (old ${oldVersion}, new ${newVersion})`)
  finish(2)
}

const work = mkdtempSync(join(tmpdir(), 'vellum-update-test-'))
const installDir = join(work, 'app')
const exe = join(installDir, `${PRODUCT}.exe`)
// The installer relaunches the new version through the shell, without our environment, so a temp VELLUM_USER_DATA cannot carry
// over. The test product's own default data folder does: an installed build keeps its data in %APPDATA%\<exe name> (userDataDir.ts).
const appData = ps(`[Environment]::GetFolderPath('ApplicationData')`)
const testData = join(appData, PRODUCT)
const realData = join(appData, 'Vellum')
delete process.env.VELLUM_USER_DATA // the app under test must resolve its data folder by itself

// ---- guards: never meet a real install
const registered = ps(
  `Get-ChildItem 'HKCU:\\Software' | Where-Object { (Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue).ShortcutName -eq '${PRODUCT}' } | Measure-Object | Select-Object -ExpandProperty Count`
)
const localPrograms = ps(`Test-Path (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Programs\\${PRODUCT}')`)
const running = ps(`(Get-Process -Name ${PRODUCT} -ErrorAction SilentlyContinue | Measure-Object).Count`)
// the folder the installed app will resolve (userDataDir.ts: named after the exe) must be the test product's own, never the real one
const resolvesTo = join(appData, parse(exe).name)
if (resolvesTo.toLowerCase() === realData.toLowerCase() || existsSync(testData)) {
  say(`FAILED: the app would use ${resolvesTo} (real data folder: ${realData}; the test data folder ${testData} must not exist yet); refusing to run`)
  rmSync(work, { recursive: true, force: true })
  finish(2)
}
if (registered !== '0' || localPrograms !== 'False' || running !== '0') {
  say(`FAILED: '${PRODUCT}' is already installed, registered or running (${registered} registry keys, folder ${localPrograms}, ${running} processes); refusing to run`)
  rmSync(work, { recursive: true, force: true })
  finish(2)
}

const freePort = () =>
  new Promise((res) => {
    const s = createServer()
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => res(port))
    })
  })

// ---- the local feed
const requests = []
const server = http.createServer((req, res) => {
  const name = decodeURIComponent((req.url ?? '/').split('?')[0].slice(1))
  const file = join(newDir, name)
  if (!name || name.includes('..') || !existsSync(file) || !statSync(file).isFile()) {
    requests.push(`${req.method} /${name} -> 404`)
    res.writeHead(404).end()
    return
  }
  const size = statSync(file).size
  const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '')
  if (range) {
    const start = Number(range[1])
    const end = range[2] ? Number(range[2]) : size - 1
    requests.push(`${req.method} /${name} range -> 206`)
    res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes' })
    createReadStream(file, { start, end }).pipe(res)
  } else {
    requests.push(`${req.method} /${name} -> 200 (${size} bytes)`)
    res.writeHead(200, { 'Content-Length': size, 'Accept-Ranges': 'bytes' })
    if (req.method === 'HEAD') res.end()
    else createReadStream(file).pipe(res)
  }
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const feed = `http://127.0.0.1:${server.address().port}`

// the real data folder must not be touched: its user data (profiles.json, profiles/, the bridge token) is compared before and after
const realDataStamp = () =>
  ps(`$d = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Vellum'; (@('profiles.json', 'profiles', 'bridge-token', 'index.json') | ForEach-Object { $p = Join-Path $d $_; if (Test-Path $p) { "$_=$((Get-Item $p).LastWriteTimeUtc.Ticks)" } else { "$_=none" } }) -join ';'`)
const realBefore = realDataStamp()
const productVersion = () => ps(`if (Test-Path '${exe}') { (Get-Item '${exe}').VersionInfo.ProductVersion }`)
const installedProcs = () => ps(`(Get-Process -Name ${PRODUCT} -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith('${installDir}', [StringComparison]::OrdinalIgnoreCase) } | Measure-Object).Count`)
const installerProcs = () => ps(`(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like 'Vellum-Setup-*' } | Measure-Object).Count`)
let app
let updaterCache = ''
try {
  say(`old ${oldSetup} (${oldVersion}); new ${newSetupName} (${newVersion}) served from ${feed}; install dir ${installDir}`)

  // ---- 1. install the old version silently, start it
  const inst = spawnSync(oldSetup, ['/S', `/D=${installDir}`], { windowsHide: true })
  check(inst.status === 0 && existsSync(exe), `the old version ${oldVersion} installs silently into the temp folder`)
  check(productVersion().startsWith(oldVersion), `the installed ${PRODUCT}.exe is version ${productVersion()}`)
  const appUpdate = join(installDir, 'resources', 'app-update.yml')
  const cacheName = existsSync(appUpdate) ? (readFileSync(appUpdate, 'utf8').match(/^updaterCacheDirName:\s*(\S+)/m)?.[1] ?? '') : ''
  check(cacheName === CACHE_DIR, `the test build's updater cache folder is its own (${cacheName})`)
  updaterCache = cacheName === CACHE_DIR ? join(ps(`[Environment]::GetFolderPath('LocalApplicationData')`), cacheName) : ''

  const port = await freePort()
  app = await electron.launch({
    executablePath: exe,
    args: [],
    env: { ...process.env, VELLUM_UPDATE_URL: feed, VELLUM_PORT: String(port), VELLUM_NO_UPDATE_CHECK: '1' }
  })
  const page = await app.firstWindow()
  page.setDefaultTimeout(20000)
  await page.waitForTimeout(3000)
  const info = await app.evaluate(({ app: a }) => ({ version: a.getVersion(), packaged: a.isPackaged, userData: a.getPath('userData') }))
  check(info.packaged && info.version === oldVersion, `the installed app is a packaged build at version ${info.version}`)
  check(info.userData.toLowerCase() === testData.toLowerCase() && info.userData.toLowerCase() !== realData.toLowerCase(), `the app resolved its data folder to ${info.userData}, not the real one`)
  if (info.userData.toLowerCase() === realData.toLowerCase()) throw new Error('the app resolved the REAL data folder: aborting')

  // a design file made in the old version (profile + frame on the Scratchpad), saved to the app's data folder
  await page.locator('input:not([type=file])').first().fill('Updater')
  await page.getByRole('button', { name: 'Create profile' }).click()
  await page.waitForTimeout(2000)
  await page.getByText('Scratchpad').first().dblclick()
  await page.waitForTimeout(2500)
  await page.keyboard.press('f')
  await page.mouse.move(330, 150)
  await page.mouse.down()
  await page.mouse.move(600, 300, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(3000) // autosave
  const designFiles = () => {
    const base = join(testData, 'profiles')
    const out = []
    const walk = (d) => {
      if (!existsSync(d)) return
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const f = join(d, e.name)
        if (e.isDirectory()) walk(f)
        else if (/files[\\/][^\\/]+\.json$/.test(f)) out.push(f)
      }
    }
    walk(base)
    return out
  }
  const design = designFiles().find((f) => JSON.parse(readFileSync(f, 'utf8')).nodes && Object.keys(JSON.parse(readFileSync(f, 'utf8')).nodes).length >= 2)
  const nodesBefore = design ? Object.keys(JSON.parse(readFileSync(design, 'utf8')).nodes).length : 0
  check(Boolean(design), `the old version saved a design with a frame (${nodesBefore} nodes) in its data folder`)

  // ---- 2. the update states over IPC
  await page.evaluate(() => {
    window.__states = []
    window.canvasApi.updates.onStatus((s) => window.__states.push({ state: s.state, latest: s.latest, progress: s.progress, message: s.message }))
  })
  await page.evaluate(() => void window.canvasApi.updates.check())
  const deadline = Date.now() + 180000
  let states = []
  while (Date.now() < deadline) {
    states = await page.evaluate(() => window.__states)
    if (states.some((s) => s.state === 'ready' || s.state === 'error')) break
    await sleep(500)
  }
  const seq = []
  for (const s of states) if (seq[seq.length - 1] !== s.state) seq.push(s.state)
  say(`states over IPC: ${seq.join(' -> ')}`)
  check(['checking', 'available', 'downloading', 'ready'].every((s) => seq.includes(s)) && seq.indexOf('checking') < seq.indexOf('available') && seq.indexOf('available') < seq.indexOf('ready'), 'checking -> available -> downloading -> ready')
  const ready = states.find((s) => s.state === 'ready')
  check(ready?.latest === newVersion, `the update offered is ${ready?.latest} (expected ${newVersion})`)
  const setupSize = statSync(join(newDir, newSetupName)).size
  const served = requests.filter((r) => r.includes(newSetupName) && !r.includes('blockmap'))
  const cached = updaterCache && existsSync(updaterCache) ? readdirSync(updaterCache, { recursive: true }).filter((n) => String(n).endsWith('.exe')).map((n) => statSync(join(updaterCache, String(n))).size) : []
  say(`download size: the installer is ${setupSize} bytes (${(setupSize / 1048576).toFixed(1)} MB); the feed served ${served.join(', ') || 'nothing'}; the updater cache holds ${cached.join(', ') || 'no installer'} bytes`)
  check(cached.includes(setupSize), 'the downloaded installer in the updater cache has the size of the published one')
  check(requests.some((r) => r.includes(newSetupName) && r.includes('200')) && requests.some((r) => r.includes('latest.yml')), `the feed was asked for latest.yml and ${newSetupName}`)
  check(productVersion().startsWith(oldVersion) && Number(installerProcs()) === 0, 'nothing is installed before install() is called (exe still the old version, no installer running)')
  check((await app.evaluate(({ app: a }) => a.getVersion())) === oldVersion, 'the running app is still the old version')

  // ---- 3. install: quitAndInstall, the new version replaces the old and starts again
  await page.evaluate(() => void window.canvasApi.updates.install()).catch(() => undefined)
  const t1 = Date.now() + 180000
  while (Date.now() < t1 && !(productVersion().startsWith(newVersion) && Number(installerProcs()) === 0)) await sleep(1000)
  await sleep(3000)
  check(productVersion().startsWith(newVersion), `after install() the installed ${PRODUCT}.exe is version ${productVersion()} (expected ${newVersion})`)
  const t2 = Date.now() + 60000
  while (Date.now() < t2 && Number(installedProcs()) === 0) await sleep(1000)
  check(Number(installedProcs()) > 0, 'the new version was started again from the same folder (force-run)')
  const entries = JSON.parse(ps(`$e = @(Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' | ForEach-Object { Get-ItemProperty $_.PSPath } | Where-Object { $_.DisplayName -like '${PRODUCT}*' } | ForEach-Object { @{ v = $_.DisplayVersion; u = $_.UninstallString } }); ConvertTo-Json -InputObject $e -Compress`) || '[]')
  const entry = entries.find((e) => (e.u ?? '').toLowerCase().includes(installDir.toLowerCase()))
  const dn = entry?.v
  check(dn === newVersion, `the uninstall entry now says ${dn} and still points at the same folder`)
  check(ps(`Test-Path (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Programs\\${PRODUCT}')`) === 'False', 'no second copy appeared in %LOCALAPPDATA%\\Programs')
  const nodesAfter = design && existsSync(design) ? Object.keys(JSON.parse(readFileSync(design, 'utf8')).nodes).length : -1
  check(nodesAfter === nodesBefore, `the design file made in the old version is still there with all its ${nodesAfter} nodes`)
  check(existsSync(join(testData, 'lockfile')) || Number(installedProcs()) > 0, 'the relaunched version runs on that same data folder')
  check(realDataStamp() === realBefore, 'the real %APPDATA%/Vellum user data (profiles.json, profiles, bridge token) was not touched, not even by the relaunched app')
  check(ps(`Test-Path (Join-Path ([Environment]::GetFolderPath('ApplicationData')) '${PRODUCT}')`) === 'True', 'the relaunched app keeps its data in its own folder (named after its exe)')
} catch (e) {
  check(false, `script error: ${String(e.message).slice(0, 300)}`)
} finally {
  // ---- 4. uninstall and clean up, only what this run made
  say(`feed requests: ${requests.join(' | ')}`)
  try {
    await Promise.race([app?.close(), sleep(5000)])
  } catch {
    /* already gone */
  }
  ps(`Get-Process -Name ${PRODUCT} -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith('${installDir}', [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force`)
  await sleep(1500)
  const uninst = join(installDir, `Uninstall ${PRODUCT}.exe`)
  if (existsSync(uninst)) {
    const u = spawnSync(uninst, ['/S', `_?=${installDir}`], { windowsHide: true })
    check(u.status === 0 && !existsSync(exe), 'silent uninstall removes the app')
  }
  const left = ps(
    `$n = 0
     Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' | Where-Object { (Get-ItemProperty $_.PSPath).DisplayName -like '${PRODUCT}*' } | ForEach-Object { Remove-Item $_.PSPath -Recurse -Force; $n++ }
     Get-ChildItem 'HKCU:\\Software' | Where-Object { (Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue).ShortcutName -eq '${PRODUCT}' } | ForEach-Object { Remove-Item $_.PSPath -Recurse -Force; $n++ }
     foreach ($l in @((Join-Path ([Environment]::GetFolderPath('Desktop')) '${PRODUCT}.lnk'), (Join-Path ([Environment]::GetFolderPath('Programs')) '${PRODUCT}.lnk'))) { if (Test-Path $l) { Remove-Item $l -Force; $n++ } }
     $d = Join-Path ([Environment]::GetFolderPath('ApplicationData')) '${PRODUCT}'; if (Test-Path $d) { Remove-Item $d -Recurse -Force; $n++ }
     $n`
  )
  say(`cleanup removed ${left} leftover registry keys, shortcuts or data folders of the test product`)
  if (updaterCache && updaterCache.toLowerCase().endsWith(CACHE_DIR)) rmSync(updaterCache, { recursive: true, force: true }) // the test build's own cache folder, never the real one
  server.close()
  try {
    rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
  } catch {
    /* temp folder may still be locked */
  }
  const residue = ps(
    `"$((Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' | Where-Object { (Get-ItemProperty $_.PSPath).DisplayName -like '${PRODUCT}*' } | Measure-Object).Count) keys, $((Get-Process -Name ${PRODUCT} -ErrorAction SilentlyContinue | Measure-Object).Count) processes"`
  )
  check(residue === '0 keys, 0 processes', `nothing left behind (${residue})`)
  finish(results.every(Boolean) ? 0 : 1)
}
