import { useEffect, useState } from 'react'
import { Ellipsis, File, Pencil } from 'lucide-react'
import { type MenuEntry } from '../ui'
import { DND_FILE, moveToFolderMenu } from './folders'
import { DASHBOARD, getStore } from '../model/store'
import type { Doc } from '../model/types'
import { InlineEdit } from '../editor/left/InlineEdit'
import { Thumbnail } from './Thumbnail'
import { DEFAULT_USER_NAME } from './SettingsPage'
import { Avatar } from '../profile/parts'
import { useCurrentProfile } from '../profile/profile'

export function relativeTime(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 45) return 'Edited just now'
  const m = Math.round(s / 60)
  if (m < 60) return `Edited ${m} minute${m === 1 ? '' : 's'} ago`
  const h = Math.round(m / 60)
  if (h < 24) return `Edited ${h} hour${h === 1 ? '' : 's'} ago`
  const d = Math.round(h / 24)
  if (d < 30) return `Edited ${d} day${d === 1 ? '' : 's'} ago`
  return `Edited ${new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`
}

/** Re-render periodically so relative times stay fresh. */
export function useNow(intervalMs = 30000): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

export function subtitle(doc: Doc, now: number): string {
  return doc.scratchpad ? 'Your permanent draft' : relativeTime(doc.updatedAt, now)
}

export function fileMenu(doc: Doc, actions: { rename: () => void; askDelete: () => void }): MenuEntry[] {
  const s = getStore()
  return [
    { label: 'Open', onSelect: () => s.openDoc(doc.id) },
    {
      label: 'Open in new tab',
      onSelect: () => {
        s.openDoc(doc.id)
        s.setActiveTab(DASHBOARD)
      }
    },
    { type: 'separator' },
    { label: 'Rename', onSelect: actions.rename },
    { label: 'Duplicate', onSelect: () => duplicateDoc(doc.id) },
    ...(doc.scratchpad ? [] : [moveToFolderMenu(doc)]),
    ...(doc.scratchpad
      ? []
      : ([
          { label: doc.archived ? 'Unarchive' : 'Archive', onSelect: () => s.archiveDoc(doc.id, !doc.archived) },
          { type: 'separator' },
          { label: 'Delete…', danger: true, onSelect: actions.askDelete }
        ] as MenuEntry[]))
  ]
}

/** Menu for a multi-selection. The Scratchpad is skipped by Move, Archive and Delete. */
export function filesMenu(docs: Doc[], actions: { askDelete: (docs: Doc[]) => void }): MenuEntry[] {
  const s = getStore()
  const safe = docs.filter((d) => !d.scratchpad)
  const allArchived = safe.length > 0 && safe.every((d) => d.archived)
  return [
    { label: `Open ${docs.length} files`, onSelect: () => docs.forEach((d) => s.openDoc(d.id)) },
    { type: 'separator' },
    { label: 'Duplicate', onSelect: () => docs.forEach((d) => duplicateDoc(d.id)) },
    moveToFolderMenu(docs),
    { label: allArchived ? 'Unarchive' : 'Archive', disabled: !safe.length, onSelect: () => safe.forEach((d) => s.archiveDoc(d.id, !allArchived)) },
    { type: 'separator' },
    { label: `Delete ${safe.length} file${safe.length === 1 ? '' : 's'}…`, danger: true, disabled: !safe.length, onSelect: () => actions.askDelete(safe) }
  ]
}

/** Copy a doc (all pages, nodes, tokens) into a new file without opening it. */
export function duplicateDoc(id: string): string | null {
  const s = getStore()
  const src = s.docs[id]
  if (!src) return null
  const newId = s.createDoc(`${src.name} copy`, { open: false })
  // replace the fresh doc's content with a deep copy of the source; not undoable (file-level action)
  s.mutate(
    newId,
    'Duplicate file',
    (d) => {
      const copy = JSON.parse(JSON.stringify(src)) as Doc
      d.pages = copy.pages
      d.nodes = copy.nodes
      d.tokens = copy.tokens
      d.nextId = copy.nextId
      d.thumbnail = copy.thumbnail
      if (copy.folderId) d.folderId = copy.folderId
    },
    { noHistory: true }
  )
  return newId
}

/** Start dragging a file (or every selected file) onto a folder. */
function dragFile(e: React.DragEvent, ids: string[]): void {
  e.dataTransfer.setData(DND_FILE, ids.join('\n'))
  e.dataTransfer.effectAllowed = 'move'
}

interface CardProps {
  doc: Doc
  now: number
  onMenu: (e: React.MouseEvent, doc: Doc, rename: () => void) => void
  selected?: boolean
  /** Ctrl/Shift-click: returns true when the click was taken as a selection change */
  onPick?: (e: React.MouseEvent, doc: Doc) => boolean
  /** ids to drag when this file is dragged (the selection when it includes this file) */
  dragIds?: (doc: Doc) => string[]
}

/** Shared click / drag / key handlers for cards and rows (the context menu stays per component). */
function itemProps(p: CardProps, renaming: boolean): React.HTMLAttributes<HTMLDivElement> & { draggable: boolean } {
  const { doc } = p
  return {
    tabIndex: 0,
    draggable: !renaming && !doc.scratchpad,
    onDragStart: (e) => dragFile(e, p.dragIds?.(doc) ?? [doc.id]),
    onClick: (e) => {
      if (renaming || p.onPick?.(e, doc)) return
      getStore().openDoc(doc.id)
    },
    onKeyDown: (e) => {
      if (e.key === 'Enter' && !renaming) getStore().openDoc(doc.id)
    }
  }
}

export function FileCard(props: CardProps): JSX.Element {
  const { doc, now, onMenu } = props
  const [renaming, setRenaming] = useState(false)
  const profile = useCurrentProfile()
  const rename = (): void => setRenaming(true)
  return (
    <div
      className={['db-card', props.selected && 'db-card--selected'].filter(Boolean).join(' ')}
      {...itemProps(props, renaming)}
      onContextMenu={(e) => onMenu(e, doc, rename)}
    >
      <div className="db-card__head">
        <div className="db-card__titles">
          <div className="db-card__title">
            {renaming ? (
              <InlineEdit
                value={doc.name}
                onCommit={(v) => {
                  getStore().renameDoc(doc.id, v)
                  setRenaming(false)
                }}
                onCancel={() => setRenaming(false)}
              />
            ) : (
              <>
                <span className="db-ellipsis">{doc.name}</span>
                {doc.scratchpad && (
                  <button
                    type="button"
                    className="db-card__pencil"
                    aria-label="Rename"
                    onClick={(e) => {
                      e.stopPropagation()
                      rename()
                    }}
                  >
                    <Pencil size={13} />
                  </button>
                )}
              </>
            )}
          </div>
          <div className="db-card__sub">{subtitle(doc, now)}</div>
        </div>
        <Avatar
          className="db-card__avatar"
          name={profile?.name ?? DEFAULT_USER_NAME}
          avatar={profile?.avatar}
          color={profile?.color}
          size={24}
          title={profile?.name ?? DEFAULT_USER_NAME}
        />
        <button
          type="button"
          className="db-card__more"
          aria-label="More"
          onClick={(e) => {
            e.stopPropagation()
            onMenu(e, doc, rename)
          }}
        >
          <Ellipsis size={16} />
        </button>
      </div>
      <Thumbnail doc={doc} />
    </div>
  )
}

export function FileRow(props: CardProps): JSX.Element {
  const { doc, now, onMenu } = props
  const [renaming, setRenaming] = useState(false)
  const rename = (): void => setRenaming(true)
  return (
    <div
      className={['db-row', props.selected && 'db-row--selected'].filter(Boolean).join(' ')}
      {...itemProps(props, renaming)}
      onContextMenu={(e) => onMenu(e, doc, rename)}
    >
      <File size={14} className="db-row__icon" />
      <span className="db-row__name">
        {renaming ? (
          <InlineEdit
            value={doc.name}
            onCommit={(v) => {
              getStore().renameDoc(doc.id, v)
              setRenaming(false)
            }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <span className="db-ellipsis">{doc.name}</span>
        )}
      </span>
      <span className="db-row__meta">{doc.pages.length} page{doc.pages.length === 1 ? '' : 's'}</span>
      <span className="db-row__time">{subtitle(doc, now)}</span>
      <button
        type="button"
        className="db-card__more db-row__more"
        aria-label="More"
        onClick={(e) => {
          e.stopPropagation()
          onMenu(e, doc, rename)
        }}
      >
        <Ellipsis size={16} />
      </button>
    </div>
  )
}
