import { useRef, useState, type CSSProperties } from 'react'
import { ChevronDown, ChevronRight, Plus, X } from 'lucide-react'
import { IconButton, Popover, Select, useContextMenu, type MenuEntry } from '../../ui'
import { getStore, useStore } from '../../model/store'
import { modesOf, tokenValueIn } from '../../model/modes'
import { getTextStyle, linkedNodes, uniqueTextStyleName } from '../../model/textStyles'
import { TEXT_STYLE_KEYS } from '../../model/types'
import type { CNode, Doc, StylePatch, TextStyle, Token } from '../../model/types'
import { addColorToken } from '../inspector/ColorInput'
import { WEIGHTS } from '../inspector/TextSection'
import { InlineEdit } from './InlineEdit'
import { colourSource, colourTokenName, groupColourStyles, groupTextStyles, previewStyle, styleCaption } from './styleUtils'

const collapsed = new Map<string, Set<string>>()

/** Theme tab "Styles" view: text styles (live preview, groups, create / rename / delete / edit) and colour styles over the tokens. */
export function StylesPanel({
  docId,
  mode,
  onEditToken
}: {
  docId: string
  /** theme mode being viewed (null when the file has no modes) */
  mode: string | null
  /** open the token editor (owned by the Theme panel) for a colour style */
  onEditToken: (name: string, anchor: HTMLElement) => void
}): JSX.Element {
  const doc = useStore((s) => s.docs[docId])
  const selection = useStore((s) => s.editors[docId]?.selection)
  const [msg, setMsg] = useState<string | null>(null)
  const [, force] = useState(0)
  if (!collapsed.has(docId)) collapsed.set(docId, new Set())
  const closed = collapsed.get(docId)!
  const toggle = (key: string): void => {
    if (closed.has(key)) closed.delete(key)
    else closed.add(key)
    force((n) => n + 1)
  }
  if (!doc) return <div className="lp-styles" />
  const nodes = (selection ?? []).map((id) => doc.nodes[id]).filter((n): n is CNode => Boolean(n))
  // tokens as CSS variables for the previews (the value in the mode being viewed)
  const vars: Record<string, string> = {}
  for (const t of doc.tokens) vars[t.name] = tokenValueIn(doc, t, mode)
  return (
    <div className="lp-styles" style={vars as CSSProperties}>
      {msg && (
        <div className="lp-styles__msg" role="alert">
          {msg}
        </div>
      )}
      <TextStyles docId={docId} doc={doc} nodes={nodes} closed={closed} toggle={toggle} setMsg={setMsg} />
      <ColourStyles docId={docId} doc={doc} nodes={nodes} mode={mode} closed={closed} toggle={toggle} setMsg={setMsg} onEditToken={onEditToken} />
    </div>
  )
}

interface SectionProps {
  docId: string
  doc: Doc
  nodes: CNode[]
  closed: Set<string>
  toggle: (key: string) => void
  setMsg: (m: string | null) => void
}

function GroupHead({ label, count, open, onClick }: { label: string; count: number; open: boolean; onClick: () => void }): JSX.Element {
  return (
    <div className="lp-section-head lp-styles__group" onClick={onClick}>
      <span className="lp-chev">{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
      <span className="lp-section-title">{label}</span>
      <span className="lp-theme-group__count">{count}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// text styles

function TextStyles({ docId, doc, nodes, closed, toggle, setMsg }: SectionProps): JSX.Element {
  const styles = doc.textStyles ?? []
  const [editing, setEditing] = useState<{ id: string; anchor: HTMLElement } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const ctx = useContextMenu()
  const s = getStore
  const textNodes = nodes.filter((n) => n.type === 'text')

  const create = (): void => {
    setMsg(null)
    let id = ''
    s().transact(docId, 'Create text style', () => {
      if (textNodes.length === 1) {
        id = s().createTextStyle(docId, 'Text style', textNodes[0].id)
        s().applyTextStyle(docId, [textNodes[0].id], id) // the layer it came from follows it
      } else id = s().createTextStyle(docId, 'Text style', { fontSize: 16, fontWeight: 400, lineHeight: '1.25' })
    })
    setRenaming(id)
  }

  const rename = (id: string, name: string): void => {
    const taken = styles.some((x) => x.id !== id && x.name.toLowerCase() === name.trim().toLowerCase())
    if (taken) setMsg(`A text style named "${name.trim()}" already exists`)
    else {
      setMsg(null)
      s().renameTextStyle(docId, id, name)
    }
  }

  const duplicate = (st: TextStyle): void => {
    s().createTextStyle(docId, uniqueTextStyleName(doc, `${st.name} copy`), { ...st.style })
  }

  const apply = (id: string): void => {
    if (!textNodes.length) return setMsg('Select a text layer to apply the style')
    setMsg(null)
    s().applyTextStyle(docId, textNodes.map((n) => n.id), id)
  }

  const menu = (st: TextStyle): MenuEntry[] => [
    { label: 'Apply to selection', disabled: !textNodes.length, onSelect: () => apply(st.id) },
    { label: 'Rename', onSelect: () => setRenaming(st.id) },
    { label: 'Duplicate', onSelect: () => duplicate(st) },
    { type: 'separator' },
    { label: 'Delete', danger: true, onSelect: () => s().deleteTextStyle(docId, st.id) }
  ]

  const editingStyle = editing ? getTextStyle(doc, editing.id) : undefined
  return (
    <div className="lp-styles__section" data-styles="text">
      <div className="lp-styles__head">
        <span className="lp-styles__title">Text styles</span>
        <span className="lp-theme-group__count">{styles.length}</span>
        <span className="lp-styles__spacer" />
        <IconButton
          icon={<Plus size={14} />}
          label={textNodes.length === 1 ? 'Create text style from selection' : 'New text style'}
          onClick={create}
        />
      </div>
      {styles.length === 0 && <div className="lp-styles__empty">No text styles yet. Select a text layer and press +.</div>}
      {groupTextStyles(styles).map((g) => {
        const key = `text:${g.group}`
        const open = !closed.has(key)
        return (
          <div key={g.group || '(none)'}>
            {g.group && <GroupHead label={g.group} count={g.items.length} open={open} onClick={() => toggle(key)} />}
            {open &&
              g.items.map(({ item: st, label }) => (
                <div
                  key={st.id}
                  className={['lp-style', editing?.id === st.id && 'lp-style--active'].filter(Boolean).join(' ')}
                  data-text-style-id={st.id}
                  title={`${st.name}: ${styleCaption(st.style)}`}
                  onClick={(e) => setEditing(editing?.id === st.id ? null : { id: st.id, anchor: e.currentTarget })}
                  onDoubleClick={() => setRenaming(st.id)}
                  onContextMenu={(e) => ctx.open(e, menu(st))}
                >
                  <span className="lp-style__preview" style={previewStyle(st.style) as CSSProperties}>
                    Ag
                  </span>
                  {renaming === st.id ? (
                    <InlineEdit
                      value={st.name}
                      onCommit={(v) => {
                        rename(st.id, v)
                        setRenaming(null)
                      }}
                      onCancel={() => setRenaming(null)}
                    />
                  ) : (
                    <span className="lp-ellipsis lp-style__name">{g.group ? label : st.name}</span>
                  )}
                  {renaming !== st.id && <span className="lp-style__caption">{styleCaption(st.style)}</span>}
                  {renaming !== st.id && <span className="lp-style__count">{linkedNodes(doc, st.id).length}</span>}
                </div>
              ))}
          </div>
        )
      })}
      {ctx.element}
      <Popover open={Boolean(editing && editingStyle)} anchor={editing?.anchor ?? null} onClose={() => setEditing(null)} placement="right-start" offset={8}>
        {editing && editingStyle && (
          <TextStyleEditor
            key={editing.id}
            docId={docId}
            style={editingStyle}
            selectionHasText={textNodes.length > 0}
            onRename={(v) => rename(editingStyle.id, v)}
            onApply={() => apply(editingStyle.id)}
            onDelete={() => {
              s().deleteTextStyle(docId, editingStyle.id)
              setEditing(null)
            }}
            onClose={() => setEditing(null)}
          />
        )}
      </Popover>
    </div>
  )
}

const CASES = [
  { value: 'none', label: 'Original case' },
  { value: 'uppercase', label: 'UPPER' },
  { value: 'lowercase', label: 'lower' },
  { value: 'capitalize', label: 'Title' }
]
const DECORATIONS = [
  { value: 'none', label: 'No line' },
  { value: 'underline', label: 'Underline' },
  { value: 'line-through', label: 'Strikethrough' }
]

/** A typed value for a style key: numbers where CSS takes them, text otherwise, empty = remove. */
export function parseStyleInput(key: (typeof TEXT_STYLE_KEYS)[number], raw: string): string | number | null {
  const v = raw.trim()
  if (!v) return null
  if ((key === 'fontSize' || key === 'fontWeight') && /^\d+(\.\d+)?(px)?$/.test(v)) return parseFloat(v)
  return v
}

function TextStyleEditor({
  docId,
  style,
  selectionHasText,
  onRename,
  onApply,
  onDelete,
  onClose
}: {
  docId: string
  style: TextStyle
  selectionHasText: boolean
  onRename: (v: string) => void
  onApply: () => void
  onDelete: () => void
  onClose: () => void
}): JSX.Element {
  const [name, setName] = useState(style.name)
  const set = (patch: StylePatch): void => getStore().updateTextStyle(docId, style.id, patch)
  const stop = (e: React.KeyboardEvent): void => e.stopPropagation()
  const text = (key: (typeof TEXT_STYLE_KEYS)[number], label: string, mono = false): JSX.Element => (
    <StyleField key={`${style.id}:${key}:${String(style.style[key] ?? '')}`} label={label} mono={mono} value={String(style.style[key] ?? '')} onCommit={(v) => set({ [key]: parseStyleInput(key, v) })} />
  )
  return (
    <div className="lp-token-editor lp-style-editor" onKeyDown={stop}>
      <div className="lp-token-editor__head">
        <span>Edit text style</span>
        <IconButton icon={<X size={14} />} label="Close" onClick={onClose} />
      </div>
      <label className="lp-token-editor__field">
        <span>Name</span>
        <input
          value={name}
          spellCheck={false}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== style.name && onRename(name)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim() && name !== style.name) onRename(name)
            if (e.key === 'Escape') onClose()
          }}
        />
      </label>
      {text('fontFamily', 'Font')}
      {text('fontSize', 'Size')}
      <div className="lp-token-editor__field">
        <span>Weight</span>
        <Select<string>
          size="sm"
          value={String(style.style.fontWeight === 'bold' ? 700 : style.style.fontWeight ?? '400')}
          options={WEIGHTS}
          onChange={(v) => set({ fontWeight: Number(v) })}
        />
      </div>
      {text('lineHeight', 'Line height')}
      {text('letterSpacing', 'Spacing')}
      <div className="lp-token-editor__field">
        <span>Case</span>
        <Select<string> size="sm" value={String(style.style.textTransform ?? 'none')} options={CASES} onChange={(v) => set({ textTransform: v === 'none' ? null : v })} />
      </div>
      <div className="lp-token-editor__field">
        <span>Line</span>
        <Select<string>
          size="sm"
          value={String(style.style.textDecorationLine ?? 'none')}
          options={DECORATIONS}
          onChange={(v) => set({ textDecorationLine: v === 'none' ? null : v })}
        />
      </div>
      <div className="lp-style-editor__actions">
        <button type="button" className="lp-token-editor__reset" disabled={!selectionHasText} onClick={onApply}>
          Apply to selection
        </button>
        <button type="button" className="lp-token-editor__reset lp-style-editor__delete" onClick={onDelete}>
          Delete style
        </button>
      </div>
    </div>
  )
}

function StyleField({ label, value, mono, onCommit }: { label: string; value: string; mono?: boolean; onCommit: (v: string) => void }): JSX.Element {
  const [v, setV] = useState(value)
  return (
    <label className="lp-token-editor__field">
      <span>{label}</span>
      <input
        className={mono ? 'lp-mono' : undefined}
        value={v}
        spellCheck={false}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => v !== value && onCommit(v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && v !== value) onCommit(v)
          if (e.key === 'Escape') setV(value)
        }}
      />
    </label>
  )
}

// ---------------------------------------------------------------------------------------------
// colour styles (colour tokens)

function ColourStyles({
  docId,
  doc,
  nodes,
  mode,
  closed,
  toggle,
  setMsg,
  onEditToken
}: SectionProps & { mode: string | null; onEditToken: (name: string, anchor: HTMLElement) => void }): JSX.Element {
  const modes = modesOf(doc)
  const [naming, setNaming] = useState(false)
  const addBtn = useRef<HTMLButtonElement | null>(null)
  const groups = groupColourStyles(doc.tokens)
  const total = groups.reduce((n, g) => n + g.items.length, 0)

  const create = (rawName: string): void => {
    const src = colourSource(nodes)
    if ('error' in src) return setMsg(src.error)
    const name = colourTokenName(rawName)
    const shown = name.replace(/^--color-/, '')
    const err = addColorToken(docId, name, src.color, (ref) => getStore().updateStyles(docId, [src.id], { [src.key]: ref }))
    if (err === 'Name already used') setMsg(`A colour style named "${shown}" already exists`)
    else if (err) setMsg(err === 'Invalid name' ? 'Use letters, numbers and hyphens in the name' : err)
    else {
      setMsg(null)
      setNaming(false)
    }
  }

  return (
    <div className="lp-styles__section" data-styles="colour">
      <div className="lp-styles__head">
        <span className="lp-styles__title">Colour styles</span>
        <span className="lp-theme-group__count">{total}</span>
        <span className="lp-styles__spacer" />
        <IconButton
          ref={addBtn}
          icon={<Plus size={14} />}
          label="Create colour style from selection"
          onClick={() => {
            setMsg(null)
            setNaming(true)
          }}
        />
      </div>
      {naming && (
        <div className="lp-style lp-style--new">
          <span className="lp-style__swatch" style={{ background: (() => { const c = colourSource(nodes); return 'color' in c ? c.color : 'transparent' })() }} />
          <InlineEdit
            value=""
            className="lp-style__new-input"
            onCommit={create}
            onCancel={() => {
              setNaming(false)
            }}
          />
        </div>
      )}
      {total === 0 && !naming && <div className="lp-styles__empty">No colour styles yet. Select a layer and press +.</div>}
      {groups.map((g) => {
        const key = `colour:${g.group}`
        const open = !closed.has(key)
        return (
          <div key={g.group || '(none)'}>
            {g.group && <GroupHead label={g.group} count={g.items.length} open={open} onClick={() => toggle(key)} />}
            {open &&
              g.items.map(({ item: t, label }) => (
                <ColourRow key={t.name} token={t} label={label} modes={modes} mode={mode} doc={doc} onClick={(el) => onEditToken(t.name, el)} />
              ))}
          </div>
        )
      })}
    </div>
  )
}

function ColourRow({ token, label, modes, mode, doc, onClick }: { token: Token; label: string; modes: string[]; mode: string | null; doc: Doc; onClick: (el: HTMLElement) => void }): JSX.Element {
  const value = tokenValueIn(doc, token, mode)
  return (
    <div className="lp-style" data-colour-style={token.name} title={`${token.name}: ${value}`} onClick={(e) => onClick(e.currentTarget)}>
      {modes.length ? (
        <span className="lp-style__swatches">
          {modes.map((m) => (
            <span key={m} className={['lp-style__swatch', m === mode && 'lp-style__swatch--on'].filter(Boolean).join(' ')} title={m} style={{ background: tokenValueIn(doc, token, m) }} />
          ))}
        </span>
      ) : (
        <span className="lp-style__swatch" style={{ background: value }} />
      )}
      <span className="lp-ellipsis lp-style__name">{label}</span>
      <span className="lp-style__caption lp-mono">{value}</span>
    </div>
  )
}
