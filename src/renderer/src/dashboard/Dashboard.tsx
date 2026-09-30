// Dashboard: sidebar (account, search, Recents/Learn, Files/Archive/Settings, agents card) + main area.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Archive, ChevronDown, ChevronRight, Clock, FolderPlus, GraduationCap, LayoutGrid, List, Lock, Minus, Plus, Search, Settings } from 'lucide-react'
import { Button, Menu, Modal, Tooltip, useContextMenu } from '../ui'
import { getStore, useStore } from '../model/store'
import type { Doc } from '../model/types'
import { FooterLinks } from '../editor/left/WhatsNew'
import { FileCard, FileRow, fileMenu, useNow } from './FileCard'
import { LearnPage } from './LearnPage'
import { DEFAULT_USER_NAME, PREF, SettingsPage } from './SettingsPage'
import { ConnectAgentModal } from './ConnectAgentModal'
import { Avatar } from '../profile/parts'
import { lockAndReload, useCurrentProfile } from '../profile/profile'
import { DeleteProfileModal, EditProfileModal } from '../profile/ProfileModals'
import { childFolders, createFolder, docFolder, folderById, moveDocToFolder, useFolders, type Folder } from './folders'
import { Breadcrumb, FolderCard, FolderTree, folderMenu } from './FolderViews'
import './dashboard.css'

type Section = 'recents' | 'learn' | 'files' | 'archive' | 'settings'

const TITLES: Record<Section, string> = {
  recents: 'Recents',
  learn: 'Learn',
  files: 'Files',
  archive: 'Archive',
  settings: 'Settings'
}

let lastSection: Section = 'recents'
let lastFolder: string | null = null

/** Create a new file, applying the default page colour preference. */
export function createFile(): string {
  const s = getStore()
  const id = s.createDoc()
  const bg = s.prefs[PREF.defaultPageColor]
  if (typeof bg === 'string' && bg) {
    s.mutate(
      id,
      'Page background',
      (d) => {
        for (const p of d.pages) p.background = bg
      },
      { noHistory: true }
    )
  }
  return id
}

function NavItem({ icon, label, active, onClick }: { icon: ReactNode; label: string; active: boolean; onClick: () => void }): JSX.Element {
  return (
    <button type="button" className={['db-nav', active && 'db-nav--active'].filter(Boolean).join(' ')} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  )
}

export function Dashboard(): JSX.Element {
  const docs = useStore((s) => s.docs)
  const recents = useStore((s) => s.recents)
  const prefs = useStore((s) => s.prefs)
  const [section, setSectionState] = useState<Section>(lastSection)
  const [query, setQuery] = useState('')
  const folders = useFolders()
  const [folderState, setFolderState] = useState<string | null>(lastFolder)
  // a folder deleted elsewhere falls back to its parent chain / the top level
  const folder = folderById(folders, folderState) ? folderState : null
  const [renameNew, setRenameNew] = useState<string | null>(null)
  const [editProfileOpen, setEditProfileOpen] = useState(false)
  const [deleteProfileOpen, setDeleteProfileOpen] = useState(false)
  const profile = useCurrentProfile()
  const [accountOpen, setAccountOpen] = useState(false)
  const [connectOpen, setConnectOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Doc | null>(null)
  const accountRef = useRef<HTMLButtonElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const ctx = useContextMenu()
  const now = useNow()

  const userName = profile?.name ?? String(prefs[PREF.userName] ?? DEFAULT_USER_NAME)
  const view = prefs[PREF.dashboardView] === 'list' ? 'list' : 'grid'
  const agentsDismissed = Boolean(prefs[PREF.agentsCardDismissed])
  const setSection = (s: Section): void => {
    lastSection = s
    setSectionState(s)
    setQuery('')
  }
  const openFolder = (id: string | null): void => {
    lastFolder = id
    setFolderState(id)
    setSection('files')
  }
  const newFolder = (): void => {
    const id = createFolder(section === 'files' && !query.trim() ? folder : null)
    setRenameNew(id)
    if (section !== 'files') openFolder(null)
  }

  // Ctrl+F focuses search
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.code === 'KeyF') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const list = useMemo(() => {
    const all = Object.values(docs)
    const q = query.trim().toLowerCase()
    if (q) return all.filter((d) => d.name.toLowerCase().includes(q)).sort((a, b) => b.updatedAt - a.updatedAt)
    switch (section) {
      case 'recents': {
        const seen = new Set<string>()
        const out: Doc[] = []
        for (const id of recents) {
          const d = docs[id]
          if (d && !d.archived && !seen.has(id)) {
            seen.add(id)
            out.push(d)
          }
        }
        return out
      }
      case 'files':
        return all.filter((d) => !d.archived && docFolder(folders, d) === folder).sort((a, b) => Number(Boolean(b.scratchpad)) - Number(Boolean(a.scratchpad)) || b.updatedAt - a.updatedAt)
      case 'archive':
        return all.filter((d) => d.archived).sort((a, b) => b.updatedAt - a.updatedAt)
      default:
        return []
    }
  }, [docs, recents, section, query, folders, folder])

  const openMenu = (e: React.MouseEvent, doc: Doc, rename: () => void): void =>
    ctx.open(e, fileMenu(doc, { rename, askDelete: () => setConfirmDelete(doc) }))
  const openFolderMenu = (e: React.MouseEvent, f: Folder, rename: () => void): void =>
    ctx.open(e, folderMenu(f, { rename, open: (id) => openFolder(id) }))

  const searching = query.trim().length > 0
  const showFiles = searching || section === 'recents' || section === 'files' || section === 'archive'
  const title = searching ? `Results for “${query.trim()}”` : TITLES[section]
  const inFiles = !searching && section === 'files'
  const subFolders = inFiles ? childFolders(folders, folder) : []

  return (
    <div className="db">
      <aside className="db-side">
        <div className="db-account">
          <button
            type="button"
            ref={accountRef}
            className="db-account__btn"
            onClick={() => setAccountOpen((o) => !o)}
            onDoubleClick={() => {
              if (!profile) return
              setAccountOpen(false)
              setEditProfileOpen(true)
            }}
          >
            <Avatar name={userName} avatar={profile?.avatar} color={profile?.color} size={24} />
            <span className="db-account__name">{userName}</span>
            {profile?.hasPassword && <Lock size={12} className="db-account__lock" />}
            <ChevronDown size={14} className="db-account__chev" />
          </button>
          <Menu
            open={accountOpen}
            onClose={() => setAccountOpen(false)}
            anchor={accountRef.current}
            ignore={[accountRef.current]}
            minWidth={200}
            items={
              profile
                ? [
                    { label: 'Edit profile…', onSelect: () => setEditProfileOpen(true) },
                    { label: 'Switch profile', onSelect: () => void lockAndReload() },
                    ...(profile.hasPassword ? [{ label: 'Lock', onSelect: () => void lockAndReload() }] : []),
                    { type: 'separator' as const },
                    { label: 'Settings', onSelect: () => setSection('settings') },
                    { type: 'separator' as const },
                    { label: 'Delete profile…', danger: true, onSelect: () => setDeleteProfileOpen(true) }
                  ]
                : [{ label: 'Settings', onSelect: () => setSection('settings') }]
            }
          />
        </div>

        <label className="db-search">
          <Search size={14} />
          <input
            ref={searchRef}
            placeholder="Search"
            value={query}
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') {
                setQuery('')
                ;(e.target as HTMLInputElement).blur()
              }
            }}
          />
          {!query && <span className="db-search__kbd">Ctrl F</span>}
        </label>

        <nav className="db-navs">
          <NavItem icon={<Clock size={16} />} label="Recents" active={!searching && section === 'recents'} onClick={() => setSection('recents')} />
          <NavItem icon={<GraduationCap size={16} />} label="Learn" active={!searching && section === 'learn'} onClick={() => setSection('learn')} />
        </nav>
        <div className="db-side__hairline" />
        <nav className="db-navs">
          <NavItem icon={<LayoutGrid size={16} />} label="Files" active={inFiles && folder === null} onClick={() => openFolder(null)} />
          <FolderTree current={inFiles ? folder : undefined} onOpen={openFolder} onMenu={openFolderMenu} />
          <NavItem icon={<Archive size={16} />} label="Archive" active={!searching && section === 'archive'} onClick={() => setSection('archive')} />
          <NavItem icon={<Settings size={16} />} label="Settings" active={!searching && section === 'settings'} onClick={() => setSection('settings')} />
        </nav>

        <div className="db-side__spacer" />

        {!agentsDismissed && (
          <div className="db-promo">
            <div className="db-promo__head">
              <span>Using agents</span>
              <button type="button" className="db-promo__close" aria-label="Dismiss" onClick={() => getStore().setPref(PREF.agentsCardDismissed, true)}>
                <Minus size={14} />
              </button>
            </div>
            <div className="db-promo__text">Enable agentic workflows with Vellum’s MCP server.</div>
            <Button full className="db-promo__btn" onClick={() => setConnectOpen(true)}>
              Get started <ChevronRight size={14} />
            </Button>
          </div>
        )}
        <FooterLinks className="db-footer" />
      </aside>

      <section className="db-main">
        <div className="db-main__inner">
          <div className="db-main__head">
            {inFiles ? <Breadcrumb current={folder} onOpen={openFolder} /> : <h1 className="db-title">{title}</h1>}
            {showFiles && (
              <>
                {(inFiles || section === 'recents') && !searching && (
                  <Button size="sm" icon={<FolderPlus size={14} />} className="db-newfile" onClick={newFolder}>
                    New folder
                  </Button>
                )}
                <Button
                  variant="primary"
                  size="sm"
                  icon={<Plus size={14} />}
                  className="db-newfile"
                  onClick={() => {
                    const id = createFile()
                    if (inFiles && folder) moveDocToFolder(id, folder)
                  }}
                >
                  New file
                </Button>
                <div className="db-viewtoggle">
                  <Tooltip label="Grid view">
                    <button
                      type="button"
                      className={['db-viewtoggle__btn', view === 'grid' && 'db-viewtoggle__btn--active'].filter(Boolean).join(' ')}
                      onClick={() => getStore().setPref(PREF.dashboardView, 'grid')}
                      aria-label="Grid view"
                    >
                      <LayoutGrid size={14} />
                    </button>
                  </Tooltip>
                  <Tooltip label="List view">
                    <button
                      type="button"
                      className={['db-viewtoggle__btn', view === 'list' && 'db-viewtoggle__btn--active'].filter(Boolean).join(' ')}
                      onClick={() => getStore().setPref(PREF.dashboardView, 'list')}
                      aria-label="List view"
                    >
                      <List size={14} />
                    </button>
                  </Tooltip>
                </div>
              </>
            )}
          </div>

          {subFolders.length > 0 && view === 'grid' && (
            <div className="db-folders">
              {subFolders.map((f) => (
                <FolderCard key={f.id} f={f} list={false} onOpen={openFolder} onMenu={openFolderMenu} autoRename={f.id === renameNew} />
              ))}
            </div>
          )}
          {subFolders.length > 0 && view === 'list' && (
            <div className="db-list db-list--folders">
              {subFolders.map((f) => (
                <FolderCard key={f.id} f={f} list onOpen={openFolder} onMenu={openFolderMenu} autoRename={f.id === renameNew} />
              ))}
            </div>
          )}
          {showFiles &&
            (list.length === 0 ? (
              subFolders.length > 0 ? null :
              <div className="db-empty">
                {searching
                  ? 'No files match your search.'
                  : section === 'archive'
                    ? 'Archived files will appear here.'
                    : inFiles && folder
                      ? 'This folder is empty. Drag files here, or use “Move to folder” in a file’s menu.'
                      : 'No files yet.'}
              </div>
            ) : view === 'grid' ? (
              <div className="db-grid">
                {list.map((d) => (
                  <FileCard key={d.id} doc={d} now={now} onMenu={openMenu} />
                ))}
              </div>
            ) : (
              <div className="db-list">
                <div className="db-list__head">
                  <span className="db-row__icon" />
                  <span className="db-row__name">Name</span>
                  <span className="db-row__meta">Pages</span>
                  <span className="db-row__time">Edited</span>
                  <span className="db-row__more" />
                </div>
                {list.map((d) => (
                  <FileRow key={d.id} doc={d} now={now} onMenu={openMenu} />
                ))}
              </div>
            ))}
          {!searching && section === 'learn' && <LearnPage />}
          {!searching && section === 'settings' && <SettingsPage />}
        </div>
      </section>

      {ctx.element}
      <ConnectAgentModal open={connectOpen} onClose={() => setConnectOpen(false)} />
      <EditProfileModal open={editProfileOpen} onClose={() => setEditProfileOpen(false)} />
      <DeleteProfileModal open={deleteProfileOpen} onClose={() => setDeleteProfileOpen(false)} />
      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title="Delete file?"
        width={400}
        footer={
          <>
            <Button onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button
              className="db-danger-btn"
              onClick={() => {
                if (confirmDelete) getStore().deleteDoc(confirmDelete.id)
                setConfirmDelete(null)
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        <div className="db-confirm">
          “{confirmDelete?.name}” will be permanently deleted. This can’t be undone.
        </div>
      </Modal>
    </div>
  )
}
