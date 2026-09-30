import { useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowRight,
  BetweenHorizontalStart,
  BetweenVerticalStart,
  PanelLeftRightDashed,
  PanelTopBottomDashed,
  Scan,
  SlidersHorizontal,
  WrapText
} from 'lucide-react'
import { Checkbox, Field, IconButton, Menu, Section, Segmented, type MenuEntry } from '../../ui'
import { useStore } from '../../model/store'
import { common, co, fv, isMixed, readBox, writeBox, type Ctx } from './common'

type A = 'start' | 'center' | 'end'
const norm = (v: unknown): A | 'between' | 'around' | 'evenly' | 'stretch' => {
  const s = String(v ?? 'start')
  if (s === 'center') return 'center'
  if (s === 'end' || s === 'flex-end') return 'end'
  if (s === 'space-between') return 'between'
  if (s === 'space-around') return 'around'
  if (s === 'space-evenly') return 'evenly'
  if (s === 'stretch') return 'stretch'
  return 'start'
}
const IDX: Record<A, number> = { start: 0, center: 1, end: 2 }
const VAL: A[] = ['start', 'center', 'end']

function Bars({ dir, align }: { dir: 'row' | 'column'; align: A }): JSX.Element {
  const sizes = [10, 6, 8]
  const cross = align === 'start' ? 'flex-start' : align === 'end' ? 'flex-end' : 'center'
  return (
    <span
      className={`insp-bars insp-bars--${dir === 'column' ? 'col' : 'row'}`}
      style={{ alignItems: cross, width: 12, height: 12, justifyContent: 'center' }}
    >
      {sizes.map((s, i) =>
        dir === 'column' ? <span key={i} style={{ width: s }} /> : <span key={i} style={{ height: s }} />
      )}
    </span>
  )
}

export function FlexSection({ ctx }: { ctx: Ctx }): JSX.Element {
  const { nodes, docId, ids } = ctx
  const spacingBtn = useRef<HTMLButtonElement | null>(null)
  const [spacingOpen, setSpacingOpen] = useState(false)
  const n0 = nodes[0]
  const dirM = common(nodes, (n) => (String(n.style.flexDirection ?? 'row').startsWith('column') ? 'column' : 'row'))
  const dir: 'row' | 'column' = isMixed(dirM) ? 'column' : (dirM as 'row' | 'column')
  const ai = norm(n0.style.alignItems)
  const jc = norm(n0.style.justifyContent)
  const wrap = common(nodes, (n) => n.style.flexWrap === 'wrap')
  const gap = common(nodes, (n) => (typeof n.style.gap === 'number' ? n.style.gap : parseFloat(String(n.style.gap ?? 0)) || 0))
  const pad = common(nodes, (n) => readBox(n.style, 'padding'))
  const padV = isMixed(pad) ? null : pad
  const [perSide, setPerSide] = useState(() => Boolean(padV && (padV[0] !== padV[2] || padV[1] !== padV[3])))
  const clip = common(nodes, (n) => n.style.overflow === 'clip' || n.style.overflow === 'hidden')

  // grid coordinates of the active cell(s)
  const aiIdx = IDX[(ai === 'stretch' ? 'start' : ai) as A] ?? 0
  const spaced = jc === 'between' || jc === 'around' || jc === 'evenly'
  const jcIdx = spaced ? -1 : IDX[jc as A] ?? 0
  const isOn = (row: number, col: number): boolean => {
    const main = dir === 'column' ? row : col
    const cross = dir === 'column' ? col : row
    return cross === aiIdx && (spaced || main === jcIdx)
  }
  const click = (row: number, col: number): void => {
    const main = dir === 'column' ? row : col
    const cross = dir === 'column' ? col : row
    ctx.set({ alignItems: VAL[cross], justifyContent: spaced ? n0.style.justifyContent : VAL[main] })
  }

  const setPad = (v: number[], live = false): void => ctx.set(writeBox('padding', v), live ? co(ctx, 'pad') : undefined)
  const spacingItems: MenuEntry[] = [
    { label: 'Packed', checked: !spaced, onSelect: () => ctx.set({ justifyContent: 'start' }) },
    { label: 'Space between', checked: jc === 'between', onSelect: () => ctx.set({ justifyContent: 'space-between' }) },
    { label: 'Space around', checked: jc === 'around', onSelect: () => ctx.set({ justifyContent: 'space-around' }) },
    { label: 'Space evenly', checked: jc === 'evenly', onSelect: () => ctx.set({ justifyContent: 'space-evenly' }) }
  ]

  return (
    <Section
      title="Flex"
      onRemove={() =>
        useStore.getState().transact(docId, 'Remove flex', () => ids.forEach((id) => useStore.getState().removeFlex(docId, id)))
      }
      removeLabel="Remove flex"
    >
      <div className="insp-flex">
        <div className="insp-aligngrid">
          {[0, 1, 2].map((row) =>
            [0, 1, 2].map((col) => {
              const on = isOn(row, col)
              return (
                <button
                  key={`${row}-${col}`}
                  type="button"
                  className={on ? 'on' : undefined}
                  onClick={() => click(row, col)}
                  onDoubleClick={() => ctx.set({ justifyContent: spaced ? 'start' : 'space-between' })}
                >
                  {on ? <Bars dir={dir} align={VAL[aiIdx]} /> : <span className="dot" />}
                </button>
              )
            })
          )}
        </div>
        <Segmented
          size="md"
          full
          value={isMixed(dirM) ? null : dir}
          options={[
            { value: 'column', icon: <ArrowDown size={14} />, title: 'Vertical' },
            { value: 'row', icon: <ArrowRight size={14} />, title: 'Horizontal' }
          ]}
          onChange={(v) => ctx.set({ flexDirection: v })}
         
        />
        <IconButton
          icon={<WrapText size={14} />}
          label="Wrap"
          active={wrap === true}
          onClick={() => ctx.set({ flexWrap: wrap === true ? null : 'wrap' })}
        />
        <Field
          label={dir === 'column' ? <BetweenVerticalStart size={13} /> : <BetweenHorizontalStart size={13} />}
          value={jc === 'between' ? 'Auto' : fv(gap)}
          placeholder="Mixed"
          type="number"
          min={0}
          keywords={['Auto']}
          onChange={(v) => {
            if (v === 'Auto') ctx.set({ justifyContent: 'space-between' })
            else if (typeof v === 'number') ctx.set({ gap: v, ...(jc === 'between' ? { justifyContent: 'start' } : {}) })
          }}
          onScrub={(v) => ctx.set({ gap: Math.max(0, v) }, co(ctx, 'gap'))}
         
        />
        <IconButton
          ref={spacingBtn}
          icon={<SlidersHorizontal size={14} />}
          label="Spacing options"
          active={spaced}
          onClick={() => setSpacingOpen((o) => !o)}
        />
      </div>
      {!perSide ? (
        <div className="insp-g2i">
          <Field
            label={<PanelLeftRightDashed size={13} />}
            value={padV ? (padV[1] === padV[3] ? padV[1] : null) : null}
            placeholder="Mixed"
            min={0}
            onChange={(v) => typeof v === 'number' && padV && setPad([padV[0], v, padV[2], v])}
            onScrub={(v) => padV && setPad([padV[0], v, padV[2], v], true)}
          />
          <Field
            label={<PanelTopBottomDashed size={13} />}
            value={padV ? (padV[0] === padV[2] ? padV[0] : null) : null}
            placeholder="Mixed"
            min={0}
            onChange={(v) => typeof v === 'number' && padV && setPad([v, padV[1], v, padV[3]])}
            onScrub={(v) => padV && setPad([v, padV[1], v, padV[3]], true)}
          />
          <IconButton icon={<Scan size={14} />} label="Individual padding" onClick={() => setPerSide(true)} />
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 24px', gap: 8 }}>
          <div className="insp-g4">
            {(['T', 'R', 'B', 'L'] as const).map((l, i) => (
              <Field
                key={l}
                label={l}
                value={padV ? padV[i] : null}
                placeholder="–"
                min={0}
                onChange={(v) => {
                  if (typeof v !== 'number' || !padV) return
                  const next = [...padV]
                  next[i] = v
                  setPad(next)
                }}
                onScrub={(v) => {
                  if (!padV) return
                  const next = [...padV]
                  next[i] = v
                  setPad(next, true)
                }}
              />
            ))}
          </div>
          <IconButton icon={<Scan size={14} />} label="Individual padding" active onClick={() => setPerSide(false)} />
        </div>
      )}
      <Checkbox
        checked={clip === true}
        label="Clip content"
        shortcut="Alt+C"
        onChange={(on) => ctx.set({ overflow: on ? 'clip' : null })}
      />
      <Menu
        open={spacingOpen}
        onClose={() => setSpacingOpen(false)}
        anchor={spacingBtn.current}
        items={spacingItems}
        placement="bottom-end"
        minWidth={150}
        ignore={[spacingBtn.current]}
      />
    </Section>
  )
}
