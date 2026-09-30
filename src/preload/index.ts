import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type BridgeRequest, type CanvasApi } from '@shared/api'

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

  capturePage: (rect) => ipcRenderer.invoke(IPC.capturePage, rect),
  renderHtml: (args) => ipcRenderer.invoke(IPC.renderHtml, args),

  onBridgeRequest: (cb) => {
    const h = (_e: IpcRendererEvent, req: BridgeRequest): void => cb(req)
    ipcRenderer.on(IPC.bridgeRequest, h)
    return () => ipcRenderer.removeListener(IPC.bridgeRequest, h)
  },
  bridgeRespond: (res) => ipcRenderer.send(IPC.bridgeRespond, res),
  bridgePort: () => ipcRenderer.invoke(IPC.bridgePort)
}

contextBridge.exposeInMainWorld('canvasApi', api)
