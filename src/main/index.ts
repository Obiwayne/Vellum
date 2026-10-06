import { app, BrowserWindow, ipcMain, session, shell } from 'electron'
import { readClipboardMedia } from './clipboard'
import { existsSync } from 'fs'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { IPC, type Rect } from '@shared/api'
import { clearCachesIfProtected, migrateLegacyUserData, registerStorageIpc } from './storage'
import { startBridge } from './bridge'
import { startUpdater } from './updater'
import { mcpEntryFor } from '@shared/mcpSnippets'
import { userDataDir } from './userDataDir'
import { cleanStaleRenderTemp, disposeRenderer, registerRenderScheme, renderHtml, renderPdf } from './offscreen'
import appIcon from '../../resources/icon.ico?asset'

let mainWindow: BrowserWindow | null = null

/** Open a link in the user's browser: only absolute http(s) URLs, never file:, custom protocols etc. */
function openExternalSafe(raw: unknown): void {
  if (typeof raw !== 'string' || raw.length > 2048) return
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return
  }
  if ((u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password) void shell.openExternal(u.href)
}

/** The app's own page: the dev server origin, or the built index.html. Nothing else may load in the window. */
function isAppUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    const dev = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined
    if (dev) return u.origin === new URL(dev).origin
    if (u.protocol !== 'file:') return false
    const own = pathToFileURL(join(__dirname, '../renderer/index.html'))
    return decodeURIComponent(u.pathname).toLowerCase() === decodeURIComponent(own.pathname).toLowerCase()
  } catch {
    return false
  }
}

/** Only the app window (its main frame, at the app's own URL) may use the privileged IPC. */
export function trustedSender(e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean {
  const w = mainWindow
  if (!w || w.isDestroyed() || e.sender !== w.webContents) return false
  const f = e.senderFrame
  return !!f && f === w.webContents.mainFrame && isAppUrl(f.url)
}

/**
 * Permissions the renderer may use: clipboard (copy/paste of designs and images), local font
 * enumeration (font picker) and fullscreen. Everything else (camera, mic, geolocation, notifications,
 * MIDI, HID/serial/USB, …) is denied.
 */
const ALLOWED_PERMISSIONS = new Set(['clipboard-read', 'clipboard-sanitized-write', 'local-fonts', 'fullscreen'])

function hardenDefaultSession(): void {
  const ses = session.defaultSession
  ses.setPermissionRequestHandler((wc, permission, cb) => {
    cb(ALLOWED_PERMISSIONS.has(permission) && wc === mainWindow?.webContents && isAppUrl(wc.getURL()))
  })
  ses.setPermissionCheckHandler((wc, permission) => ALLOWED_PERMISSIONS.has(permission) && !!wc && wc === mainWindow?.webContents)
  // no <webview>s, ever
  app.on('web-contents-created', (_e, wc) => {
    wc.on('will-attach-webview', (ev) => ev.preventDefault())
  })
}

// An installed build uses electron-builder's appId (electron-builder.yml), which the installer also stamps on its Start Menu
// and Desktop shortcuts, so a taskbar pin made from a shortcut and the running window are the same app and the pin survives
// updates. A clone keeps its own id (the launcher shortcut from scripts/make-shortcuts.ps1).
const APP_ID = app.isPackaged ? 'com.vellum.app' : 'app.vellum.desktop'

// Pinning a running window to the taskbar would otherwise pin the bare electron.exe (with its own icon).
// Point the pin at the Vellum launcher and icon instead.
function setTaskbarDetails(win: BrowserWindow): void {
  if (process.platform !== 'win32') return
  const launcher = join(app.getAppPath(), 'scripts', 'launch.vbs')
  win.setAppDetails({
    appId: APP_ID,
    appIconPath: appIcon,
    appIconIndex: 0,
    relaunchDisplayName: 'Vellum',
    ...(existsSync(launcher)
      ? { relaunchCommand: `"${join(process.env.WINDIR ?? 'C:\\Windows', 'System32', 'wscript.exe')}" "${launcher}"` }
      : {})
  })
}

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
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      spellcheck: false
    }
  })
  mainWindow = win
  setTaskbarDetails(win)

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

  // never open new Electron windows; http(s) links go to the user's browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url)
    return { action: 'deny' }
  })
  // the window only ever shows the app itself (a design can't navigate it away, e.g. with
  // <meta http-equiv=refresh>, a link, a form or a dropped file)
  win.webContents.on('will-navigate', (e) => {
    if (!isAppUrl(e.url)) e.preventDefault()
  })
  win.webContents.on('will-frame-navigate', (e) => {
    if (!e.isMainFrame && !e.url.startsWith('about:')) e.preventDefault()
  })
  win.webContents.on('will-redirect', (e) => {
    if (e.isMainFrame && !isAppUrl(e.url)) e.preventDefault()
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
  ipcMain.on(IPC.reload, (e) => trustedSender(e) && e.sender.reload())
  ipcMain.on(IPC.forceReload, (e) => trustedSender(e) && e.sender.reloadIgnoringCache())
  ipcMain.on(IPC.toggleDevTools, (e) => trustedSender(e) && e.sender.toggleDevTools())
  ipcMain.on(IPC.toggleFullScreen, (e) => {
    const w = current(e)
    if (w) w.setFullScreen(!w.isFullScreen())
  })
  ipcMain.on(IPC.quit, (e) => trustedSender(e) && app.quit())
  ipcMain.on(IPC.openExternal, (e, url: unknown) => {
    if (trustedSender(e)) openExternalSafe(url)
  })
  ipcMain.on(IPC.mcpEntry, (e) => {
    e.returnValue = mcpEntryFor({ isPackaged: app.isPackaged, execPath: process.execPath, appPath: app.getAppPath(), resourcesPath: process.resourcesPath })
  })
  ipcMain.on(IPC.agentDriven, (e) => {
    e.returnValue = agentDriven()
  })
  ipcMain.handle(IPC.readClipboardMedia, (e) => {
    if (!trustedSender(e)) throw new Error('Not allowed')
    return readClipboardMedia()
  })
  ipcMain.handle(IPC.renderHtml, (e, args: unknown) => {
    if (!trustedSender(e)) throw new Error('Not allowed')
    return renderHtml(args)
  })
  ipcMain.handle(IPC.renderPdf, (e, args: unknown) => {
    if (!trustedSender(e)) throw new Error('Not allowed')
    return renderPdf(args)
  })
  ipcMain.handle(IPC.capturePage, async (e, rect?: Rect) => {
    if (!trustedSender(e)) throw new Error('Not allowed')
    const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(1e5, Math.max(-1e5, v))) : 0)
    const r =
      rect && typeof rect === 'object'
        ? { x: n(rect.x), y: n(rect.y), width: Math.max(1, n(rect.width)), height: Math.max(1, n(rect.height)) }
        : undefined
    const img = await e.sender.capturePage(r)
    return img.toPNG().toString('base64')
  })
}

// userData is %APPDATA%\Vellum (unless --user-data-dir or VELLUM_USER_DATA is given); must be set
// before the single-instance lock, which lives in userData. VELLUM_USER_DATA points the app at a
// separate data folder (profiles.json, profiles/…) — used for testing without touching real data.
app.setName('Vellum')
const dataDir = userDataDir({
  env: process.env.VELLUM_USER_DATA,
  hasUserDataSwitch: app.commandLine.hasSwitch('user-data-dir'),
  isPackaged: app.isPackaged,
  execPath: process.execPath,
  appData: app.getPath('appData')
})
if (dataDir) {
  app.setPath('userData', dataDir)
  if (!process.env.VELLUM_USER_DATA) migrateLegacyUserData()
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
    app.setAppUserModelId(APP_ID)
    hardenDefaultSession()
    registerWindowIpc()
    registerStorageIpc()
    cleanStaleRenderTemp()
    void clearCachesIfProtected()
    startBridge(() => mainWindow)
    startUpdater(() => mainWindow, trustedSender)
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

/** Name of the agent driving this window, or null. Muster puts MUSTER_AGENT in its crew agents' env,
 *  which their test scripts pass on; VELLUM_AGENT_DRIVEN=1 (or a name) turns it on, =0 turns it off. */
function agentDriven(): string | null {
  const flag = process.env.VELLUM_AGENT_DRIVEN?.trim()
  if (flag === '0') return null
  if (flag) return flag === '1' ? 'agent' : flag
  return process.env.MUSTER_AGENT?.trim() || null
}
