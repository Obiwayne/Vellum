import { useRef, useState } from 'react'
import { AlignJustify, Blend, Circle, Eye, EyeOff, Minus, Plus, Settings2, SunDim, Copy } from 'lucide-react'
import { Button, Field, IconButton, Menu, Section, Select, Slider, type MenuEntry } from '../../ui'
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
import { RASTER_FORMATS, exportNode, type ExportFormat } from './exporting'

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
/** One-click looks, written as ordinary CSS filters (editable afterwards). */
const FILTER_PRESETS: Array<{ label: string; list: FilterFn[] }> = [
  { label: 'Black & white', list: [{ fn: 'grayscale', value: 100 }, { fn: 'contrast', value: 110 }] },
  { label: 'Vivid', list: [{ fn: 'saturate', value: 150 }, { fn: 'contrast', value: 110 }] },
  { label: 'Fade', list: [{ fn: 'contrast', value: 85 }, { fn: 'brightness', value: 110 }, { fn: 'saturate', value: 80 }] },
  { label: 'Vintage', list: [{ fn: 'sepia', value: 40 }, { fn: 'contrast', value: 90 }, { fn: 'saturate', value: 120 }] },
  { label: 'Warm', list: [{ fn: 'sepia', value: 25 }, { fn: 'saturate', value: 130 }, { fn: 'hue-rotate', value: -10 }] },
  { label: 'Cool', list: [{ fn: 'saturate', value: 90 }, { fn: 'hue-rotate', value: 15 }, { fn: 'brightness', value: 105 }] },
  { label: 'Dim', list: [{ fn: 'brightness', value: 70 }] },
  { label: 'Soft focus', list: [{ fn: 'blur', value: 2 }, { fn: 'brightness', value: 105 }] }
]

/** Slider range per filter (the field still accepts the full CSS range). */
const sliderRange = (fn: string): [number, number] => {
  const d = FILTER_DEFS[fn]
  if (!d) return [0, 100]
  if (fn === 'blur') return [0, 40]
  if (d.unit === '%' && d.max > 100) return [0, 200]
  return [d.min, d.max]
}

export function FiltersSection({ ctx }: { ctx: Ctx }): JSX.Element {
  const addBtn = useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  const val = common(ctx.nodes, (n) => parseFilters(n.style.filter))
  const list = isMixed(val) ? [] : val
  const commit = (l: FilterFn[], live = false): void => ctx.set({ filter: formatFilters(l) }, live ? co(ctx, 'filter') : undefined)
  const items: MenuEntry[] = [
    ...Object.entries(FILTER_DEFS).map(([fn, d]) => ({
      label: d.label,
      disabled: list.some((f) => f.fn === fn),
      onSelect: () => commit([...list, { fn, value: d.def }])
    })),
    { type: 'separator' as const },
    { type: 'heading' as const, label: 'Presets' },
    ...FILTER_PRESETS.map((p) => ({ label: p.label, onSelect: () => commit(p.list.map((f) => ({ ...f }))) }))
  ]
  return (
    <>
    <Section
      title="Filters"
      empty={!list.length && !isMixed(val)}
      actions={<IconButton ref={addBtn} icon={<Plus size={16} />} label="Add filter or preset" onClick={() => setOpen((o) => !o)} />}
    >
      {isMixed(val) && <Mixed what="filters" />}
      {list.map((f, i) => {
        const d = FILTER_DEFS[f.fn]
        const [lo, hi] = sliderRange(f.fn)
        const set = (v: number, live: boolean): void => commit(list.map((x, j) => (j === i ? { ...x, value: v } : x)), live)
        return (
          <div key={f.fn + i} style={{ display: 'grid', gridTemplateColumns: '92px minmax(0,1fr) 58px 24px', gap: 6, alignItems: 'center' }}>
            <Select<string>
              value={f.fn}
              options={Object.entries(FILTER_DEFS).map(([fn, dd]) => ({ value: fn, label: dd.label }))}
              onChange={(fn) => commit(list.map((x, j) => (j === i ? { fn, value: FILTER_DEFS[fn].def } : x)))}
            />
            <Slider
              value={Math.min(hi, Math.max(lo, f.value))}
              min={lo}
              max={hi}
              step={f.fn === 'blur' ? 0.5 : 1}
              fill
              onChange={(v) => set(v, true)}
            />
            <Field
              value={f.value}
              unit={d?.unit === 'px' ? undefined : d?.unit}
              min={d?.min}
              max={d?.max}
              onChange={(v) => typeof v === 'number' && set(v, false)}
              onScrub={(v) => set(v, true)}
            />
            <IconButton icon={<Minus size={14} />} label="Remove filter" onClick={() => commit(list.filter((_, j) => j !== i))} />
          </div>
        )
      })}
    </Section>
    <Menu open={open} onClose={() => setOpen(false)} anchor={addBtn.current} items={items} placement="bottom-end" minWidth={160} ignore={[addBtn.current]} />
    </>
  )
}

/** "blur(12px) saturate(180%)" → { blur: 12, saturate: 180 }. */
function parseBackdrop(v: unknown): { blur: number; saturate: number } | null {
  if (!v || v === 'none') return null
  const s = String(v)
  const b = /blur\(\s*([\d.]+)px\s*\)/.exec(s)
  const sat = /saturate\(\s*([\d.]+)(%?)\s*\)/.exec(s)
  return {
    blur: b ? Number(b[1]) : 0,
    saturate: sat ? Number(sat[1]) * (sat[2] ? 1 : 100) : 100
  }
}
const formatBackdrop = (blur: number, saturate: number): string =>
  [`blur(${blur}px)`, saturate !== 100 ? `saturate(${saturate}%)` : ''].filter(Boolean).join(' ')

const ROW3 = { display: 'grid', gridTemplateColumns: '64px minmax(0,1fr) 58px', gap: 6, alignItems: 'center' } as const

/** Background blur (frosted glass): CSS backdrop-filter. Needs a translucent fill to show. */
export function BackgroundBlurSection({ ctx }: { ctx: Ctx }): JSX.Element {
  const val = common(ctx.nodes, (n) => {
    const p = parseBackdrop(n.style.backdropFilter)
    return p ? `${p.blur}|${p.saturate}` : ''
  })
  const cur = isMixed(val) || !val ? null : parseBackdrop(ctx.nodes[0].style.backdropFilter)
  const set = (blur: number, sat: number, live = false): void =>
    ctx.set({ backdropFilter: formatBackdrop(Math.max(0, blur), Math.max(0, sat)) }, live ? co(ctx, 'backdrop') : undefined)
  return (
    <Section
      title="Background blur"
      empty={!cur && !isMixed(val)}
      onAdd={cur ? undefined : () => set(12, 140)}
      addLabel="Add background blur"
      onRemove={cur || isMixed(val) ? () => ctx.set({ backdropFilter: null }) : undefined}
      removeLabel="Remove background blur"
    >
      {isMixed(val) && <Mixed what="background blurs" />}
      {cur && (
        <>
          <div style={ROW3}>
            <span style={{ color: 'var(--text-3)' }}>Blur</span>
            <Slider value={Math.min(60, cur.blur)} min={0} max={60} step={0.5} fill onChange={(v) => set(v, cur.saturate, true)} />
            <Field value={cur.blur} min={0} max={200} onChange={(v) => typeof v === 'number' && set(v, cur.saturate)} onScrub={(v) => set(v, cur.saturate, true)} />
          </div>
          <div style={ROW3}>
            <span style={{ color: 'var(--text-3)' }}>Saturate</span>
            <Slider value={Math.min(300, cur.saturate)} min={0} max={300} fill onChange={(v) => set(cur.blur, v, true)} />
            <Field value={cur.saturate} unit="%" min={0} max={500} onChange={(v) => typeof v === 'number' && set(cur.blur, v)} onScrub={(v) => set(cur.blur, v, true)} />
          </div>
          <div style={{ color: 'var(--text-4)', lineHeight: '16px' }}>
            Blurs what is behind this layer. Give it a translucent fill (for example white at 40%) to see it.
          </div>
        </>
      )}
    </Section>
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

/** A new row is a PNG at the first of 2x, 3x, 1x that the raster rows don't have yet (2x by default). */
function newExportRow(rows: ExportRow[]): ExportRow {
  const used = new Set(rows.filter((r) => RASTER_FORMATS.has(r.format)).map((r) => r.scale))
  const scale = (['2', '3', '1'] as const).find((s) => !used.has(s)) ?? '2'
  return { scale, format: 'png' }
}

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
      onAdd={() => setRows([...rows, newExportRow(rows)])}
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
            disabled={!RASTER_FORMATS.has(r.format)}
            onChange={(scale) => setRows(rows.map((x, j) => (j === i ? { ...x, scale } : x)))}
          />
          <Select<ExportFormat>
            value={r.format}
            options={[
              { value: 'png', label: 'PNG' },
              { value: 'jpg', label: 'JPG' },
              { value: 'webp', label: 'WebP' },
              { value: 'svg', label: 'SVG' },
              { value: 'pdf', label: 'PDF' },
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
