// Shared between main, preload and renderer. Keep this file free of runtime imports.
import type { DiffSummary } from './docDiff'
import type { McpEntry } from './mcpSnippets'

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

/** State of the updater: git for clones (src/main/updater.ts), electron-updater for installed builds (src/main/appUpdater.ts). */
export interface UpdateStatus {
  state: 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'ready' | 'installing' | 'error' | 'unsupported'
  /** short hash of the running version */
  current?: string
  /** short hash of the newest version on GitHub (installed builds: the newest version number) */
  latest?: string
  /** installed builds: download progress 0-100 while `downloading` */
  progress?: number
  /** installed builds: the release notes of the new version, when the release has any */
  releaseNotes?: string
  /** commits on GitHub that this copy doesn't have yet (newest first, at most 30) */
  commits: { hash: string; subject: string; date: number }[]
  /** how many commits behind (may be more than commits.length) */
  behind: number
  /** files edited locally: an update would overwrite them, so it is refused */
  dirty: string[]
  /** the install step being run, or why it failed / is unsupported */
  message?: string
  checkedAt?: number
  /** true when running under `npm run dev`: after an update, restart the dev server yourself */
  dev: boolean
}

export interface UpdatesApi {
  status(): Promise<UpdateStatus>
  check(): Promise<UpdateStatus>
  /** clones: pull, install packages, rebuild and restart. Installed builds: restart into a downloaded update (state `ready`) */
  install(): Promise<UpdateStatus>
  onStatus(cb: (status: UpdateStatus) => void): () => void
}

/** How a version came to be: saved automatically, named by the user, or kept before a restore. */
export type VersionKind = 'auto' | 'named' | 'restore'

/** One saved version of a doc (src/main/history.ts). */
export interface VersionMeta {
  id: string
  kind: VersionKind
  /** when the version was saved */
  createdAt: number
  /** the doc's own updatedAt at that moment (when it was last edited) */
  docUpdatedAt: number
  name?: string
  /** for kind 'restore': createdAt of the version that was restored over it */
  restoredFrom?: number
  /** changes since the previous (older) version; missing for the oldest */
  summary?: DiffSummary
  pageCount: number
  nodeCount: number
  /** compressed bytes on disk (without shared images) */
  size: number
  /** main process only: blob hashes this version uses */
  blobs?: string[]
}

export interface HistoryApi {
  /** newest first */
  list(docId: string): Promise<VersionMeta[]>
  /** the doc as it was in that version */
  load(docId: string, versionId: string): Promise<StoredDoc | null>
  /** save the given doc state as a named version, or as the restore point before a restore */
  save(doc: StoredDoc, opts: { kind: 'named' | 'restore'; name?: string; restoredFrom?: number }): Promise<VersionMeta>
  /** name / rename a version ('' clears the name); a named version is never pruned */
  rename(docId: string, versionId: string, name: string): Promise<void>
  remove(docId: string, versionId: string): Promise<void>
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
  /** unsaved-changes copy of a design (files/<id>.recovery), written while edits are pending; a clean save deletes it */
  saveRecovery(doc: StoredDoc): Promise<void>
  /** designs with a recovery copy left behind (a crash before the save landed) */
  listRecoveries(): Promise<StoredDoc[]>
  discardRecovery(id: string): Promise<void>
  /** files that could not be read and were restored from their last backup since the last call (profile-relative names) */
  takeRestored(): Promise<string[]>
  userDataPath(): Promise<string>
  profiles: ProfilesApi
  updates: UpdatesApi
  history: HistoryApi
  /** how an agent starts the MCP server: the packaged bundle run by the app's own Electron, or `node mcp/dist/index.js` for a clone */
  mcpEntry: McpEntry
  /** set when an agent launched this window (Muster crew, or VELLUM_AGENT_DRIVEN): its name, else null */
  agentDriven: string | null
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
  saveRecovery: 'fs:saveRecovery',
  listRecoveries: 'fs:listRecoveries',
  discardRecovery: 'fs:discardRecovery',
  takeRestored: 'fs:takeRestored',
  userDataPath: 'fs:userDataPath',
  mcpEntry: 'app:mcpEntry',
  agentDriven: 'app:agentDriven',
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
  profSaveRecoveryKey: 'profiles:saveRecoveryKey',
  updStatus: 'updates:status',
  updCheck: 'updates:check',
  updInstall: 'updates:install',
  updChanged: 'updates:changed',
  histList: 'history:list',
  histLoad: 'history:load',
  histSave: 'history:save',
  histRename: 'history:rename',
  histRemove: 'history:remove'
} as const
