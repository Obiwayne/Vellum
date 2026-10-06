// Runs every Playwright flow in scripts/e2e-*.mjs against a fresh build and prints one summary:  npm run e2e
// Each script gets its own output folder (screenshots) and its output is saved next to them.
//   SKIP_BUILD=1     use the existing out/ build instead of building first
//   ONLY=a,b         run just the scripts whose name contains one of these words (e.g. ONLY=variants,assets)
//   OUT=<dir>        where to write results (default .muster-evidence/e2e)
// A script passes when it exits 0, prints at least one "passed:" line and no "FAILED:" line. Exit code 1 if any fails.
// Needs the repo's `npm install` (playwright + electron). Scripts run one after another: each starts its own app.
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outRoot = process.env.OUT ?? join(root, '.muster-evidence', 'e2e')
const only = process.env.ONLY ? process.env.ONLY.split(',').map((s) => s.trim()).filter(Boolean) : null
const isWin = process.platform === 'win32'

const scripts = readdirSync(join(root, 'scripts'))
  .filter((f) => /^e2e-.+\.mjs$/.test(f) && f !== 'e2e-all.mjs')
  .filter((f) => !only || only.some((w) => f.includes(w)))
  .sort()
if (!scripts.length) {
  console.error('[e2e] no scripts matched')
  process.exit(1)
}
mkdirSync(outRoot, { recursive: true })

if (!process.env.SKIP_BUILD) {
  console.log('[e2e] building (typecheck + electron-vite build) ...')
  const b = spawnSync(isWin ? 'npm.cmd' : 'npm', ['run', 'build'], { cwd: root, stdio: 'inherit', shell: isWin })
  if (b.status !== 0) {
    console.error('[e2e] build failed')
    process.exit(1)
  }
}

/** Run one script to completion; resolves to {code, text}. A hung script is killed after 10 minutes. */
const run = (file, dir) =>
  new Promise((resolve) => {
    const p = spawn(process.execPath, [join(root, 'scripts', file), dir], { cwd: root, env: process.env })
    let text = ''
    p.stdout.on('data', (d) => (text += d))
    p.stderr.on('data', (d) => (text += d))
    const timer = setTimeout(() => {
      text += '\nFAILED: timed out after 10 minutes\n'
      p.kill()
    }, 600_000)
    p.on('error', (e) => resolve({ code: 127, text: String(e) }))
    p.on('exit', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, text })
    })
  })

const rows = []
for (const file of scripts) {
  const name = file.replace(/^e2e-/, '').replace(/\.mjs$/, '')
  const dir = join(outRoot, name)
  mkdirSync(dir, { recursive: true })
  process.stdout.write(`[e2e] ${name} ... `)
  const t0 = Date.now()
  const { code, text } = await run(file, dir)
  writeFileSync(join(dir, 'output.txt'), text)
  const lines = text.split(/\r?\n/)
  const passed = lines.filter((l) => /^passed:/.test(l)).length
  const failed = lines.filter((l) => /^FAILED:/.test(l))
  const ok = code === 0 && failed.length === 0 && passed > 0
  rows.push({ name, ok, passed, failed, code, secs: Math.round((Date.now() - t0) / 1000) })
  console.log(`${ok ? 'PASS' : 'FAIL'} (${passed} passed, ${failed.length} failed, ${rows[rows.length - 1].secs}s)`)
  for (const f of failed) console.log(`        ${f}`)
  if (!ok && !failed.length) console.log(`        exit ${code}, ${passed} passed lines: see ${join(dir, 'output.txt')}`)
}

const bad = rows.filter((r) => !r.ok)
console.log('\n[e2e] summary')
for (const r of rows) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(18)} ${String(r.passed).padStart(3)} passed  ${r.failed.length} failed  ${r.secs}s`)
const total = rows.reduce((t, r) => t + r.passed, 0)
console.log(`  ${rows.length - bad.length}/${rows.length} flows, ${total} checks passed. Output: ${outRoot}`)
writeFileSync(join(outRoot, 'summary.txt'), rows.map((r) => `${r.ok ? 'PASS' : 'FAIL'} ${r.name} ${r.passed} passed ${r.failed.length} failed`).join('\n') + '\n')
process.exit(bad.length ? 1 : 0)
