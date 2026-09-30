// Grid section (CSS grid containers) and the Grid item section (children of a grid).
import { Columns3, Rows3, Shuffle } from 'lucide-react'
import { Checkbox, Field, IconButton, Section, Segmented } from '../../ui'
import { useStore } from '../../model/store'
import type { Style } from '../../model/types'
import { common, co, fv, isMixed, type Ctx } from './common'
import { PaddingFields } from './FlexSection'

/** "repeat(3, minmax(0, 1fr))" → 3; custom templates ("200px 1fr") are returned as text. */
export function trackCount(v: unknown): number | string | null {
  if (v === undefined || v === null || v === '' || v === 'none') return null
  const s = String(v).trim()
  const m = /^repeat\(\s*(\d+)\s*,\s*(?:minmax\(\s*0(?:px)?\s*,\s*1fr\s*\)|1fr)\s*\)$/.exec(s)
  if (m) return Number(m[1])
  // "1fr 1fr 1fr" is also a plain count
  if (/^(1fr\s*)+$/.test(s)) return s.split(/\s+/).length
  return s
}

/** Number → equal tracks; text → used as the template as-is; 'Auto' (rows) → removed. */
function trackValue(v: number | string): string | null {
  if (typeof v === 'number') return `repeat(${Math.max(1, Math.min(24, Math.round(v)))}, minmax(0, 1fr))`
  const s = v.trim()
  if (!s || /^auto$/i.test(s)) return null
  if (/^\d+$/.test(s)) return trackValue(Number(s))
  return s
}

const px = (v: unknown): number => (typeof v === 'number' ? v : parseFloat(String(v ?? 0)) || 0)
const colGap = (st: Style): number => px(st.columnGap ?? st.gap)
const rowGap = (st: Style): number => px(st.rowGap ?? st.gap)

type Align = 'start' | 'center' | 'end' | 'stretch'
const ALIGN: Array<{ value: Align; label: string }> = [
  { value: 'start', label: 'Start' },
  { value: 'center', label: 'Center' },
  { value: 'end', label: 'End' },
  { value: 'stretch', label: 'Fill' }
]
const normAlign = (v: unknown, def: Align): Align => {
  const s = String(v ?? def)
  if (s === 'center' || s === 'end' || s === 'stretch') return s
  if (s === 'flex-end') return 'end'
  if (s === 'normal') return 'stretch'
  return s === 'start' || s === 'flex-start' ? 'start' : def
}

export function GridSection({ ctx }: { ctx: Ctx }): JSX.Element {
  const { nodes, docId, ids } = ctx
  const cols = common(nodes, (n) => trackCount(n.style.gridTemplateColumns))
  const rows = common(nodes, (n) => trackCount(n.style.gridTemplateRows))
  const cg = common(nodes, (n) => colGap(n.style))
  const rg = common(nodes, (n) => rowGap(n.style))
  const ai = common(nodes, (n) => normAlign(n.style.alignItems, 'stretch'))
  const ji = common(nodes, (n) => normAlign(n.style.justifyItems, 'stretch'))
  const dense = common(nodes, (n) => String(n.style.gridAutoFlow ?? '').includes('dense'))
  const flowCol = common(nodes, (n) => String(n.style.gridAutoFlow ?? '').startsWith('column'))
  const clip = common(nodes, (n) => n.style.overflow === 'clip' || n.style.overflow === 'hidden')

  /** Keep `gap` when both gaps match, else write the two longhands. */
  const setGaps = (c: number, r: number, live = false): void =>
    ctx.set(
      c === r ? { gap: c, rowGap: null, columnGap: null } : { gap: null, rowGap: r, columnGap: c },
      live ? co(ctx, 'gridgap') : undefined
    )
  const cgV = isMixed(cg) ? null : cg
  const rgV = isMixed(rg) ? null : rg

  const flow = (col: boolean, d: boolean): string | null => {
    const v = `${col ? 'column' : 'row'}${d ? ' dense' : ''}`
    return v === 'row' ? null : v
  }

  return (
    <Section
      title="Grid"
      onRemove={() =>
        useStore.getState().transact(docId, 'Remove grid', () => ids.forEach((id) => useStore.getState().removeFlex(docId, id)))
      }
      removeLabel="Remove grid"
      actions={
        <IconButton
          icon={<Shuffle size={14} />}
          label="Switch to flex"
          onClick={() =>
            useStore.getState().transact(docId, 'Switch to flex', () => ids.forEach((id) => useStore.getState().switchLayout(docId, id, 'flex')))
          }
        />
      }
    >
      <div className="insp-g2">
        <Field
          label={<Columns3 size={13} />}
          title="Columns: a number, or a template like 200px 1fr"
          type="text"
          value={isMixed(cols) ? null : cols ?? 'Auto'}
          placeholder="Mixed"
          onChange={(v) => ctx.set({ gridTemplateColumns: trackValue(v) })}
          onScrub={(v) => ctx.set({ gridTemplateColumns: trackValue(Math.max(1, v)) }, co(ctx, 'gridcols'))}
        />
        <Field
          label={<Rows3 size={13} />}
          title="Rows: Auto, a number, or a template like auto 1fr"
          type="text"
          value={isMixed(rows) ? null : rows ?? 'Auto'}
          placeholder="Mixed"
          onChange={(v) => ctx.set({ gridTemplateRows: trackValue(v) })}
          onScrub={(v) => ctx.set({ gridTemplateRows: v < 1 ? null : trackValue(v) }, co(ctx, 'gridrows'))}
        />
      </div>
      <div className="insp-g2">
        <Field
          label="↔"
          title="Column gap"
          value={fv(cg)}
          placeholder="Mixed"
          min={0}
          onChange={(v) => typeof v === 'number' && setGaps(v, rgV ?? v)}
          onScrub={(v) => setGaps(Math.max(0, v), rgV ?? Math.max(0, v), true)}
        />
        <Field
          label="↕"
          title="Row gap"
          value={fv(rg)}
          placeholder="Mixed"
          min={0}
          onChange={(v) => typeof v === 'number' && setGaps(cgV ?? v, v)}
          onScrub={(v) => setGaps(cgV ?? Math.max(0, v), Math.max(0, v), true)}
        />
      </div>
      <div className="insp-label">Align in cell (vertical)</div>
      <Segmented
        full
        value={isMixed(ai) ? null : ai}
        options={ALIGN}
        onChange={(v) => ctx.set({ alignItems: v === 'stretch' ? null : v })}
      />
      <div className="insp-label">Align in cell (horizontal)</div>
      <Segmented
        full
        value={isMixed(ji) ? null : ji}
        options={ALIGN}
        onChange={(v) => ctx.set({ justifyItems: v === 'stretch' ? null : v })}
      />
      <PaddingFields ctx={ctx} />
      <Checkbox
        checked={flowCol === true}
        label="Fill columns first"
        onChange={(on) => ctx.set({ gridAutoFlow: flow(on, dense === true) })}
      />
      <Checkbox
        checked={dense === true}
        label="Dense packing (fill gaps)"
        onChange={(on) => ctx.set({ gridAutoFlow: flow(flowCol === true, on) })}
      />
      <Checkbox
        checked={clip === true}
        label="Clip content"
        shortcut="Alt+C"
        onChange={(on) => ctx.set({ overflow: on ? 'clip' : null })}
      />
    </Section>
  )
}

/** "span 2" → 2 (1 when unset). */
const spanOf = (v: unknown): number => {
  const m = /span\s+(\d+)/.exec(String(v ?? ''))
  return m ? Number(m[1]) : 1
}
const spanValue = (n: number): string | null => (n > 1 ? `span ${Math.min(24, Math.round(n))}` : null)

/** Shown for children of a grid: how many columns/rows the item spans. */
export function GridItemSection({ ctx }: { ctx: Ctx }): JSX.Element {
  const { nodes } = ctx
  const cs = common(nodes, (n) => spanOf(n.style.gridColumn))
  const rs = common(nodes, (n) => spanOf(n.style.gridRow))
  return (
    <Section title="Grid item">
      <div className="insp-g2">
        <Field
          label={<Columns3 size={13} />}
          title="Column span"
          value={fv(cs)}
          placeholder="Mixed"
          min={1}
          max={24}
          unit=" col"
          onChange={(v) => typeof v === 'number' && ctx.set({ gridColumn: spanValue(v) })}
          onScrub={(v) => ctx.set({ gridColumn: spanValue(Math.max(1, v)) }, co(ctx, 'colspan'))}
        />
        <Field
          label={<Rows3 size={13} />}
          title="Row span"
          value={fv(rs)}
          placeholder="Mixed"
          min={1}
          max={24}
          unit=" row"
          onChange={(v) => typeof v === 'number' && ctx.set({ gridRow: spanValue(v) })}
          onScrub={(v) => ctx.set({ gridRow: spanValue(Math.max(1, v)) }, co(ctx, 'rowspan'))}
        />
      </div>
    </Section>
  )
}
