// MCP tools: files, pages, basic info, tokens, working indicator, comments.
import { getStore, activePage, activeDocId } from '../model/store'
import { topLevelOf } from '../model/ops'
import type { CommentThread, Doc, Token } from '../model/types'
import { MODE_ATTR, MODE_NAME_RE, modesOf, tokenValueIn, tokensCssWithModes } from '../model/modes'
import {
  arr,
  geometry,
  getDoc,
  hasDoc,
  registerHandler,
  resolveDocId,
  resolvePage,
  scoped,
  str
} from './registry'

// ------------------------------------------------------------------------------------------------
// basic info

/** First family of each font stack used in the file (tokens resolved). */
export function fontFamiliesOf(doc: Doc, ids?: string[]): string[] {
  const tokens = new Map(doc.tokens.map((t) => [t.name, t.value]))
  const out = new Set<string>()
  for (const n of ids ? ids.map((i) => doc.nodes[i]).filter(Boolean) : Object.values(doc.nodes)) {
    let f = n.style.fontFamily
    if (typeof f !== 'string') continue
    f = f.replace(/var\((--[\w-]+)(?:,\s*([^)]*))?\)/g, (_m, name: string, fb?: string) => tokens.get(name) ?? fb ?? '')
    const first = f.split(',')[0]?.trim().replace(/^["']|["']$/g, '')
    if (first) out.add(first)
  }
  return [...out]
}

export function basicInfo(docId: string, pageIdArg?: unknown): unknown {
  const s = getStore()
  const doc = getDoc(docId)
  const page = resolvePage(doc, pageIdArg)
  const root = doc.nodes[page.rootId]
  const viewing = activeDocId(s) === doc.id ? activePage(s, doc.id)?.id : s.editors[doc.id]?.pageId
  const artboards = (root?.children ?? [])
    .filter((id) => doc.nodes[id])
    .map((id) => {
      const n = doc.nodes[id]
      const g = geometry(doc, id)
      return { id, name: n.name, childCount: n.children.length, width: g.width, height: g.height, worldX: g.worldX, worldY: g.worldY }
    })
  let nodeCount = 0
  const walk = (id: string): void => {
    for (const c of doc.nodes[id]?.children ?? []) {
      nodeCount++
      walk(c)
    }
  }
  walk(page.rootId)
  return scoped(doc.id, {
    fileName: doc.name,
    pageName: page.name,
    pageId: page.id,
    rootNodeId: page.rootId,
    nodeCount,
    artboardCount: artboards.length,
    artboards,
    pages: doc.pages.map((p) => ({ id: p.id, name: p.name, isActive: p.id === viewing })),
    fontFamilies: fontFamiliesOf(doc),
    openComments: (doc.comments ?? []).filter((t) => t.status === 'open').length,
    ...(modesOf(doc).length ? { themeModes: modesOf(doc) } : {}),
    tokens: { items: doc.tokens.map((t) => ({ name: t.name, value: t.value })) }
  })
}

registerHandler('get_basic_info', (args) => basicInfo(resolveDocId(args), args.pageId))

// ------------------------------------------------------------------------------------------------
// files & pages

registerHandler('list_files', (args) => {
  const s = getStore()
  const limit = typeof args.limit === 'number' ? Math.max(1, Math.min(200, args.limit)) : 50
  const files = Object.values(s.docs)
    .map((d) => ({
      id: d.id,
      name: d.name,
      updatedAt: d.updatedAt,
      createdAt: d.createdAt,
      open: s.tabs.includes(d.id),
      active: s.activeTab === d.id,
      pageCount: d.pages.length,
      ...(d.archived ? { archived: true } : {}),
      ...(d.scratchpad ? { scratchpad: true } : {})
    }))
    .sort((a, b) => Number(b.open) - Number(a.open) || b.updatedAt - a.updatedAt)
    .slice(0, limit)
  return { files, count: files.length }
})

registerHandler('open_file', (args) => {
  const s = getStore()
  const id = str(args.fileId)?.replace(/^.*\/file\//, '').split('/')[0]
  if (!id || !hasDoc(id)) throw new Error(`File ${args.fileId} not found. Use list_files to see available files.`)
  const wasOpen = s.tabs.includes(id)
  if (s.docs[id].archived) s.archiveDoc(id, false)
  s.openDoc(id)
  const pageId = str(args.pageId)
  if (pageId && !wasOpen && s.docs[id].pages.some((p) => p.id === pageId)) getStore().setActivePage(id, pageId)
  return basicInfo(id)
})

registerHandler('create_file', (args) => {
  const s = getStore()
  const name = str(args.name)?.trim() || 'Untitled'
  const cloneId = str(args.cloneFileId)
  if (cloneId && !hasDoc(cloneId)) throw new Error(`File ${cloneId} not found`)
  const id = s.createDoc(name, { open: false })
  if (cloneId) {
    const src = getStore().docs[cloneId]
    const copy = JSON.parse(JSON.stringify({ pages: src.pages, nodes: src.nodes, tokens: src.tokens, nextId: src.nextId }))
    getStore().mutate(
      id,
      'Clone file',
      (d) => {
        d.pages = copy.pages
        d.nodes = copy.nodes
        d.tokens = copy.tokens
        d.nextId = copy.nextId
      },
      { noHistory: true }
    )
  }
  return { fileId: id, name, hint: 'Call open_file with this fileId to start working in it.' }
})

registerHandler('create_page', (args) => {
  const docId = resolveDocId(args)
  const s = getStore()
  const prev = s.editors[docId]?.pageId
  const pageId = s.addPage(docId, str(args.name)?.trim() || undefined)
  if (!pageId) throw new Error('Could not create page')
  // don't pull the user away from the page they are looking at
  if (prev) getStore().setActivePage(docId, prev)
  const doc = getDoc(docId)
  const page = doc.pages.find((p) => p.id === pageId)
  return scoped(docId, { pageId, name: page?.name, rootNodeId: page?.rootId })
})

registerHandler('rename_pages', (args) => {
  const docId = resolveDocId(args)
  const updates = arr<{ pageId?: string; name?: string }>(args.updates)
  const results: unknown[] = []
  getStore().transact(docId, 'Rename pages', () => {
    for (const u of updates) {
      const doc = getDoc(docId)
      if (!u.pageId || !doc.pages.some((p) => p.id === u.pageId)) {
        results.push({ pageId: u.pageId, result: 'error', message: 'Page not found' })
        continue
      }
      if (!u.name?.trim()) {
        results.push({ pageId: u.pageId, result: 'error', message: 'Name is empty' })
        continue
      }
      getStore().renamePage(docId, u.pageId, u.name)
      results.push({ pageId: u.pageId, name: u.name.trim(), result: 'renamed' })
    }
  })
  return scoped(docId, { results })
})

// ------------------------------------------------------------------------------------------------
// tokens

export function tokenType(name: string): string {
  const n = name.toLowerCase()
  if (n.startsWith('--color-')) return 'color'
  if (n.startsWith('--breakpoint-')) return 'breakpoint'
  if (n.startsWith('--container-')) return 'container'
  if (n.startsWith('--spacing')) return 'spacing'
  if (n.startsWith('--font-weight-')) return 'fontWeight'
  if (n.startsWith('--font-')) return 'fontFamily'
  if (n.startsWith('--text-')) return n.includes('--line-height') ? 'lineHeight' : 'fontSize'
  if (n.startsWith('--tracking-')) return 'letterSpacing'
  if (n.startsWith('--leading-')) return 'lineHeight'
  if (n.startsWith('--radius-')) return 'radius'
  if (n.startsWith('--opacity-')) return 'opacity'
  return 'other'
}

function globToRegex(glob: string): RegExp {
  const esc = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${esc}$`, 'i')
}

registerHandler('get_tokens', (args) => {
  const docId = resolveDocId(args)
  const doc = getDoc(docId)
  const types = arr<string>(args.types)
  const pattern = str(args.namePattern)
  const re = pattern ? globToRegex(pattern) : null
  const list = doc.tokens.filter((t) => (!types.length || types.includes(tokenType(t.name))) && (!re || re.test(t.name)))
  const format = str(args.format) ?? 'json'
  const modes = modesOf(doc)
  if (format === 'css') return scoped(docId, tokensCssWithModes(doc, list, true))
  if (format === 'tailwind') {
    const theme = `@theme {\n${list.map((t) => `  ${t.name}: ${t.value};`).join('\n')}\n}`
    const extra = modes.length ? `\n\n${tokensCssWithModes(doc, list, true).split('\n\n').slice(1).join('\n\n')}` : ''
    return scoped(docId, theme + extra)
  }
  return scoped(docId, {
    ...(modes.length ? { modes, baseMode: modes[0] } : {}),
    tokens: list.map((t) => ({
      name: t.name,
      value: t.value,
      type: tokenType(t.name),
      ...(modes.length > 1 ? { modes: Object.fromEntries(modes.slice(1).map((m) => [m, tokenValueIn(doc, t, m)])) } : {})
    })),
    count: list.length
  })
})

const NAME_RE = /^--[a-zA-Z0-9_-]+$/
const tokenValue = (v: unknown): string | null => (typeof v === 'number' ? String(v) : typeof v === 'string' ? v : null)

registerHandler('create_tokens', (args) => {
  const docId = resolveDocId(args)
  const results: unknown[] = []
  const valid: Token[] = []
  const existing = new Set(getDoc(docId).tokens.map((t) => t.name))
  for (const t of arr<{ name?: string; value?: unknown }>(args.tokens)) {
    const value = tokenValue(t.value)
    if (!t.name || !NAME_RE.test(t.name)) results.push({ name: t.name, result: 'error', message: 'Invalid token name' })
    else if (value === null) results.push({ name: t.name, result: 'error', message: 'Missing value' })
    else {
      valid.push({ name: t.name, value })
      results.push({ name: t.name, result: existing.has(t.name) ? 'updated' : 'created' })
    }
  }
  if (valid.length) getStore().upsertTokens(docId, valid)
  applyModeValues(docId, arr<{ name?: string; modes?: unknown }>(args.tokens))
  return scoped(docId, { results, ...(modesOf(getDoc(docId)).length ? { themeModes: modesOf(getDoc(docId)) } : {}) })
})

registerHandler('set_tokens', (args) => {
  const docId = resolveDocId(args)
  const entries = arr<{ name?: string; newName?: string; value?: unknown; delete?: boolean }>(args.tokens)
  const results: unknown[] = []
  if (args.replace === true) {
    const tokens: Token[] = []
    for (const e of entries) {
      const v = tokenValue(e.value)
      if (e.name && NAME_RE.test(e.name) && v !== null) tokens.push({ name: e.name, value: v })
      else results.push({ name: e.name, result: 'error', message: 'Each token needs a valid name and value' })
    }
    getStore().setTokens(docId, tokens)
    return scoped(docId, { replaced: true, count: tokens.length, ...(results.length ? { results } : {}) })
  }
  // mode values first (by the current name), then renames/values/deletes
  applyModeValues(docId, entries.filter((e) => !e.delete) as Array<{ name?: string; modes?: unknown }>)
  getStore().mutate(docId, 'Set tokens', (d) => {
    for (const e of entries) {
      const t = d.tokens.find((x) => x.name === e.name)
      if (!t) {
        results.push({ name: e.name, result: 'error', message: 'Token not found (use create_tokens to add new tokens)' })
        continue
      }
      if (e.delete) {
        d.tokens = d.tokens.filter((x) => x.name !== e.name)
        results.push({ name: e.name, result: 'deleted' })
        continue
      }
      const v = tokenValue(e.value)
      if (v !== null) t.value = v
      if (e.newName && e.newName !== t.name) {
        if (!NAME_RE.test(e.newName)) {
          results.push({ name: e.name, result: 'error', message: 'Invalid newName' })
          continue
        }
        const old = t.name
        t.name = e.newName
        // keep references working: var(--old) → var(--new) across the file
        const re = new RegExp(`var\\(${old.replace(/[-]/g, '\\-')}(?=[,)])`, 'g')
        for (const n of Object.values(d.nodes)) {
          for (const [k, val] of Object.entries(n.style)) {
            if (typeof val === 'string' && val.includes(old)) n.style[k] = val.replace(re, `var(${e.newName}`)
          }
          if (n.svg?.includes(old)) n.svg = n.svg.replace(re, `var(${e.newName}`)
        }
        for (const other of d.tokens) if (other.value.includes(old)) other.value = other.value.replace(re, `var(${e.newName}`)
      }
      results.push({ name: t.name, result: 'updated', value: t.value })
    }
  })
  return scoped(docId, { results })
})

// ------------------------------------------------------------------------------------------------
// theme modes

/** Write per-mode token values ({ Dark: '#000' }), creating modes that don't exist yet. */
function applyModeValues(docId: string, entries: Array<{ name?: string; modes?: unknown }>): void {
  const s = getStore()
  for (const e of entries) {
    if (!e.name || !e.modes || typeof e.modes !== 'object') continue
    for (const [mode, raw] of Object.entries(e.modes as Record<string, unknown>)) {
      const m = mode.trim()
      if (!MODE_NAME_RE.test(m)) throw new Error(`Invalid mode name "${mode}" (letters, digits, spaces, - and _; max 32)`)
      if (!modesOf(getDoc(docId)).includes(m)) s.addMode(docId, m)
      const v = raw === null ? null : tokenValue(raw)
      if (raw !== null && v === null) continue
      s.setTokenValue(docId, e.name, m, v)
    }
  }
}

registerHandler('set_theme_mode', (args) => {
  const docId = resolveDocId(args)
  const doc = getDoc(docId)
  const modes = modesOf(doc)
  const mode = args.mode === null || args.mode === undefined ? null : str(args.mode)?.trim() ?? null
  if (mode && !modes.includes(mode))
    throw new Error(modes.length ? `Mode "${mode}" not found. Modes: ${modes.join(', ')}` : 'The file has no theme modes. Create them with create_tokens (modes: {"Dark": …}).')
  const ids = arr<string>(args.nodeIds)
  const results: unknown[] = []
  getStore().mutate(docId, 'Set theme mode', (d) => {
    for (const id of ids) {
      const n = d.nodes[id]
      if (!n || n.type !== 'frame') {
        results.push({ nodeId: id, result: 'error', message: n ? 'Only frames can have a theme mode' : 'Node not found' })
        continue
      }
      if (mode) (n.attrs ??= {})[MODE_ATTR] = mode
      else if (n.attrs) delete n.attrs[MODE_ATTR]
      results.push({ nodeId: id, mode: mode ?? 'inherit', result: 'ok' })
    }
  })
  return scoped(docId, { results })
})

// ------------------------------------------------------------------------------------------------
// working indicator

registerHandler('finish_working_on_nodes', (args) => {
  const docId = resolveDocId(args)
  const s = getStore()
  const current = s.editors[docId]?.workingNodes ?? []
  const ids = arr<string>(args.nodeIds)
  if (!ids.length) {
    s.setWorkingNodes(docId, [])
    return scoped(docId, { released: current, remaining: [] })
  }
  const doc = getDoc(docId)
  const release = new Set<string>()
  for (const id of ids) {
    release.add(id)
    const top = doc.nodes[id] ? topLevelOf(doc, id) : undefined
    if (top) release.add(top)
  }
  const remaining = current.filter((id) => !release.has(id))
  s.setWorkingNodes(docId, remaining)
  return scoped(docId, { released: current.filter((id) => release.has(id)), remaining })
})

// ------------------------------------------------------------------------------------------------
// comments: threads the user pins to layers with the Comment tool (C). Agents read them, make the
// change, reply and resolve.

const AGENT = { kind: 'agent' as const, name: 'AI' }

function artboardOf(doc: Doc, nodeId: string): { id: string; name: string } | undefined {
  const top = topLevelOf(doc, nodeId)
  const n = top ? doc.nodes[top] : undefined
  return n ? { id: n.id, name: n.name } : undefined
}

function threadNode(doc: Doc, t: CommentThread): Record<string, unknown> | null {
  if (!t.nodeId) return null
  const n = doc.nodes[t.nodeId]
  if (!n) return { id: t.nodeId, deleted: true }
  return {
    id: n.id,
    name: n.name,
    type: n.type,
    ...(n.type === 'text' ? { text: n.text ?? '' } : {}),
    ...(n.parent && doc.nodes[n.parent] && !doc.pages.some((p) => p.rootId === n.parent)
      ? { parent: { id: n.parent, name: doc.nodes[n.parent].name, type: doc.nodes[n.parent].type } }
      : {}),
    artboard: artboardOf(doc, n.id)
  }
}

function threadSummary(doc: Doc, t: CommentThread): Record<string, unknown> {
  const first = t.messages[0]
  const last = t.messages[t.messages.length - 1]
  return {
    threadId: t.id,
    number: t.number,
    status: t.status,
    pageId: t.pageId,
    pageName: doc.pages.find((p) => p.id === t.pageId)?.name,
    node: threadNode(doc, t),
    comment: first?.body ?? '',
    author: first?.authorName,
    messageCount: t.messages.length,
    ...(t.messages.length > 1 ? { lastMessage: { author: last.author === 'agent' ? 'agent' : last.authorName, body: last.body } } : {}),
    createdAt: new Date(t.createdAt).toISOString(),
    updatedAt: new Date(t.updatedAt).toISOString()
  }
}

function requireThread(doc: Doc, id: unknown): CommentThread {
  const t = typeof id === 'string' ? doc.comments?.find((c) => c.id === id || String(c.number) === id.replace(/^#/, '')) : undefined
  if (!t) throw new Error(`Comment thread ${String(id ?? '')} not found. Use list_comment_threads to see the threads.`)
  return t
}

registerHandler('list_comment_threads', (args) => {
  const docId = resolveDocId(args)
  const doc = getDoc(docId)
  const status = str(args.status) ?? 'open'
  const pageId = str(args.pageId)
  const nodeId = str(args.nodeId)
  // a nodeId filter also matches threads on the node's descendants
  const under = (id: string | null): boolean => {
    if (!nodeId) return true
    let cur: string | null = id
    while (cur) {
      if (cur === nodeId) return true
      cur = doc.nodes[cur]?.parent ?? null
    }
    return false
  }
  const all = (doc.comments ?? [])
    .filter((t) => (status === 'all' || t.status === status) && (!pageId || t.pageId === pageId) && under(t.nodeId))
    .sort((a, b) => a.number - b.number)
  const offset = typeof args.offset === 'number' ? Math.max(0, args.offset) : 0
  const limit = typeof args.limit === 'number' ? Math.max(1, Math.min(200, args.limit)) : 50
  const threads = all.slice(offset, offset + limit).map((t) => threadSummary(doc, t))
  return scoped(docId, {
    threads,
    count: threads.length,
    total: all.length,
    ...(threads.length
      ? { hint: 'For each thread: make the change on its node, reply_to_comment_thread with what you did (resolve: true), then finish_working_on_nodes.' }
      : {})
  })
})

registerHandler('get_comment_thread', (args) => {
  const docId = resolveDocId(args)
  const doc = getDoc(docId)
  const t = requireThread(doc, args.threadId)
  return scoped(docId, {
    ...threadSummary(doc, t),
    messages: t.messages.map((m) => ({
      id: m.id,
      author: m.author === 'agent' ? 'agent' : 'user',
      authorName: m.authorName,
      body: m.body,
      createdAt: new Date(m.createdAt).toISOString()
    }))
  })
})

registerHandler('set_comment_thread_status', (args) => {
  const docId = resolveDocId(args)
  const t = requireThread(getDoc(docId), args.threadId)
  const status = args.status === 'open' ? 'open' : args.status === 'resolved' ? 'resolved' : null
  if (!status) throw new Error('status must be "open" or "resolved"')
  getStore().setCommentStatus(docId, t.id, status)
  return scoped(docId, { threadId: t.id, number: t.number, status })
})

registerHandler('reply_to_comment_thread', (args) => {
  const docId = resolveDocId(args)
  const t = requireThread(getDoc(docId), args.threadId)
  const body = str(args.body)?.trim()
  if (!body) throw new Error('body is empty')
  if (body.length > 4000) throw new Error('body is too long (max 4000 characters)')
  const s = getStore()
  s.replyComment(docId, t.id, body, AGENT)
  if (args.resolve === true) s.setCommentStatus(docId, t.id, 'resolved')
  const after = getDoc(docId).comments?.find((c) => c.id === t.id)
  return scoped(docId, { threadId: t.id, number: t.number, status: after?.status, messageCount: after?.messages.length })
})

registerHandler('list_comment_thread_authors', (args) => {
  const docId = resolveDocId(args)
  const names = new Set<string>()
  for (const t of getDoc(docId).comments ?? []) for (const m of t.messages) names.add(m.author === 'agent' ? `${m.authorName} (agent)` : m.authorName)
  return scoped(docId, { authors: [...names] })
})
