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
    expect(text).toContain('Restart to update (your files are saved first)') // a space between the bold label and the bracket
    act(() => root.unmount())
    host.remove()
  })

  it('has a Crash recovery section that uses the words of the restore prompt', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => root.render(createElement(LearnPage)))
    expect([...host.querySelectorAll('h2')].map((h) => h.textContent)).toContain('Crash recovery')
    const text = host.querySelector('[data-learn="recovery"]')?.textContent ?? ''
    for (const x of ['Unsaved changes found', 'Restore', 'Discard', '.bak', '%APPDATA%\\Vellum']) expect(text, x).toContain(x)
    act(() => root.unmount())
    host.remove()
  })
  it('puts a space between Restart to update and the parenthesis after it', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => root.render(createElement(LearnPage)))
    const text = host.querySelector('[data-learn="updates"]')?.textContent ?? ''
    expect(text).toContain('Restart to update (your files are saved first)')
    act(() => root.unmount())
    host.remove()
  })
})
