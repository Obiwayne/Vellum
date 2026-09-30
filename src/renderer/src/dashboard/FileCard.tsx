import { useEffect, useState } from 'react'
import { Ellipsis, File, Pencil } from 'lucide-react'
import { type MenuEntry } from '../ui'
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
    ...(doc.scratchpad
      ? []
      : ([
          { label: doc.archived ? 'Unarchive' : 'Archive', onSelect: () => s.archiveDoc(doc.id, !doc.archived) },
          { type: 'separator' },
          { label: 'Delete…', danger: true, onSelect: actions.askDelete }
        ] as MenuEntry[]))
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
    },
    { noHistory: true }
  )
  return newId
}

interface CardProps {
  doc: Doc
  now: number
  onMenu: (e: React.MouseEvent, doc: Doc, rename: () => void) => void
}

export function FileCard({ doc, now, onMenu }: CardProps): JSX.Element {
  const [renaming, setRenaming] = useState(false)
  const profile = useCurrentProfile()
  const rename = (): void => setRenaming(true)
  return (
    <div
      className="db-card"
      tabIndex={0}
      onClick={() => !renaming && getStore().openDoc(doc.id)}
      onKeyDown={(e) => e.key === 'Enter' && !renaming && getStore().openDoc(doc.id)}
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

export function FileRow({ doc, now, onMenu }: CardProps): JSX.Element {
  const [renaming, setRenaming] = useState(false)
  const rename = (): void => setRenaming(true)
  return (
    <div
      className="db-row"
      tabIndex={0}
      onClick={() => !renaming && getStore().openDoc(doc.id)}
      onKeyDown={(e) => e.key === 'Enter' && !renaming && getStore().openDoc(doc.id)}
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
