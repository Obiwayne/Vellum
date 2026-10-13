// @vitest-environment jsdom
// T77: the file card menu's "Open in Dev Mode" opens the file straight into read-only Dev Mode.
import { beforeEach, describe, expect, it } from 'vitest'
import { canEdit, getStore, useStore } from '../model/store'
import { fileMenu } from './FileCard'

const S = getStore
const entry = (id: string, label: string) => {
  const e = fileMenu(S().docs[id], { rename: () => undefined, askDelete: () => undefined }).find((m) => 'label' in m && m.label === label)
  if (!e || !('onSelect' in e) || !e.onSelect) throw new Error(`no menu entry ${label}`)
  return e
}

beforeEach(() => useStore.setState(useStore.getInitialState(), true))

describe('Open in Dev Mode', () => {
  it('sits right under Open in the file menu', () => {
    const id = S().createDoc('Acme', { open: false })
    const labels = fileMenu(S().docs[id], { rename: () => undefined, askDelete: () => undefined }).flatMap((m) => ('label' in m ? [m.label] : []))
    expect(labels.slice(0, 3)).toEqual(['Open', 'Open in Dev Mode', 'Open in new tab'])
  })

  it('opens the file in a tab, active, in Dev Mode: nothing can be edited', () => {
    const id = S().createDoc('Acme', { open: false })
    expect(S().tabs).not.toContain(id)
    entry(id, 'Open in Dev Mode').onSelect?.()
    expect(S().tabs).toContain(id)
    expect(S().activeTab).toBe(id)
    expect(S().editors[id].devMode).toBe(true)
    expect(canEdit(id)).toBe(false)
  })

  it('after Open in Dev Mode the design cannot be changed: edits are refused and the document is untouched', () => {
    const id = S().createDoc('Acme', { open: false })
    const root = S().docs[id].pages[0].rootId
    const frame = S().createNode(id, { type: 'frame', name: 'Frame', style: { width: 200, height: 100 } }, root)
    const text = S().createNode(id, { type: 'text', text: 'Hello' }, frame)
    entry(id, 'Open in Dev Mode').onSelect?.()
    const before = JSON.stringify(S().docs[id])
    S().createNode(id, { type: 'rect' }, frame)
    S().setText(id, text, 'Changed')
    S().updateStyles(id, [frame], { width: 50 })
    S().renameNode(id, frame, 'Renamed')
    S().deleteNodes(id, [text])
    S().setReady(id, [frame], 1)
    S().setDev(id, [frame], { notes: 'x' })
    expect(JSON.stringify(S().docs[id])).toBe(before)
    // Dev Mode is a view setting: leaving it restores editing
    S().setDevMode(id, false)
    S().setText(id, text, 'Changed')
    expect(S().docs[id].nodes[text].text).toBe('Changed')
  })

  it('plain Open still opens for editing', () => {
    const id = S().createDoc('Acme', { open: false })
    entry(id, 'Open').onSelect?.()
    expect(S().activeTab).toBe(id)
    expect(canEdit(id)).toBe(true)
  })

  it('a file already open for editing switches to Dev Mode, and the Scratchpad has the entry too', () => {
    const id = S().createDoc('Acme', { open: true })
    expect(canEdit(id)).toBe(true)
    entry(id, 'Open in Dev Mode').onSelect?.()
    expect(canEdit(id)).toBe(false)
    const scratch = Object.values(S().docs).find((d) => d.scratchpad)
    if (scratch) expect(entry(scratch.id, 'Open in Dev Mode')).toBeTruthy()
  })
})
