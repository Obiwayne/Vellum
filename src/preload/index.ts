import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type BridgeRequest, type CanvasApi, type UpdateStatus } from '@shared/api'

const api: CanvasApi = {
  platform: process.platform,
  minimize: () => ipcRenderer.send(IPC.minimize),
  toggleMaximize: () => ipcRenderer.send(IPC.toggleMaximize),
  close: () => ipcRenderer.send(IPC.close),
  isMaximized: () => ipcRenderer.invoke(IPC.isMaximized),
  onMaximizedChange: (cb) => {
    const h = (_e: IpcRendererEvent, v: boolean): void => cb(v)
    ipcRenderer.on(IPC.maximizedChange, h)
    return () => ipcRenderer.removeListener(IPC.maximizedChange, h)
  },
  reload: () => ipcRenderer.send(IPC.reload),
  forceReload: () => ipcRenderer.send(IPC.forceReload),
  toggleDevTools: () => ipcRenderer.send(IPC.toggleDevTools),
  toggleFullScreen: () => ipcRenderer.send(IPC.toggleFullScreen),
  quit: () => ipcRenderer.send(IPC.quit),
  openExternal: (url) => ipcRenderer.send(IPC.openExternal, url),

  listDocs: () => ipcRenderer.invoke(IPC.listDocs),
  loadDoc: (id) => ipcRenderer.invoke(IPC.loadDoc, id),
  saveDoc: (doc) => ipcRenderer.invoke(IPC.saveDoc, doc),
  deleteDoc: (id) => ipcRenderer.invoke(IPC.deleteDoc, id),
  loadIndex: () => ipcRenderer.invoke(IPC.loadIndex),
  saveIndex: (index) => ipcRenderer.invoke(IPC.saveIndex, index),
  userDataPath: () => ipcRenderer.invoke(IPC.userDataPath),
  profiles: {
    state: () => ipcRenderer.invoke(IPC.profState),
    create: (input) => ipcRenderer.invoke(IPC.profCreate, input),
    open: (id, password) => ipcRenderer.invoke(IPC.profOpen, id, password),
    recover: (id, key, pw) => ipcRenderer.invoke(IPC.profRecover, id, key, pw),
    lock: () => ipcRenderer.invoke(IPC.profLock),
    update: (patch) => ipcRenderer.invoke(IPC.profUpdate, patch),
    setPassword: (cur, next) => ipcRenderer.invoke(IPC.profSetPassword, cur, next),
    removePassword: (cur) => ipcRenderer.invoke(IPC.profRemovePassword, cur),
    newRecoveryKey: (cur) => ipcRenderer.invoke(IPC.profNewRecoveryKey, cur),
    remove: (id, pw) => ipcRenderer.invoke(IPC.profRemove, id, pw),
    saveRecoveryKey: (name, key) => ipcRenderer.invoke(IPC.profSaveRecoveryKey, name, key)
  },
  updates: {
    status: () => ipcRenderer.invoke(IPC.updStatus),
    check: () => ipcRenderer.invoke(IPC.updCheck),
    install: () => ipcRenderer.invoke(IPC.updInstall),
    onStatus: (cb) => {
      const h = (_e: IpcRendererEvent, s: UpdateStatus): void => cb(s)
      ipcRenderer.on(IPC.updChanged, h)
      return () => ipcRenderer.removeListener(IPC.updChanged, h)
    }
  },
  history: {
    list: (docId) => ipcRenderer.invoke(IPC.histList, docId),
    load: (docId, versionId) => ipcRenderer.invoke(IPC.histLoad, docId, versionId),
    save: (doc, opts) => ipcRenderer.invoke(IPC.histSave, doc, opts),
    rename: (docId, versionId, name) => ipcRenderer.invoke(IPC.histRename, docId, versionId, name),
    remove: (docId, versionId) => ipcRenderer.invoke(IPC.histRemove, docId, versionId)
  },
  mcpEntry: ipcRenderer.sendSync(IPC.mcpEntry) as string,
  agentDriven: (ipcRenderer.sendSync(IPC.agentDriven) as string | null) ?? null,

  capturePage: (rect) => ipcRenderer.invoke(IPC.capturePage, rect),
  renderHtml: (args) => ipcRenderer.invoke(IPC.renderHtml, args),
  renderPdf: (args) => ipcRenderer.invoke(IPC.renderPdf, args),
  readClipboardMedia: () => ipcRenderer.invoke(IPC.readClipboardMedia),

  onBridgeRequest: (cb) => {
    const h = (_e: IpcRendererEvent, req: BridgeRequest): void => cb(req)
    ipcRenderer.on(IPC.bridgeRequest, h)
    return () => ipcRenderer.removeListener(IPC.bridgeRequest, h)
  },
  bridgeRespond: (res) => ipcRenderer.send(IPC.bridgeRespond, res),
  bridgePort: () => ipcRenderer.invoke(IPC.bridgePort)
}

contextBridge.exposeInMainWorld('canvasApi', api)
