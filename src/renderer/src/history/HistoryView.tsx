// Full-window version history of a doc: the versions on the right (newest first), the selected one
// rendered read-only on the left with its changes outlined, and restore / duplicate / name / delete.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Ellipsis,
  History,
  Minus,
  PencilLine,
  Plus,
  RotateCcw,
  Tag,
  X
} from 'lucide-react'
import type { VersionMeta } from '@shared/api'
import { diffDocs, summarize, summaryText, topmost, type ChangeAspect, type DocDiff, type NodeChange } from '@shared/docDiff'
import { getStore, useStore } from '../model/store'
import type { Doc } from '../model/types'
import { Button, IconButton, Modal, Select, useContextMenu, type MenuEntry } from '../ui'
import { InlineEdit } from '../editor/left/InlineEdit'
import { relativeTime, useNow } from '../dashboard/FileCard'
import { toast } from '../editor/canvas/toast'
import { VersionCanvas, type Mark } from './VersionCanvas'
import {
  duplicateVersion,
  listVersions,
  loadVersionDoc,
  restoreVersion,
  useSaveVersionDialog,
  versionTime,
  versionTitle
} from './versions'
import './history.css'

const CURRENT = 'current'
const ASPECT_LABEL: Record<ChangeAspect, string> = {
  style: 'style',
  text: 'text',
  position: 'position',
  name: 'name',
  visibility: 'visibility',
  layers: 'layer order',
  content: 'content'
}
const LIST_LIMIT = 150
const capitalize = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1)

function dayLabel(ts: number, now: number): string {
  const d = new Date(ts)
  const today = new Date(now)
  const start = (x: Date): number => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((start(today) - start(d)) / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', ...(d.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }) })
}

/** Small LRU of loaded version docs (they can be large). */
function useVersionDocs(docId: string): (vid: string) => Promise<Doc | null> {
  const cache = useRef(new Map<string, Promise<Doc | null>>())
  return useCallback(
    (vid: string) => {
      const c = cache.current
      let p = c.get(vid)
      if (p) {
        c.delete(vid)
        c.set(vid, p)
        return p
      }
      p = loadVersionDoc(docId, vid)
      c.set(vid, p)
      while (c.size > 6) c.delete(c.keys().next().value as string)
      return p
    },
    [docId]
  )
}

export function HistoryView({ docId }: { docId: string }): JSX.Element {
  const live = useStore((s) => s.docs[docId])
  const now = useNow()
  const load = useVersionDocs(docId)
  const [versions, setVersions] = useState<VersionMeta[] | null>(null)
  const [sel, setSel] = useState<string>(CURRENT)
  const [view, setView] = useState<{ key: string; doc: Doc; base: Doc | null } | null>(null)
  const [loading, setLoading] = useState(false)
  const [pageId, setPageId] = useState<string>('')
  const [showMarks, setShowMarks] = useState(true)
  const [focus, setFocus] = useState<{ id: string | null; tick: number }>({ id: null, tick: 0 })
  const [renaming, setRenaming] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<VersionMeta | null>(null)
  const [busy, setBusy] = useState(false)
  const ctx = useContextMenu()
  const listRef = useRef<HTMLDivElement | null>(null)
  const openSave = useSaveVersionDialog((s) => s.open)
  const saveDialogOpen = useSaveVersionDialog((s) => s.docId !== null)

  const refresh = useCallback(async () => setVersions(await listVersions(docId)), [docId])
  useEffect(() => {
    void refresh()
    // an automatic version may be written right after the viewer opens (pending save)
    const t = setTimeout(() => void refresh(), 2000)
    return () => clearTimeout(t)
  }, [refresh])
  // refresh when the save dialog closes (a named version may have been added)
  useEffect(() => {
    if (!saveDialogOpen) void refresh()
  }, [saveDialogOpen, refresh])

  const index = versions ? versions.findIndex((v) => v.id === sel) : -1
  const selMeta = index >= 0 ? versions![index] : null

  // load the selected version and the one before it (for the change list)
  useEffect(() => {
    if (!live || !versions) return
    let cancelled = false
    setLoading(true)
    void (async () => {
      let doc: Doc | null
      let base: Doc | null
      if (sel === CURRENT) {
        doc = live
        base = versions[0] ? await load(versions[0].id) : null
      } else {
        const i = versions.findIndex((v) => v.id === sel)
        doc = i >= 0 ? await load(sel) : null
        base = i >= 0 && versions[i + 1] ? await load(versions[i + 1].id) : null
      }
      if (cancelled) return
      setLoading(false)
      if (!doc) {
        if (sel !== CURRENT) toast('This version could not be read')
        return
      }
      setView({ key: sel, doc, base })
    })()
    return () => {
      cancelled = true
    }
  }, [sel, versions, live, load])

  const diff: DocDiff | null = useMemo(() => (view && view.base ? diffDocs(view.base, view.doc) : null), [view])

  // page to show: keep the current one when it exists in this version, else the first page with changes
  useEffect(() => {
    if (!view) return
    const pages = view.doc.pages
    if (pages.some((p) => p.id === pageId)) return
    const changed = diff ? [...diff.added, ...diff.changed][0]?.pageId : null
    setPageId(changed && pages.some((p) => p.id === changed) ? changed : pages[0]?.id ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

  const marks = useMemo(() => {
    const m = new Map<string, Mark>()
    if (!diff) return m
    for (const c of diff.added) m.set(c.id, 'added')
    for (const c of diff.changed) if (!(c.aspects?.length === 1 && c.aspects[0] === 'layers')) m.set(c.id, 'changed')
    return m
  }, [diff])

  const close = useCallback(() => getStore().closeHistory(), [])

  const select = useCallback((id: string) => {
    setSel(id)
    setRenaming(null)
    setFocus({ id: null, tick: 0 })
  }, [])

  const order = useMemo(() => [CURRENT, ...(versions ?? []).map((v) => v.id)], [versions])
  const step = useCallback(
    (dir: 1 | -1) => {
      const i = order.indexOf(sel)
      const next = order[i + dir]
      if (next) select(next)
    },
    [order, sel, select]
  )

  // keyboard: ↑/↓ move through versions, Esc closes
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, [contenteditable="true"]') || document.querySelector('.c-modal-overlay')) return
      if (e.key === 'Escape') close()
      else if (e.key === 'ArrowDown') step(1)
      else if (e.key === 'ArrowUp') step(-1)
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [close, step])

  // keep the selected row in view
  useEffect(() => {
    listRef.current?.querySelector('.hv-row--selected')?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const doRestore = async (v: VersionMeta): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const ok = await restoreVersion(docId, v)
      if (!ok) {
        toast('This version could not be restored')
        return
      }
      toast(`Restored the version from ${versionTime(v.docUpdatedAt)}`, 3000)
      getStore().closeHistory()
      getStore().openDoc(docId)
    } finally {
      setBusy(false)
    }
  }

  const doDuplicate = async (v: VersionMeta): Promise<void> => {
    const id = await duplicateVersion(docId, v)
    toast(id ? 'Copied to a new file on the dashboard' : 'This version could not be read', 2500)
  }

  const doRename = async (v: VersionMeta, name: string): Promise<void> => {
    setRenaming(null)
    await window.canvasApi?.history.rename(docId, v.id, name)
    await refresh()
  }

  const doDelete = async (v: VersionMeta): Promise<void> => {
    setConfirmDelete(null)
    await window.canvasApi?.history.remove(docId, v.id)
    if (sel === v.id) select(CURRENT)
    await refresh()
  }

  const versionMenu = (v: VersionMeta): MenuEntry[] => [
    { label: 'Restore this version', onSelect: () => void doRestore(v) },
    { label: 'Duplicate as new file', onSelect: () => void doDuplicate(v) },
    { type: 'separator' },
    { label: v.name ? 'Rename version' : 'Name this version', onSelect: () => setRenaming(v.id) },
    { type: 'separator' },
    { label: 'Delete version…', danger: true, onSelect: () => setConfirmDelete(v) }
  ]

  const goTo = (c: NodeChange, removed: boolean): void => {
    if (removed) {
      // a removed layer still exists in the older version: show it there
      const older = sel === CURRENT ? versions?.[0] : versions?.[index + 1]
      if (!older) return
      setSel(older.id)
    }
    if (c.pageId) setPageId(c.pageId)
    setFocus((f) => ({ id: c.id, tick: f.tick + 1 }))
  }

  if (!live) return <div className="hv" />

  const doc = view?.doc
  const page = doc?.pages.find((p) => p.id === pageId) ?? doc?.pages[0]
  const currentSummary = view && sel === CURRENT && diff ? summaryText(summarize(diff)) : ''
  const liveUnchanged = versions?.[0] && versions[0].docUpdatedAt >= live.updatedAt

  // group the rows by day
  const groups: { label: string; items: VersionMeta[] }[] = []
  for (const v of (versions ?? []).slice(0, LIST_LIMIT)) {
    const label = dayLabel(v.docUpdatedAt, now)
    const g = groups[groups.length - 1]
    if (g && g.label === label) g.items.push(v)
    else groups.push({ label, items: [v] })
  }

  const title = sel === CURRENT ? 'Current version' : selMeta ? versionTitle(selMeta) : ''

  return (
    <div className="hv">
      <div className="hv-main">
        <div className="hv-top">
          <Button variant="ghost" size="sm" icon={<ArrowLeft size={14} />} onClick={close}>
            Back
          </Button>
          <div className="hv-top__title">
            <span className="hv-top__doc">{live.name}</span>
            <span className="hv-top__sep">/</span>
            <span className="hv-top__ver">{title}</span>
            {selMeta && selMeta.name && <span className="hv-top__time">{versionTime(selMeta.docUpdatedAt)}</span>}
          </div>
          <div className="hv-top__spacer" />
          {doc && doc.pages.length > 1 && (
            <div className="hv-top__page">
              <Select
                value={page?.id ?? ''}
                options={doc.pages.map((p) => ({ value: p.id, label: p.name }))}
                onChange={(v: string) => setPageId(v)}
              />
            </div>
          )}
          <label className="hv-toggle">
            <input type="checkbox" checked={showMarks} onChange={(e) => setShowMarks(e.target.checked)} />
            Show changes
          </label>
          <IconButton icon={<ChevronUp size={16} />} label="Newer version" shortcut="ArrowUp" disabled={sel === CURRENT} onClick={() => step(-1)} />
          <IconButton
            icon={<ChevronDown size={16} />}
            label="Older version"
            shortcut="ArrowDown"
            disabled={order.indexOf(sel) >= order.length - 1}
            onClick={() => step(1)}
          />
          {selMeta ? (
            <Button variant="primary" size="sm" icon={<RotateCcw size={14} />} disabled={busy} onClick={() => void doRestore(selMeta)}>
              Restore this version
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => {
                close()
                getStore().openDoc(docId)
              }}
            >
              Open file
            </Button>
          )}
        </div>
        <div className="hv-stage">
          {doc && page ? (
            <VersionCanvas
              key={view?.key}
              doc={doc}
              pageId={page.id}
              marks={marks}
              showMarks={showMarks}
              focusId={focus.id}
              focusTick={focus.tick}
            />
          ) : (
            <div className="hv-empty">{loading || !versions ? 'Loading…' : 'Nothing to show'}</div>
          )}
          {loading && doc && <div className="hv-loading">Loading version…</div>}
          {showMarks && diff && (marks.size > 0 || diff.removed.length > 0) && (
            <div className="hv-legend">
              <span>
                <i className="hv-dot hv-dot--added" /> Added
              </span>
              <span>
                <i className="hv-dot hv-dot--changed" /> Edited
              </span>
            </div>
          )}
        </div>
      </div>

      <aside className="hv-side">
        <div className="hv-side__head">
          <History size={16} />
          <span className="hv-side__title">Version history</span>
          <IconButton icon={<Plus size={16} />} label="Save current version…" shortcut="Ctrl+Alt+S" onClick={() => openSave(docId)} />
          <IconButton icon={<X size={16} />} label="Close" onClick={close} />
        </div>
        <div className="hv-list" ref={listRef}>
          <Row
            selected={sel === CURRENT}
            onClick={() => select(CURRENT)}
            title="Current version"
            sub={relativeTime(live.updatedAt, now)}
            summary={liveUnchanged ? 'No changes since the last version' : currentSummary}
            badge="Live"
          >
            {sel === CURRENT && diff && !liveUnchanged && <Changes diff={diff} onGo={goTo} />}
          </Row>

          {versions === null && <div className="hv-note">Loading versions…</div>}
          {versions && versions.length === 0 && (
            <div className="hv-note">
              No saved versions yet. Vellum saves one automatically every few minutes while you edit, or click + to save one
              now.
            </div>
          )}
          {groups.map((g) => (
            <div key={g.label}>
              <div className="hv-day">{g.label}</div>
              {g.items.map((v) => (
                <Row
                  key={v.id}
                  selected={sel === v.id}
                  onClick={() => select(v.id)}
                  onMenu={(e) => ctx.open(e, versionMenu(v))}
                  icon={v.kind === 'named' ? <Tag size={12} /> : v.kind === 'restore' ? <RotateCcw size={12} /> : undefined}
                  title={
                    renaming === v.id ? (
                      <InlineEdit value={v.name ?? ''} onCommit={(n) => void doRename(v, n)} onCancel={() => setRenaming(null)} />
                    ) : (
                      versionTitle(v)
                    )
                  }
                  sub={
                    v.name || v.kind === 'restore'
                      ? versionTime(v.docUpdatedAt) +
                        (v.kind === 'restore' && v.restoredFrom ? ` · replaced by the version from ${versionTime(v.restoredFrom)}` : '')
                      : capitalize(relativeTime(v.docUpdatedAt, now).replace(/^Edited /, ''))
                  }
                  summary={v.summary ? summaryText(v.summary) || 'No layer changes' : 'Oldest saved version'}
                >
                  {sel === v.id && diff && <Changes diff={diff} onGo={goTo} />}
                  {sel === v.id && (
                    <div className="hv-row__actions">
                      <Button size="sm" variant="primary" icon={<RotateCcw size={13} />} disabled={busy} onClick={() => void doRestore(v)}>
                        Restore
                      </Button>
                      <Button size="sm" icon={<PencilLine size={13} />} onClick={() => setRenaming(v.id)}>
                        {v.name ? 'Rename' : 'Name'}
                      </Button>
                      <IconButton icon={<Ellipsis size={16} />} label="More" onClick={(e) => ctx.open(e, versionMenu(v))} />
                    </div>
                  )}
                </Row>
              ))}
            </div>
          ))}
          {versions && versions.length > LIST_LIMIT && (
            <div className="hv-note">Showing the newest {LIST_LIMIT} of {versions.length} versions.</div>
          )}
          {versions && versions.length > 0 && (
            <div className="hv-note hv-note--foot">
              Vellum saves a version every 5 minutes while you edit. The newest 100 automatic versions are kept; named
              versions are kept until you delete them.
            </div>
          )}
        </div>
      </aside>
      {ctx.element}
      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title="Delete version?"
        width={400}
        footer={
          <>
            <Button onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button className="db-danger-btn" onClick={() => confirmDelete && void doDelete(confirmDelete)}>
              Delete
            </Button>
          </>
        }
      >
        <p className="hv-modal-text hv-modal-body">
          “{confirmDelete ? versionTitle(confirmDelete) : ''}” will be removed from the history of {live.name}. The file itself
          is not changed.
        </p>
      </Modal>
    </div>
  )
}

function Row(props: {
  selected: boolean
  onClick: () => void
  onMenu?: (e: React.MouseEvent) => void
  icon?: React.ReactNode
  title: React.ReactNode
  sub: string
  summary?: string
  badge?: string
  children?: React.ReactNode
}): JSX.Element {
  return (
    <div
      className={['hv-row', props.selected && 'hv-row--selected'].filter(Boolean).join(' ')}
      onClick={props.onClick}
      onContextMenu={props.onMenu}
    >
      <div className="hv-row__rail">
        <i className="hv-row__dot" />
      </div>
      <div className="hv-row__body">
        <div className="hv-row__title">
          {props.icon && <span className="hv-row__icon">{props.icon}</span>}
          <span className="hv-row__name">{props.title}</span>
          {props.badge && <span className="hv-row__badge">{props.badge}</span>}
        </div>
        <div className="hv-row__sub">{props.sub}</div>
        {props.summary && <div className="hv-row__summary">{props.summary}</div>}
        {props.children && (
          <div className="hv-row__detail" onClick={(e) => e.stopPropagation()}>
            {props.children}
          </div>
        )}
      </div>
    </div>
  )
}

const MAX_ITEMS = 40

function Changes({ diff, onGo }: { diff: DocDiff; onGo: (c: NodeChange, removed: boolean) => void }): JSX.Element {
  const [all, setAll] = useState(false)
  const items: { kind: 'added' | 'changed' | 'removed'; c: NodeChange; count: number }[] = [
    ...topmost(diff.added).map(({ change, count }) => ({ kind: 'added' as const, c: change, count })),
    ...diff.changed.map((c) => ({ kind: 'changed' as const, c, count: 1 })),
    ...topmost(diff.removed).map(({ change, count }) => ({ kind: 'removed' as const, c: change, count }))
  ]
  const shown = all ? items : items.slice(0, MAX_ITEMS)
  const other: string[] = []
  if (diff.renamed) other.push(`File renamed from “${diff.renamed.from}” to “${diff.renamed.to}”`)
  for (const p of diff.pagesAdded) other.push(`Page “${p}” added`)
  for (const p of diff.pagesRemoved) other.push(`Page “${p}” deleted`)
  for (const p of diff.pagesRenamed) other.push(`Page “${p.from}” renamed to “${p.to}”`)
  for (const p of diff.pagesRecoloured) other.push(`Canvas colour of “${p}” changed`)
  if (diff.tokensAdded.length) other.push(`Tokens added: ${diff.tokensAdded.join(', ')}`)
  if (diff.tokensChanged.length) other.push(`Tokens changed: ${diff.tokensChanged.join(', ')}`)
  if (diff.tokensRemoved.length) other.push(`Tokens removed: ${diff.tokensRemoved.join(', ')}`)
  if (diff.modesChanged) other.push('Theme modes changed')

  if (!items.length && !other.length) return <div className="hv-changes__none">No changes to layers, pages or tokens.</div>
  return (
    <div className="hv-changes">
      {other.map((t) => (
        <div key={t} className="hv-change hv-change--meta">
          {t}
        </div>
      ))}
      {shown.map(({ kind, c, count }) => (
        <button
          type="button"
          key={`${kind}:${c.id}`}
          className={`hv-change hv-change--${kind}`}
          title={kind === 'removed' ? 'Show in the older version' : 'Zoom to layer'}
          onClick={() => onGo(c, kind === 'removed')}
        >
          <span className="hv-change__sign">{kind === 'added' ? <Plus size={11} /> : kind === 'removed' ? <Minus size={11} /> : <PencilLine size={11} />}</span>
          <span className="hv-change__name">{c.name || c.type}</span>
          <span className="hv-change__what">
            {kind === 'changed'
              ? (c.aspects ?? []).map((a) => ASPECT_LABEL[a]).join(', ')
              : count > 1
                ? `${kind} · ${count} layers`
                : kind}
          </span>
        </button>
      ))}
      {items.length > MAX_ITEMS && (
        <button type="button" className="hv-changes__more" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${items.length} layer changes`}
        </button>
      )}
    </div>
  )
}
