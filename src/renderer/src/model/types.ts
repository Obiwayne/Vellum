// Shared document contract — see docs/ARCHITECTURE.md. Do not change shapes without updating the doc.

export type NodeType = 'frame' | 'rect' | 'text' | 'image' | 'svg'

/** React CSSProperties keys (camelCase). number = px where CSS needs a unit. */
export type Style = Record<string, string | number>

/** A style patch: `null` removes the key. */
export type StylePatch = Record<string, string | number | null | undefined>

export interface CNode {
  /** short unique id, "<n>-0" counter per doc (see ops.newId) */
  id: string
  type: NodeType
  /** layer name ("Frame", "Rectangle", text preview for text) */
  name: string
  /** page root id for top-level nodes (artboards); null only for page roots */
  parent: string | null
  children: string[]
  /** full CSS of the node; width/height live here */
  style: Style
  /** world coords for top-level nodes; offset within parent when parent is not flex or style.position==='absolute' */
  x: number
  y: number
  /** text nodes: plain text, newlines allowed */
  text?: string
  /** svg nodes: inner markup of <svg> */
  svg?: string
  /** extra HTML attrs (viewBox, src, alt) */
  attrs?: Record<string, string>
  visible: boolean
  locked: boolean
}

export interface Page {
  id: string
  name: string
  rootId: string
  /** canvas colour, default '#282828' */
  background: string
}

/** name like '--color-gray-50' */
export interface Token {
  name: string
  value: string
}

export interface Doc {
  id: string
  name: string
  pages: Page[]
  nodes: Record<string, CNode>
  tokens: Token[]
  nextId: number
  createdAt: number
  updatedAt: number
  archived?: boolean
  /** data URL, optional */
  thumbnail?: string
  /** true for the permanent Scratchpad draft (cannot be deleted) */
  scratchpad?: boolean
  /**
   * Document format version (see ops.DOC_VERSION / ops.migrateDoc). Missing = 1.
   * v2: canvas content inherits `line-height: normal` (v1 inherited 20px).
   */
  version?: number
  /** comment threads pinned to the canvas (not part of undo history) */
  comments?: CommentThread[]
}

export interface CommentMessage {
  id: string
  /** 'user' = typed in the app, 'agent' = written through MCP */
  author: 'user' | 'agent'
  authorName: string
  body: string
  createdAt: number
}

export interface CommentThread {
  id: string
  /** 1, 2, 3… per file, shown on the pin */
  number: number
  pageId: string
  /** node the pin is attached to (it follows the node); null = pinned to the canvas */
  nodeId: string | null
  /** pin offset from the node's top-left corner (world px); unused when nodeId is null */
  ox: number
  oy: number
  /** world position when the comment was made (fallback when the node is gone or hidden) */
  x: number
  y: number
  status: 'open' | 'resolved'
  messages: CommentMessage[]
  createdAt: number
  updatedAt: number
}

export type Tool = 'move' | 'pan' | 'frame' | 'rect' | 'pen' | 'text' | 'comment' | 'shader' | 'image' | 'svg'

export interface Camera {
  /** screen = world * zoom + (x, y) */
  x: number
  y: number
  zoom: number
}

export interface EditorState {
  docId: string
  pageId: string
  selection: string[]
  hovered: string | null
  tool: Tool
  camera: Camera
  editingTextId: string | null
  /** nodes an agent is currently working on (teal outline) */
  workingNodes: string[]
}

export type TabId = 'dashboard' | string

export interface WorldRect {
  x: number
  y: number
  width: number
  height: number
}
