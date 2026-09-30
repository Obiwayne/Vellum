import { useRef, useState } from 'react'
import { ChevronDown, Code, FileDown } from 'lucide-react'
import { Button, Menu, Popover, type MenuEntry } from '../../ui'
import { activePage, getStore, useStore } from '../../model/store'
import { nodeToHtml } from '../../model/html'
import { Avatar } from '../../profile/parts'
import { useCurrentProfile } from '../../profile/profile'
import { zoomIn, zoomOut, zoomTo100, zoomToFit, zoomToSelection } from './zoom'

/** Zoom-menu prefs (persisted via setPref). */
export const VIEW_PREFS: Array<{ key: string; label: string; def: boolean; shortcut?: string; group: number }> = [
  { key: 'canvas.zoomCentersSelection', label: 'Zoom centers selection', def: false, group: 1 },
  { key: 'canvas.zoomNumberKeys', label: 'Zoom using number keys', def: false, group: 1 },
  { key: 'canvas.invertZoom', label: 'Invert zoom direction', def: false, group: 1 },
  { key: 'canvas.scrollWheelZooms', label: 'Scroll wheel zooms', def: false, group: 1 },
  { key: 'canvas.rightClickPan', label: 'Right click to pan', def: false, group: 1 },
  { key: 'canvas.pixelGrid', label: 'Show pixel grid', def: true, shortcut: "Shift+'", group: 2 },
  { key: 'canvas.snapToPixel', label: 'Snap to pixel', def: true, shortcut: "Ctrl+Shift+'", group: 2 },
  { key: 'canvas.layoutGuides', label: 'Layout guides', def: true, shortcut: 'Shift+G', group: 2 },
  { key: 'canvas.multiplayerCursors', label: 'Multiplayer cursors', def: true, shortcut: 'Shift+M', group: 2 },
  { key: 'canvas.deepSelection', label: 'Use deep selection', def: false, group: 2 },
  { key: 'canvas.showComments', label: 'Show comments', def: true, shortcut: 'Shift+C', group: 3 }
]

export function prefBool(prefs: Record<string, unknown>, key: string): boolean {
  const d = VIEW_PREFS.find((p) => p.key === key)?.def ?? false
  const v = prefs[key]
  return typeof v === 'boolean' ? v : d
}

function download(name: string, data: string, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function TopBar({ docId }: { docId: string }): JSX.Element {
  const zoom = useStore((s) => s.editors[docId]?.camera.zoom ?? 1)
  const prefs = useStore((s) => s.prefs)
  const setPref = useStore((s) => s.setPref)
  const zoomRef = useRef<HTMLButtonElement | null>(null)
  const shareRef = useRef<HTMLButtonElement | null>(null)
  const [zoomOpen, setZoomOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const profile = useCurrentProfile()
  const name = profile?.name ?? (typeof prefs.userName === 'string' && prefs.userName.trim() ? prefs.userName : 'Vellum')

  const items: MenuEntry[] = [
    { label: 'Zoom in', shortcut: '+', onSelect: () => zoomIn(docId) },
    { label: 'Zoom out', shortcut: '−', onSelect: () => zoomOut(docId) },
    { label: 'Zoom to 100%', shortcut: 'Shift+0', onSelect: () => zoomTo100(docId) },
    { label: 'Zoom to fit', shortcut: 'Shift+1', onSelect: () => zoomToFit(docId) },
    { label: 'Zoom to selection', shortcut: 'Shift+2', onSelect: () => zoomToSelection(docId) }
  ]
  let group = 0
  for (const p of VIEW_PREFS) {
    if (p.group !== group) {
      items.push({ type: 'separator' })
      group = p.group
    }
    const on = prefBool(prefs, p.key)
    items.push({ label: p.label, shortcut: p.shortcut, checked: on, keepOpen: true, onSelect: () => setPref(p.key, !on) })
  }

  const exportFile = (): void => {
    const doc = getStore().docs[docId]
    if (!doc) return
    download(`${doc.name || 'Untitled'}.vellum`, JSON.stringify(doc, null, 2), 'application/json')
    setShareOpen(false)
  }
  const copyHtml = async (): Promise<void> => {
    const s = getStore()
    const doc = s.docs[docId]
    if (!doc) return
    const sel = s.editors[docId]?.selection ?? []
    const page = activePage(s, docId)
    const ids = sel.length ? sel : (page ? doc.nodes[page.rootId]?.children ?? [] : [])
    const html = ids.map((id) => nodeToHtml(doc, id)).join('\n\n')
    await navigator.clipboard.writeText(html)
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  return (
    <div className="insp-top">
      <Avatar className="insp-avatar" name={name} avatar={profile?.avatar} color={profile?.color ?? '#4A5A6A'} size={24} title={name} />
      <button
        ref={zoomRef}
        type="button"
        className={['insp-zoom', zoomOpen && 'insp-zoom--open'].filter(Boolean).join(' ')}
        onClick={() => setZoomOpen((o) => !o)}
      >
        {Math.round(zoom * 100)}% <ChevronDown size={12} />
      </button>
      <Button ref={shareRef} size="sm" onClick={() => setShareOpen((o) => !o)}>
        Share
      </Button>
      <Menu
        open={zoomOpen}
        onClose={() => setZoomOpen(false)}
        anchor={zoomRef.current}
        items={items}
        placement="bottom-end"
        minWidth={200}
        ignore={[zoomRef.current]}
      />
      <Popover
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        anchor={shareRef.current}
        placement="bottom-end"
        offset={6}
        ignore={[shareRef.current]}
      >
        <div className="insp-share">
          <p>Vellum files are local. Share a copy of this file or its HTML.</p>
          <Button full icon={<FileDown size={14} />} onClick={exportFile}>
            Export file (.vellum JSON)
          </Button>
          <Button full icon={<Code size={14} />} onClick={() => void copyHtml()}>
            {copied ? 'Copied' : 'Copy HTML'}
          </Button>
        </div>
      </Popover>
    </div>
  )
}
