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

/** index.json of the open profile (profiles/<id>/index.json) */
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

/** A local profile as the renderer sees it (no key material, ever). */
export interface ProfileInfo {
  id: string
  name: string
  /** small square data URL, or undefined → coloured initial */
  avatar?: string
  color: string
  hasPassword: boolean
  /** idle minutes before a protected profile locks (0/undefined = never) */
  autoLockMinutes?: number
  createdAt: number
  lastUsedAt: number
}

export interface ProfilesState {
  profiles: ProfileInfo[]
  /** the unlocked profile, or null (picker / locked) */
  currentId: string | null
  /** pre-profiles files in userData/files that the first new profile will take over */
  legacyFileCount: number
  /** false right after Switch profile / Lock, so a lone unprotected profile doesn't reopen itself */
  autoOpen: boolean
}

export type ProfileResult<T = object> = ({ ok: true } & T) | { ok: false; error: string }

export interface ProfilesApi {
  state(): Promise<ProfilesState>
  create(input: { name: string; avatar?: string; password?: string }): Promise<ProfileResult<{ recoveryKey?: string; migrated: number }>>
  open(id: string, password?: string): Promise<ProfileResult>
  /** check a recovery key; with newPassword also set it and open the profile */
  recover(id: string, recoveryKey: string, newPassword?: string): Promise<ProfileResult>
  /** lock the open profile (waits for pending writes); the renderer reloads afterwards */
  lock(): Promise<void>
  update(patch: { name?: string; avatar?: string | null; autoLockMinutes?: number }): Promise<ProfileResult>
  /** add (returns a recovery key) or change the open profile's password */
  setPassword(currentPassword: string | undefined, newPassword: string): Promise<ProfileResult<{ recoveryKey?: string }>>
  removePassword(currentPassword: string): Promise<ProfileResult>
  newRecoveryKey(currentPassword: string): Promise<ProfileResult<{ recoveryKey: string }>>
  remove(id: string, password?: string): Promise<ProfileResult>
  /** save dialog → .txt with the recovery key */
  saveRecoveryKey(profileName: string, recoveryKey: string): Promise<ProfileResult<{ path?: string }>>
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
  profiles: ProfilesApi
  /** absolute path of the MCP server entry (mcp/dist/index.js), forward slashes */
  mcpEntry: string
  // capture: rect in CSS px of the window's web contents; returns PNG base64 (no data: prefix)
  capturePage(rect?: Rect): Promise<string>
  // rasterise a standalone HTML document offscreen; returns PNG base64 + pixel size
  // images on the system clipboard: a bitmap (screenshots, "Copy image") and/or image files copied in Explorer
  readClipboardMedia(): Promise<ClipboardMedia>
  renderHtml(args: {
    html: string
    scale?: number
    format?: 'png' | 'jpeg' | 'webp'
    /** flatten onto this colour (JPEG has no alpha) */
    background?: string
  }): Promise<{ base64: string; width: number; height: number }>
  // print a standalone HTML document to PDF offscreen: one page per `.__vellum_page` element, sized to it
  renderPdf(args: { html: string }): Promise<{ base64: string; pages: { width: number; height: number }[] }>
  // bridge (MCP)
  onBridgeRequest(cb: (req: BridgeRequest) => void): () => void
  bridgeRespond(res: BridgeResponse): void
  bridgePort(): Promise<number>
}

export interface ClipboardMedia {
  /** PNG data URL of a bitmap on the clipboard */
  image?: string
  /** image files copied in the file manager: raster files as data URLs, SVG files as markup */
  files: Array<{ name: string; dataUrl?: string; svg?: string }>
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
  mcpEntry: 'app:mcpEntry',
  capturePage: 'win:capturePage',
  renderHtml: 'win:renderHtml',
  renderPdf: 'win:renderPdf',
  readClipboardMedia: 'clip:readMedia',
  bridgeRequest: 'bridge:request',
  bridgeRespond: 'bridge:respond',
  bridgePort: 'bridge:port',
  profState: 'profiles:state',
  profCreate: 'profiles:create',
  profOpen: 'profiles:open',
  profRecover: 'profiles:recover',
  profLock: 'profiles:lock',
  profUpdate: 'profiles:update',
  profSetPassword: 'profiles:setPassword',
  profRemovePassword: 'profiles:removePassword',
  profNewRecoveryKey: 'profiles:newRecoveryKey',
  profRemove: 'profiles:remove',
  profSaveRecoveryKey: 'profiles:saveRecoveryKey'
} as const
