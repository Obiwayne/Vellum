// Shared by scripts/e2e-handoff.mjs and scripts/dogfood-handoff.mjs: the sample "Checkout" design as HTML that the
// app pastes into a file (desktop and mobile frames, a hidden promo layer, an unrelated unready frame), and the
// driver that tags, marks ready and exports it. Everything runs against the built app with a temporary VELLUM_USER_DATA.
import { _electron as electron } from 'playwright'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// strings that must never reach a bundle: a layer that is hidden in the design, a frame that is not ready, a layer on another page
export const CANARY = { hidden: 'Free delivery on orders over $100', unready: 'CANARY_UNREADY_FRAME', other: 'CANARY_SETTINGS_PAGE' }

const FONT = "font-family:system-ui,'Segoe UI',Arial,sans-serif"

export const DESKTOP_HTML = `<div style="width:720px;display:flex;flex-direction:column;gap:24px;padding:32px;background:#F8FAFC;color:#0F172A;${FONT}">
<div style="display:flex;justify-content:space-between;align-items:center"><div style="font-size:24px;font-weight:700">Checkout</div><div style="font-size:14px;color:#475569">Step 2 of 3</div></div>
<div style="display:flex;flex-direction:column;gap:12px;padding:20px;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:12px">
<div style="display:flex;justify-content:space-between;font-size:16px"><div>Wireless keyboard</div><div>$89.00</div></div>
<div style="display:flex;justify-content:space-between;font-size:16px"><div>USB-C cable</div><div>$12.00</div></div>
<div style="display:flex;justify-content:space-between;font-size:16px"><div>Delivery</div><div>$4.00</div></div>
<div style="display:flex;justify-content:space-between;font-size:18px;font-weight:700;padding-top:12px;border-top:1px solid #E2E8F0"><div>Total</div><div>$105.00</div></div>
</div>
<div style="padding:12px 16px;background:#FEF3C7;border-radius:8px;font-size:14px;color:#92400E">${CANARY.hidden}</div>
<div style="display:flex;gap:16px"><div style="padding:14px 28px;background:#2563EB;border-radius:8px;color:#FFFFFF;font-size:16px;font-weight:600">Pay $105.00</div><div style="padding:14px 28px;background:#E2E8F0;border-radius:8px;color:#0F172A;font-size:16px;font-weight:600">Back to cart</div></div>
</div>`

export const MOBILE_HTML = `<div style="width:360px;display:flex;flex-direction:column;gap:16px;padding:20px;background:#F8FAFC;color:#0F172A;${FONT}">
<div style="display:flex;justify-content:space-between;align-items:center"><div style="font-size:20px;font-weight:700">Checkout</div><div style="font-size:13px;color:#475569">2 of 3</div></div>
<div style="display:flex;flex-direction:column;gap:10px;padding:16px;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:12px">
<div style="display:flex;justify-content:space-between;font-size:15px"><div>Wireless keyboard</div><div>$89.00</div></div>
<div style="display:flex;justify-content:space-between;font-size:15px"><div>USB-C cable</div><div>$12.00</div></div>
<div style="display:flex;justify-content:space-between;font-size:15px"><div>Delivery</div><div>$4.00</div></div>
<div style="display:flex;justify-content:space-between;font-size:17px;font-weight:700;padding-top:10px;border-top:1px solid #E2E8F0"><div>Total</div><div>$105.00</div></div>
</div>
<div style="padding:14px 20px;background:#2563EB;border-radius:8px;color:#FFFFFF;font-size:16px;font-weight:600;text-align:center">Pay $105.00</div>
</div>`

export const UNREADY_HTML = `<div style="width:320px;padding:20px;background:#FFFFFF;color:#0F172A;${FONT}"><div style="font-size:16px">${CANARY.unready}</div></div>`

/** A second, small screen that stays untouched when the first is edited (the "unchanged" side of CHANGES.md). */
export const RECEIPT_HTML = `<div style="width:320px;display:flex;flex-direction:column;gap:8px;padding:24px;background:#FFFFFF;color:#0F172A;${FONT}"><div style="font-size:20px;font-weight:700">Receipt</div><div style="font-size:14px;color:#475569">Order 1042 is confirmed</div></div>`

/** Launch the built app on a temporary profile and open the Scratchpad. */
export async function launchApp(outDir) {
  mkdirSync(outDir, { recursive: true })
  const ud = mkdtempSync(join(tmpdir(), 'vellum-handoff-ud-'))
  const app = await electron.launch({ args: ['out/main/index.js'], env: { ...process.env, VELLUM_USER_DATA: ud, VELLUM_AGENT_DRIVEN: '0' } })
  const page = await app.firstWindow()
  await page.waitForTimeout(2500)
  await page.locator('input:not([type=file])').first().fill('Tester')
  await page.getByRole('button', { name: 'Create profile' }).click()
  await page.waitForTimeout(2000)
  await page.getByText('Scratchpad').first().dblclick()
  await page.waitForTimeout(2500)
  return { app, page, ud }
}

/** Paste an HTML snippet into the file through the system clipboard (the app's own HTML import path). */
export async function pasteHtml(app, page, html) {
  await app.evaluate(({ clipboard }, h) => clipboard.writeText(h), html)
  // Escape climbs to the parent and then clears the selection: pasting with nothing selected lands at the top level
  for (let i = 0; i < 4; i++) await page.keyboard.press('Escape')
  await page.keyboard.press('Control+v')
  await page.waitForTimeout(900)
}

/**
 * Hide the promo layer of the first frame: expand it in Layers, select the promo text and press Ctrl+Shift+H.
 * Returns whether the layer was found.
 */
export async function hidePromo(page) {
  const first = (await layerRows(page)).filter((r) => r.pad < 16)[0]
  await page.mouse.click(14, first.y + 10) // the row's chevron
  await page.waitForTimeout(300)
  const find = async () => (await layerRows(page)).find((r) => r.text.includes('Free delivery'))
  let promo = await find()
  for (let depth = 0; !promo && depth < 3; depth++) {
    // open the next level of nested frames
    for (const r of (await layerRows(page)).filter((x) => x.pad >= 16)) {
      const chevron = await page.evaluate((id) => {
        const row = document.querySelector(`.lp-layer[data-layer-id="${id}"]`)
        return Boolean(row?.querySelector('.lp-chev svg'))
      }, r.id)
      if (chevron) await page.mouse.click(14 + r.pad - 8, r.y + 10)
    }
    await page.waitForTimeout(200)
    promo = await find()
  }
  if (promo) {
    await page.mouse.click(110, promo.y + 10)
    await page.keyboard.press('Control+Shift+h')
    await page.waitForTimeout(400)
  }
  await page.mouse.click(14, first.y + 10) // collapse again
  await page.waitForTimeout(300)
  return Boolean(promo)
}

/** Top-level rows of the Layers panel in order: { id, text, y }. */
export const layerRows = (page) =>
  page.evaluate(() => [...document.querySelectorAll('.lp-layer')].map((e) => ({ id: e.getAttribute('data-layer-id'), text: e.textContent.trim(), y: Math.round(e.getBoundingClientRect().y), pad: parseFloat(getComputedStyle(e).paddingLeft) })))

export async function tagScreen(page, name, breakpointLabel) {
  const input = page.locator('[data-testid="screen-section"] input').first()
  await input.fill(name)
  await input.press('Enter')
  await page.waitForTimeout(400)
  if (breakpointLabel) {
    const menu = page.locator('[data-testid="screen-section"]').getByRole('button').first()
    await menu.click()
    await page.getByText(breakpointLabel, { exact: false }).first().click()
    await page.waitForTimeout(300)
  }
}

export async function markReady(page, rowY) {
  await page.mouse.click(110, rowY + 10)
  await page.mouse.click(110, rowY + 10, { button: 'right' })
  await page.waitForTimeout(250)
  await page.getByText('Mark ready for dev', { exact: true }).click()
  await page.waitForTimeout(300)
}

/** Export to `target` through the (stubbed) native save dialog; resolves when the done card shows. */
export async function exportFolder(app, page, target) {
  await app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p })
  }, target)
  const direct = page.locator('.insp-top').getByRole('button', { name: /Export handoff/ })
  await direct.first().click()
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Export folder…' }).click()
  await page.waitForFunction(() => /Handoff v\d+ exported|Could not export/.test(document.body.innerText), null, { timeout: 120000 })
  return page.evaluate(() => document.body.innerText)
}
