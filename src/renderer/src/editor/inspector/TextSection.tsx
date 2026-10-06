import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AArrowUp,
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronDown,
  FoldVertical,
  Minus,
  Search,
  Slash,
  SlidersHorizontal,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignJustify,
  TextAlignStart,
  Type,
  WrapText,
  X,
  AlignVerticalSpaceAround,
  CaseSensitive,
  Baseline,
  Ligature,
  Plus
} from 'lucide-react'
import { Field, IconButton, Popover, Section, Segmented, Select, Slider } from '../../ui'
import type { CNode } from '../../model/types'
import { applyStylePatch } from '../../model/ops'
import { common, co, fv, isMixed, px, type Ctx } from './common'
import { ColorInput } from './ColorInput'
import { TextStyleRow } from './TextStyleRow'
import {
  STANDARD_AXES,
  axisLabel,
  buildCatalogue,
  familyName,
  fontAxes,
  formatVariation,
  isGoogleFont,
  loadGoogleFont,
  parseVariation,
  queryLocalFamilies,
  type AxisValue,
  type FontAxis,
  type FontEntry
} from './fonts'

export const WEIGHTS: Array<{ value: string; label: string }> = [
  { value: '100', label: 'Thin' },
  { value: '200', label: 'Extra Light' },
  { value: '300', label: 'Light' },
  { value: '400', label: 'Regular' },
  { value: '500', label: 'Medium' },
  { value: '600', label: 'Semi Bold' },
  { value: '700', label: 'Bold' },
  { value: '800', label: 'Extra Bold' },
  { value: '900', label: 'Black' }
]
export const weightOf = (n: CNode): string => {
  const w = n.style.fontWeight
  if (w === 'bold') return '700'
  if (w === undefined || w === 'normal') return '400'
  return String(Math.round(Number(w) / 100) * 100 || 400)
}
export const fontSizeOf = (n: CNode): number => px(n.style.fontSize, 16)
export function lineHeightOf(n: CNode): number | 'Auto' {
  const v = n.style.lineHeight
  if (v === undefined || v === 'normal') return 'Auto'
  if (typeof v === 'number') return Math.round(v * fontSizeOf(n) * 100) / 100
  const s = String(v).trim()
  if (s.endsWith('%')) return Math.round((parseFloat(s) / 100) * fontSizeOf(n) * 100) / 100
  if (/^\d*\.?\d+$/.test(s)) return Math.round(parseFloat(s) * fontSizeOf(n) * 100) / 100
  return px(s, 20)
}
export function letterSpacingPct(n: CNode): number {
  const v = n.style.letterSpacing
  if (v === undefined || v === 'normal') return 0
  const s = String(v).trim()
  if (s.endsWith('em')) return Math.round(parseFloat(s) * 10000) / 100
  return Math.round((px(v) / fontSizeOf(n)) * 10000) / 100
}
type VAlign = 'top' | 'middle' | 'bottom'
function vAlignOf(n: CNode): VAlign {
  if (n.style.display !== 'flex') return 'top'
  const j = String(n.style.justifyContent ?? '')
  return j === 'center' ? 'middle' : j === 'end' || j === 'flex-end' ? 'bottom' : 'top'
}

// ------------------------------------------------------------------------------------------ Font picker
function FontPicker({
  open,
  anchor,
  onClose,
  current,
  onPick
}: {
  open: boolean
  anchor: HTMLElement | null
  onClose: () => void
  current: string
  onPick: (f: FontEntry) => void
}): JSX.Element {
  const [q, setQ] = useState('')
  const [local, setLocal] = useState<string[] | null>(null)
  const [, bump] = useState(0)
  const listRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    void queryLocalFamilies().then((l) => l && setLocal(l))
  }, [open])
  const all = useMemo(() => buildCatalogue(local), [local])
  const shown = all.filter((f) => f.name.toLowerCase().includes(q.trim().toLowerCase()))
  // lazily load previews of Google fonts that scroll into view
  useEffect(() => {
    if (!open) return
    const root = listRef.current
    if (!root) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          const name = (e.target as HTMLElement).dataset.google
          if (name) void loadGoogleFont(name).then((ok) => ok && bump((n) => n + 1))
        }
      },
      { root }
    )
    root.querySelectorAll('[data-google]').forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [open, shown.length, q])
  // scroll current into view on open
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => listRef.current?.querySelector('.on')?.scrollIntoView({ block: 'center' }), 0)
    return () => clearTimeout(t)
  }, [open])
  return (
    <Popover open={open} onClose={onClose} anchor={anchor} placement="left-start" offset={12}>
      <div className="insp-fonts">
        <div className="insp-pop__head" style={{ margin: 0 }}>
          <span style={{ flex: 1 }}>Fonts</span>
          <IconButton icon={<X size={14} />} label="Close" onClick={onClose} />
        </div>
        <div className="insp-fonts__search">
          <div className="c-field">
            <span className="c-field__label">
              <Search size={13} />
            </span>
            <input
              className="c-field__input"
              placeholder="Search fonts"
              value={q}
              autoFocus
              spellCheck={false}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter' && shown[0]) onPick(shown[0])
                if (e.key === 'Escape') onClose()
              }}
            />
          </div>
        </div>
        <div className="insp-fonts__list" ref={listRef}>
          {shown.map((f) => (
            <button
              key={f.name}
              type="button"
              data-google={f.source === 'google' ? f.name : undefined}
              className={['insp-fontitem', f.name === current && 'on'].filter(Boolean).join(' ')}
              style={{ fontFamily: `${f.css}, var(--font-ui)` }}
              title={f.source === 'google' ? `${f.name} (Google Fonts)` : f.name}
              onClick={() => onPick(f)}
            >
              {f.name}
            </button>
          ))}
          {!shown.length && <div className="insp-fonts__note">No fonts match “{q}”.</div>}
        </div>
        {!local && <div className="insp-fonts__note">Showing common fonts — local font access unavailable.</div>}
      </div>
    </Popover>
  )
}

// ------------------------------------------------------------------------------------------ Formatting
type Case = 'none' | 'uppercase' | 'lowercase' | 'capitalize'
type Wrap = 'normal' | 'nowrap' | 'balance' | 'pretty'
function FormattingPopover({ ctx, open, anchor, onClose }: { ctx: Ctx; open: boolean; anchor: HTMLElement | null; onClose: () => void }): JSX.Element {
  const n0 = ctx.nodes[0]
  const align = common(ctx.nodes, (n) => String(n.style.textAlign ?? 'left'))
  const tcase = common(ctx.nodes, (n) => String(n.style.textTransform ?? 'none') as Case)
  const wrap = common(ctx.nodes, (n): Wrap =>
    n.style.whiteSpace === 'pre' || n.style.whiteSpace === 'nowrap'
      ? 'nowrap'
      : n.style.textWrap === 'balance'
        ? 'balance'
        : n.style.textWrap === 'pretty'
          ? 'pretty'
          : 'normal'
  )
  const keep = common(ctx.nodes, (n) => n.style.wordBreak === 'keep-all')
  const trunc = common(ctx.nodes, (n) => n.style.textOverflow === 'ellipsis')
  const lines = common(ctx.nodes, (n) => Number(n.style.WebkitLineClamp ?? 1))
  const setTrunc = (on: boolean, nLines = 1): void => {
    if (!on) {
      ctx.set({ textOverflow: null, overflow: null, WebkitLineClamp: null, WebkitBoxOrient: null, display: null })
      return
    }
    const single = wrap === 'nowrap'
    ctx.set(
      single
        ? { textOverflow: 'ellipsis', overflow: 'hidden', WebkitLineClamp: null, WebkitBoxOrient: null }
        : { textOverflow: 'ellipsis', overflow: 'hidden', display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: nLines, justifyContent: null, flexDirection: null }
    )
  }
  return (
    <Popover open={open} onClose={onClose} anchor={anchor} placement="left-start" offset={12}>
      <div className="insp-fmt">
        <div className="insp-pop__head" style={{ margin: 0 }}>
          <span style={{ flex: 1 }}>Formatting</span>
          <IconButton icon={<X size={14} />} label="Close" onClick={onClose} />
        </div>
        <div
          className="insp-fmt__preview"
          style={{
            fontFamily: n0 ? `${String(n0.style.fontFamily ?? 'system-ui')}, var(--font-ui)` : undefined,
            fontWeight: n0 ? Number(weightOf(n0)) : undefined,
            textTransform: isMixed(tcase) ? undefined : tcase,
            justifyContent: align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start'
          }}
        >
          Lorem ipsum
        </div>
        <div className="insp-fmt__row">
          <span>Alignment</span>
          <Segmented
            size="sm"
            value={isMixed(align) ? null : align}
            options={[
              { value: 'left', icon: <TextAlignStart size={14} />, title: 'Left' },
              { value: 'center', icon: <TextAlignCenter size={14} />, title: 'Center' },
              { value: 'right', icon: <TextAlignEnd size={14} />, title: 'Right' },
              { value: 'justify', icon: <TextAlignJustify size={14} />, title: 'Justify' }
            ]}
            onChange={(v) => ctx.set({ textAlign: v === 'left' ? null : v })}
          />
        </div>
        <div className="insp-fmt__row">
          <span>Case</span>
          <Segmented<Case>
            size="sm"
            value={isMixed(tcase) ? null : tcase}
            options={[
              { value: 'none', icon: <Slash size={12} />, title: 'None' },
              { value: 'uppercase', label: 'AA', title: 'Uppercase' },
              { value: 'lowercase', label: 'aa', title: 'Lowercase' },
              { value: 'capitalize', label: 'Aa', title: 'Capitalize' }
            ]}
            onChange={(v) => ctx.set({ textTransform: v === 'none' ? null : v })}
          />
        </div>
        <div className="insp-fmt__row">
          <span>Wrap</span>
          <Select<Wrap>
            size="sm"
            value={isMixed(wrap) ? null : wrap}
            placeholder="Mixed"
            icon={<WrapText size={13} />}
            options={[
              { value: 'normal', label: 'Normal' },
              { value: 'nowrap', label: 'No wrap' },
              { value: 'balance', label: 'Balance' },
              { value: 'pretty', label: 'Pretty' }
            ]}
            onChange={(v) =>
              ctx.set({
                whiteSpace: v === 'nowrap' ? 'pre' : null,
                textWrap: v === 'balance' || v === 'pretty' ? v : null
              })
            }
          />
        </div>
        <div className="insp-fmt__row">
          <span>Keep words</span>
          <Segmented
            size="sm"
            value={isMixed(keep) ? null : keep ? 'on' : 'off'}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'on', label: 'On' }
            ]}
            onChange={(v) => ctx.set({ wordBreak: v === 'on' ? 'keep-all' : null })}
          />
        </div>
        <div className="insp-fmt__row">
          <span>Truncation</span>
          <Segmented
            size="sm"
            value={isMixed(trunc) ? null : trunc ? 'on' : 'off'}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'on', label: 'On' }
            ]}
            onChange={(v) => setTrunc(v === 'on')}
          />
        </div>
        {trunc === true && wrap !== 'nowrap' && (
          <div className="insp-fmt__row" style={{ marginBottom: 6 }}>
            <span>Max lines</span>
            <Field value={fv(lines)} min={1} max={99} style={{ width: 154 }} onChange={(v) => typeof v === 'number' && setTrunc(true, v)} />
          </div>
        )}
        <div style={{ height: 6 }} />
      </div>
    </Popover>
  )
}

// ------------------------------------------------------------------------------------------ OpenType features
/** fontVariantNumeric keywords by group: at most one per group, written in this order. */
const NUMERIC_GROUPS = {
  figures: ['lining-nums', 'oldstyle-nums'],
  spacing: ['proportional-nums', 'tabular-nums'],
  fractions: ['diagonal-fractions', 'stacked-fractions'],
  ordinal: ['ordinal'],
  zero: ['slashed-zero']
}
type NumericGroup = keyof typeof NUMERIC_GROUPS
const NUMERIC_ORDER = Object.values(NUMERIC_GROUPS).flat()
const numericOf = (v: string | number | undefined): string[] =>
  String(v ?? '')
    .split(/\s+/)
    .filter((t) => t && t !== 'normal')
/** A node's keyword from one group ('auto' when none). */
const numericIn = (n: CNode, g: NumericGroup): string => numericOf(n.style.fontVariantNumeric).find((t) => NUMERIC_GROUPS[g].includes(t)) ?? 'auto'
/** Swap one group's keyword and keep the rest: oldstyle + tabular → 'oldstyle-nums tabular-nums'. */
export function withNumeric(v: string | number | undefined, g: NumericGroup, token: string): string | null {
  const list = numericOf(v).filter((t) => !NUMERIC_GROUPS[g].includes(t))
  if (token !== 'auto') list.push(token)
  const rank = (t: string): number => (NUMERIC_ORDER.includes(t) ? NUMERIC_ORDER.indexOf(t) : 99)
  list.sort((a, b) => rank(a) - rank(b))
  return list.length ? list.join(' ') : null
}
/** 'ss01, "cv11" 0' → '"ss01" 1, "cv11" 0' (anything else is kept as typed). */
function normalizeFeatures(s: string): string | null {
  const parts = s.split(',').map((p) => p.trim()).filter(Boolean)
  if (!parts.length || s.trim() === 'normal') return null
  return parts
    .map((p) => {
      const m = /^["']?([\w ]{4})["']?(?:\s+(\d+|on|off))?$/.exec(p)
      if (!m) return p
      return `"${m[1]}" ${m[2] === 'off' ? 0 : !m[2] || m[2] === 'on' ? 1 : m[2]}`
    })
    .join(', ')
}

/** Write one variation axis (null removes it) on every selected node, keeping the other axes in order. */
function setAxis(ctx: Ctx, tag: string, value: number | null, live = false): void {
  ctx.each(
    'Variable axis',
    (n) => {
      const list = parseVariation(n.style.fontVariationSettings)
      const i = list.findIndex((a) => a.tag === tag)
      const next: AxisValue[] =
        value === null ? list.filter((a) => a.tag !== tag) : i < 0 ? [...list, { tag, value }] : list.map((a, j) => (j === i ? { tag, value } : a))
      applyStylePatch(n.style, { fontVariationSettings: formatVariation(next) })
    },
    live ? co(ctx, `axis:${tag}`) : undefined
  )
}

function TypeDetailsPopover({
  ctx,
  axes,
  open,
  anchor,
  onClose
}: {
  ctx: Ctx
  axes: FontAxis[] | null
  open: boolean
  anchor: HTMLElement | null
  onClose: () => void
}): JSX.Element {
  const [tag, setTag] = useState('')
  const figures = common(ctx.nodes, (n) => numericIn(n, 'figures'))
  const spacing = common(ctx.nodes, (n) => numericIn(n, 'spacing'))
  const fractions = common(ctx.nodes, (n) => numericIn(n, 'fractions') !== 'auto')
  const zero = common(ctx.nodes, (n) => numericIn(n, 'zero') !== 'auto')
  const liga = common(ctx.nodes, (n) => n.style.fontVariantLigatures !== 'none')
  const caps = common(ctx.nodes, (n) => String(n.style.fontVariantCaps ?? 'normal'))
  const features = common(ctx.nodes, (n) => String(n.style.fontFeatureSettings ?? ''))
  const used = parseVariation(ctx.nodes[0]?.style.fontVariationSettings).map((a) => a.tag)
  const setNumeric = (g: NumericGroup, token: string): void =>
    ctx.each('Number style', (n) => applyStylePatch(n.style, { fontVariantNumeric: withNumeric(n.style.fontVariantNumeric, g, token) }))
  const addAxis = (t: string): void => setAxis(ctx, t, axes?.find((a) => a.tag === t)?.def ?? STANDARD_AXES[t]?.def ?? 0)
  const onOff = [
    { value: 'off', label: 'Off' },
    { value: 'on', label: 'On' }
  ]
  return (
    <Popover open={open} onClose={onClose} anchor={anchor} placement="left-start" offset={12}>
      <div className="insp-fmt">
        <div className="insp-pop__head" style={{ margin: 0 }}>
          <span style={{ flex: 1 }}>Type details</span>
          <IconButton icon={<X size={14} />} label="Close" onClick={onClose} />
        </div>
        <div style={{ height: 6 }} />
        <div className="insp-fmt__row">
          <span>Figures</span>
          <Select<string>
            size="sm"
            value={isMixed(figures) ? null : figures}
            placeholder="Mixed"
            options={[
              { value: 'auto', label: 'Default' },
              { value: 'lining-nums', label: 'Lining' },
              { value: 'oldstyle-nums', label: 'Oldstyle' }
            ]}
            onChange={(v) => setNumeric('figures', v)}
          />
        </div>
        <div className="insp-fmt__row">
          <span>Figure spacing</span>
          <Select<string>
            size="sm"
            value={isMixed(spacing) ? null : spacing}
            placeholder="Mixed"
            options={[
              { value: 'auto', label: 'Default' },
              { value: 'proportional-nums', label: 'Proportional' },
              { value: 'tabular-nums', label: 'Tabular' }
            ]}
            onChange={(v) => setNumeric('spacing', v)}
          />
        </div>
        <div className="insp-fmt__row">
          <span>Slashed zero</span>
          <Segmented size="sm" value={isMixed(zero) ? null : zero ? 'on' : 'off'} options={onOff} onChange={(v) => setNumeric('zero', v === 'on' ? 'slashed-zero' : 'auto')} />
        </div>
        <div className="insp-fmt__row">
          <span>Fractions</span>
          <Segmented
            size="sm"
            value={isMixed(fractions) ? null : fractions ? 'on' : 'off'}
            options={onOff}
            onChange={(v) => setNumeric('fractions', v === 'on' ? 'diagonal-fractions' : 'auto')}
          />
        </div>
        <div className="insp-fmt__row">
          <span>Ligatures</span>
          <Segmented size="sm" value={isMixed(liga) ? null : liga ? 'on' : 'off'} options={onOff} onChange={(v) => ctx.set({ fontVariantLigatures: v === 'on' ? null : 'none' })} />
        </div>
        <div className="insp-fmt__row">
          <span>Capitals</span>
          <Select<string>
            size="sm"
            value={isMixed(caps) ? null : caps}
            placeholder="Mixed"
            options={[
              { value: 'normal', label: 'Normal' },
              { value: 'small-caps', label: 'Small caps' },
              { value: 'all-small-caps', label: 'All small caps' }
            ]}
            onChange={(v) => ctx.set({ fontVariantCaps: v === 'normal' ? null : v })}
          />
        </div>
        <div className="insp-fmt__row">
          <span>Features</span>
          <Field
            size="sm"
            type="text"
            mono
            value={isMixed(features) ? null : features}
            placeholder={isMixed(features) ? 'Mixed' : '"ss01" 1, "cv11" 1'}
            title="font-feature-settings"
            style={{ width: 154 }}
            onChange={(v) => ctx.set({ fontFeatureSettings: normalizeFeatures(String(v)) })}
          />
        </div>
        <div className="insp-fmt__row">
          <span>Add axis</span>
          <div style={{ display: 'flex', gap: 4, width: 154 }}>
            <Select<string>
              size="sm"
              value={null}
              placeholder="Axis"
              style={{ flex: 1, minWidth: 0 }}
              menuMinWidth={150}
              options={Object.keys(STANDARD_AXES)
                .filter((t) => t !== 'wght')
                .map((t) => ({ value: t, label: `${axisLabel(t)} (${t})`, disabled: used.includes(t) }))}
              onChange={addAxis}
            />
            <Field size="sm" type="text" mono value={tag} placeholder="Tag" title="Custom axis tag, e.g. GRAD" style={{ width: 48 }} onChange={(v) => setTag(String(v).trim().slice(0, 4))} />
            <IconButton
              icon={<Plus size={14} />}
              label="Add custom axis"
              disabled={!/^[A-Za-z0-9]{4}$/.test(tag) || used.includes(tag)}
              onClick={() => {
                addAxis(tag)
                setTag('')
              }}
            />
          </div>
        </div>
        <div style={{ height: 6 }} />
      </div>
    </Popover>
  )
}

// ------------------------------------------------------------------------------------------ Variable axes
/** Detected axes of a family (null while loading or when unknown). */
function useFontAxes(family: string | null): FontAxis[] | null {
  const [got, setGot] = useState<{ family: string; axes: FontAxis[] | null } | null>(null)
  useEffect(() => {
    if (!family) return
    let live = true
    void fontAxes(family).then((axes) => live && setGot({ family, axes }))
    return () => {
      live = false
    }
  }, [family])
  return got && got.family === family ? got.axes : null
}

const AXIS_ROW = { display: 'grid', gridTemplateColumns: '36px minmax(0,1fr) 58px 24px', gap: 6, alignItems: 'center' } as const

/** One slider + field per axis of the font (wght stays with the weight menu) plus any axis already set. */
function VariableAxes({ ctx, axes }: { ctx: Ctx; axes: FontAxis[] | null }): JSX.Element | null {
  const settings = common(ctx.nodes, (n) => parseVariation(n.style.fontVariationSettings))
  const set = isMixed(settings) ? parseVariation(ctx.nodes[0]?.style.fontVariationSettings) : settings
  const rows = (axes ?? []).filter((a) => a.tag !== 'wght')
  for (const s of set)
    if (!rows.some((r) => r.tag === s.tag))
      rows.push(STANDARD_AXES[s.tag] ?? { tag: s.tag, min: Math.min(0, s.value), max: Math.max(100, s.value), def: 0 })
  if (!rows.length) return null
  return (
    <>
      {rows.map((a) => {
        const cur = set.find((s) => s.tag === a.tag)
        const detected = Boolean(axes?.some((x) => x.tag === a.tag))
        const v = cur?.value ?? a.def
        const span = a.max - a.min
        return (
          <div key={a.tag} style={AXIS_ROW}>
            <span style={{ color: 'var(--text-3)' }} title={`${axisLabel(a.tag)} (${a.tag})`}>
              {a.tag}
            </span>
            <Slider
              value={Math.min(a.max, Math.max(a.min, v))}
              min={a.min}
              max={a.max}
              step={span <= 2 ? 0.01 : span < 50 ? 0.1 : 1}
              fill
              onChange={(x) => setAxis(ctx, a.tag, x, true)}
            />
            <Field
              value={isMixed(settings) ? null : v}
              placeholder="Mixed"
              title={axisLabel(a.tag)}
              min={detected ? a.min : undefined}
              max={detected ? a.max : undefined}
              onChange={(x) => typeof x === 'number' && setAxis(ctx, a.tag, x)}
              onScrub={(x) => setAxis(ctx, a.tag, x, true)}
            />
            {cur ? (
              <IconButton icon={<Minus size={14} />} label={detected ? 'Reset axis' : 'Remove axis'} onClick={() => setAxis(ctx, a.tag, null)} />
            ) : (
              <span />
            )}
          </div>
        )
      })}
    </>
  )
}

// ------------------------------------------------------------------------------------------ Text section
export function TextSection({ ctx }: { ctx: Ctx }): JSX.Element {
  const famRef = useRef<HTMLButtonElement | null>(null)
  const optRef = useRef<HTMLButtonElement | null>(null)
  const detRef = useRef<HTMLButtonElement | null>(null)
  const [fontsOpen, setFontsOpen] = useState(false)
  const [fmtOpen, setFmtOpen] = useState(false)
  const [detOpen, setDetOpen] = useState(false)
  const family = common(ctx.nodes, (n) => familyName(n.style.fontFamily))
  const axes = useFontAxes(isMixed(family) ? null : family)
  const weight = common(ctx.nodes, weightOf)
  const size = common(ctx.nodes, fontSizeOf)
  const lh = common(ctx.nodes, lineHeightOf)
  const ls = common(ctx.nodes, letterSpacingPct)
  const align = common(ctx.nodes, (n) => String(n.style.textAlign ?? 'left'))
  const valign = common(ctx.nodes, vAlignOf)

  // make sure Google fonts used by the selection are registered
  useEffect(() => {
    if (!isMixed(family) && isGoogleFont(family)) void loadGoogleFont(family)
  }, [family])

  const setVAlign = (v: VAlign): void =>
    ctx.set(
      v === 'top'
        ? { display: null, flexDirection: null, justifyContent: null }
        : { display: 'flex', flexDirection: 'column', justifyContent: v === 'middle' ? 'center' : 'end', WebkitLineClamp: null, WebkitBoxOrient: null }
    )

  return (
    <Section
      title="Text"
      actions={
        <>
          <IconButton ref={detRef} icon={<Ligature size={14} />} label="Type details" active={detOpen} onClick={() => setDetOpen((o) => !o)} />
          <IconButton ref={optRef} icon={<SlidersHorizontal size={14} />} label="Formatting" active={fmtOpen} onClick={() => setFmtOpen((o) => !o)} />
        </>
      }
    >
      <TextStyleRow ctx={ctx} />
      <button ref={famRef} type="button" className="c-select" onClick={() => setFontsOpen((o) => !o)}>
        <span className="c-select__icon">
          <Type size={13} />
        </span>
        <span className={['c-select__value', isMixed(family) && 'c-select__value--placeholder'].filter(Boolean).join(' ')}>
          {isMixed(family) ? 'Mixed' : family}
        </span>
        <span className="c-select__chevron">
          <ChevronDown size={14} />
        </span>
      </button>
      <Select<string>
        value={isMixed(weight) ? null : weight}
        placeholder="Mixed"
        icon={<AArrowUp size={13} />}
        options={WEIGHTS}
        onChange={(v) => ctx.set({ fontWeight: Number(v) === 400 ? null : Number(v) })}
      />
      <div className="insp-g3">
        <Field
          label={<CaseSensitive size={13} />}
          title="Font size"
          value={fv(size)}
          placeholder="Mixed"
          min={1}
          onChange={(v) => typeof v === 'number' && ctx.set({ fontSize: Math.max(1, v) })}
          onScrub={(v) => ctx.set({ fontSize: Math.max(1, v) }, co(ctx, 'fs'))}
        />
        <Field
          label={<Baseline size={13} />}
          title="Line height"
          type="number"
          value={isMixed(lh) ? null : lh}
          placeholder="Mixed"
          keywords={['Auto']}
          min={0}
          onChange={(v) => ctx.set({ lineHeight: v === 'Auto' ? 'normal' : `${v}px` })}
          onScrub={(v) => ctx.set({ lineHeight: `${Math.max(0, v)}px` }, co(ctx, 'lh'))}
        />
        <Field
          label={<AlignVerticalSpaceAround size={13} style={{ transform: 'rotate(90deg)' }} />}
          title="Letter spacing"
          value={fv(ls)}
          unit="%"
          placeholder="Mixed"
          step={0.5}
          onChange={(v) => typeof v === 'number' && ctx.set({ letterSpacing: v ? `${Math.round(v * 100) / 10000}em` : null })}
          onScrub={(v) => ctx.set({ letterSpacing: v ? `${Math.round(v * 100) / 10000}em` : null }, co(ctx, 'ls'))}
        />
      </div>
      <div className="insp-g2">
        <Segmented
          size="md"
          full
          value={isMixed(align) ? null : align}
          options={[
            { value: 'left', icon: <TextAlignStart size={14} />, title: 'Align left' },
            { value: 'center', icon: <TextAlignCenter size={14} />, title: 'Align center' },
            { value: 'right', icon: <TextAlignEnd size={14} />, title: 'Align right' }
          ]}
          onChange={(v) => ctx.set({ textAlign: v === 'left' ? null : v })}
        />
        <Segmented<VAlign>
          size="md"
          full
          value={isMixed(valign) ? null : valign}
          options={[
            { value: 'top', icon: <ArrowUpToLine size={14} />, title: 'Align top' },
            { value: 'middle', icon: <FoldVertical size={14} />, title: 'Align middle' },
            { value: 'bottom', icon: <ArrowDownToLine size={14} />, title: 'Align bottom' }
          ]}
          onChange={setVAlign}
        />
      </div>
      <VariableAxes ctx={ctx} axes={axes} />
      <FontPicker
        open={fontsOpen}
        anchor={famRef.current}
        onClose={() => setFontsOpen(false)}
        current={isMixed(family) ? '' : family}
        onPick={(f) => {
          if (f.source === 'google') void loadGoogleFont(f.name)
          ctx.set({ fontFamily: f.css === 'system-ui, sans-serif' ? 'system-ui, sans-serif' : f.css })
        }}
      />
      <FormattingPopover ctx={ctx} open={fmtOpen} anchor={optRef.current} onClose={() => setFmtOpen(false)} />
      <TypeDetailsPopover ctx={ctx} axes={axes} open={detOpen} anchor={detRef.current} onClose={() => setDetOpen(false)} />
    </Section>
  )
}

// ------------------------------------------------------------------------------------------ Underline / Stroke
export function UnderlineSection({ ctx }: { ctx: Ctx }): JSX.Element {
  const on = common(ctx.nodes, (n) => /underline/.test(String(n.style.textDecorationLine ?? n.style.textDecoration ?? '')))
  const n0 = ctx.nodes[0]
  const add = (): void => ctx.set({ textDecoration: null, textDecorationLine: 'underline' })
  if (on !== true) return <Section title="Underline" empty={on === false} onAdd={add} addLabel="Add underline" />
  const thickness = common(ctx.nodes, (n) => px(n.style.textDecorationThickness, 1))
  const offset = common(ctx.nodes, (n) => px(n.style.textUnderlineOffset, 0))
  const color = String(n0.style.textDecorationColor ?? n0.style.color ?? '#000000')
  return (
    <Section title="Underline">
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr) 24px', gap: 8, alignItems: 'center' }}>
        <Field
          label="W"
          title="Thickness"
          value={fv(thickness)}
          placeholder="Mixed"
          min={0}
          onChange={(v) => typeof v === 'number' && ctx.set({ textDecorationThickness: v })}
          onScrub={(v) => ctx.set({ textDecorationThickness: Math.max(0, v) }, co(ctx, 'ut'))}
        />
        <Field
          label="↓"
          title="Offset"
          value={fv(offset)}
          placeholder="Mixed"
          onChange={(v) => typeof v === 'number' && ctx.set({ textUnderlineOffset: v || null })}
          onScrub={(v) => ctx.set({ textUnderlineOffset: v || null }, co(ctx, 'uo'))}
        />
        <IconButton
          icon={<Minus size={14} />}
          label="Remove underline"
          onClick={() =>
            ctx.set({ textDecoration: null, textDecorationLine: null, textDecorationColor: null, textDecorationThickness: null, textUnderlineOffset: null })
          }
        />
      </div>
      <ColorInput
        docId={ctx.docId}
            nodeId={ctx.ids[0]}
        value={color}
        onChange={(c, { live }) => ctx.set({ textDecorationColor: c }, live ? co(ctx, 'uc') : undefined)}
      />
    </Section>
  )
}

export function StrokeSection({ ctx }: { ctx: Ctx }): JSX.Element {
  const w = common(ctx.nodes, (n) => (n.style.WebkitTextStrokeWidth !== undefined ? px(n.style.WebkitTextStrokeWidth) : null))
  const add = (): void => ctx.set({ WebkitTextStrokeWidth: 1, WebkitTextStrokeColor: '#000000', paintOrder: 'stroke fill' })
  if (isMixed(w))
    return (
      <Section title="Stroke" onAdd={add}>
        <div className="insp-mixed">Mixed — click + to replace</div>
      </Section>
    )
  if (w === null) return <Section title="Stroke" empty onAdd={add} addLabel="Add stroke" />
  const color = String(ctx.nodes[0].style.WebkitTextStrokeColor ?? '#000000')
  return (
    <Section title="Stroke">
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 24px', gap: 8, alignItems: 'center' }}>
        <Field
          label="W"
          title="Stroke width"
          value={w}
          min={0}
          step={0.5}
          onChange={(v) => typeof v === 'number' && ctx.set({ WebkitTextStrokeWidth: v })}
          onScrub={(v) => ctx.set({ WebkitTextStrokeWidth: Math.max(0, v) }, co(ctx, 'sw'))}
        />
        <IconButton
          icon={<Minus size={14} />}
          label="Remove stroke"
          onClick={() => ctx.set({ WebkitTextStrokeWidth: null, WebkitTextStrokeColor: null, paintOrder: null })}
        />
      </div>
      <ColorInput
        docId={ctx.docId}
            nodeId={ctx.ids[0]}
        value={color}
        onChange={(c, { live }) => ctx.set({ WebkitTextStrokeColor: c }, live ? co(ctx, 'sc') : undefined)}
      />
    </Section>
  )
}
