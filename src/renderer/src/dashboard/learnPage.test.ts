// @vitest-environment jsdom
// The Learn page has an Updates entry that uses the app's real labels.
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { describe, expect, it } from 'vitest'
import handoffDoc from '../../../../docs/HANDOFF.md?raw'
import { HANDOFF_DOC_URL, LearnPage } from './LearnPage'

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

  it('has a Developer handoff and Dev Mode section with the real labels and a link to docs/HANDOFF.md', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => root.render(createElement(LearnPage)))
    expect([...host.querySelectorAll('h2')].map((h) => h.textContent)).toContain('Developer handoff and Dev Mode')
    const section = host.querySelector('[data-learn="handoff"]')
    const text = section?.textContent ?? ''
    for (const x of ['Open in Dev Mode', 'Mark ready for dev', 'Export handoff…', 'Export folder…', 'Save as zip…', 'Changed since ready', 'CHANGES.md', 'get_dev_spec', 'export_handoff', 'docs/HANDOFF.md']) {
      expect(text, x).toContain(x)
    }
    // the shortcut list carries the Dev Mode key
    expect(host.textContent).toContain('Dev Mode (Design | Dev)')
    const opened: string[] = []
    ;(window as unknown as { canvasApi: unknown }).canvasApi = { openExternal: (u: string) => opened.push(u) }
    const link = [...(section?.querySelectorAll('button') ?? [])].find((b) => /HANDOFF\.md/.test(b.textContent ?? ''))
    expect(link).toBeTruthy()
    act(() => link!.click())
    expect(opened).toEqual([HANDOFF_DOC_URL])
    expect(HANDOFF_DOC_URL.startsWith('https://github.com/')).toBe(true)
    expect(HANDOFF_DOC_URL.endsWith('/docs/HANDOFF.md')).toBe(true)
    act(() => root.unmount())
    host.remove()
  })

  it("docs/HANDOFF.md starts with Andy's quick start box, the same box every export opens with", () => {
    const nl = String.fromCharCode(10)
    const doc = handoffDoc.split(String.fromCharCode(13)).join('')
    const afterTitle = doc.split(nl).slice(1).join(nl).trimStart()
    expect(afterTitle.startsWith("> ## Andy's quick start")).toBe(true)
    const box = afterTitle.split(nl + nl)[0]
    expect(box).toContain('Tell Claude Code')
    expect(box).toContain('PNGs in screens/')
  })
})
