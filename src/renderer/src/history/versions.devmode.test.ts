import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../editor/canvas/toast', () => ({ toast: vi.fn() }))

import type { VersionMeta } from '@shared/api'
import { getStore, onEditRefused, useStore } from '../model/store'
import { restoreVersion } from './versions'

const meta: VersionMeta = { id: 'v1', docUpdatedAt: 1, kind: 'auto' } as VersionMeta

describe('restoreVersion in Dev Mode', () => {
  let save: ReturnType<typeof vi.fn>
  let load: ReturnType<typeof vi.fn>
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
    save = vi.fn(async () => ({}))
    load = vi.fn(async () => null)
    ;(globalThis as { window?: unknown }).window = { canvasApi: { history: { save, load, list: vi.fn() } } }
  })

  it('returns false, writes no "Before restore" version, loads nothing and tells the editor', async () => {
    const id = getStore().createDoc('D', { open: false })
    getStore().setDevMode(id, true)
    const refused = vi.fn()
    const off = onEditRefused(refused)
    const before = getStore().docs[id]
    expect(await restoreVersion(id, meta)).toBe(false)
    off()
    expect(save).not.toHaveBeenCalled()
    expect(load).not.toHaveBeenCalled()
    expect(refused).toHaveBeenCalledWith(id)
    expect(getStore().docs[id]).toBe(before)
  })

  it('in Design mode it still gets as far as loading the version', async () => {
    const id = getStore().createDoc('D', { open: false })
    expect(await restoreVersion(id, meta)).toBe(false) // the version could not be read
    expect(load).toHaveBeenCalledWith(id, 'v1')
  })
})
