// Folder UI for the dashboard: sidebar tree, folder cards/rows in the Files view, breadcrumb.
// Files and folders can be dragged onto any folder (tree, card, row or breadcrumb).
import { useState, type DragEvent } from 'react'
import { ChevronRight, Ellipsis, Folder as FolderIcon, FolderOpen } from 'lucide-react'
import type { MenuEntry } from '../ui'
import { useStore } from '../model/store'
import { InlineEdit } from '../editor/left/InlineEdit'
import {
  childFolders,
  createFolder,
  deleteFolder,
  DND_FILE,
  DND_FOLDER,
  fileCount,
  folderPath,
  moveDocToFolder,
  moveFolder,
  renameFolder,
  useFolders,
  type Folder
} from './folders'

/** Drop handlers that move a dragged file or folder into `target` (null = top level). */
function useDrop(target: string | null): {
  over: boolean
  props: { onDragOver: (e: DragEvent) => void; onDragLeave: () => void; onDrop: (e: DragEvent) => void }
} {
  const [over, setOver] = useState(false)
  const accepts = (e: DragEvent): boolean => e.dataTransfer.types.includes(DND_FILE) || e.dataTransfer.types.includes(DND_FOLDER)
  return {
    over,
    props: {
      onDragOver: (e) => {
        if (!accepts(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        if (!over) setOver(true)
      },
      onDragLeave: () => setOver(false),
      onDrop: (e) => {
        setOver(false)
        const file = e.dataTransfer.getData(DND_FILE)
        const folder = e.dataTransfer.getData(DND_FOLDER)
        if (!file && !folder) return
        e.preventDefault()
        e.stopPropagation()
        if (file) moveDocToFolder(file, target)
        else if (folder && folder !== target) moveFolder(folder, target)
      }
    }
  }
}

export function folderMenu(f: Folder, actions: { rename: () => void; open: (id: string) => void }): MenuEntry[] {
  return [
    { label: 'Open', onSelect: () => actions.open(f.id) },
    { type: 'separator' },
    { label: 'Rename', onSelect: actions.rename },
    { label: 'New folder inside', onSelect: () => actions.open(createFolder(f.id)) },
    ...(f.parent ? [{ label: 'Move to top level', onSelect: () => moveFolder(f.id, null) }] : []),
    { type: 'separator' },
    { label: 'Delete folder (keeps its files)', danger: true, onSelect: () => deleteFolder(f.id) }
  ]
}

// ------------------------------------------------------------------------------------------------
// sidebar tree

const expanded = new Set<string>()

export function FolderTree({
  current,
  onOpen,
  onMenu
}: {
  /** folder shown in the Files view (undefined when another section is active) */
  current: string | null | undefined
  onOpen: (id: string) => void
  onMenu: (e: React.MouseEvent, f: Folder, rename: () => void) => void
}): JSX.Element | null {
  const folders = useFolders()
  const [, force] = useState(0)
  // keep the open folder's ancestors expanded
  if (current) for (const f of folderPath(folders, current).slice(0, -1)) expanded.add(f.id)
  const toggle = (id: string): void => {
    if (expanded.has(id)) expanded.delete(id)
    else expanded.add(id)
    force((n) => n + 1)
  }
  if (!folders.length) return null
  const rows = (parent: string | null, depth: number): JSX.Element[] =>
    childFolders(folders, parent).flatMap((f) => {
      const kids = childFolders(folders, f.id).length > 0
      const open = expanded.has(f.id)
      return [
        <TreeRow key={f.id} f={f} depth={depth} kids={kids} open={open} active={current === f.id} onToggle={toggle} onOpen={onOpen} onMenu={onMenu} />,
        ...(kids && open ? rows(f.id, depth + 1) : [])
      ]
    })
  return <div className="db-tree">{rows(null, 0)}</div>
}

function TreeRow({
  f,
  depth,
  kids,
  open,
  active,
  onToggle,
  onOpen,
  onMenu
}: {
  f: Folder
  depth: number
  kids: boolean
  open: boolean
  active: boolean
  onToggle: (id: string) => void
  onOpen: (id: string) => void
  onMenu: (e: React.MouseEvent, f: Folder, rename: () => void) => void
}): JSX.Element {
  const [renaming, setRenaming] = useState(false)
  const drop = useDrop(f.id)
  return (
    <div
      className={['db-nav', 'db-tree__row', active && 'db-nav--active', drop.over && 'db-drop'].filter(Boolean).join(' ')}
      style={{ paddingLeft: 8 + depth * 14 }}
      role="button"
      tabIndex={0}
      draggable={!renaming}
      onDragStart={(e) => {
        e.dataTransfer.setData(DND_FOLDER, f.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onClick={() => !renaming && onOpen(f.id)}
      onDoubleClick={() => setRenaming(true)}
      onContextMenu={(e) => onMenu(e, f, () => setRenaming(true))}
      {...drop.props}
    >
      <span
        className={['db-tree__chev', !kids && 'db-tree__chev--none', open && 'db-tree__chev--open'].filter(Boolean).join(' ')}
        onClick={(e) => {
          e.stopPropagation()
          if (kids) onToggle(f.id)
        }}
      >
        <ChevronRight size={12} />
      </span>
      {active ? <FolderOpen size={15} /> : <FolderIcon size={15} />}
      {renaming ? (
        <InlineEdit
          value={f.name}
          onCommit={(v) => {
            renameFolder(f.id, v)
            setRenaming(false)
          }}
          onCancel={() => setRenaming(false)}
        />
      ) : (
        <span className="db-ellipsis">{f.name}</span>
      )}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------
// Files view

export function FolderCard({
  f,
  list,
  onOpen,
  onMenu,
  autoRename
}: {
  f: Folder
  list: boolean
  onOpen: (id: string) => void
  onMenu: (e: React.MouseEvent, f: Folder, rename: () => void) => void
  autoRename?: boolean
}): JSX.Element {
  const folders = useFolders()
  const docs = useStore((s) => s.docs)
  const [renaming, setRenaming] = useState(Boolean(autoRename))
  const drop = useDrop(f.id)
  const count = fileCount(folders, Object.values(docs), f.id)
  const subs = childFolders(folders, f.id).length
  const meta = [`${count} file${count === 1 ? '' : 's'}`, subs ? `${subs} folder${subs === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')
  const rename = (): void => setRenaming(true)
  return (
    <div
      className={[list ? 'db-row' : 'db-folder', drop.over && 'db-drop'].filter(Boolean).join(' ')}
      tabIndex={0}
      draggable={!renaming}
      onDragStart={(e) => {
        e.dataTransfer.setData(DND_FOLDER, f.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onClick={() => !renaming && onOpen(f.id)}
      onKeyDown={(e) => e.key === 'Enter' && !renaming && onOpen(f.id)}
      onContextMenu={(e) => onMenu(e, f, rename)}
      {...drop.props}
    >
      <FolderIcon size={list ? 14 : 18} className={list ? 'db-row__icon' : 'db-folder__icon'} />
      <span className={list ? 'db-row__name' : 'db-folder__name'}>
        {renaming ? (
          <InlineEdit
            value={f.name}
            onCommit={(v) => {
              renameFolder(f.id, v)
              setRenaming(false)
            }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <span className="db-ellipsis">{f.name}</span>
        )}
        {!list && <span className="db-folder__meta">{meta}</span>}
      </span>
      {list && <span className="db-row__meta">{meta}</span>}
      {list && <span className="db-row__time" />}
      <button
        type="button"
        className={list ? 'db-row__more' : 'db-card__more'}
        aria-label="More"
        onClick={(e) => {
          e.stopPropagation()
          onMenu(e, f, rename)
        }}
      >
        <Ellipsis size={16} />
      </button>
    </div>
  )
}

/** "Files › Work › Client": every crumb opens that folder and accepts drops. */
export function Breadcrumb({ current, onOpen }: { current: string | null; onOpen: (id: string | null) => void }): JSX.Element {
  const folders = useFolders()
  const path = folderPath(folders, current)
  return (
    <h1 className="db-title db-crumbs">
      <Crumb id={null} label="Files" last={!path.length} onOpen={onOpen} />
      {path.map((f, i) => (
        <span key={f.id} className="db-crumbs__part">
          <ChevronRight size={18} className="db-crumbs__sep" />
          <Crumb id={f.id} label={f.name} last={i === path.length - 1} onOpen={onOpen} />
        </span>
      ))}
    </h1>
  )
}

function Crumb({ id, label, last, onOpen }: { id: string | null; label: string; last: boolean; onOpen: (id: string | null) => void }): JSX.Element {
  const drop = useDrop(id)
  return (
    <button
      type="button"
      className={['db-crumb', last && 'db-crumb--last', drop.over && 'db-drop'].filter(Boolean).join(' ')}
      onClick={() => !last && onOpen(id)}
      {...drop.props}
    >
      {label}
    </button>
  )
}
