import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Plus, Search, X } from 'lucide-react'
import { Button, ColorPicker, IconButton, Menu, Popover, parseColor, useContextMenu, type MenuEntry } from '../../ui'
import { getStore, useStore } from '../../model/store'
import type { Token } from '../../model/types'
import { STARTER_THEME } from './starterTheme'
import {
  GROUPS,
  cssToTokens,
  displayName,
  downloadText,
  groupOf,
  groupTokens,
  normalizeName,
  pickTextFile,
  tokensToCss,
  uniqueName,
  type TokenGroup
} from './tokenUtils'
import { InlineEdit } from './InlineEdit'

const collapsedGroups = new Map<string, Set<TokenGroup>>()

function ThemeEmptyIcon(): JSX.Element {
  // 2x2 grid with shapes
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="2" width="28" height="28" rx="2" />
      <path d="M16 2v28M2 16h28" />
      <path d="M9 6.5l3.5 6h-7z" strokeLinejoin="round" />
      <circle cx="23" cy="9.5" r="3" />
      <rect x="6" y="20" width="6" height="6" />
      <path d="M20 23h6M23 20v6" />
    </svg>
  )
}

export function ThemePanel({ docId }: { docId: string }): JSX.Element {
  const tokens = useStore((s) => s.docs[docId]?.tokens ?? [])
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const addBtn = useRef<HTMLButtonElement | null>(null)
  const [editing, setEditing] = useState<{ name: string; anchor: HTMLElement } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [, force] = useState(0)
  const ctx = useContextMenu()
  const listRef = useRef<HTMLDivElement | null>(null)

  if (!collapsedGroups.has(docId)) collapsedGroups.set(docId, new Set())
  const collapsed = collapsedGroups.get(docId)!

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? tokens.filter((t) => t.name.toLowerCase().includes(q) || t.value.toLowerCase().includes(q)) : tokens
  }, [tokens, query])
  const groups = useMemo(() => groupTokens(filtered), [filtered])

  const s = getStore
  const addToken = (g: TokenGroup): void => {
    const def = GROUPS.find((x) => x.id === g)!
    const base = g === 'other' ? '--token' : `${def.prefix}new`
    const name = uniqueName(s().docs[docId]?.tokens ?? [], base)
    s().upsertTokens(docId, [{ name, value: def.sample }])
    collapsed.delete(g)
    setQuery('')
    // open the editor on the new row once rendered
    requestAnimationFrame(() => {
      const el = listRef.current?.querySelector(`[data-token="${CSS.escape(name)}"]`) as HTMLElement | null
      if (el) {
        el.scrollIntoView({ block: 'nearest' })
        setEditing({ name, anchor: el })
      }
    })
  }

  const renameToken = (oldName: string, input: string): void => {
    const name = normalizeName(input)
    const list = s().docs[docId]?.tokens ?? []
    if (!name || name === oldName || list.some((t) => t.name === name)) return
    s().setTokens(
      docId,
      list.map((t) => (t.name === oldName ? { ...t, name } : t))
    )
  }

  const duplicateToken = (name: string): void => {
    const list = s().docs[docId]?.tokens ?? []
    const i = list.findIndex((t) => t.name === name)
    if (i < 0) return
    const copy = { name: uniqueName(list, `${name}-copy`), value: list[i].value }
    s().setTokens(docId, [...list.slice(0, i + 1), copy, ...list.slice(i + 1)])
  }

  const importCss = async (): Promise<void> => {
    const text = await pickTextFile()
    if (!text) return
    const parsed = cssToTokens(text)
    if (parsed.length) s().upsertTokens(docId, parsed)
  }

  const addMenu: MenuEntry[] = [
    { type: 'heading', label: 'New token' },
    ...GROUPS.filter((g) => g.id !== 'other').map((g) => ({ label: g.label, onSelect: () => addToken(g.id) })),
    { type: 'separator' },
    { label: 'Import CSS…', onSelect: () => void importCss() },
    { label: 'Export CSS…', disabled: !tokens.length, onSelect: () => downloadText('tokens.css', tokensToCss(tokens)) },
    { label: 'Copy as CSS', disabled: !tokens.length, onSelect: () => void navigator.clipboard.writeText(tokensToCss(tokens)) },
    { type: 'separator' },
    { label: 'Use starter theme', onSelect: () => s().upsertTokens(docId, STARTER_THEME) },
    { label: 'Delete all tokens', danger: true, disabled: !tokens.length, onSelect: () => s().setTokens(docId, []) }
  ]

  const rowMenu = (name: string): MenuEntry[] => [
    { label: 'Edit', onSelect: () => openEditor(name) },
    { label: 'Rename', onSelect: () => setRenaming(name) },
    { label: 'Duplicate', onSelect: () => duplicateToken(name) },
    { label: 'Copy name', onSelect: () => void navigator.clipboard.writeText(`var(${name})`) },
    { type: 'separator' },
    { label: 'Delete', danger: true, onSelect: () => s().removeToken(docId, name) }
  ]

  const openEditor = (name: string): void => {
    const el = listRef.current?.querySelector(`[data-token="${CSS.escape(name)}"]`) as HTMLElement | null
    if (el) setEditing({ name, anchor: el })
  }

  const editingToken = editing ? tokens.find((t) => t.name === editing.name) : undefined
  useEffect(() => {
    if (editing && !editingToken) setEditing(null)
  }, [editing, editingToken])

  return (
    <div className="lp-theme">
      <div className="lp-theme-head">
        {searching ? (
          <input
            className="lp-theme-search"
            autoFocus
            placeholder="Search tokens"
            value={query}
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') {
                setQuery('')
                setSearching(false)
              }
            }}
          />
        ) : (
          <span className="lp-theme-count">{tokens.length ? `${tokens.length} token${tokens.length === 1 ? '' : 's'}` : 'No tokens'}</span>
        )}
        <IconButton
          icon={searching ? <X size={14} /> : <Search size={14} />}
          label={searching ? 'Close search' : 'Search'}
          onClick={() => {
            if (searching) setQuery('')
            setSearching((v) => !v)
          }}
        />
        <IconButton ref={addBtn} icon={<Plus size={16} />} label="Add token" active={addOpen} onClick={() => setAddOpen((o) => !o)} />
        <Menu open={addOpen} onClose={() => setAddOpen(false)} anchor={addBtn.current} items={addMenu} placement="bottom-end" ignore={[addBtn.current]} minWidth={180} />
      </div>

      {tokens.length === 0 ? (
        <div className="lp-theme-empty">
          <div className="lp-theme-empty__icon">
            <ThemeEmptyIcon />
          </div>
          <div className="lp-theme-empty__title">Theme tokens</div>
          <div className="lp-theme-empty__text">
            Create tokens to get started,
            <br />
            or explore the starter theme.
          </div>
          <Button variant="primary" size="sm" className="lp-theme-empty__btn" onClick={() => addToken('color')}>
            Create token
          </Button>
          <Button size="sm" className="lp-theme-empty__btn" onClick={() => s().upsertTokens(docId, STARTER_THEME)}>
            Use starter theme
          </Button>
        </div>
      ) : (
        <div className="lp-theme-list" ref={listRef}>
          {groups.length === 0 && <div className="lp-theme-nores">No matching tokens</div>}
          {groups.map((g) => {
            const isCollapsed = collapsed.has(g.id) && !query
            return (
              <div key={g.id} className="lp-theme-group">
                <div
                  className="lp-section-head"
                  onClick={() => {
                    if (collapsed.has(g.id)) collapsed.delete(g.id)
                    else collapsed.add(g.id)
                    force((n) => n + 1)
                  }}
                >
                  <span className="lp-chev">{isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}</span>
                  <span className="lp-section-title">{g.label}</span>
                  <span className="lp-theme-group__count">{g.tokens.length}</span>
                </div>
                {!isCollapsed &&
                  g.tokens.map((t) => (
                    <TokenRow
                      key={t.name}
                      token={t}
                      active={editing?.name === t.name}
                      renaming={renaming === t.name}
                      onClick={(el) => setEditing(editing?.name === t.name ? null : { name: t.name, anchor: el })}
                      onContextMenu={(e) => ctx.open(e, rowMenu(t.name))}
                      onRename={() => setRenaming(t.name)}
                      onRenameDone={(v) => {
                        if (v !== null) renameToken(t.name, v)
                        setRenaming(null)
                      }}
                    />
                  ))}
              </div>
            )
          })}
        </div>
      )}
      {ctx.element}
      <Popover
        open={Boolean(editing && editingToken)}
        anchor={editing?.anchor ?? null}
        onClose={() => setEditing(null)}
        placement="right-start"
        offset={8}
      >
        {editing && editingToken && (
          <TokenEditor
            key={editing.name}
            docId={docId}
            token={editingToken}
            onRename={(v) => {
              const name = normalizeName(v)
              renameToken(editing.name, v)
              if (name && s().docs[docId]?.tokens.some((t) => t.name === name)) setEditing({ ...editing, name })
            }}
            onClose={() => setEditing(null)}
          />
        )}
      </Popover>
    </div>
  )
}

function TokenRow({
  token,
  active,
  renaming,
  onClick,
  onContextMenu,
  onRename,
  onRenameDone
}: {
  token: Token
  active: boolean
  renaming: boolean
  onClick: (el: HTMLElement) => void
  onContextMenu: (e: React.MouseEvent) => void
  onRename: () => void
  onRenameDone: (v: string | null) => void
}): JSX.Element {
  const isColor = groupOf(token.name) === 'color'
  return (
    <div
      className={['lp-token', active && 'lp-token--active'].filter(Boolean).join(' ')}
      data-token={token.name}
      title={`${token.name}: ${token.value}`}
      onClick={(e) => onClick(e.currentTarget)}
      onDoubleClick={onRename}
      onContextMenu={onContextMenu}
    >
      {isColor && <span className="lp-token__swatch" style={{ background: token.value }} />}
      {renaming ? (
        <InlineEdit value={displayName(token.name)} onCommit={(v) => onRenameDone(v)} onCancel={() => onRenameDone(null)} />
      ) : (
        <span className="lp-ellipsis lp-token__name">{displayName(token.name)}</span>
      )}
      {!isColor && !renaming && <span className="lp-token__value">{token.value}</span>}
    </div>
  )
}

function TokenEditor({
  docId,
  token,
  onRename,
  onClose
}: {
  docId: string
  token: Token
  onRename: (v: string) => void
  onClose: () => void
}): JSX.Element {
  const isColor = groupOf(token.name) === 'color'
  const [name, setName] = useState(displayName(token.name))
  const [value, setValue] = useState(token.value)
  const initial = useRef(token.value)
  useEffect(() => setValue(token.value), [token.value])

  const setTokenValue = (v: string, live: boolean): void => {
    getStore().mutate(
      docId,
      'Edit token',
      (d) => {
        const t = d.tokens.find((x) => x.name === token.name)
        if (t) t.value = v
      },
      live ? { coalesce: `token:${token.name}` } : undefined
    )
  }

  const stop = (e: React.KeyboardEvent): void => e.stopPropagation()

  return (
    <div className={['lp-token-editor', isColor && 'lp-token-editor--color'].filter(Boolean).join(' ')} onKeyDown={stop}>
      <div className="lp-token-editor__head">
        <span>Edit token</span>
        <IconButton icon={<X size={14} />} label="Close" onClick={onClose} />
      </div>
      <label className="lp-token-editor__field">
        <span>Name</span>
        <input
          value={name}
          spellCheck={false}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => onRename(name)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onRename(name)
            if (e.key === 'Escape') onClose()
          }}
        />
      </label>
      <label className="lp-token-editor__field">
        <span>Value</span>
        <input
          className="lp-mono"
          value={value}
          spellCheck={false}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => value.trim() && value !== token.value && setTokenValue(value.trim(), false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && value.trim()) setTokenValue(value.trim(), false)
            if (e.key === 'Escape') onClose()
          }}
        />
      </label>
      {isColor && (
        <div className="lp-token-editor__picker">
          <ColorPicker
            value={parseColor(token.value) ? token.value : '#000000'}
            previous={initial.current}
            onChange={(c, { live }) => setTokenValue(c, live)}
          />
        </div>
      )}
    </div>
  )
}
