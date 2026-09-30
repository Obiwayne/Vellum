// Shared between main, preload and renderer. Keep this file free of runtime imports.

/** Persisted JSON document. The renderer's `Doc` type (model/types.ts) is stored as-is. */
export interface StoredDoc {
  id: string
  name: string
  updatedAt: number
  [key: string]: unknown
}

export interface DocSummary {
  id: string
  name: string
  updatedAt: number
  archived?: boolean
}

/** userData/index.json */
export interface IndexData {
  /** doc ids, most recently opened/edited first */
  recents: string[]
  /** open tabs: 'dashboard' | docId (dashboard is always first) */
  tabs: string[]
  activeTab: string
  /** id of the permanent Scratchpad doc */
  scratchpadId?: string
  /** free-form local preferences (dashboard view mode, zoom prefs, dismissed cards…) */
  prefs: Record<string, unknown>
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Message sent by an MCP client over WebSocket and forwarded to the renderer. */
export interface BridgeRequest {
  id: string
  tool: string
  args: Record<string, unknown>
}

export interface BridgeResponse {
  id: string
  result?: unknown
  error?: string
}

export interface CanvasApi {
  platform: string
  // window
  minimize(): void
  toggleMaximize(): void
  close(): void
  isMaximized(): Promise<boolean>
  onMaximizedChange(cb: (maximized: boolean) => void): () => void
  reload(): void
  forceReload(): void
  toggleDevTools(): void
  toggleFullScreen(): void
  quit(): void
  openExternal(url: string): void
  // storage
  listDocs(): Promise<DocSummary[]>
  loadDoc(id: string): Promise<StoredDoc | null>
  saveDoc(doc: StoredDoc): Promise<void>
  deleteDoc(id: string): Promise<void>
  loadIndex(): Promise<IndexData | null>
  saveIndex(index: IndexData): Promise<void>
  userDataPath(): Promise<string>
  // capture: rect in CSS px of the window's web contents; returns PNG base64 (no data: prefix)
  capturePage(rect?: Rect): Promise<string>
  // rasterise a standalone HTML document offscreen; returns PNG base64 + pixel size
  renderHtml(args: { html: string; scale?: number }): Promise<{ base64: string; width: number; height: number }>
  // bridge (MCP)
  onBridgeRequest(cb: (req: BridgeRequest) => void): () => void
  bridgeRespond(res: BridgeResponse): void
  bridgePort(): Promise<number>
}

export const IPC = {
  minimize: 'win:minimize',
  toggleMaximize: 'win:toggleMaximize',
  close: 'win:close',
  isMaximized: 'win:isMaximized',
  maximizedChange: 'win:maximizedChange',
  reload: 'win:reload',
  forceReload: 'win:forceReload',
  toggleDevTools: 'win:toggleDevTools',
  toggleFullScreen: 'win:toggleFullScreen',
  quit: 'app:quit',
  openExternal: 'app:openExternal',
  listDocs: 'fs:listDocs',
  loadDoc: 'fs:loadDoc',
  saveDoc: 'fs:saveDoc',
  deleteDoc: 'fs:deleteDoc',
  loadIndex: 'fs:loadIndex',
  saveIndex: 'fs:saveIndex',
  userDataPath: 'fs:userDataPath',
  capturePage: 'win:capturePage',
  renderHtml: 'win:renderHtml',
  bridgeRequest: 'bridge:request',
  bridgeRespond: 'bridge:respond',
  bridgePort: 'bridge:port'
} as const
