// Central zustand store: docs, tabs, per-doc editor state and every mutation (undoable ones go
// through `mutate`, which records immer patches in model/history.ts).
import { create } from 'zustand'
import { original, produce, produceWithPatches } from 'immer'
import type { Patch } from 'immer'
import { nanoid } from 'nanoid'
import type { Camera, CNode, CommentThread, Doc, EditorState, NodeType, Page, StylePatch, TabId, Token, Tool, WorldRect } from './types'
import { history } from './history'
import * as ops from './ops'
import * as comp from './components'
import { htmlToNodes } from './html'
import { MODE_ATTR, MODE_NAME_RE } from './modes'

export const DASHBOARD: TabId = 'dashboard'

export interface HydrateData {
  docs: Record<string, Doc>
  recents: string[]
  tabs: string[]
  activeTab: string
  prefs: Record<string, unknown>
  scratchpadId?: string
}

export interface MutateOptions {
  /** consecutive mutations with the same key within 1s merge into one undo step (scrubbing, sliders) */
  coalesce?: string
  /** skip history (e.g. thumbnails) */
  noHistory?: boolean
  /** the recipe maintains instances itself: do not read its changes to instance nodes as user edits (see components.settleEdits) */
  derived?: boolean
}

export interface Store {
  ready: boolean
  docs: Record<string, Doc>
  tabs: TabId[]
  activeTab: TabId
  /** doc ids, most recent first */
  recents: string[]
  /** stack of recently closed doc tabs (for Reopen Closed Tab) */
  closedTabs: string[]
  /** id of the permanent Scratchpad doc */
  scratchpadId?: string
  editors: Record<string, EditorState>
  prefs: Record<string, unknown>
  /** bumps on every history change so undo/redo UI can re-render */
  historyTick: number
  /** doc whose version history is open (full-window viewer), or null */
  historyDocId: string | null

  openHistory(docId: string): void
  closeHistory(): void

  hydrate(data: HydrateData): void

  // files
  createDoc(name?: string, opts?: { open?: boolean }): string
  openDoc(id: string): void
  closeTab(id: TabId): void
  setActiveTab(id: TabId): void
  reopenClosedTab(): void
  cycleTab(dir: 1 | -1): void
  goToLastTab(): void
  renameDoc(id: string, name: string): void
  archiveDoc(id: string, archived: boolean): void
  deleteDoc(id: string): void
  setThumbnail(id: string, dataUrl: string | undefined): void

  // pages (undoable)
  addPage(docId: string, name?: string): string
  renamePage(docId: string, pageId: string, name: string): void
  deletePage(docId: string, pageId: string): void
  /** Move a page to `index` in the pages list (index in the list without the page). */
  movePage(docId: string, pageId: string, index: number): void
  setActivePage(docId: string, pageId: string): void
  setPageBackground(docId: string, pageId: string, color: string): void

  // nodes (undoable)
  createNode(docId: string, partial: Partial<CNode> & { type: NodeType }, parentId: string, index?: number): string
  insertHtml(docId: string, parentId: string, html: string, index?: number): string[]
  updateStyles(docId: string, ids: string[], patch: StylePatch, opts?: MutateOptions): void
  updateNode(docId: string, id: string, patch: Partial<CNode>, opts?: MutateOptions): void
  setText(docId: string, id: string, text: string, opts?: MutateOptions): void
  renameNode(docId: string, id: string, name: string): void
  moveNodes(docId: string, ids: string[], newParentId: string, index?: number): void
  deleteNodes(docId: string, ids: string[]): void
  duplicateNodes(docId: string, ids: string[]): string[]
  addFlex(docId: string, id: string): void
  addGrid(docId: string, id: string): void
  switchLayout(docId: string, id: string, to: 'flex' | 'grid'): void
  wrapInFlex(docId: string, ids: string[]): string | null
  removeFlex(docId: string, id: string): void

  // components (undoable; see model/components.ts, docs/COMPONENTS.md)
  /** make a component from the ids: a single frame becomes the main, anything else is wrapped in a frame first. `geometry` = measured world rects when the UI has them. Returns the main's id. */
  createComponent(docId: string, ids: string[], geometry?: ComponentGeometry, name?: string): string
  createInstance(docId: string, mainId: string, parentId: string, index?: number, at?: { x: number; y: number }): string
  detachInstance(docId: string, id: string): void
  /** drop one node's override (srcId = the main-side node id) or all of the instance's */
  resetOverrides(docId: string, instanceId: string, srcId?: string): void
  /** generic escape hatch: run an arbitrary recipe on the doc draft as one undoable step */
  mutate(docId: string, label: string, recipe: (draft: Doc) => void, opts?: MutateOptions): void

  // tokens (undoable)
  setTokens(docId: string, tokens: Token[]): void
  upsertTokens(docId: string, tokens: Token[]): void
  removeToken(docId: string, name: string): void
  /** add a theme mode (the first call also creates the base mode); values start as copies of the base */
  addMode(docId: string, name: string, baseName?: string): string | null
  renameMode(docId: string, from: string, to: string): boolean
  removeMode(docId: string, name: string): void
  /** set a token's value in a mode (the base mode writes token.value) */
  setTokenValue(docId: string, tokenName: string, mode: string | null, value: string | null, opts?: MutateOptions): void

  // comments (saved with the file, not part of undo history)
  addComment(docId: string, anchor: CommentAnchor, body: string, author?: CommentAuthor): string | null
  replyComment(docId: string, threadId: string, body: string, author?: CommentAuthor): boolean
  setCommentStatus(docId: string, threadId: string, status: CommentThread['status']): boolean
  deleteComment(docId: string, threadId: string): void

  // editor (not undoable)
  select(docId: string, ids: string[], additive?: boolean): void
  setTool(docId: string, tool: Tool): void
  setCamera(docId: string, camera: Partial<Camera>): void
  setHovered(docId: string, id: string | null): void
  setEditingText(docId: string, id: string | null): void
  setWorkingNodes(docId: string, ids: string[]): void
  addWorkingNodes(docId: string, ids: string[]): void

  // history
  undo(docId: string): void
  redo(docId: string): void
  transact<T>(docId: string, label: string, fn: () => T): T
  canUndo(docId: string): boolean
  canRedo(docId: string): boolean

  // prefs (persisted in index.json)
  setPref(key: string, value: unknown): void
}

/** World geometry for wrapping a multi-node selection into a component (see ops.wrapNodes). */
export interface ComponentGeometry {
  rects: Map<string, WorldRect | null>
  bounds: WorldRect
  origin: { x: number; y: number }
}
export type CommentAnchor = Pick<CommentThread, 'pageId' | 'nodeId' | 'ox' | 'oy' | 'x' | 'y'>
export interface CommentAuthor {
  kind: 'user' | 'agent'
  name: string
}
const YOU: CommentAuthor = { kind: 'user', name: 'You' }

export function defaultEditor(doc: Doc): EditorState {
  return {
    docId: doc.id,
    pageId: doc.pages[0]?.id ?? '',
    selection: [],
    hovered: null,
    tool: 'move',
    camera: { x: 120, y: 120, zoom: 1 },
    editingTextId: null,
    workingNodes: []
  }
}

const touchRecents = (recents: string[], id: string): string[] => [id, ...recents.filter((r) => r !== id)]

export const useStore = create<Store>()((set, get) => {
  /** Apply an undoable recipe to a doc. Returns false if the doc does not exist. */
  function mutate(docId: string, label: string, recipe: (d: Doc) => void, opts: MutateOptions = {}): boolean {
    const doc = get().docs[docId]
    if (!doc) return false
    let [next, patches, inverse] = produceWithPatches(doc, (d) => {
      recipe(d)
      // instance edits become overrides; structural ones throw; orphaned instances detach
      if (!opts.derived && comp.usesComponents(doc)) comp.settleEdits(d, original(d) as Doc)
    })
    if (comp.usesComponents(doc) || comp.usesComponents(next)) {
      // derived instance nodes follow their mains (same undo step: the patches are concatenated)
      const changed = new Set<string>()
      for (const p of patches) if (p.path[0] === 'nodes' && p.path.length >= 2) changed.add(String(p.path[1]))
      const stale = comp.staleAfter(doc, next, changed)
      if (stale.mains.size || stale.roots.size) {
        const [n2, p2, i2] = produceWithPatches(next, (d) => comp.syncStale(d, stale))
        next = n2
        patches = [...patches, ...p2] as Patch[]
        inverse = [...i2, ...inverse] as Patch[]
      }
    }
    if (!patches.length) return true
    const stamped = { ...next, updatedAt: Date.now() }
    if (!opts.noHistory) history.record(docId, label, patches, inverse, opts.coalesce)
    set((s) => ({
      docs: { ...s.docs, [docId]: stamped },
      recents: s.recents[0] === docId ? s.recents : touchRecents(s.recents, docId),
      historyTick: s.historyTick + 1
    }))
    return true
  }

  function editor(docId: string, fn: (e: EditorState) => void): void {
    const doc = get().docs[docId]
    if (!doc) return
    set((s) => {
      const cur = s.editors[docId] ?? defaultEditor(doc)
      const next = produce(cur, fn)
      return next === cur && s.editors[docId] ? {} : { editors: { ...s.editors, [docId]: next } }
    })
  }

  /** Drop selection/hover/editing refs to nodes that no longer exist, and fix the active page. */
  function pruneEditor(docId: string): void {
    const doc = get().docs[docId]
    if (!doc) return
    editor(docId, (e) => {
      const alive = (id: string): boolean => Boolean(doc.nodes[id])
      if (e.selection.some((id) => !alive(id))) e.selection = e.selection.filter(alive)
      if (e.hovered && !alive(e.hovered)) e.hovered = null
      if (e.editingTextId && !alive(e.editingTextId)) e.editingTextId = null
      if (e.workingNodes.some((id) => !alive(id))) e.workingNodes = e.workingNodes.filter(alive)
      if (!doc.pages.some((p) => p.id === e.pageId)) e.pageId = doc.pages[0]?.id ?? ''
    })
  }

  const pageById = (doc: Doc, pageId: string): Page | undefined => doc.pages.find((p) => p.id === pageId)

  return {
    ready: false,
    docs: {},
    tabs: [DASHBOARD],
    activeTab: DASHBOARD,
    recents: [],
    closedTabs: [],
    scratchpadId: undefined,
    editors: {},
    prefs: {},
    historyTick: 0,
    historyDocId: null,

    openHistory(docId) {
      if (get().docs[docId]) set({ historyDocId: docId })
    },
    closeHistory() {
      set({ historyDocId: null })
    },

    hydrate(data) {
      const editors: Record<string, EditorState> = {}
      for (const d of Object.values(data.docs)) editors[d.id] = defaultEditor(d)
      const tabs = [DASHBOARD, ...data.tabs.filter((t) => t !== DASHBOARD && data.docs[t])]
      const activeTab = tabs.includes(data.activeTab) ? data.activeTab : DASHBOARD
      set({
        ready: true,
        docs: data.docs,
        recents: data.recents.filter((r) => data.docs[r]),
        tabs,
        activeTab,
        prefs: data.prefs,
        scratchpadId: data.scratchpadId,
        editors
      })
    },

    // ------------------------------------------------------------------ files
    createDoc(name, opts = {}) {
      const id = nanoid(12)
      const doc = produce(ops.makeDoc(id, name ?? 'Untitled'), () => undefined)
      set((s) => ({
        docs: { ...s.docs, [id]: doc },
        editors: { ...s.editors, [id]: defaultEditor(doc) },
        recents: touchRecents(s.recents, id)
      }))
      if (opts.open !== false) get().openDoc(id)
      return id
    },

    openDoc(id) {
      const s = get()
      const doc = s.docs[id]
      if (!doc) return
      set({
        tabs: s.tabs.includes(id) ? s.tabs : [...s.tabs, id],
        activeTab: id,
        historyDocId: null,
        recents: touchRecents(s.recents, id),
        editors: s.editors[id] ? s.editors : { ...s.editors, [id]: defaultEditor(doc) }
      })
    },

    closeTab(id) {
      if (id === DASHBOARD) return
      const s = get()
      const i = s.tabs.indexOf(id)
      if (i < 0) return
      const tabs = s.tabs.filter((t) => t !== id)
      const activeTab = s.activeTab === id ? tabs[Math.min(i, tabs.length - 1)] ?? DASHBOARD : s.activeTab
      set({ tabs, activeTab, closedTabs: [...s.closedTabs.filter((c) => c !== id), id].slice(-20) })
    },

    setActiveTab(id) {
      const s = get()
      if (!s.tabs.includes(id)) {
        if (s.docs[id]) get().openDoc(id)
        return
      }
      set({ activeTab: id, historyDocId: null, recents: id !== DASHBOARD ? touchRecents(s.recents, id) : s.recents })
    },

    reopenClosedTab() {
      const s = get()
      const closed = [...s.closedTabs]
      while (closed.length) {
        const id = closed.pop() as string
        if (s.docs[id]) {
          set({ closedTabs: closed })
          get().openDoc(id)
          return
        }
      }
      set({ closedTabs: [] })
    },

    cycleTab(dir) {
      const s = get()
      const i = s.tabs.indexOf(s.activeTab)
      const n = s.tabs.length
      get().setActiveTab(s.tabs[(i + dir + n) % n])
    },

    goToLastTab() {
      const s = get()
      get().setActiveTab(s.tabs[s.tabs.length - 1])
    },

    renameDoc(id, name) {
      const doc = get().docs[id]
      const trimmed = name.trim()
      if (!doc || !trimmed || doc.name === trimmed) return
      set((s) => ({ docs: { ...s.docs, [id]: { ...doc, name: trimmed, updatedAt: Date.now() } } }))
    },

    archiveDoc(id, archived) {
      const doc = get().docs[id]
      if (!doc || doc.scratchpad) return
      set((s) => ({ docs: { ...s.docs, [id]: { ...doc, archived, updatedAt: Date.now() } } }))
      if (archived) get().closeTab(id)
    },

    deleteDoc(id) {
      const s = get()
      const doc = s.docs[id]
      if (!doc || doc.scratchpad || id === s.scratchpadId) return
      get().closeTab(id)
      set((st) => {
        const docs = { ...st.docs }
        delete docs[id]
        const editors = { ...st.editors }
        delete editors[id]
        return {
          docs,
          editors,
          recents: st.recents.filter((r) => r !== id),
          closedTabs: st.closedTabs.filter((c) => c !== id),
          historyDocId: st.historyDocId === id ? null : st.historyDocId
        }
      })
      history.clear(id)
    },

    setThumbnail(id, dataUrl) {
      const doc = get().docs[id]
      if (!doc || doc.thumbnail === dataUrl) return
      set((s) => ({ docs: { ...s.docs, [id]: { ...doc, thumbnail: dataUrl } } }))
    },

    // ------------------------------------------------------------------ pages
    addPage(docId, name) {
      let pageId = ''
      mutate(docId, 'Add page', (d) => {
        pageId = ops.makePage(d, name ?? `Page ${d.pages.length + 1}`).id
      })
      if (pageId) get().setActivePage(docId, pageId)
      return pageId
    },

    renamePage(docId, pageId, name) {
      const trimmed = name.trim()
      if (!trimmed) return
      mutate(docId, 'Rename page', (d) => {
        const p = pageById(d, pageId)
        if (p) {
          p.name = trimmed
          if (d.nodes[p.rootId]) d.nodes[p.rootId].name = trimmed
        }
      })
    },

    deletePage(docId, pageId) {
      mutate(docId, 'Delete page', (d) => {
        if (d.pages.length <= 1) return
        const p = pageById(d, pageId)
        if (!p) return
        ops.removeNode(d, p.rootId)
        d.pages = d.pages.filter((x) => x.id !== pageId)
      })
      pruneEditor(docId)
    },

    movePage(docId, pageId, index) {
      mutate(docId, 'Move page', (d) => {
        const from = d.pages.findIndex((p) => p.id === pageId)
        if (from < 0) return
        const to = Math.max(0, Math.min(index, d.pages.length - 1))
        if (to === from) return
        const [page] = d.pages.splice(from, 1)
        d.pages.splice(to, 0, page)
      })
    },

    setActivePage(docId, pageId) {
      editor(docId, (e) => {
        if (e.pageId === pageId) return
        e.pageId = pageId
        e.selection = []
        e.hovered = null
        e.editingTextId = null
      })
    },

    setPageBackground(docId, pageId, color) {
      mutate(
        docId,
        'Page background',
        (d) => {
          const p = pageById(d, pageId)
          if (p) p.background = color
        },
        { coalesce: `bg:${pageId}` }
      )
    },

    // ------------------------------------------------------------------ nodes
    createNode(docId, partial, parentId, index) {
      let id = ''
      mutate(docId, `Create ${partial.type}`, (d) => {
        if (!d.nodes[parentId]) throw new Error(`Parent ${parentId} not found`)
        const n = ops.makeNode(d, partial)
        ops.insertNode(d, n, parentId, index)
        id = n.id
      })
      return id
    },

    insertHtml(docId, parentId, html, index) {
      let ids: string[] = []
      mutate(docId, 'Insert HTML', (d) => {
        if (!d.nodes[parentId]) throw new Error(`Parent ${parentId} not found`)
        ids = htmlToNodes(html, d, { topLevel: ops.isPageRoot(d, parentId) })
        const parent = d.nodes[parentId]
        let i = index === undefined || index < 0 || index > parent.children.length ? parent.children.length : index
        for (const id of ids) {
          d.nodes[id].parent = parentId
          parent.children.splice(i++, 0, id)
        }
      })
      return ids
    },

    updateStyles(docId, ids, patch, opts) {
      mutate(
        docId,
        'Update styles',
        (d) => {
          for (const id of ids) {
            const n = d.nodes[id]
            if (n) ops.applyStylePatch(n.style, patch)
          }
        },
        opts
      )
    },

    updateNode(docId, id, patch, opts) {
      mutate(
        docId,
        'Update node',
        (d) => {
          const n = d.nodes[id]
          if (!n) return
          const { id: _ignoredId, children: _c, parent: _p, style, ...rest } = patch
          Object.assign(n, rest)
          if (style) n.style = { ...style }
          if (patch.text !== undefined && n.type === 'text' && patch.name === undefined) {
            // keep auto-names in sync with content
            const old = get().docs[docId]?.nodes[id]
            if (old && old.name === ops.textPreview(old.text ?? '')) n.name = ops.textPreview(patch.text) || n.name
          }
        },
        opts
      )
    },

    setText(docId, id, text, opts) {
      mutate(
        docId,
        'Edit text',
        (d) => {
          const n = d.nodes[id]
          if (!n) return
          const autoNamed = n.name === ops.textPreview(n.text ?? '') || n.name === 'Text'
          n.text = text
          if (autoNamed) n.name = ops.textPreview(text) || 'Text'
        },
        opts
      )
    },

    renameNode(docId, id, name) {
      mutate(docId, 'Rename layer', (d) => {
        const n = d.nodes[id]
        if (n && name.trim()) n.name = name.trim()
      })
    },

    moveNodes(docId, ids, newParentId, index) {
      mutate(docId, 'Move', (d) => {
        const list = ops.sortByTreeOrder(d, ops.topmostOnly(d, ids)).filter((id) => d.nodes[id]?.parent)
        let i = index
        for (const id of list) {
          const n = d.nodes[id]
          // moving within same parent: account for removal shifting the target index
          if (i !== undefined && n.parent === newParentId) {
            const cur = d.nodes[newParentId].children.indexOf(id)
            if (cur >= 0 && cur < i) i -= 1
          }
          ops.reparent(d, id, newParentId, i)
          if (i !== undefined) i += 1
        }
      })
      pruneEditor(docId)
    },

    deleteNodes(docId, ids) {
      mutate(docId, 'Delete', (d) => {
        for (const id of ops.topmostOnly(d, ids)) {
          if (ops.isPageRoot(d, id)) continue
          ops.removeNode(d, id)
        }
      })
      pruneEditor(docId)
    },

    duplicateNodes(docId, ids) {
      const out: string[] = []
      mutate(docId, 'Duplicate', (d) => {
        for (const id of ops.sortByTreeOrder(d, ops.topmostOnly(d, ids))) {
          if (!d.nodes[id]?.parent) continue
          out.push(ops.duplicate(d, id))
        }
      })
      return out
    },

    addFlex(docId, id) {
      mutate(docId, 'Add flex', (d) => ops.addFlex(d, id))
    },

    addGrid(docId, id) {
      mutate(docId, 'Add grid', (d) => ops.addGrid(d, id))
    },

    switchLayout(docId, id, to) {
      mutate(docId, to === 'grid' ? 'Switch to grid' : 'Switch to flex', (d) => ops.switchLayout(d, id, to))
    },

    wrapInFlex(docId, ids) {
      let wrapper: string | null = null
      mutate(docId, 'Wrap in flex', (d) => {
        wrapper = ops.wrapInFlex(d, ops.topmostOnly(d, ids))
      })
      return wrapper
    },

    removeFlex(docId, id) {
      mutate(docId, 'Remove flex', (d) => ops.removeFlex(d, id))
    },

    createComponent(docId, ids, geometry, name) {
      let main = ''
      mutate(docId, 'Create component', (d) => {
        const list = ops.sortByTreeOrder(d, ops.topmostOnly(d, ids))
        const rects = geometry?.rects ?? new Map(list.map((id) => [id, ops.worldRect(d, id)]))
        const boxes = [...rects.values()].filter((r): r is WorldRect => Boolean(r))
        const bounds = geometry?.bounds ?? unionRects(boxes)
        const parent = list[0] ? d.nodes[list[0]]?.parent : null
        const origin = geometry?.origin ?? (parent ? (ops.worldRect(d, parent) ?? { x: 0, y: 0 }) : { x: 0, y: 0 })
        main = comp.createComponentFrom(d, list, rects, bounds, { x: origin.x, y: origin.y }, name)
      }, { derived: true })
      return main
    },

    createInstance(docId, mainId, parentId, index, at) {
      let id = ''
      mutate(docId, 'Create instance', (d) => {
        id = comp.createInstance(d, mainId, parentId, index, at)
      }, { derived: true })
      return id
    },

    detachInstance(docId, id) {
      mutate(docId, 'Detach instance', (d) => comp.detachInstance(d, id), { derived: true })
    },

    resetOverrides(docId, instanceId, srcId) {
      mutate(docId, 'Reset overrides', (d) => comp.resetOverrides(d, instanceId, srcId), { derived: true })
    },

    mutate(docId, label, recipe, opts) {
      mutate(docId, label, recipe, opts)
      pruneEditor(docId)
    },

    // ------------------------------------------------------------------ tokens
    setTokens(docId, tokens) {
      mutate(docId, 'Set tokens', (d) => {
        d.tokens = tokens.map((t) => ({ ...t }))
      })
    },

    upsertTokens(docId, tokens) {
      mutate(docId, 'Update tokens', (d) => {
        for (const t of tokens) {
          const existing = d.tokens.find((x) => x.name === t.name)
          if (existing) existing.value = t.value
          else d.tokens.push({ ...t })
        }
      })
    },

    removeToken(docId, name) {
      mutate(docId, 'Remove token', (d) => {
        d.tokens = d.tokens.filter((t) => t.name !== name)
      })
    },

    addMode(docId, name, baseName = 'Light') {
      const doc = get().docs[docId]
      const n = name.trim()
      if (!doc || !MODE_NAME_RE.test(n)) return null
      const existing = doc.modes && doc.modes.length > 1 ? doc.modes : []
      const base = existing[0] ?? (baseName.trim() || 'Light')
      if ([...existing, base].some((m) => m.toLowerCase() === n.toLowerCase())) return null
      mutate(docId, 'Add mode', (d) => {
        d.modes = [...(existing.length ? existing : [base]), n]
      })
      return n
    },

    renameMode(docId, from, to) {
      const doc = get().docs[docId]
      const n = to.trim()
      if (!doc?.modes?.includes(from) || !MODE_NAME_RE.test(n) || doc.modes.some((m) => m !== from && m.toLowerCase() === n.toLowerCase())) return false
      mutate(docId, 'Rename mode', (d) => {
        d.modes = d.modes!.map((m) => (m === from ? n : m))
        for (const t of d.tokens) {
          if (t.modes && from in t.modes) {
            t.modes[n] = t.modes[from]
            delete t.modes[from]
          }
        }
        for (const node of Object.values(d.nodes)) if (node.attrs?.[MODE_ATTR] === from) node.attrs[MODE_ATTR] = n
      })
      return true
    },

    removeMode(docId, name) {
      mutate(docId, 'Delete mode', (d) => {
        if (!d.modes?.includes(name)) return
        const wasBase = d.modes[0] === name
        d.modes = d.modes.filter((m) => m !== name)
        for (const t of d.tokens) {
          // deleting the base mode promotes the next mode's values to base
          if (wasBase && d.modes[0] && t.modes?.[d.modes[0]] !== undefined) t.value = t.modes[d.modes[0]]
          if (t.modes) {
            delete t.modes[name]
            if (wasBase && d.modes[0]) delete t.modes[d.modes[0]]
            if (!Object.keys(t.modes).length) delete t.modes
          }
        }
        for (const node of Object.values(d.nodes)) if (node.attrs?.[MODE_ATTR] === name) delete node.attrs[MODE_ATTR]
        if (d.modes.length < 2) {
          delete d.modes
          for (const t of d.tokens) delete t.modes
          for (const node of Object.values(d.nodes)) if (node.attrs) delete node.attrs[MODE_ATTR]
        }
      })
    },

    setTokenValue(docId, tokenName, mode, value, opts) {
      mutate(
        docId,
        'Edit token',
        (d) => {
          const t = d.tokens.find((x) => x.name === tokenName)
          if (!t) return
          const base = !mode || !d.modes || d.modes.length < 2 || mode === d.modes[0]
          if (base) {
            if (value !== null) t.value = value
            return
          }
          if (value === null) {
            if (t.modes) delete t.modes[mode]
            if (t.modes && !Object.keys(t.modes).length) delete t.modes
          } else (t.modes ??= {})[mode] = value
        },
        opts
      )
    },

    // ------------------------------------------------------------------ comments
    addComment(docId, anchor, body, author = YOU) {
      const text = body.trim()
      if (!text) return null
      const id = nanoid(10)
      const now = Date.now()
      const ok = mutate(
        docId,
        'Add comment',
        (d) => {
          const list = (d.comments ??= [])
          const number = list.reduce((m, t) => Math.max(m, t.number), 0) + 1
          list.push({
            id,
            number,
            ...anchor,
            status: 'open',
            messages: [{ id: nanoid(10), author: author.kind, authorName: author.name, body: text, createdAt: now }],
            createdAt: now,
            updatedAt: now
          })
        },
        { noHistory: true }
      )
      return ok ? id : null
    },

    replyComment(docId, threadId, body, author = YOU) {
      const text = body.trim()
      const t = get().docs[docId]?.comments?.find((c) => c.id === threadId)
      if (!text || !t) return false
      mutate(
        docId,
        'Reply to comment',
        (d) => {
          const th = d.comments?.find((c) => c.id === threadId)
          if (!th) return
          const now = Date.now()
          th.messages.push({ id: nanoid(10), author: author.kind, authorName: author.name, body: text, createdAt: now })
          th.updatedAt = now
        },
        { noHistory: true }
      )
      return true
    },

    setCommentStatus(docId, threadId, status) {
      if (!get().docs[docId]?.comments?.some((c) => c.id === threadId)) return false
      mutate(
        docId,
        status === 'resolved' ? 'Resolve comment' : 'Reopen comment',
        (d) => {
          const th = d.comments?.find((c) => c.id === threadId)
          if (!th || th.status === status) return
          th.status = status
          th.updatedAt = Date.now()
        },
        { noHistory: true }
      )
      return true
    },

    deleteComment(docId, threadId) {
      mutate(
        docId,
        'Delete comment',
        (d) => {
          if (d.comments) d.comments = d.comments.filter((c) => c.id !== threadId)
        },
        { noHistory: true }
      )
    },

    // ------------------------------------------------------------------ editor
    select(docId, ids, additive) {
      editor(docId, (e) => {
        if (additive) {
          const set = new Set(e.selection)
          for (const id of ids) {
            if (set.has(id)) set.delete(id)
            else set.add(id)
          }
          e.selection = [...set]
        } else {
          e.selection = [...ids]
        }
        if (e.editingTextId && !e.selection.includes(e.editingTextId)) e.editingTextId = null
      })
    },

    setTool(docId, tool) {
      editor(docId, (e) => {
        e.tool = tool
      })
    },

    setCamera(docId, camera) {
      editor(docId, (e) => {
        Object.assign(e.camera, camera)
      })
    },

    setHovered(docId, id) {
      editor(docId, (e) => {
        e.hovered = id
      })
    },

    setEditingText(docId, id) {
      editor(docId, (e) => {
        e.editingTextId = id
      })
    },

    setWorkingNodes(docId, ids) {
      editor(docId, (e) => {
        e.workingNodes = [...ids]
      })
    },

    addWorkingNodes(docId, ids) {
      editor(docId, (e) => {
        e.workingNodes = [...new Set([...e.workingNodes, ...ids])]
      })
    },

    // ------------------------------------------------------------------ history
    undo(docId) {
      const doc = get().docs[docId]
      if (!doc) return
      const next = history.undo(docId, doc)
      if (!next) return
      set((s) => ({ docs: { ...s.docs, [docId]: { ...next, updatedAt: Date.now() } }, historyTick: s.historyTick + 1 }))
      pruneEditor(docId)
    },

    redo(docId) {
      const doc = get().docs[docId]
      if (!doc) return
      const next = history.redo(docId, doc)
      if (!next) return
      set((s) => ({ docs: { ...s.docs, [docId]: { ...next, updatedAt: Date.now() } }, historyTick: s.historyTick + 1 }))
      pruneEditor(docId)
    },

    transact(docId, label, fn) {
      history.begin(docId, label)
      try {
        return fn()
      } finally {
        history.end(docId)
        set((s) => ({ historyTick: s.historyTick + 1 }))
      }
    },

    canUndo: (docId) => history.canUndo(docId),
    canRedo: (docId) => history.canRedo(docId),

    setPref(key, value) {
      set((s) => ({ prefs: { ...s.prefs, [key]: value } }))
    }
  }
})

// ------------------------------------------------------------------------------------------------
// convenience selectors / hooks

/** Active doc id, or null when the dashboard is active. */
export const activeDocId = (s: Store): string | null => (s.activeTab !== DASHBOARD && s.docs[s.activeTab] ? s.activeTab : null)

export function useActiveDoc(): Doc | null {
  return useStore((s) => {
    const id = activeDocId(s)
    return id ? s.docs[id] : null
  })
}

export function useActiveEditor(): EditorState | null {
  return useStore((s) => {
    const id = activeDocId(s)
    return id ? s.editors[id] ?? null : null
  })
}

/** Active page of a doc (per its editor state). */
export function activePage(s: Store, docId: string): Page | undefined {
  const doc = s.docs[docId]
  if (!doc) return undefined
  const pid = s.editors[docId]?.pageId
  return doc.pages.find((p) => p.id === pid) ?? doc.pages[0]
}

export const getStore = (): Store => useStore.getState()

function unionRects(rects: WorldRect[]): WorldRect {
  if (!rects.length) return { x: 0, y: 0, width: 0, height: 0 }
  const x = Math.min(...rects.map((r) => r.x))
  const y = Math.min(...rects.map((r) => r.y))
  return { x, y, width: Math.max(...rects.map((r) => r.x + r.width)) - x, height: Math.max(...rects.map((r) => r.y + r.height)) - y }
}
