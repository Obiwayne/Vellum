// Drives the built app (npm run build first) through the Assets panel: components on two pages, rename and
// go-to from the row's context menu, search, drag onto an artboard / a nested frame / empty canvas, undo.
// Usage: node scripts/e2e-assets.mjs <out-dir>. Needs `npm i -D playwright`.
import { _electron as electron } from 'playwright'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = process.argv[2] ?? '.muster-evidence/e2e-assets'
mkdirSync(out, { recursive: true })
const ud = mkdtempSync(join(tmpdir(), 'vellum-e2e-'))
const app = await electron.launch({ args: ['out/main/index.js'], env: { ...process.env, VELLUM_USER_DATA: ud } })
const page = await app.firstWindow()
const results = []
let n = 0
const shot = async (name) => {
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(out, `${String(++n).padStart(2, '0')}-${name}.png`) })
}
const check = (ok, label) => results.push(`${ok ? 'passed' : 'FAILED'}: ${label}`)
const rows = () => page.locator('.lp-component').count()
const rowNames = () => page.locator('.lp-component .lp-ellipsis').allTextContents()
/** every canvas frame that directly holds a "Hello"/"World" text leaf: id, parent frame id, centre on screen */
const holders = (word) =>
  page.evaluate((w) => {
    const leaves = [...document.querySelectorAll('[data-node-id]')].filter((e) => e.children.length === 0 && e.textContent === w)
    return leaves.map((l) => {
      const f = l.parentElement.closest('[data-node-id]')
      const r = f.getBoundingClientRect()
      return {
        id: f.getAttribute('data-node-id'),
        parent: f.parentElement.closest('[data-node-id]')?.getAttribute('data-node-id') ?? null,
        cx: Math.round(r.x + r.width / 2),
        cy: Math.round(r.y + r.height / 2)
      }
    })
  }, word)
const frameIdAt = (x, y) => page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.closest('[data-node-id]')?.getAttribute('data-node-id') ?? null, [x, y])
const dragRow = async (index, x, y) => {
  const box = await page.locator('.lp-component').nth(index).boundingBox()
  await page.mouse.move(box.x + 40, box.y + 12)
  await page.mouse.down()
  await page.mouse.move(x, y, { steps: 14 })
  await page.mouse.up()
  await page.waitForTimeout(600)
}
const drawFrame = async (x1, y1, x2, y2) => {
  await page.keyboard.press('f')
  await page.mouse.move(x1, y1)
  await page.mouse.down()
  await page.mouse.move(x2, y2, { steps: 6 })
  await page.mouse.up()
}
const typeText = async (x, y, text) => {
  await page.keyboard.press('t')
  await page.mouse.click(x, y)
  await page.keyboard.type(text)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
}
const renameRow = async (index, name) => {
  await page.locator('.lp-component').nth(index).click({ button: 'right' })
  await page.getByText('Rename', { exact: true }).click()
  await page.keyboard.press('Control+a')
  await page.keyboard.type(name)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
}
try {
  await page.waitForTimeout(2500)
  await page.locator('input:not([type=file])').first().fill('Tester')
  await page.getByRole('button', { name: 'Create profile' }).click()
  await page.waitForTimeout(2000)
  await page.getByText('Scratchpad').first().dblclick()
  await page.waitForTimeout(2500)

  // page 1: a component with "Hello"
  await drawFrame(330, 150, 480, 230)
  await typeText(350, 175, 'Hello')
  await page.mouse.click(470, 222)
  await page.keyboard.press('Control+Alt+k')
  await page.waitForTimeout(400)
  // page 2: a component with "World"
  await page.getByRole('button', { name: 'Add page' }).click()
  await page.waitForTimeout(600)
  await drawFrame(330, 150, 480, 230)
  await typeText(350, 175, 'World')
  await page.mouse.click(470, 222)
  await page.keyboard.press('Control+Alt+k')
  await page.waitForTimeout(500)
  await shot('two-components-two-pages')
  check((await rows()) === 2, `the Assets panel lists components of both pages (${await rows()} rows)`)
  check((await page.locator('.lp-components__page').count()) === 2, 'rows are grouped under two page headings')

  // rename from the context menu
  await renameRow(0, 'Card')
  await renameRow(1, 'Banner')
  await shot('renamed')
  const names = await rowNames()
  check(names.join() === 'Card,Banner', `Rename from the right-click menu (${names.join()})`)

  // search across pages
  const search = page.locator('.lp-components__search input')
  await search.fill('BAN')
  await page.waitForTimeout(300)
  check((await rows()) === 1 && (await rowNames())[0] === 'Banner', `search "BAN" keeps only Banner (${await rowNames()})`)
  await search.fill('zzz')
  await page.waitForTimeout(300)
  check((await rows()) === 0 && (await page.locator('.lp-components__empty').count()) === 1, 'search without hits shows "No components match"')
  await shot('search-no-match')
  await search.fill('a')
  await page.waitForTimeout(300)
  check((await rows()) === 2, `search "a" matches both pages (${await rows()} rows)`)
  await search.fill('')
  await page.waitForTimeout(300)

  // Go to main component from the row menu: we are on page 2, Card lives on page 1
  const activeBefore = await page.locator('.lp-page--active').textContent()
  await page.locator('.lp-component').nth(0).click({ button: 'right' })
  await page.getByText('Go to main component').click()
  await page.waitForTimeout(500)
  const activeAfter = await page.locator('.lp-page--active').textContent()
  await shot('go-to-main')
  check(activeBefore !== activeAfter, `Go to main component switches the page (${activeBefore} -> ${activeAfter})`)
  check((await page.locator('.lp-layer--selected').count()) >= 1, 'and selects the main in Layers')

  // on page 1: an artboard with a nested frame, then drag Card onto them
  await drawFrame(560, 150, 900, 330)
  await drawFrame(600, 190, 760, 300) // nested: drawn inside the artboard
  await page.keyboard.press('Escape')
  const artboard = await frameIdAt(580, 160)
  const nested = await frameIdAt(680, 245)
  check(Boolean(artboard) && Boolean(nested) && artboard !== nested, `artboard and nested frame found (${artboard} / ${nested})`)

  let known = new Set((await holders('Hello')).map((h) => h.id))
  const fresh = async () => (await holders('Hello')).filter((h) => !known.has(h.id))
  await dragRow(0, 840, 170) // onto the artboard, outside the nested frame
  let [a] = await fresh()
  await shot('drop-on-artboard')
  check(Boolean(a) && a.parent === artboard, `drop on the artboard parents the instance there (${a?.parent} vs ${artboard})`)
  check(Boolean(a) && Math.abs(a.cx - 840) <= 6 && Math.abs(a.cy - 170) <= 6, `instance is centred on the drop point (${a?.cx},${a?.cy} vs 840,170)`)
  known = new Set((await holders('Hello')).map((h) => h.id))

  await dragRow(0, 680, 245) // onto the nested frame
  ;[a] = await fresh()
  await shot('drop-on-nested-frame')
  check(Boolean(a) && a.parent === nested, `drop on the nested frame parents the instance there (${a?.parent} vs ${nested})`)
  known = new Set((await holders('Hello')).map((h) => h.id))

  await dragRow(0, 450, 620) // empty canvas
  ;[a] = await fresh()
  await shot('drop-on-empty-canvas')
  check(Boolean(a) && a.parent === null, `drop on empty canvas lands on the page (parent ${a?.parent})`)
  const count = (await page.locator('.lp-component .lp-component__count').first().textContent()) ?? ''
  check(count === '3', `the Card row counts 3 instances (${count})`)

  // one undo removes exactly the last drop
  const before = (await holders('Hello')).length
  await page.evaluate(() => document.activeElement?.blur())
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(500)
  await shot('after-undo')
  const after = (await holders('Hello')).length
  check(after === before - 1, `one undo removes the dropped instance (${before} -> ${after})`)
  const count2 = (await page.locator('.lp-component .lp-component__count').first().textContent()) ?? ''
  check(count2 === '2', `the Card row is back to 2 instances (${count2})`)
} finally {
  console.log(results.join('\n'))
  await Promise.race([app.close(), new Promise((r) => setTimeout(r, 8000))])
  try {
    rmSync(ud, { recursive: true, force: true })
  } catch {
    /* temp dir may still be locked */
  }
  process.exit(0)
}
