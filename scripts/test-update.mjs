// Real update check against a local feed. The packaged app (an unpacked build, e.g. release/win-unpacked/<Name>.exe) is
// pointed at a folder that serves latest.yml and a newer installer (VELLUM_UPDATE_URL), with a temp VELLUM_USER_DATA.
// Logs the UpdateStatus states it receives over IPC and what the feed server was asked for. It never calls install():
// quitAndInstall would run the new installer. A --dir build has no resources/app-update.yml (installer builds do), so copy
// one from an installer build's win-unpacked first.
// Usage: node scripts/test-update.mjs <app.exe> <feed-folder> [log-file]
import { _electron as electron } from 'playwright'
import http from 'node:http'
import { createReadStream, existsSync, rmSync, mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const [exeArg, feedArg, logArg] = process.argv.slice(2)
if (!exeArg || !feedArg) {
  console.log('usage: node scripts/test-update.mjs <app.exe> <feed-folder> [log-file]')
  process.exit(2)
}
const feedDir = resolve(feedArg)
const exe = resolve(exeArg)
const log = []
const t0 = Date.now()
const say = (m) => {
  const line = `[+${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`
  log.push(line)
  console.log(line)
}

// electron-updater keeps a finished download in %LOCALAPPDATA%ellum-updater; start from an empty one so the run shows a real download
rmSync(join(process.env.LOCALAPPDATA ?? '', 'vellum-updater'), { recursive: true, force: true })
const requests = []
const server = http.createServer((req, res) => {
  const name = decodeURIComponent((req.url ?? '/').split('?')[0].slice(1))
  const file = join(feedDir, name)
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
    requests.push(`${req.method} /${name} range ${start}-${end} -> 206`)
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
say(`feed ${feed} serving ${readdirSync(feedDir).filter((n) => !n.endsWith('.yml') || n === 'latest.yml').join(', ')}`)

const userData = mkdtempSync(join(tmpdir(), 'vellum-update-ud-'))
const installerRunning = () => {
  try {
    return execFileSync('tasklist', ['/NH'], { encoding: 'utf8' }).includes('-Setup-')
  } catch {
    return false
  }
}

const app = await electron.launch({
  executablePath: exe,
  args: [],
  env: { ...process.env, VELLUM_USER_DATA: userData, VELLUM_UPDATE_URL: feed, VELLUM_PORT: '29399', VELLUM_NO_UPDATE_CHECK: '' }
})
try {
  const page = await app.firstWindow()
  page.setDefaultTimeout(20000)
  await page.waitForTimeout(3000)
  say(`app version (main process): ${await app.evaluate(({ app }) => `${app.getVersion()} isPackaged=${app.isPackaged}`)}`)
  await page.evaluate(() => {
    window.__states = []
    const api = window.canvasApi.updates
    api.onStatus((s) => window.__states.push({ t: Date.now(), state: s.state, progress: s.progress, latest: s.latest, current: s.current, message: s.message }))
  })
  say(`initial status: ${JSON.stringify(await page.evaluate(() => window.canvasApi.updates.status().then((s) => ({ state: s.state, current: s.current }))))}`)
  say('calling updates.check() (the app also checks by itself 15 s after start)')
  await page.evaluate(() => void window.canvasApi.updates.check())
  const deadline = Date.now() + 120000
  let last = ''
  while (Date.now() < deadline) {
    const states = await page.evaluate(() => window.__states.map((s) => `${s.state}${s.progress !== undefined ? ':' + s.progress : ''}`))
    const cur = states.join(' > ')
    if (cur !== last) {
      last = cur
    }
    if (states.some((x) => x.startsWith('ready') || x.startsWith('error'))) break
    await page.waitForTimeout(500)
  }
  const states = await page.evaluate(() => window.__states)
  const seq = []
  for (const s of states) if (seq[seq.length - 1] !== s.state) seq.push(s.state)
  say(`state sequence over IPC: ${seq.join(' -> ')}`)
  const progress = states.filter((s) => s.state === 'downloading').map((s) => s.progress)
  say(`download progress values: ${progress.length ? `${progress[0]} .. ${progress[progress.length - 1]} (${progress.length} updates)` : 'none'}`)
  const final = await page.evaluate(() => window.canvasApi.updates.status())
  say(`final status: ${JSON.stringify({ state: final.state, current: final.current, latest: final.latest, progress: final.progress, message: final.message })}`)
  say(`installer process running before any install request: ${installerRunning()}`)
  say(`app version still: ${await app.evaluate(({ app }) => app.getVersion())}`)
  // an install request while not ready must do nothing; here it IS ready, and we deliberately do not call it (it would run the installer)
  say(`feed requests: ${requests.join(' | ')}`)
  say('NOT calling install(): quitAndInstall would run the new installer')
} catch (e) {
  say(`ERROR ${String(e.message).slice(0, 300)}`)
} finally {
  await Promise.race([app.close(), new Promise((r) => setTimeout(r, 8000))])
  server.close()
  writeFileSync(resolve(logArg ?? 'test-update-log.txt'), log.join('\n') + '\n')
  process.exit(0)
}
