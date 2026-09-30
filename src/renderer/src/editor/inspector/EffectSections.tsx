import { useRef, useState } from 'react'
import { AlignJustify, Blend, Circle, Eye, EyeOff, Minus, Plus, Settings2, SunDim, Copy } from 'lucide-react'
import { Button, Field, IconButton, Menu, Section, Select, type MenuEntry } from '../../ui'
import type { Style, StylePatch } from '../../model/types'
import {
  FILTER_DEFS,
  common,
  co,
  formatFilters,
  formatShadows,
  isMixed,
  parseFilters,
  parseShadows,
  px,
  splitTop,
  type Ctx,
  type FilterFn,
  type Shadow
} from './common'
import { ColorInput } from './ColorInput'
import { exportNode, type ExportFormat } from './exporting'

const Mixed = ({ what }: { what: string }): JSX.Element => <div className="insp-mixed">Mixed {what} — click + to replace</div>

/** Parse a `1px solid #000` style shorthand. */
function parseLineShorthand(v: unknown): { width: number; style: string; color: string } | null {
  if (v === undefined || v === null || v === '' || v === 'none') return null
  const parts = splitTop(String(v), ' ')
  const out = { width: 1, style: 'solid', color: '#000000' }
  for (const p of parts) {
    if (/^-?\d*\.?\d+(px)?$/.test(p)) out.width = parseFloat(p)
    else if (/^(none|hidden|dotted|dashed|solid|double|groove|ridge|inset|outset)$/.test(p)) out.style = p
    else out.color = p
  }
  return out
}

function LineStyleButton({ value, onChange }: { value: string; onChange: (s: string) => void }): JSX.Element {
  const ref = useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  const items: MenuEntry[] = ['solid', 'dashed', 'dotted', 'double'].map((st) => ({
    label: cap(st),
    checked: value === st,
    onSelect: () => onChange(st)
  }))
  return (
    <>
      <IconButton ref={ref} icon={<Settings2 size={14} />} label="Line style" onClick={() => setOpen((o) => !o)} />
      <Menu open={open} onClose={() => setOpen(false)} anchor={ref.current} items={items} placement="bottom-end" minWidth={120} ignore={[ref.current]} />
    </>
  )
}

// ------------------------------------------------------------------------------------------ Outline
interface Outline {
  width: number
  offset: number
  color: string
  style: string
}
function readOutline(s: Style): Outline | null {
  const sh = parseLineShorthand(s.outline)
  if (!sh && s.outlineStyle === undefined && s.outlineWidth === undefined) return null
  return {
    width: s.outlineWidth !== undefined ? px(s.outlineWidth) : sh?.width ?? 1,
    offset: px(s.outlineOffset),
    color: String(s.outlineColor ?? sh?.color ?? '#000000'),
    style: String(s.outlineStyle ?? sh?.style ?? 'solid')
  }
}
function writeOutline(o: Outline | null): StylePatch {
  const p: StylePatch = { outline: null, outlineStyle: null, outlineWidth: null, outlineOffset: null, outlineColor: null }
  if (o) Object.assign(p, { outlineStyle: o.style, outlineWidth: o.width, outlineOffset: o.offset || null, outlineColor: o.color })
  return p
}

export function OutlineSection({ ctx }: { ctx: Ctx }): JSX.Element {
  const val = common(ctx.nodes, (n) => readOutline(n.style))
  const set = (o: Outline | null, live = false): void => ctx.set(writeOutline(o), live ? co(ctx, 'outline') : undefined)
  const add = (): void => set({ width: 1, offset: 0, color: '#000000', style: 'solid' })
  if (isMixed(val))
    return (
      <Section title="Outline" onAdd={add}>
        <Mixed what="outlines" />
      </Section>
    )
  if (!val) return <Section title="Outline" empty onAdd={add} addLabel="Add outline" />
  const hidden = val.style === 'none'
  return (
    <Section title="Outline" actions={<LineStyleButton value={val.style} onChange={(st) => set({ ...val, style: st })} />}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr) 24px 24px', gap: 4, alignItems: 'center' }}>
        <Field
          label={<AlignJustify size={12} />}
          value={val.width}
          min={0}
          title="Weight"
          onChange={(v) => typeof v === 'number' && set({ ...val, width: v })}
          onScrub={(v) => set({ ...val, width: Math.max(0, v) }, true)}
          style={{ marginRight: 4 }}
        />
        <Field
          label={<Circle size={11} />}
          value={val.offset}
          title="Offset"
          onChange={(v) => typeof v === 'number' && set({ ...val, offset: v })}
          onScrub={(v) => set({ ...val, offset: v }, true)}
          style={{ marginRight: 4 }}
        />
        <IconButton
          icon={hidden ? <EyeOff size={14} /> : <Eye size={14} />}
          label={hidden ? 'Show outline' : 'Hide outline'}
          onClick={() => set({ ...val, style: hidden ? 'solid' : 'none' })}
        />
        <IconButton icon={<Minus size={14} />} label="Remove outline" onClick={() => set(null)} />
      </div>
      <ColorInput docId={ctx.docId} value={val.color} onChange={(c, { live }) => set({ ...val, color: c }, live)} />
    </Section>
  )
}

// ------------------------------------------------------------------------------------------ Border
type Side = 'all' | 'top' | 'right' | 'bottom' | 'left'
const SIDES: Side[] = ['top', 'right', 'bottom', 'left']
const cap = (s: string): string => s[0].toUpperCase() + s.slice(1)
interface Border {
  side: Side
  width: number
  color: string
  style: string
}
function readBorder(s: Style): Border | null {
  const all = parseLineShorthand(s.border)
  if (all || s.borderStyle !== undefined || s.borderWidth !== undefined) {
    return {
      side: 'all',
      width: s.borderWidth !== undefined ? px(s.borderWidth) : all?.width ?? 1,
      color: String(s.borderColor ?? all?.color ?? '#000000'),
      style: String(s.borderStyle ?? all?.style ?? 'solid')
    }
  }
  for (const side of SIDES) {
    const k = `border${cap(side)}`
    const sh = parseLineShorthand(s[k])
    if (sh || s[`${k}Style`] !== undefined || s[`${k}Width`] !== undefined)
      return {
        side,
        width: s[`${k}Width`] !== undefined ? px(s[`${k}Width`]) : sh?.width ?? 1,
        color: String(s[`${k}Color`] ?? sh?.color ?? '#000000'),
        style: String(s[`${k}Style`] ?? sh?.style ?? 'solid')
      }
  }
  return null
}
function writeBorder(b: Border | null): StylePatch {
  const p: StylePatch = { border: null, borderWidth: null, borderStyle: null, borderColor: null }
  for (const side of SIDES) {
    const k = `border${cap(side)}`
    p[k] = null
    p[`${k}Width`] = null
    p[`${k}Style`] = null
    p[`${k}Color`] = null
  }
  if (b) {
    const k = b.side === 'all' ? 'border' : `border${cap(b.side)}`
    p[`${k}Width`] = b.width
    p[`${k}Style`] = b.style
    p[`${k}Color`] = b.color
  }
  return p
}

export function BorderSection({ ctx }: { ctx: Ctx }): JSX.Element {
  const val = common(ctx.nodes, (n) => readBorder(n.style))
  const set = (b: Border | null, live = false): void => ctx.set(writeBorder(b), live ? co(ctx, 'border') : undefined)
  const add = (): void => set({ side: 'all', width: 1, color: '#000000', style: 'solid' })
  if (isMixed(val))
    return (
      <Section title="Border" onAdd={add}>
        <Mixed what="borders" />
      </Section>
    )
  if (!val) return <Section title="Border" empty onAdd={add} addLabel="Add border" />
  const hidden = val.style === 'none'
  return (
    <Section
      title="Border"
      actions={<LineStyleButton value={val.style} onChange={(st) => set({ ...val, style: st })} />}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr) 24px 24px', gap: 4, alignItems: 'center' }}>
        <Field
          label={<AlignJustify size={12} />}
          value={val.width}
          min={0}
          title="Weight"
          onChange={(v) => typeof v === 'number' && set({ ...val, width: v })}
          onScrub={(v) => set({ ...val, width: Math.max(0, v) }, true)}
          style={{ marginRight: 4 }}
        />
        <Select<Side>
          value={val.side}
          icon={<span style={{ display: 'inline-block', width: 11, height: 11, borderTop: '1.5px solid currentColor', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.3)' }} />}
          options={[
            { value: 'all', label: 'All' },
            'separator',
            { value: 'top', label: 'Top' },
            { value: 'right', label: 'Right' },
            { value: 'bottom', label: 'Bottom' },
            { value: 'left', label: 'Left' }
          ]}
          onChange={(side) => set({ ...val, side })}
          style={{ marginRight: 4 }}
        />
        <IconButton
          icon={hidden ? <EyeOff size={14} /> : <Eye size={14} />}
          label={hidden ? 'Show border' : 'Hide border'}
          onClick={() => set({ ...val, style: hidden ? 'solid' : 'none' })}
        />
        <IconButton icon={<Minus size={14} />} label="Remove border" onClick={() => set(null)} />
      </div>
      <ColorInput docId={ctx.docId} value={val.color} onChange={(c, { live }) => set({ ...val, color: c }, live)} />
    </Section>
  )
}

// ------------------------------------------------------------------------------------------ Shadows
export function ShadowSection({ ctx, inset, text }: { ctx: Ctx; inset?: boolean; text?: boolean }): JSX.Element {
  const prop = text ? 'textShadow' : 'boxShadow'
  const title = inset ? 'Inner shadow' : 'Shadow'
  const all = common(ctx.nodes, (n) => parseShadows(n.style[prop]))
  const commit = (list: Shadow[], live = false): void =>
    ctx.set({ [prop]: formatShadows(list, text) }, live ? co(ctx, prop + String(inset)) : undefined)
  const def: Shadow = { inset: Boolean(inset), x: 0, y: 2, blur: 3, spread: 0, color: '#00000033' }
  if (isMixed(all))
    return (
      <Section title={title} onAdd={() => commit([def])}>
        <Mixed what="shadows" />
      </Section>
    )
  const mine = all.map((s, i) => ({ s, i })).filter(({ s }) => s.inset === Boolean(inset))
  const add = (): void => commit([...all, def])
  if (!mine.length) return <Section title={title} empty onAdd={add} addLabel={`Add ${title.toLowerCase()}`} />
  const update = (i: number, patch: Partial<Shadow>, live = false): void =>
    commit(
      all.map((s, j) => (j === i ? { ...s, ...patch } : s)),
      live
    )
  const fields: Array<[keyof Shadow, JSX.Element | string, string]> = [
    ['x', 'X', 'X'],
    ['y', 'Y', 'Y'],
    ['blur', <SunDim key="b" size={12} />, 'Blur'],
    ...(text ? [] : ([['spread', <Blend key="s" size={12} />, 'Spread']] as Array<[keyof Shadow, JSX.Element, string]>))
  ]
  return (
    <Section title={title} onAdd={add} addLabel={`Add ${title.toLowerCase()}`}>
      {mine.map(({ s, i }) => (
        <div key={i} className="insp-fillblock">
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <div style={{ flex: 1, minWidth: 0, display: 'grid', gridTemplateColumns: `repeat(${fields.length}, minmax(0,1fr))`, gap: 4 }}>
              {fields.map(([k, label, tip]) => (
                <Field
                  key={k}
                  label={label}
                  title={tip}
                  value={s[k] as number}
                  min={k === 'blur' ? 0 : undefined}
                  onChange={(v) => typeof v === 'number' && update(i, { [k]: v })}
                  onScrub={(v) => update(i, { [k]: k === 'blur' ? Math.max(0, v) : v }, true)}
                />
              ))}
            </div>
            <IconButton icon={<Minus size={14} />} label={`Remove ${title.toLowerCase()}`} onClick={() => commit(all.filter((_, j) => j !== i))} />
          </div>
          <ColorInput docId={ctx.docId} value={s.color} onChange={(c, { live }) => update(i, { color: c }, live)} />
        </div>
      ))}
    </Section>
  )
}

// ------------------------------------------------------------------------------------------ Filters
export function FiltersSection({ ctx }: { ctx: Ctx }): JSX.Element {
  const addBtn = useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  const val = common(ctx.nodes, (n) => parseFilters(n.style.filter))
  const list = isMixed(val) ? [] : val
  const commit = (l: FilterFn[], live = false): void => ctx.set({ filter: formatFilters(l) }, live ? co(ctx, 'filter') : undefined)
  const items: MenuEntry[] = Object.entries(FILTER_DEFS).map(([fn, d]) => ({
    label: d.label,
    disabled: list.some((f) => f.fn === fn),
    onSelect: () => commit([...list, { fn, value: d.def }])
  }))
  return (
    <>
    <Section
      title="Filters"
      empty={!list.length && !isMixed(val)}
      actions={<IconButton ref={addBtn} icon={<Plus size={16} />} label="Add filter" onClick={() => setOpen((o) => !o)} />}
    >
      {isMixed(val) && <Mixed what="filters" />}
      {list.map((f, i) => {
        const d = FILTER_DEFS[f.fn]
        return (
          <div key={f.fn + i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 84px 24px', gap: 8, alignItems: 'center' }}>
            <Select<string>
              value={f.fn}
              options={Object.entries(FILTER_DEFS).map(([fn, dd]) => ({ value: fn, label: dd.label }))}
              onChange={(fn) => commit(list.map((x, j) => (j === i ? { fn, value: FILTER_DEFS[fn].def } : x)))}
            />
            <Field
              value={f.value}
              unit={d?.unit === 'px' ? undefined : d?.unit}
              min={d?.min}
              max={d?.max}
              onChange={(v) => typeof v === 'number' && commit(list.map((x, j) => (j === i ? { ...x, value: v } : x)))}
              onScrub={(v) => commit(list.map((x, j) => (j === i ? { ...x, value: v } : x)), true)}
            />
            <IconButton icon={<Minus size={14} />} label="Remove filter" onClick={() => commit(list.filter((_, j) => j !== i))} />
          </div>
        )
      })}
    </Section>
    <Menu open={open} onClose={() => setOpen(false)} anchor={addBtn.current} items={items} placement="bottom-end" minWidth={150} ignore={[addBtn.current]} />
    </>
  )
}

// ------------------------------------------------------------------------------------------ placeholders
export function PlaceholderSection({ title }: { title: string }): JSX.Element {
  return (
    <Section
      title={title}
      empty
      actions={<IconButton icon={<Plus size={16} />} label={`${title} (coming soon)`} disabled />}
    />
  )
}

// ------------------------------------------------------------------------------------------ Export
interface ExportRow {
  scale: '1' | '2' | '3'
  format: ExportFormat
}
const exportRows = new Map<string, ExportRow[]>()

export function ExportSection({ ctx }: { ctx: Ctx }): JSX.Element {
  const key = ctx.ids.join(',')
  const [, force] = useState(0)
  const [busy, setBusy] = useState(false)
  const rows = exportRows.get(key) ?? []
  const setRows = (r: ExportRow[]): void => {
    exportRows.set(key, r)
    force((n) => n + 1)
  }
  const label =
    ctx.nodes.length === 1 ? ctx.nodes[0].name : `${ctx.nodes.length} layers`
  return (
    <Section
      title="Export"
      empty={!rows.length}
      actions={
        <IconButton
          icon={<Copy size={14} />}
          label="Copy as PNG"
          onClick={() => ctx.nodes[0] && void exportNode(ctx.doc, ctx.nodes[0].id, 'png', 1, { clipboard: true })}
        />
      }
      onAdd={() => setRows([...rows, { scale: rows.length ? String(Math.min(3, rows.length + 1)) as ExportRow['scale'] : '1', format: 'png' }])}
      addLabel="Add export"
    >
      {rows.map((r, i) => (
        <div key={i} className="insp-exportrow">
          <Select<ExportRow['scale']>
            value={r.scale}
            options={[
              { value: '1', label: '1x' },
              { value: '2', label: '2x' },
              { value: '3', label: '3x' }
            ]}
            disabled={r.format !== 'png'}
            onChange={(scale) => setRows(rows.map((x, j) => (j === i ? { ...x, scale } : x)))}
          />
          <Select<ExportFormat>
            value={r.format}
            options={[
              { value: 'png', label: 'PNG' },
              { value: 'svg', label: 'SVG' },
              { value: 'html', label: 'HTML' }
            ]}
            onChange={(format) => setRows(rows.map((x, j) => (j === i ? { ...x, format } : x)))}
          />
          <IconButton icon={<Minus size={14} />} label="Remove export" onClick={() => setRows(rows.filter((_, j) => j !== i))} />
        </div>
      ))}
      {rows.length > 0 && (
        <Button
          full
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              for (const n of ctx.nodes)
                for (const r of rows) await exportNode(ctx.doc, n.id, r.format, Number(r.scale))
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? 'Exporting…' : `Export ${label}`}
        </Button>
      )}
    </Section>
  )
}
