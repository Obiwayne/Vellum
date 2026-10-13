// Guard for Dev Mode (T63): while a doc is in Dev Mode every store action that can change the design is refused.
// Every function on the store must be classified below: a new action that is in neither list fails the
// "classified" test, so adding an edit path forces a decision (and a line here).
import { beforeEach, describe, expect, it } from 'vitest'
import { canEdit, DEV_MODE_TOOLS, getStore, notifyEditRefused, onEditRefused, useStore } from './store'
import type { Doc } from './types'

const S = getStore
let id: string

/** A doc with a frame, text, a component with an instance, a token, a text style and a comment. */
function seed() {
  const frame = S().createNode(id, { type: 'frame', name: 'Frame', style: { width: 200, height: 100 } }, S().docs[id].pages[0].rootId)
  const text = S().createNode(id, { type: 'text', text: 'Hello' }, frame)
  const other = S().createNode(id, { type: 'rect', style: { width: 10, height: 10 } }, frame)
  const main = S().createComponent(id, [S().createNode(id, { type: 'frame', name: 'Btn', style: { width: 80, height: 32 } }, S().docs[id].pages[0].rootId)])
  const inst = S().createInstance(id, main, S().docs[id].pages[0].rootId)
  S().setTokens(id, [{ name: '--c', value: '#ff0000' }])
  S().addMode(id, 'Dark')
  const style = S().createTextStyle(id, 'Body', text)
  const thread = S().addComment(id, { pageId: S().docs[id].pages[0].id, nodeId: null, ox: 0, oy: 0, x: 0, y: 0 }, 'Look')!
  return { frame, text, other, main, inst, style, thread, page: S().docs[id].pages[0].id }
}
type Seed = ReturnType<typeof seed>

/** Every action that edits the design (or the things the design is made of), with arguments that would succeed in Design mode. */
const DESIGN_EDITS: Record<string, (c: Seed) => void> = {
  addPage: () => S().addPage(id, 'New'),
  renamePage: (c) => S().renamePage(id, c.page, 'Renamed'),
  deletePage: () => {
    const p = S().addPage(id, 'Tmp')
    S().deletePage(id, p || 'none')
  },
  movePage: (c) => S().movePage(id, c.page, 0),
  setPageBackground: (c) => S().setPageBackground(id, c.page, '#123456'),
  createNode: (c) => void S().createNode(id, { type: 'rect' }, c.frame),
  insertHtml: (c) => void S().insertHtml(id, c.frame, '<div>x</div>'),
  updateStyles: (c) => void S().updateStyles(id, [c.other], { width: 50 }),
  updateNode: (c) => S().updateNode(id, c.other, { visible: false }),
  setText: (c) => S().setText(id, c.text, 'Changed'),
  renameNode: (c) => S().renameNode(id, c.other, 'Renamed'),
  moveNodes: (c) => S().moveNodes(id, [c.other], S().docs[id].pages[0].rootId),
  deleteNodes: (c) => S().deleteNodes(id, [c.other]),
  duplicateNodes: (c) => void S().duplicateNodes(id, [c.other]),
  addFlex: (c) => S().addFlex(id, c.frame),
  addGrid: (c) => S().addGrid(id, c.frame),
  switchLayout: (c) => S().switchLayout(id, c.frame, 'grid'),
  wrapInFlex: (c) => void S().wrapInFlex(id, [c.other]),
  removeFlex: (c) => S().removeFlex(id, c.frame),
  createComponent: (c) => void S().createComponent(id, [c.other]),
  createInstance: (c) => void S().createInstance(id, c.main, c.frame),
  detachInstance: (c) => S().detachInstance(id, c.inst),
  resetOverrides: (c) => S().resetOverrides(id, c.inst),
  addVariant: (c) => void S().addVariant(id, c.main),
  setVariantValue: (c) => void S().setVariantValue(id, c.inst, 'p', 'o'),
  addProp: (c) => void S().addProp(id, c.main, { name: 'Label', type: 'text', default: 'x' }),
  bindProp: (c) => S().bindProp(id, c.other, 'visible', 'p'),
  setInstanceProp: (c) => S().setInstanceProp(id, c.inst, 'p', 'v'),
  renameVariantProp: (c) => S().renameVariantProp(id, c.main, 'p', 'State'),
  renameVariantOption: (c) => S().renameVariantOption(id, c.main, 'p', 'a', 'b'),
  removeProp: (c) => S().removeProp(id, c.main, 'p'),
  updateProp: (c) => S().updateProp(id, c.main, 'p', { name: 'x' }),
  resetInstanceProps: (c) => S().resetInstanceProps(id, c.inst),
  createTextStyle: (c) => void S().createTextStyle(id, 'Heading', c.text),
  renameTextStyle: (c) => S().renameTextStyle(id, c.style, 'Renamed'),
  updateTextStyle: (c) => S().updateTextStyle(id, c.style, { fontSize: 30 }),
  deleteTextStyle: (c) => S().deleteTextStyle(id, c.style),
  applyTextStyle: (c) => S().applyTextStyle(id, [c.text], c.style),
  detachTextStyle: (c) => S().detachTextStyle(id, [c.text]),
  setDev: (c) => S().setDev(id, [c.frame], { notes: 'n' }),
  makeStateProperty: (c) => void S().makeStateProperty(id, c.main),
  setScreen: (c) => void S().setScreen(id, c.frame, { name: 'Home', bp: 'Desktop' }),
  setReady: (c) => S().setReady(id, [c.frame], 1),
  mutate: (c) =>
    S().mutate(id, 'Anything', (d) => {
      d.nodes[c.frame].name = 'Hacked'
    }),
  setTokens: () => S().setTokens(id, [{ name: '--x', value: '#000' }]),
  upsertTokens: () => S().upsertTokens(id, [{ name: '--c', value: '#00ff00' }]),
  removeToken: () => S().removeToken(id, '--c'),
  addMode: () => void S().addMode(id, 'Extra'),
  renameMode: () => void S().renameMode(id, 'Dark', 'Night'),
  removeMode: () => S().removeMode(id, 'Dark'),
  setTokenValue: () => S().setTokenValue(id, '--c', null, '#0000ff'),
  undo: () => S().undo(id),
  redo: () => S().redo(id)
}

/** Actions that never change the design: file-level bookkeeping, navigation, selection, camera, comments, transient editor state. */
const NOT_DESIGN_EDITS = new Set([
  'openHistory',
  'closeHistory',
  'hydrate',
  'createDoc',
  'openDoc',
  'closeTab',
  'setActiveTab',
  'reopenClosedTab',
  'cycleTab',
  'goToLastTab',
  'renameDoc',
  'archiveDoc',
  'deleteDoc',
  'setThumbnail',
  'setActivePage',
  'goToMain',
  'addComment',
  'replyComment',
  'setCommentStatus',
  'deleteComment',
  'select',
  'setTool',
  'setDevMode',
  'setCamera',
  'setHovered',
  'setEditingText',
  'setWorkingNodes',
  'addWorkingNodes',
  'transact',
  'canUndo',
  'canRedo',
  'setPref'
])

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true)
  id = S().createDoc('Guard', { open: false })
})

describe('Dev Mode guard: every store action is classified', () => {
  it('each function on the store is a listed design edit or a listed non-edit', () => {
    const s = S() as unknown as Record<string, unknown>
    const fns = Object.keys(s).filter((k) => typeof s[k] === 'function')
    const unclassified = fns.filter((k) => !(k in DESIGN_EDITS) && !NOT_DESIGN_EDITS.has(k))
    expect(unclassified).toEqual([])
    // and nothing in the lists is stale
    const stale = [...Object.keys(DESIGN_EDITS), ...NOT_DESIGN_EDITS].filter((k) => !fns.includes(k))
    expect(stale).toEqual([])
  })
})

describe('Dev Mode guard: design edits are refused', () => {
  for (const [name, run] of Object.entries(DESIGN_EDITS)) {
    it(`${name} changes nothing and says so`, () => {
      const c = seed()
      // give undo something to refuse
      if (name === 'redo') {
        S().renameNode(id, c.other, 'Before')
        S().undo(id)
      }
      S().setDevMode(id, true)
      expect(canEdit(id)).toBe(false)
      const before = S().docs[id]
      const snapshot = JSON.stringify(before)
      const undoable = S().canUndo(id)
      const redoable = S().canRedo(id)
      let refused = 0
      const off = onEditRefused((d) => d === id && refused++)
      try {
        run(c)
      } finally {
        off()
      }
      expect(S().docs[id]).toBe(before) // same object: not even a no-op copy
      expect(JSON.stringify(S().docs[id])).toBe(snapshot)
      expect(S().canUndo(id)).toBe(undoable)
      expect(S().canRedo(id)).toBe(redoable)
      expect(refused).toBeGreaterThan(0)
    })
  }

  it('the same actions work again after switching back to Design', () => {
    const c = seed()
    S().setDevMode(id, true)
    S().setText(id, c.text, 'nope')
    S().setDevMode(id, false)
    S().setText(id, c.text, 'yes')
    expect(S().docs[id].nodes[c.text].text).toBe('yes')
    S().undo(id)
    expect(S().docs[id].nodes[c.text].text).toBe('Hello')
  })
})

describe('Dev Mode guard: what still works', () => {
  it('selecting, hovering, the camera, comments and page switching are allowed', () => {
    const c = seed()
    S().setDevMode(id, true)
    S().select(id, [c.frame])
    expect(S().editors[id].selection).toEqual([c.frame])
    S().setHovered(id, c.text)
    S().setCamera(id, { zoom: 2 })
    expect(S().editors[id].camera.zoom).toBe(2)
    const t = S().addComment(id, { pageId: c.page, nodeId: c.frame, ox: 0, oy: 0, x: 1, y: 1 }, 'From dev')
    expect(t).toBeTruthy()
    expect(S().docs[id].comments?.some((x) => x.id === t)).toBe(true)
    S().setCommentStatus(id, c.thread, 'resolved')
    expect(S().docs[id].comments?.find((x) => x.id === c.thread)?.status).toBe('resolved')
    const p = S().docs[id].pages[0].id
    S().setActivePage(id, p)
  })

  it('only the non-drawing tools can be picked', () => {
    seed()
    S().setDevMode(id, true)
    for (const t of ['frame', 'rect', 'pen', 'text', 'shader', 'image', 'svg', 'icon'] as const) {
      S().setTool(id, t)
      expect(S().editors[id].tool).toBe('move')
    }
    for (const t of DEV_MODE_TOOLS) {
      S().setTool(id, t)
      expect(S().editors[id].tool).toBe(t)
    }
  })

  it('turning Dev Mode on drops a drawing tool and a text edit in progress', () => {
    const c = seed()
    S().setTool(id, 'rect')
    S().setEditingText(id, c.text)
    S().setDevMode(id, true)
    expect(S().editors[id].tool).toBe('move')
    expect(S().editors[id].editingTextId).toBeNull()
    S().setEditingText(id, c.text)
    expect(S().editors[id].editingTextId).toBeNull()
  })

  it('Dev Mode is per file and is not part of the saved document', () => {
    const other = S().createDoc('Other', { open: false })
    const c = seed()
    S().setDevMode(id, true)
    expect(canEdit(other)).toBe(true)
    expect(JSON.stringify(S().docs[id])).not.toContain('devMode')
    S().setText(other, S().createNode(other, { type: 'text', text: 'a' }, S().docs[other].pages[0].rootId), 'b')
    expect(Object.values((S().docs[other] as Doc).nodes).some((n) => n.text === 'b')).toBe(true)
    expect(c.text).toBeTruthy()
  })

  it('notifyEditRefused reaches listeners', () => {
    let n = 0
    const off = onEditRefused(() => n++)
    notifyEditRefused(id)
    off()
    notifyEditRefused(id)
    expect(n).toBe(1)
  })
})
