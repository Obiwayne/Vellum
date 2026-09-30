// Editor keyboard shortcuts (tools, selection, arrange, clipboard, zoom). Installed by CanvasView
// for the mounted doc. Runs in the capture phase so editor keys (e.g. Ctrl+Shift+R = Paste to
// replace) win over app shortcuts; it skips text inputs, open menus/popovers and modals.
import { getStore } from '../model/store'
import { isPopoverOpen } from '../ui'
import type { Tool } from '../model/types'
import * as A from './canvas/actions'
import { zoomIn, zoomOut, zoomTo100, zoomToFit, zoomToSelection } from './canvas/camera'

function isTextTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

const TOOL_KEYS: Record<string, Tool> = {
  KeyV: 'move',
  KeyF: 'frame',
  KeyR: 'rect',
  KeyP: 'pen',
  KeyT: 'text',
  KeyC: 'comment',
  KeyS: 'shader'
}

/** Handlers for Create image / Create SVG are provided by the toolbar (it owns the SVG dialog). */
export const toolbarHooks: { createImage?: () => void; createSvg?: () => void } = {}

export function installCanvasShortcuts(docId: string): () => void {
  const onKey = (e: KeyboardEvent): void => {
    if (e.defaultPrevented) return
    if (getStore().activeTab !== docId) return
    if (isTextTarget(e.target) || isTextTarget(document.activeElement)) return
    if (isPopoverOpen() || document.querySelector('.c-modal-overlay')) return
    const s = getStore()
    const ed = s.editors[docId]
    if (!ed) return
    const ctrl = e.ctrlKey || e.metaKey
    const shift = e.shiftKey
    const alt = e.altKey
    const code = e.code
    const key = e.key
    const sel = ed.selection
    let handled = true

    if (ctrl && !alt) {
      if (code === 'KeyD' && !shift) A.duplicateSelection(docId)
      else if (code === 'KeyC' && !shift) void A.copySelection(docId)
      else if (code === 'KeyX' && !shift) void A.cutSelection(docId)
      else if (code === 'KeyV') void A.paste(docId, shift ? 'onTop' : 'normal')
      else if (code === 'KeyR' && shift) void A.paste(docId, 'replace')
      else if (code === 'KeyA' && !shift) A.selectAll(docId)
      else if (code === 'KeyL' && shift) A.toggleLocked(docId)
      else if (code === 'KeyL') A.copyLink(docId)
      else if (code === 'KeyH' && shift) A.toggleVisible(docId)
      else if (code === 'KeyI' && shift) toolbarHooks.createImage?.()
      else if (code === 'KeyJ' && shift) toolbarHooks.createSvg?.()
      else if (code === 'BracketRight') A.reorder(docId, 'forward')
      else if (code === 'BracketLeft') A.reorder(docId, 'backward')
      else if (key === '=' || key === '+') zoomIn(docId)
      else if (key === '-') zoomOut(docId)
      else if (code === 'Digit0' && !shift) zoomTo100(docId)
      else if (code === 'Quote' && shift) s.setPref('canvas.snapToPixel', s.prefs['canvas.snapToPixel'] === false)
      else handled = false
    } else if (ctrl && alt) {
      if (code === 'KeyC') A.copyStyles(docId)
      else if (code === 'KeyV') A.pasteStyles(docId)
      else handled = false
    } else if (alt) {
      if (code === 'KeyC') A.toggleClip(docId)
      else handled = false
    } else if (shift) {
      if (code === 'KeyF') A.frameSelection(docId)
      else if (code === 'KeyA') A.wrapOrAddFlex(docId)
      else if (code === 'KeyN') A.nextArtboard(docId, -1)
      else if (code === 'Digit0') zoomTo100(docId)
      else if (code === 'Digit1') zoomToFit(docId)
      else if (code === 'Digit2') zoomToSelection(docId)
      else if (code === 'Quote') s.setPref('canvas.pixelGrid', s.prefs['canvas.pixelGrid'] === false)
      else if (key === '+') zoomIn(docId)
      else if (code === 'Tab') A.selectSibling(docId, -1)
      else if (key === 'Enter') A.selectParent(docId)
      else if (key.startsWith('Arrow')) nudgeKey(docId, key, 10)
      else handled = false
    } else {
      if (TOOL_KEYS[code]) s.setTool(docId, TOOL_KEYS[code])
      else if (key === 'Escape') {
        if (ed.tool !== 'move') s.setTool(docId, 'move')
        else if (sel.length) A.selectParent(docId)
        else handled = false
      } else if (key === 'Enter') {
        const doc = s.docs[docId]
        const one = sel.length === 1 ? doc?.nodes[sel[0]] : undefined
        if (one?.type === 'text' && !one.locked) A.startTextEditing(docId, one.id)
        else A.selectChildren(docId)
      } else if (key === 'Delete' || key === 'Backspace') A.deleteSelection(docId)
      else if (key.startsWith('Arrow')) nudgeKey(docId, key, 1)
      else if (code === 'BracketRight') A.reorder(docId, 'front')
      else if (code === 'BracketLeft') A.reorder(docId, 'back')
      else if (code === 'KeyN') A.nextArtboard(docId, 1)
      else if (key === '.') A.toggleHideUI()
      else if (key === '=' || key === '+') zoomIn(docId)
      else if (key === '-') zoomOut(docId)
      else if (code === 'Tab') A.selectSibling(docId, 1)
      else handled = false
    }
    if (handled) {
      e.preventDefault()
      e.stopPropagation()
    }
  }
  window.addEventListener('keydown', onKey, true)
  return () => window.removeEventListener('keydown', onKey, true)
}

function nudgeKey(docId: string, key: string, step: number): void {
  const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0
  const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0
  A.nudge(docId, dx, dy)
}
