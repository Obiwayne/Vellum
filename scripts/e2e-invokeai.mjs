// Drives the built app (npm run build first) through the InvokeAI plugin against a mock InvokeAI server
// (the REST endpoints the plugin uses), and checks that the generated image lands on the canvas.
// Usage: node scripts/e2e-invokeai.mjs <out-dir>
import { _electron as electron } from 'playwright'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'

const out = process.argv[2] ?? '.muster-evidence/e2e'
mkdirSync(out, { recursive: true })
const results = []
const ok = (cond, label) => results.push(`${cond ? 'passed' : 'FAILED'}: ${label}`)

// --- mock InvokeAI -------------------------------------------------------------------------------
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const c = Buffer.alloc(4)
  c.writeUInt32BE(crc(td))
  return Buffer.concat([len, td, c])
}
/** solid orange RGB PNG */
const png = (w, h) => {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr.set([8, 2, 0, 0, 0], 8)
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, Buffer.from([255, 106, 31]))])
  const raw = Buffer.concat(Array.from({ length: h }, () => row))
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

const MODELS = [
  { key: 'sd15', hash: 'h1', name: 'Dreamshaper 8', base: 'sd-1', type: 'main', format: 'checkpoint' },
  { key: 'xl', hash: 'h2', name: 'Juggernaut XL', base: 'sdxl', type: 'main', format: 'diffusers' },
  { key: 'flux', hash: 'h3', name: 'FLUX Schnell', base: 'flux', type: 'main', format: 'checkpoint' }
]
let enqueued = null
let polls = 0
const server = createServer((req, res) => {
  const send = (code, body, type = 'application/json') => {
    res.writeHead(code, { 'Content-Type': type })
    res.end(type === 'application/json' ? JSON.stringify(body) : body)
  }
  let body = ''
  req.on('data', (d) => (body += d))
  req.on('end', () => {
    const u = new URL(req.url, 'http://x')
    if (u.pathname === '/api/v1/app/version') return send(200, { version: '6.0.0-mock' })
    if (u.pathname === '/api/v2/models/') return send(200, { models: MODELS })
    if (req.method === 'POST' && u.pathname === '/api/v1/queue/default/enqueue_batch') {
      enqueued = JSON.parse(body)
      polls = 0
      return send(200, { queue_id: 'default', enqueued: 1, requested: 1, batch: enqueued.batch, priority: 0, item_ids: [7] })
    }
    if (u.pathname === '/api/v1/queue/default/i/7') {
      polls++
      const status = polls < 2 ? 'pending' : polls < 4 ? 'in_progress' : 'completed'
      return send(200, {
        item_id: 7,
        status,
        session: status === 'completed' ? { source_prepared_mapping: { vellum_l2i: ['abc'] }, results: { abc: { image: { image_name: 'mock.png' } } } } : {}
      })
    }
    if (u.pathname === '/api/v1/images/i/mock.png/full') {
      const n = enqueued?.batch?.graph?.nodes?.noise
      return send(200, png(n?.width ?? 64, n?.height ?? 64), 'image/png')
    }
    send(404, { detail: 'Not Found' })
  })
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const mockUrl = `http://127.0.0.1:${server.address().port}`

// --- app ------------------------------------------------------------------------------------------
const ud = mkdtempSync(join(tmpdir(), 'vellum-e2e-'))
const app = await electron.launch({ args: ['out/main/index.js'], env: { ...process.env, VELLUM_USER_DATA: ud, VELLUM_NO_UPDATE_CHECK: '1' } })
const page = await app.firstWindow()
page.on('pageerror', (e) => results.push(`FAILED: page error: ${e.message}`))
let n = 0
const shot = async (name) => {
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(out, `${String(++n).padStart(2, '0')}-${name}.png`) })
}
const images = () => page.evaluate(() => document.querySelectorAll('img[data-node-id], [data-node-id] img, img[src^="data:image/png"]').length)
try {
  await page.waitForTimeout(2500)
  await page.locator('input:not([type=file])').first().fill('Tester')
  await page.getByRole('button', { name: 'Create profile' }).click()
  await page.waitForTimeout(2000)
  await page.getByText('Scratchpad').first().dblclick()
  await page.waitForTimeout(2500)
  const before = await images()

  await page.getByRole('button', { name: 'Plugins' }).click()
  await shot('plugins-menu')
  ok(await page.getByText('InvokeAI').first().isVisible(), 'puzzle menu lists InvokeAI')
  await page.getByText('InvokeAI').first().click()
  await page.waitForTimeout(1500)
  await shot('dialog-not-connected')
  ok(await page.getByText(/Can't reach InvokeAI|Connecting/).first().isVisible(), 'shows not-connected state with no server on :9090')

  const urlInput = page.locator('.ia-input')
  await urlInput.fill(mockUrl)
  await urlInput.press('Enter')
  await page.waitForTimeout(1000)
  ok(await page.getByText('Connected to InvokeAI 6.0.0-mock').isVisible(), 'connects to the mock server')
  await page.locator('.ia-text').first().fill('an orange square')
  await shot('dialog-connected')
  await page.getByRole('button', { name: 'Generate' }).click()
  await page.waitForTimeout(4500)
  await shot('after-generate')

  const g = enqueued?.batch?.graph
  ok(!!g, 'enqueued a batch')
  ok(g?.nodes?.model?.type === 'main_model_loader' && g?.nodes?.model?.model?.key === 'sd15', 'graph uses the SD 1.x loader and first supported model')
  ok(g?.nodes?.pos?.prompt === 'an orange square', 'graph carries the prompt')
  ok(g?.nodes?.noise?.width === 512 && g?.nodes?.noise?.height === 512, 'default 512x512 for SD 1.x')
  ok(!(await page.locator('.ia').isVisible()), 'dialog closes after the image is placed')
  const after = await images()
  ok(after === before + 1, `one image added to the canvas (${before} -> ${after})`)

  await page.getByRole('button', { name: 'Plugins' }).click()
  await page.getByText('Manage plugins…').click()
  await shot('manage-plugins')
  await page.locator('.pl-row [role=checkbox]').click()
  await page.getByRole('button', { name: 'Done' }).click()
  await page.getByRole('button', { name: 'Plugins' }).click()
  ok(await page.getByText('No plugins turned on').isVisible(), 'turning InvokeAI off hides it from the menu')
  await shot('plugin-off')
  await page.keyboard.press('Escape')
} catch (err) {
  results.push(`FAILED: ${err?.message ?? err}`)
  await shot('error').catch(() => {})
} finally {
  console.log(results.join('\n'))
  await app.close().catch(() => {})
  server.close()
  rmSync(ud, { recursive: true, force: true })
  process.exit(results.some((r) => r.startsWith('FAILED')) ? 1 : 0)
}
