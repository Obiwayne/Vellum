// @vitest-environment jsdom
// The Learn page has an Updates entry that uses the app's real labels.
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { describe, expect, it } from 'vitest'
import { LearnPage } from './LearnPage'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('Learn page', () => {
  it('has an Updates section: the auto-check setting, Help menu item, Restart to update, Later, and where the data lives', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => root.render(createElement(LearnPage)))
    const headings = [...host.querySelectorAll('h2')].map((h) => h.textContent)
    expect(headings).toContain('Updates')
    const text = host.querySelector('[data-learn="updates"]')?.textContent ?? ''
    for (const s of ['Check for updates automatically', 'Check for Updates…', 'Version X is ready to install', 'Restart to update', 'Later', '%APPDATA%\\Vellum', 'Update and restart']) {
      expect(text, s).toContain(s)
    }
    act(() => root.unmount())
    host.remove()
  })
})
