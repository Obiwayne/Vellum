// One snapshot per generated file of the fixture bundle: a change to any output shows up as a diff under
// `__snapshots__/checkout/`. Update deliberately with `npx vitest run -u`.
import { describe, expect, it } from 'vitest'
import { buildHandoff } from './index'
import { checkoutDoc } from './fixture'

const f = checkoutDoc()
const bundle = buildHandoff(f.doc, {
  frames: [f.desktop, f.mobile],
  version: 3,
  exportedAt: '2026-01-02T03:04:05.000Z',
  vellum: '1.0.0',
  projectLabel: 'Acme Checkout',
  measure: f.measure,
  renders: true
})

describe('fixture bundle, file by file', () => {
  it('has the expected set of files', () => {
    expect(Object.keys(bundle.files)).toMatchSnapshot()
  })
  for (const path of Object.keys(bundle.files)) {
    it(path, async () => {
      await expect(bundle.files[path]).toMatchFileSnapshot(`./__snapshots__/checkout/${path}`)
    })
  }
})
