// @vitest-environment jsdom
// Update UI wiring, every state, for an installed build and for a clone (git wording unchanged).
import { createElement, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateStatus } from '@shared/api'
import { useStore } from '../model/store'
import { UpdateBadge, UpdateDialog, UpdateReminder, initUpdates, useUpdates, updateKey } from './updates'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const base: UpdateStatus = { state: 'idle', commits: [], behind: 0, dirty: [], dev: false, current: '0.1.0' }
const inst = (p: Partial<UpdateStatus>): UpdateStatus => ({ ...base, installed: true, ...p })
const clone = (p: Partial<UpdateStatus>): UpdateStatus => ({ ...base, installed: false, ...p })

const api = { status: vi.fn(), check: vi.fn(), install: vi.fn(), setAutoCheck: vi.fn(), onStatus: vi.fn() }
let host: HTMLElement
let root: Root
let push: (s: UpdateStatus) => void

function mount(...els: Parameters<typeof createElement>[0][]): void {
  act(() => root.render(createElement('div', null, ...els.map((e, i) => createElement(e as never, { key: i })))))
}
const text = (): string => host.textContent ?? ''
const click = (label: string | RegExp): void => {
  const b = [...host.querySelectorAll('button')].find((x) => (typeof label === 'string' ? x.textContent?.trim() === label || x.getAttribute('aria-label') === label : label.test(x.textContent ?? '')))
  if (!b) throw new Error(`no button ${label}`)
  act(() => b.click())
}
const has = (label: string): boolean => [...host.querySelectorAll('button')].some((x) => x.textContent?.trim() === label || x.getAttribute('aria-label') === label)
const set = (s: UpdateStatus): void => act(() => useUpdates.setState({ status: s }))

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  api.status.mockResolvedValue(null)
  api.check.mockResolvedValue(null)
  api.install.mockResolvedValue(null)
  api.onStatus.mockImplementation((cb: (s: UpdateStatus) => void) => {
    push = cb
    return () => undefined
  })
  ;(window as unknown as { canvasApi: unknown }).canvasApi = { updates: api }
  useUpdates.setState({ status: null, dialog: false, dismissed: null })
  useStore.setState(useStore.getInitialState(), true)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('installed build', () => {
  it('available: "Version X is available" with expandable release notes', () => {
    mount(UpdateReminder)
    set(inst({ state: 'available', latest: '0.2.0', progress: 0, releaseNotes: 'Faster export' }))
    expect(text()).toContain('Version 0.2.0 is available')
    expect(text()).not.toContain('Faster export')
    click(/Release notes/)
    expect(text()).toContain('Faster export')
    click(/Release notes/)
    expect(text()).not.toContain('Faster export')
    expect(has('Restart to update')).toBe(false)
  })

  it('downloading: shows percent and a progress bar', () => {
    mount(UpdateReminder)
    set(inst({ state: 'downloading', latest: '0.2.0', progress: 42 }))
    expect(text()).toContain('Downloading… 42%')
    const bar = host.querySelector('[role=progressbar]') as HTMLElement
    expect(bar.getAttribute('aria-valuenow')).toBe('42')
    expect((bar.firstElementChild as HTMLElement).style.width).toBe('42%')
  })

  it('ready: Restart to update calls install; Later hides the card for the session', () => {
    mount(UpdateReminder, UpdateBadge)
    set(inst({ state: 'ready', latest: '0.2.0' }))
    expect(text()).toContain('Version 0.2.0 is ready to install')
    expect(host.querySelector('.tb-update')?.textContent).toContain('Restart to update')
    click('Later')
    expect(host.querySelector('.upd-card')).toBeNull()
    expect(host.querySelector('.tb-update')).not.toBeNull() // the badge stays, so it can still be reached
    expect(localStorage.getItem('vellum.update.snooze')).toBeNull() // session only: nothing persisted
    // the card's own button
    act(() => useUpdates.setState({ dismissed: null }))
    const btns = [...host.querySelectorAll('.upd-card button')]
    act(() => (btns.find((b) => b.textContent === 'Restart to update') as HTMLElement).click())
    expect(api.install).toHaveBeenCalledTimes(1)
  })

  it('error: short message with Retry (check again)', () => {
    mount(UpdateReminder)
    set(inst({ state: 'error', message: 'Could not update: offline' }))
    expect(text()).toContain('Could not update: offline')
    click('Retry')
    expect(api.check).toHaveBeenCalledTimes(1)
  })

  it('dismissing is per version / per error: a newer version shows the card again', () => {
    mount(UpdateReminder)
    set(inst({ state: 'available', latest: '0.2.0' }))
    click('Dismiss')
    expect(host.querySelector('.upd-card')).toBeNull()
    expect(useUpdates.getState().dismissed).toBe(updateKey(inst({ latest: '0.2.0' })))
    set(inst({ state: 'downloading', latest: '0.2.0', progress: 5 }))
    expect(host.querySelector('.upd-card')).toBeNull() // same version, still dismissed
    set(inst({ state: 'available', latest: '0.3.0' }))
    expect(host.querySelector('.upd-card')).not.toBeNull()
  })

  it('no card for idle, checking, up-to-date, installing or unsupported', () => {
    mount(UpdateReminder, UpdateBadge)
    for (const state of ['idle', 'checking', 'up-to-date', 'unsupported'] as const) {
      set(inst({ state }))
      expect(host.querySelector('.upd-card')).toBeNull()
      expect(host.querySelector('.tb-update')).toBeNull()
    }
    set(inst({ state: 'installing', latest: '0.2.0' }))
    expect(host.querySelector('.upd-card')).toBeNull()
    expect(host.querySelector('.tb-update')?.textContent).toContain('Updating…')
  })

  it('never blocks editing: the card is not a modal and has no overlay', () => {
    mount(UpdateReminder)
    set(inst({ state: 'ready', latest: '0.2.0' }))
    expect(host.querySelector('[aria-modal], .modal, dialog')).toBeNull()
  })

  it('dialog (Help, Check for Updates): statuses, progress, notes, Restart to update', () => {
    mount(UpdateDialog)
    act(() => useUpdates.setState({ dialog: true, status: inst({ state: 'up-to-date' }) }))
    expect(document.body.textContent).toContain("You're on the latest version (0.1.0)")
    act(() => useUpdates.setState({ status: inst({ state: 'downloading', latest: '0.2.0', progress: 60, releaseNotes: 'Notes here' }) }))
    expect(document.body.textContent).toContain('is downloading… 60%')
    expect(document.body.textContent).toContain('Notes here')
    act(() => useUpdates.setState({ status: inst({ state: 'ready', latest: '0.2.0' }) }))
    const restart = [...document.body.querySelectorAll('button')].find((b) => b.textContent === 'Restart to update')
    expect(restart).toBeTruthy()
    act(() => restart!.click())
    expect(api.install).toHaveBeenCalled()
    act(() => useUpdates.setState({ status: inst({ state: 'error', message: 'Could not update: offline' }) }))
    expect(document.body.textContent).toContain('Could not update: offline')
    expect([...document.body.querySelectorAll('button')].some((b) => b.textContent === 'Retry')).toBe(true)
  })
})

describe('clone build keeps the git wording', () => {
  it('available: "Vellum update available", N changes, What\'s new, Update and restart', () => {
    mount(UpdateReminder, UpdateBadge)
    set(clone({ state: 'available', behind: 3, latest: 'abc1234', commits: [{ hash: 'abc1234', subject: 'Fix zoom', date: 0 }] }))
    expect(text()).toContain('Vellum update available')
    expect(text()).toContain('3 changes since your version.')
    expect(text()).toContain('Latest: Fix zoom')
    expect(host.querySelector('.tb-update')?.textContent).toContain('Update')
    expect(host.querySelector('.tb-update')?.textContent).not.toContain('Restart to update')
    click('Update and restart')
    expect(api.install).toHaveBeenCalledTimes(1)
  })

  it('Later snoozes for a day (stored), unlike the installed card', () => {
    mount(UpdateReminder)
    set(clone({ state: 'available', behind: 1, latest: 'abc1234' }))
    click('Later')
    expect(host.querySelector('.upd-card')).toBeNull()
    expect(localStorage.getItem('vellum.update.snooze')).toContain('abc1234')
  })

  it('shows nothing for downloading/ready/error cards (those are installed-only); the dialog shows git wording', () => {
    mount(UpdateReminder, UpdateDialog)
    for (const state of ['downloading', 'ready', 'error'] as const) {
      set(clone({ state, message: 'x' }))
      expect(host.querySelector('.upd-card')).toBeNull()
    }
    act(() => useUpdates.setState({ dialog: true, status: clone({ state: 'available', behind: 2, latest: 'def5678', current: 'abc1234' }) }))
    expect(document.body.textContent).toContain("2 changes available. You're on abc1234, the latest is def5678.")
    expect([...document.body.querySelectorAll('button')].some((b) => b.textContent === 'Update and restart')).toBe(true)
    act(() => useUpdates.setState({ status: clone({ state: 'up-to-date', message: 'Already current.' }) }))
    expect(document.body.textContent).toContain('Already current.')
  })

  it('unsupported (a copy that cannot update) offers the GitHub link in the dialog', () => {
    mount(UpdateDialog)
    act(() => useUpdates.setState({ dialog: true, status: clone({ state: 'unsupported', message: 'Download the latest version from GitHub.' }) }))
    expect(document.body.textContent).toContain('Download the latest version from GitHub.')
    expect([...document.body.querySelectorAll('button')].some((b) => b.textContent === 'Open GitHub')).toBe(true)
  })
})

describe('initUpdates and the auto-check setting', () => {
  it('loads the status, follows pushes, and sends the setting (default on) then every change', async () => {
    api.status.mockResolvedValue(inst({ state: 'up-to-date' }))
    const off = initUpdates()
    await act(async () => undefined)
    expect(useUpdates.getState().status?.state).toBe('up-to-date')
    expect(api.setAutoCheck).toHaveBeenLastCalledWith(true)
    act(() => push(inst({ state: 'available', latest: '0.2.0' })))
    expect(useUpdates.getState().status?.latest).toBe('0.2.0')
    act(() => useStore.getState().setPref('updates.auto', false))
    expect(api.setAutoCheck).toHaveBeenLastCalledWith(false)
    const n = api.setAutoCheck.mock.calls.length
    act(() => useStore.getState().setPref('userName', 'Sam')) // unrelated pref: no resend
    expect(api.setAutoCheck.mock.calls.length).toBe(n)
    act(() => useStore.getState().setPref('updates.auto', true))
    expect(api.setAutoCheck).toHaveBeenLastCalledWith(true)
    off()
  })

  it('without the bridge (a plain browser) it does nothing and does not throw', () => {
    ;(window as unknown as { canvasApi?: unknown }).canvasApi = undefined
    expect(() => initUpdates()()).not.toThrow()
  })
})
