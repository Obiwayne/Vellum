// Drives the built app (npm run build first): the update card states (T48). The main process pushes mocked UpdateStatus
// values (updates:changed) and the script screenshots the installed-build card (available, downloading, ready, error),
// the Restart-to-update badge, the dialog, the clone wording, and the Settings row.
// Usage: node scripts/e2e-update-ui.mjs <out-dir>. Needs `npm i -D playwright`.
import { _electron as electron } from 'playwright'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = process.argv[2] ?? '.muster-evidence/e2e-update-ui'
mkdirSync(out, { recursive: true })
const ud = mkdtempSync(join(tmpdir(), 'vellum-e2e-'))
const app = await electron.launch({ args: ['out/main/index.js'], env: { ...process.env, VELLUM_USER_DATA: ud, VELLUM_NO_UPDATE_CHECK: '1' } })
const page = await app.firstWindow()
page.setDefaultTimeout(8000)
const results = []
let n = 0
const shot = async (name) => {
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(out, `${String(++n).padStart(2, '0')}-${name}.png`) })
}
const check = (ok, label) => results.push(`${ok ? 'passed' : 'FAILED'}: ${label}`)
const base = { commits: [], behind: 0, dirty: [], current: '0.1.0' }
const push = (s) =>
  app.evaluate(({ BrowserWindow }, status) => BrowserWindow.getAllWindows()[0].webContents.send('updates:changed', status), { ...base, ...s })
const card = () => page.locator('.upd-card')
try {
  await page.waitForTimeout(1500)
  await page.reload()
  await page.waitForTimeout(2500)
  await page.locator('input:not([type=file])').first().fill('Tester')
  await page.getByRole('button', { name: 'Create profile' }).click()
  await page.waitForTimeout(2000)

  const notes = 'Faster export\nFixes a crash when opening large files'
  await push({ installed: true, state: 'available', latest: '0.2.0', progress: 0, releaseNotes: notes })
  await page.waitForTimeout(400)
  check(await card().getByText('Version 0.2.0 is available').isVisible(), 'installed: card says "Version 0.2.0 is available"')
  await page.getByRole('button', { name: /Release notes/ }).click()
  check(await card().getByText('Faster export').isVisible(), 'installed: release notes expand')
  await shot('installed-available')

  await push({ installed: true, state: 'downloading', latest: '0.2.0', progress: 62, releaseNotes: notes })
  await page.waitForTimeout(400)
  check(await card().getByText('Downloading… 62%').isVisible(), 'installed: download progress shown')
  check((await card().locator('[role=progressbar]').getAttribute('aria-valuenow')) === '62', 'installed: progress bar at 62')
  await shot('installed-downloading')

  await push({ installed: true, state: 'ready', latest: '0.2.0', releaseNotes: notes })
  await page.waitForTimeout(400)
  check(await card().getByRole('button', { name: 'Restart to update' }).isVisible(), 'installed: card has Restart to update')
  check(await page.locator('.tb-update', { hasText: 'Restart to update' }).isVisible(), 'installed: title-bar badge says Restart to update')
  await shot('installed-ready')

  // the card never blocks editing: the page behind still takes clicks
  const blocked = await page.evaluate(() => {
    const r = document.querySelector('.upd-card').getBoundingClientRect()
    const el = document.elementFromPoint(r.left - 8, r.top + r.height / 2)
    return !!el?.closest('.upd-card')
  })
  check(!blocked, 'installed: the card does not cover or block the page around it')

  await card().getByRole('button', { name: 'Later' }).click()
  await page.waitForTimeout(300)
  check((await card().count()) === 0, 'installed: Later hides the card for the session')

  await push({ installed: true, state: 'error', message: 'Could not update: network is offline' })
  await page.waitForTimeout(400)
  check(await card().getByText('Could not update: network is offline').isVisible(), 'installed: error shows a short message')
  check(await card().getByRole('button', { name: 'Retry' }).isVisible(), 'installed: error has Retry')
  await shot('installed-error')

  // dialog (Help, Check for Updates)
  await push({ installed: true, state: 'ready', latest: '0.2.0', releaseNotes: notes })
  await page.waitForTimeout(300)
  await page.locator('.tb-update').click()
  await page.waitForTimeout(400)
  check(await page.getByText('Version 0.2.0 is ready. Restart Vellum to install it.').isVisible(), 'installed: dialog says the update is ready')
  await shot('installed-dialog-ready')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  // clone wording
  await push({ installed: false, state: 'available', behind: 3, latest: 'abc1234', current: 'def5678', commits: [{ hash: 'abc1234', subject: 'Fix zoom', date: Date.now() }] })
  await page.waitForTimeout(400)
  check(await card().getByText('Vellum update available').isVisible(), 'clone: git wording kept ("Vellum update available")')
  check(await card().getByRole('button', { name: 'Update and restart' }).isVisible(), 'clone: Update and restart')
  await shot('clone-available')

  // settings row
  await page.keyboard.press('Escape')
  await page.getByText('Settings', { exact: true }).first().click()
  await page.waitForTimeout(600)
  const row = page.getByText('Check for updates automatically')
  check(await row.isVisible(), 'settings: "Check for updates automatically" row exists')
  await shot('settings-row')
} catch (err) {
  results.push(`FAILED: ${err.message}`)
} finally {
  console.log(results.join('\n'))
  await app.close()
}
if (results.some((r) => r.startsWith('FAILED'))) process.exit(1)
