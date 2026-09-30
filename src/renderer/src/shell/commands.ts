// App-level commands shared by the hamburger menu and global shortcuts.
import type { MenuEntry } from '../ui/Menu'
import { DASHBOARD, activeDocId, getStore } from '../model/store'
import { exportPagePdf } from '../editor/canvas/actions'
import { openUpdates } from './updates'
import { useSaveVersionDialog } from '../history/versions'

const api = (): Window['canvasApi'] | undefined => window.canvasApi

/**
 * Edit commands the canvas should handle when focus is not in a text field. Listen with:
 *   window.addEventListener('canvas:command', (e) => (e as CustomEvent<CanvasCommand>).detail)
 */
export type CanvasCommand = { command: 'cut' | 'copy' | 'paste' | 'selectAll' }
export const CANVAS_COMMAND_EVENT = 'canvas:command'

function isTextTarget(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable
}

function editCommand(command: CanvasCommand['command']): void {
  if (isTextTarget(document.activeElement)) {
    // native behaviour inside inputs
    document.execCommand(command === 'selectAll' ? 'selectAll' : command)
    return
  }
  window.dispatchEvent(new CustomEvent<CanvasCommand>(CANVAS_COMMAND_EVENT, { detail: { command } }))
}

export const commands = {
  newFile: (): void => {
    if (getStore().ready) getStore().createDoc()
  },
  newTab: (): void => {
    if (getStore().ready) getStore().createDoc()
  },
  reopenClosedTab: (): void => getStore().reopenClosedTab(),
  closeTab: (): void => {
    const s = getStore()
    if (s.activeTab !== DASHBOARD) s.closeTab(s.activeTab)
  },
  closeWindow: (): void => api()?.close(),
  exit: (): void => api()?.quit(),
  undo: (): void => {
    const id = activeDocId(getStore())
    if (id) getStore().undo(id)
  },
  redo: (): void => {
    const id = activeDocId(getStore())
    if (id) getStore().redo(id)
  },
  cut: (): void => editCommand('cut'),
  copy: (): void => editCommand('copy'),
  paste: (): void => editCommand('paste'),
  selectAll: (): void => editCommand('selectAll'),
  reload: (): void => api()?.reload(),
  forceReload: (): void => api()?.forceReload(),
  toggleDevTools: (): void => api()?.toggleDevTools(),
  toggleFullScreen: (): void => api()?.toggleFullScreen(),
  minimize: (): void => api()?.minimize(),
  zoom: (): void => api()?.toggleMaximize(),
  goToDashboard: (): void => getStore().setActiveTab(DASHBOARD),
  nextTab: (): void => getStore().cycleTab(1),
  previousTab: (): void => getStore().cycleTab(-1),
  goToLastTab: (): void => getStore().goToLastTab(),
  showHistory: (): void => {
    const id = activeDocId(getStore())
    if (id) getStore().openHistory(id)
  },
  saveVersion: (): void => {
    const s = getStore()
    const id = s.historyDocId ?? activeDocId(s)
    if (id) useSaveVersionDialog.getState().open(id)
  },
  exportPagePdf: (): void => {
    const id = activeDocId(getStore())
    if (id) void exportPagePdf(id)
  }
}

/** Hamburger menu (NOTES §2). */
export function appMenu(): MenuEntry[] {
  const s = getStore()
  const docId = activeDocId(s)
  return [
    {
      label: 'File',
      submenu: [
        { label: 'New File', shortcut: 'Ctrl+N', onSelect: commands.newFile },
        { label: 'New Tab', shortcut: 'Ctrl+T', onSelect: commands.newTab },
        { label: 'Reopen Closed Tab', shortcut: 'Ctrl+Shift+T', onSelect: commands.reopenClosedTab, disabled: !s.closedTabs.length },
        { label: 'New Window', shortcut: 'Ctrl+Shift+N', disabled: true },
        { type: 'separator' },
        { label: 'Close Tab', shortcut: 'Ctrl+W', onSelect: commands.closeTab, disabled: s.activeTab === DASHBOARD },
        { label: 'Close Window', shortcut: 'Ctrl+Shift+W', onSelect: commands.closeWindow },
        { type: 'separator' },
        { label: 'Save to Version History…', shortcut: 'Ctrl+Alt+S', onSelect: commands.saveVersion, disabled: !docId },
        { label: 'Show Version History', shortcut: 'Ctrl+Alt+H', onSelect: commands.showHistory, disabled: !docId },
        { type: 'separator' },
        { label: 'Export PDF of All Artboards…', onSelect: commands.exportPagePdf, disabled: !docId },
        { type: 'separator' },
        { label: 'Exit', onSelect: commands.exit }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', shortcut: 'Ctrl+Z', onSelect: commands.undo, disabled: !docId || !s.canUndo(docId) },
        { label: 'Redo', shortcut: 'Ctrl+Shift+Z', onSelect: commands.redo, disabled: !docId || !s.canRedo(docId) },
        { type: 'separator' },
        { label: 'Cut', shortcut: 'Ctrl+X', onSelect: commands.cut },
        { label: 'Copy', shortcut: 'Ctrl+C', onSelect: commands.copy },
        { label: 'Paste', shortcut: 'Ctrl+V', onSelect: commands.paste },
        { label: 'Select All', shortcut: 'Ctrl+A', onSelect: commands.selectAll }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', shortcut: 'Ctrl+R', onSelect: commands.reload },
        { label: 'Force Reload', shortcut: 'Ctrl+Shift+R', onSelect: commands.forceReload },
        { label: 'Toggle Developer Tools', shortcut: 'Ctrl+Shift+I', onSelect: commands.toggleDevTools },
        { type: 'separator' },
        { label: 'Toggle Full Screen', shortcut: 'F11', onSelect: commands.toggleFullScreen }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { label: 'Minimize', shortcut: 'Ctrl+M', onSelect: commands.minimize },
        { label: 'Zoom', onSelect: commands.zoom },
        { type: 'separator' },
        { label: 'Go to Dashboard', shortcut: 'Ctrl+Shift+D', onSelect: commands.goToDashboard },
        { label: 'Next Tab', shortcut: 'Ctrl+Tab', onSelect: commands.nextTab },
        { label: 'Previous Tab', shortcut: 'Ctrl+Shift+Tab', onSelect: commands.previousTab },
        { label: 'Go to Last Tab', shortcut: 'Ctrl+9', onSelect: commands.goToLastTab }
      ]
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Check for Updates…', onSelect: () => openUpdates() },
        { type: 'separator' },
        { label: 'Documentation', onSelect: () => undefined },
        { label: 'Video Tutorials', onSelect: () => undefined },
        { label: 'Release Notes', onSelect: () => window.canvasApi?.openExternal('https://github.com/Obiwayne/Vellum/commits') },
        { type: 'separator' },
        { label: 'Community', onSelect: () => undefined },
        { type: 'separator' },
        { label: 'View Logs', onSelect: () => undefined }
      ]
    }
  ]
}

/**
 * Global app shortcuts (tabs, files, undo/redo, window). Editor tool shortcuts live in
 * editor/shortcuts.ts. Returns an uninstall function.
 */
export function installAppShortcuts(): () => void {
  const onKey = (e: KeyboardEvent): void => {
    if (e.defaultPrevented) return
    const ctrl = e.ctrlKey || e.metaKey
    const k = e.key.toLowerCase()
    const inText = isTextTarget(e.target as Element)
    let handled = true
    if (e.key === 'F11') commands.toggleFullScreen()
    else if (e.key === 'F12') commands.toggleDevTools()
    else if (!ctrl) handled = false
    else if (k === 'tab') (e.shiftKey ? commands.previousTab : commands.nextTab)()
    else if (e.code === 'KeyN' && !e.shiftKey && !e.altKey) commands.newFile()
    else if (e.code === 'KeyT' && e.shiftKey) commands.reopenClosedTab()
    else if (e.code === 'KeyT' && !e.altKey) commands.newTab()
    else if (e.code === 'KeyW' && e.shiftKey) commands.closeWindow()
    else if (e.code === 'KeyW' && !e.altKey) commands.closeTab()
    else if (e.code === 'KeyS' && e.altKey && !e.shiftKey) commands.saveVersion()
    else if (e.code === 'KeyH' && e.altKey && !e.shiftKey) commands.showHistory()
    else if (e.code === 'KeyD' && e.shiftKey) commands.goToDashboard()
    else if (e.code === 'Digit9' && !e.shiftKey) commands.goToLastTab()
    else if (e.code === 'KeyM' && !e.shiftKey && !e.altKey) commands.minimize()
    else if (e.code === 'KeyR' && e.shiftKey) commands.forceReload()
    else if (e.code === 'KeyR' && !e.altKey) commands.reload()
    // Ctrl+Shift+I is "Create image" in the editor; only toggles devtools on the dashboard.
    else if (e.code === 'KeyI' && e.shiftKey && getStore().activeTab === DASHBOARD) commands.toggleDevTools()
    else if (e.code === 'KeyZ' && !inText && !getStore().historyDocId) (e.shiftKey ? commands.redo : commands.undo)()
    else if (e.code === 'KeyY' && !inText && !e.shiftKey && !getStore().historyDocId) commands.redo()
    else handled = false
    if (handled) {
      e.preventDefault()
      e.stopPropagation()
    }
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}
