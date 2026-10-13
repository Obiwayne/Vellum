// "Export handoff" in the main process: ask where, write the bundle (temp folder then rename, or a zip), say what
// happened. The renderer sends the finished file map; nothing here reads the document and nothing leaves the PC.
import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import { basename, extname, join } from 'node:path'
import { IPC, type HandoffExportArgs, type HandoffExportResult } from '@shared/api'
import { writeFolder, writeZip } from './bundleWrite'

type Sender = Electron.IpcMainEvent | Electron.IpcMainInvokeEvent

const cleanName = (s: unknown): string =>
  String(s ?? '')
    .replace(/[<>:"/\\|?*]+/g, '')
    .replace(new RegExp('[' + String.fromCharCode(0) + '-' + String.fromCharCode(31) + ']', 'g'), '')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 120) || 'handoff'

export async function exportHandoff(win: BrowserWindow | null, args: unknown): Promise<HandoffExportResult> {
  const a = (args ?? {}) as Partial<HandoffExportArgs>
  const kind = a.kind === 'zip' ? 'zip' : 'folder'
  const name = cleanName(a.name)
  try {
    const defaultPath = join(app.getPath('documents'), kind === 'zip' ? `${name}.zip` : name)
    const opts = {
      title: kind === 'zip' ? 'Save hand-off as zip' : 'Export hand-off folder',
      defaultPath,
      buttonLabel: kind === 'zip' ? 'Save zip' : 'Export folder',
      ...(kind === 'zip' ? { filters: [{ name: 'Zip archive', extensions: ['zip'] }] } : {})
    }
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return { ok: false, canceled: true }
    let target = r.filePath
    if (kind === 'zip' && extname(target).toLowerCase() !== '.zip') target += '.zip'
    const done = kind === 'zip' ? await writeZip(target, a.files, basename(target, '.zip')) : await writeFolder(target, a.files)
    return { ok: true, path: done.path, files: done.files, bytes: done.bytes, kind }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function registerHandoffExportIpc(getWindow: () => BrowserWindow | null, trusted: (e: Sender) => boolean): void {
  ipcMain.handle(IPC.handoffExport, (e, args: unknown) => {
    if (!trusted(e)) throw new Error('Not allowed')
    return exportHandoff(getWindow(), args)
  })
  ipcMain.handle(IPC.showInFolder, (e, path: unknown) => {
    if (!trusted(e)) throw new Error('Not allowed')
    if (typeof path === 'string' && path && !path.includes('\0')) shell.showItemInFolder(path)
  })
}
