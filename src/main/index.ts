import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { readClipboardMedia } from './clipboard'
import { join } from 'path'
import { IPC, type Rect } from '@shared/api'
import { clearCachesIfProtected, migrateLegacyUserData, registerStorageIpc } from './storage'
import { startBridge } from './bridge'
import { cleanStaleRenderTemp, disposeRenderer, registerRenderScheme, renderHtml } from './offscreen'
import appIcon from '../../resources/icon.ico?asset'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    frame: false,
    backgroundColor: '#2A2A2A',
    show: false,
    title: 'Vellum',
    icon: appIcon,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })
  mainWindow = win

  win.on('ready-to-show', () => win.show())
  const notify = (): void => {
    if (!win.isDestroyed()) win.webContents.send(IPC.maximizedChange, win.isMaximized())
  }
  win.on('maximize', notify)
  win.on('unmaximize', notify)
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  // the hidden MCP render window must not keep the app alive
  win.on('closed', () => disposeRenderer())

  // surface renderer warnings/errors in the terminal during development
  if (!app.isPackaged) {
    win.webContents.on('console-message', (e) => {
      if (e.level === 'warning' || e.level === 'error') {
        console.log(`[renderer:${e.level}] ${e.message} (${e.sourceId}:${e.lineNumber})`)
      }
    })
  }
  win.webContents.on('render-process-gone', (_e, d) => console.error('[renderer] gone:', d.reason))

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerWindowIpc(): void {
  const current = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): BrowserWindow | null =>
    BrowserWindow.fromWebContents(e.sender)

  ipcMain.on(IPC.minimize, (e) => current(e)?.minimize())
  ipcMain.on(IPC.toggleMaximize, (e) => {
    const w = current(e)
    if (!w) return
    if (w.isMaximized()) w.unmaximize()
    else w.maximize()
  })
  ipcMain.on(IPC.close, (e) => current(e)?.close())
  ipcMain.handle(IPC.isMaximized, (e) => current(e)?.isMaximized() ?? false)
  ipcMain.on(IPC.reload, (e) => e.sender.reload())
  ipcMain.on(IPC.forceReload, (e) => e.sender.reloadIgnoringCache())
  ipcMain.on(IPC.toggleDevTools, (e) => e.sender.toggleDevTools())
  ipcMain.on(IPC.toggleFullScreen, (e) => {
    const w = current(e)
    if (w) w.setFullScreen(!w.isFullScreen())
  })
  ipcMain.on(IPC.quit, () => app.quit())
  ipcMain.on(IPC.openExternal, (_e, url: string) => {
    if (typeof url === 'string' && /^https?:/.test(url)) void shell.openExternal(url)
  })
  ipcMain.on(IPC.mcpEntry, (e) => {
    e.returnValue = join(app.getAppPath(), 'mcp', 'dist', 'index.js').split('\\').join('/')
  })
  ipcMain.handle(IPC.readClipboardMedia, () => readClipboardMedia())
  ipcMain.handle(IPC.renderHtml, (_e, args: { html: string; scale?: number }) => renderHtml(args))
  ipcMain.handle(IPC.capturePage, async (e, rect?: Rect) => {
    const r = rect
      ? {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.max(1, Math.round(rect.width)),
          height: Math.max(1, Math.round(rect.height))
        }
      : undefined
    const img = await e.sender.capturePage(r)
    return img.toPNG().toString('base64')
  })
}

// userData is %APPDATA%\Vellum (unless --user-data-dir or VELLUM_USER_DATA is given); must be set
// before the single-instance lock, which lives in userData. VELLUM_USER_DATA points the app at a
// separate data folder (profiles.json, profiles/…) — used for testing without touching real data.
app.setName('Vellum')
const testUserData = process.env.VELLUM_USER_DATA
if (testUserData) {
  app.setPath('userData', testUserData)
} else if (!app.commandLine.hasSwitch('user-data-dir')) {
  app.setPath('userData', join(app.getPath('appData'), 'Vellum'))
  migrateLegacyUserData()
}
registerRenderScheme()

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    app.setAppUserModelId('app.vellum.desktop')
    registerWindowIpc()
    registerStorageIpc()
    cleanStaleRenderTemp()
    void clearCachesIfProtected()
    startBridge(() => mainWindow)
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
