// Central zustand store: docs, tabs, per-doc editor state and every mutation (undoable ones go
// through `mutate`, which records immer patches in model/history.ts).
import { create } from 'zustand'
import { produce, produceWithPatches } from 'immer'
import { nanoid } from 'nanoid'
import type { Camera, CNode, Doc, EditorState, NodeType, Page, StylePatch, TabId, Token, Tool } from './types'
import { history } from './history'
import * as ops from './ops'
import { htmlToNodes } from './html'

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
  wrapInFlex(docId: string, ids: string[]): string | null
  removeFlex(docId: string, id: string): void
  /** generic escape hatch: run an arbitrary recipe on the doc draft as one undoable step */
  mutate(docId: string, label: string, recipe: (draft: Doc) => void, opts?: MutateOptions): void

  // tokens (undoable)
  setTokens(docId: string, tokens: Token[]): void
  upsertTokens(docId: string, tokens: Token[]): void
  removeToken(docId: string, name: string): void

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
    const [next, patches, inverse] = produceWithPatches(doc, recipe)
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
      set({ activeTab: id, recents: id !== DASHBOARD ? touchRecents(s.recents, id) : s.recents })
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
          closedTabs: st.closedTabs.filter((c) => c !== id)
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
