// Context menus for the canvas (node menu, empty-canvas menu, layers under the pointer).
import { createElement } from 'react'
import { formatShortcut, type MenuEntry } from '../../ui'
import { getStore } from '../../model/store'
import { ancestors, isPageRoot } from '../../model/ops'
import { NodeIcon } from '../left/LayersTree'
import * as A from './actions'
import { getWorldEl } from './geometry'

const sep = { type: 'separator' } as const

/** Nodes stacked under a screen point (topmost first, covered ones too) for "Select layer…". */
function layersAt(docId: string, x: number, y: number): string[] {
  const doc = getStore().docs[docId]
  const world = getWorldEl()
  if (!doc || !world) return []
  const out: string[] = []
  for (const el of document.elementsFromPoint(x, y)) {
    if (!world.contains(el)) continue
    // svg nodes hit on their inner shapes
    const id = el.closest('[data-node-id]')?.getAttribute('data-node-id')
    if (id && doc.nodes[id] && !out.includes(id) && !isPageRoot(doc, id)) out.push(id)
  }
  return out
}

/**
 * Ctrl+right-click: every layer under the pointer, deepest first, indented by depth, with its
 * parent's name on the right. Choosing one selects it.
 */
export function layersMenu(docId: string, at: { x: number; y: number }): MenuEntry[] {
  const s = getStore()
  const doc = s.docs[docId]
  if (!doc) return []
  const sel = s.editors[docId]?.selection ?? []
  const depth = new Map(layersAt(docId, at.x, at.y).map((id) => [id, ancestors(doc, id).length]))
  const ids = [...depth.keys()].sort((a, b) => (depth.get(b) ?? 0) - (depth.get(a) ?? 0))
  if (!ids.length) return []
  const min = Math.min(...depth.values())
  return [
    { type: 'heading', label: 'Layers under the pointer' },
    ...ids.map((id): MenuEntry => {
      const n = doc.nodes[id]
      const parent = n.parent && !isPageRoot(doc, n.parent) ? doc.nodes[n.parent]?.name : undefined
      return {
        label: n.name,
        icon: createElement('span', { style: { display: 'flex', paddingLeft: ((depth.get(id) ?? min) - min) * 12 } }, createElement(NodeIcon, { node: n })),
        shortcut: parent,
        checked: sel.includes(id),
        onSelect: () => s.select(docId, [id])
      }
    })
  ]
}

export function nodeMenu(docId: string, at: { x: number; y: number }): MenuEntry[] {
  return spaced(buildNodeMenu(docId, at))
}

/** Shortcuts are shown spaced: "Ctrl + Shift + V". */
function spaced(items: MenuEntry[]): MenuEntry[] {
  return items.map((i) =>
    'label' in i && i.type !== 'heading'
      ? { ...i, shortcut: i.shortcut ? formatShortcut(i.shortcut, true) : undefined, submenu: i.submenu && spaced(i.submenu) }
      : i
  )
}

function buildNodeMenu(docId: string, at: { x: number; y: number }): MenuEntry[] {
  const s = getStore()
  const doc = s.docs[docId]
  const sel = s.editors[docId]?.selection ?? []
  const first = sel.length ? doc?.nodes[sel[0]] : undefined
  const hasChildren = sel.some((id) => (doc?.nodes[id]?.children.length ?? 0) > 0)
  const isText = first?.type === 'text'
  const layers = layersAt(docId, at.x, at.y)
  return [
    {
      label: 'Select layer...',
      disabled: !layers.length,
      submenu: layers.map((id) => ({
        label: doc?.nodes[id]?.name ?? id,
        checked: sel.includes(id),
        onSelect: () => s.select(docId, [id])
      }))
    },
    { label: 'Select parent', shortcut: 'Esc', onSelect: () => A.selectParent(docId) },
    { label: 'Select children', shortcut: 'Enter', disabled: !hasChildren, onSelect: () => A.selectChildren(docId) },
    sep,
    { label: 'Copy', shortcut: 'Ctrl+C', onSelect: () => void A.copySelection(docId) },
    { label: 'Copy link', shortcut: 'Ctrl+L', onSelect: () => A.copyLink(docId) },
    {
      label: 'Copy as...',
      submenu: [
        { label: 'Copy as HTML', onSelect: () => A.copyAs(docId, 'html') },
        { label: 'Copy as JSX', onSelect: () => A.copyAs(docId, 'jsx') },
        { label: 'Copy as React', shortcut: 'Alt+R', onSelect: () => A.copyAs(docId, 'react') },
        { label: 'Copy as Tailwind', shortcut: 'Alt+T', onSelect: () => A.copyAs(docId, 'tailwind') },
        { label: 'Copy as CSS', onSelect: () => A.copyAs(docId, 'css') }
      ]
    },
    sep,
    { label: 'Paste', shortcut: 'Ctrl+V', onSelect: () => void A.paste(docId, 'normal') },
    { label: 'Paste on top', shortcut: 'Ctrl+Shift+V', onSelect: () => void A.paste(docId, 'onTop') },
    { label: 'Paste to replace', shortcut: 'Ctrl+Shift+R', onSelect: () => void A.paste(docId, 'replace') },
    { label: 'Duplicate', shortcut: 'Ctrl+D', onSelect: () => A.duplicateSelection(docId) },
    sep,
    { label: 'Copy styles', shortcut: 'Ctrl+Alt+C', onSelect: () => A.copyStyles(docId) },
    { label: 'Paste styles', shortcut: 'Ctrl+Alt+V', disabled: !A.hasStyleClip(), onSelect: () => A.pasteStyles(docId) },
    sep,
    { label: 'Group selection', shortcut: 'Ctrl+G', onSelect: () => A.groupSelection(docId) },
    { label: 'Ungroup', shortcut: 'Ctrl+Shift+G', onSelect: () => A.ungroupSelection(docId) },
    { label: 'Frame selection', shortcut: 'Shift+F / Ctrl+Alt+G', onSelect: () => A.frameSelection(docId) },
    { label: 'Wrap in flex', shortcut: 'Shift+A', onSelect: () => A.wrapOrAddFlex(docId) },
    sep,
    { label: 'Bring to front', shortcut: ']', onSelect: () => A.reorder(docId, 'front') },
    { label: 'Send to back', shortcut: '[', onSelect: () => A.reorder(docId, 'back') },
    { label: 'Move forward', shortcut: 'Ctrl+]', onSelect: () => A.reorder(docId, 'forward') },
    { label: 'Move backward', shortcut: 'Ctrl+[', onSelect: () => A.reorder(docId, 'backward') },
    sep,
    { label: 'Show / hide', shortcut: 'Ctrl+Shift+H', onSelect: () => A.toggleVisible(docId) },
    { label: 'Lock / unlock', shortcut: 'Ctrl+Shift+L', onSelect: () => A.toggleLocked(docId) },
    sep,
    {
      label: 'Adjust text...',
      disabled: !isText,
      submenu: [
        {
          label: 'Auto width',
          onSelect: () => s.updateStyles(docId, sel, { width: 'fit-content', height: null })
        },
        {
          label: 'Auto height',
          onSelect: () => {
            s.transact(docId, 'Auto height', () => {
              for (const id of sel) {
                const r = document.querySelector(`[data-node-id="${CSS.escape(id)}"]`)?.getBoundingClientRect()
                const zoom = getStore().editors[docId]?.camera.zoom ?? 1
                s.updateStyles(docId, [id], { width: r ? Math.round(r.width / zoom) : null, height: null })
              }
            })
          }
        },
        { label: 'Edit text', shortcut: 'Enter', onSelect: () => first && A.startTextEditing(docId, first.id) }
      ]
    }
  ]
}

export function canvasMenu(docId: string): MenuEntry[] {
  return spaced([
    { label: 'Paste', shortcut: 'Ctrl+V', onSelect: () => void A.paste(docId, 'normal') },
    sep,
    { label: 'Next artboard', shortcut: 'N', onSelect: () => A.nextArtboard(docId, 1) },
    { label: 'Previous artboard', shortcut: 'Shift+N', onSelect: () => A.nextArtboard(docId, -1) },
    sep,
    { label: 'Export PDF of all artboards…', onSelect: () => void A.exportPagePdf(docId) },
    sep,
    { label: 'Cursor chat', shortcut: '/', disabled: true },
    { label: 'Hide UI', shortcut: '.', onSelect: () => A.toggleHideUI() }
  ])
}
