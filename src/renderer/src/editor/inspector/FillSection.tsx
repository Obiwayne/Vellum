import { useRef, useState } from 'react'
import { Crosshair, Eye, EyeOff, ImagePlus, Minus, Plus, RotateCw } from 'lucide-react'
import { Button, Field, IconButton, Section, Select } from '../../ui'
import { common, co, isMixed, type Ctx } from './common'
import { gradientCss, midColor, readFills, writeFills, type Fill, type Stop } from './fills'
import { ColorInput } from './ColorInput'
import { isGradientTarget, setGradientTarget, useGradientEdit } from '../canvas/gradientEdit'
import { moveItem, useReorder } from './reorder'

type Kind = Fill['kind']
type Grad = Extract<Fill, { kind: 'gradient' }>

// Hidden fills (eye toggle) are kept per selection for the session; CSS has no "disabled layer".
const hiddenStore = new Map<string, Array<{ index: number; fill: Fill }>>()

export function pickImageFile(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = () => {
      const f = input.files?.[0]
      if (!f) return resolve(null)
      const r = new FileReader()
      r.onload = () => resolve(typeof r.result === 'string' ? r.result : null)
      r.onerror = () => resolve(null)
      r.readAsDataURL(f)
    }
    input.click()
  })
}

function KindTabs({ kind, onChange, text }: { kind: Kind; onChange: (k: Kind) => void; text?: boolean }): JSX.Element {
  return (
    <div className="insp-fillkind">
      <button type="button" title="Solid" className={kind === 'solid' ? 'on' : ''} onClick={() => onChange('solid')}>
        <span className="ico ico--solid" />
      </button>
      {!text && (
        <>
          <button type="button" title="Gradient" className={kind === 'gradient' ? 'on' : ''} onClick={() => onChange('gradient')}>
            <span className="ico ico--grad" />
          </button>
          <button type="button" title="Image" className={kind === 'image' ? 'on' : ''} onClick={() => onChange('image')}>
            <ImagePlus size={14} />
          </button>
        </>
      )}
    </div>
  )
}

// ------------------------------------------------------------------------------------------ gradient
function GradientEditor({
  ctx,
  fill,
  index,
  onChange
}: {
  ctx: Ctx
  fill: Grad
  /** fill layer index, for on-canvas editing (single selection only) */
  index: number
  onChange: (f: Grad, live: boolean) => void
}): JSX.Element {
  const bar = useRef<HTMLDivElement | null>(null)
  const [sel, setSel] = useState(0)
  const single = ctx.ids.length === 1 && index >= 0
  const onCanvas = useGradientEdit((s) => single && isGradientTarget(s.target, ctx.docId, ctx.ids[0], index))
  const editOnCanvas = (): void => {
    if (single && !onCanvas) setGradientTarget({ docId: ctx.docId, nodeId: ctx.ids[0], index })
  }
  const drag = useRef<{ i: number; moved: boolean } | null>(null)
  const posAt = (clientX: number): number => {
    const r = bar.current?.getBoundingClientRect()
    if (!r) return 0
    return Math.round(Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100)))
  }
  const setStop = (i: number, patch: Partial<Stop>, live = false): void =>
    onChange({ ...fill, stops: fill.stops.map((s, j) => (j === i ? { ...s, ...patch } : s)) }, live)
  const preview = gradientCss({ ...fill, type: 'linear', angle: 90 })
  return (
    <>
      <div
        ref={bar}
        className="insp-gradbar"
        onPointerDown={(e) => {
          if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains('fill')) return
          const pos = posAt(e.clientX)
          const stops = [...fill.stops, { color: midColor(fill.stops, pos), pos }]
          setSel(stops.length - 1)
          onChange({ ...fill, stops }, false)
        }}
      >
        <div className="fill" style={{ backgroundImage: preview }} />
        {fill.stops.map((s, i) => (
          <div
            key={i}
            className={['insp-gradstop', i === sel && 'on'].filter(Boolean).join(' ')}
            style={{ left: `${s.pos}%`, background: s.color }}
            onPointerDown={(e) => {
              e.stopPropagation()
              e.currentTarget.setPointerCapture(e.pointerId)
              editOnCanvas()
              setSel(i)
              drag.current = { i, moved: false }
            }}
            onPointerMove={(e) => {
              if (!drag.current) return
              drag.current.moved = true
              setStop(drag.current.i, { pos: posAt(e.clientX) }, true)
            }}
            onPointerUp={() => {
              drag.current = null
            }}
          />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Select<'linear' | 'radial'>
          value={fill.type}
          options={[
            { value: 'linear', label: 'Linear' },
            { value: 'radial', label: 'Radial' }
          ]}
          onChange={(t) => onChange({ ...fill, type: t }, false)}
          style={{ flex: 1 }}
        />
        {fill.type === 'linear' && (
          <Field
            label={<RotateCw size={12} />}
            value={fill.angle}
            unit="°"
            style={{ width: 76 }}
            onChange={(v) => typeof v === 'number' && onChange({ ...fill, angle: ((v % 360) + 360) % 360 }, false)}
            onScrub={(v) => onChange({ ...fill, angle: ((v % 360) + 360) % 360 }, true)}
          />
        )}
        {single && (
          <IconButton
            icon={<Crosshair size={14} />}
            label="Edit on canvas"
            active={onCanvas}
            onClick={() => (onCanvas ? setGradientTarget(null) : editOnCanvas())}
          />
        )}
        <IconButton
          icon={<Plus size={14} />}
          label="Add stop"
          onClick={() => {
            const pos = 50
            onChange({ ...fill, stops: [...fill.stops, { color: midColor(fill.stops, pos), pos }] }, false)
            setSel(fill.stops.length)
          }}
        />
      </div>
      {fill.stops.map((s, i) => (
        <div key={i} onPointerDown={() => setSel(i)}>
          <ColorInput
            docId={ctx.docId}
            nodeId={ctx.ids[0]}
            value={s.color}
            showEyedropper={false}
            onChange={(c, { live }) => setStop(i, { color: c }, live)}
            trailing={
              <>
<IconButton
                  icon={<Minus size={14} />}
                  label="Remove stop"
                  disabled={fill.stops.length <= 2}
                  onClick={() => onChange({ ...fill, stops: fill.stops.filter((_, j) => j !== i) }, false)}
                />
              </>
            }
          />
        </div>
      ))}
    </>
  )
}

// ------------------------------------------------------------------------------------------ section
export function FillSection({ ctx, text }: { ctx: Ctx; text?: boolean }): JSX.Element {
  const fillsM = common(ctx.nodes, (n) => readFills(n.style, text))
  const key = ctx.ids.join(',')
  const [, force] = useState(0)
  const reorder = useReorder()
  const hidden = hiddenStore.get(key) ?? []

  const setFills = (next: Fill[], live = false): void =>
    ctx.set(writeFills(next, text), live ? co(ctx, 'fill') : undefined)

  if (isMixed(fillsM)) {
    return (
      <Section title="Fill" onAdd={() => setFills([{ kind: 'solid', color: text ? '#000000' : '#D9D9D9' }])}>
        <div className="insp-mixed">Mixed — click + to replace</div>
      </Section>
    )
  }
  const fills = fillsM
  // merge hidden fills back in at their positions for display
  const rows: Array<{ fill: Fill; visible: boolean; realIndex: number }> = fills.map((f, i) => ({
    fill: f,
    visible: true,
    realIndex: i
  }))
  for (const h of [...hidden].sort((a, b) => a.index - b.index))
    rows.splice(Math.min(h.index, rows.length), 0, { fill: h.fill, visible: false, realIndex: -1 })

  const add = (): void => {
    if (text) setFills([{ kind: 'solid', color: '#000000' }])
    else setFills([{ kind: 'solid', color: fills.length ? '#000000' : '#FFFFFF' }, ...fills])
  }
  const empty = rows.length === 0

  const toggleHidden = (rowIndex: number): void => {
    const row = rows[rowIndex]
    if (row.visible) {
      hiddenStore.set(key, [...hidden, { index: rowIndex, fill: row.fill }])
      setFills(fills.filter((_, i) => i !== row.realIndex))
    } else {
      const rest = hidden.filter((h) => h.fill !== row.fill)
      hiddenStore.set(key, rest)
      const visibleBefore = rows.slice(0, rowIndex).filter((r) => r.visible).length
      const next = [...fills]
      next.splice(visibleBefore, 0, row.fill)
      setFills(next)
    }
    force((n) => n + 1)
  }

  // drag to reorder: hidden fills keep their new row position, visible ones are written in order
  const moveRow = (from: number, to: number): void => {
    const next = moveItem(rows, from, to)
    hiddenStore.set(key, next.flatMap((r, i) => (r.visible ? [] : [{ index: i, fill: r.fill }])))
    setFills(next.filter((r) => r.visible).map((r) => r.fill))
    force((n) => n + 1)
  }

  const replace = (realIndex: number, f: Fill, live = false): void => {
    const next = [...fills]
    next[realIndex] = f
    setFills(next, live)
  }

  const changeKind = async (realIndex: number, fill: Fill, k: Kind): Promise<void> => {
    if (k === fill.kind) return
    const base = fill.kind === 'solid' ? fill.color : fill.kind === 'gradient' ? fill.stops[0]?.color ?? '#FFFFFF' : '#FFFFFF'
    if (k === 'solid') replace(realIndex, { kind: 'solid', color: base })
    else if (k === 'gradient')
      replace(realIndex, {
        kind: 'gradient',
        type: 'linear',
        angle: 180,
        stops: [
          { color: base, pos: 0 },
          { color: base.toUpperCase() === '#FFFFFF' ? '#BEBEBE' : '#FFFFFF', pos: 100 }
        ]
      })
    else {
      const url = await pickImageFile()
      if (url) replace(realIndex, { kind: 'image', url, size: 'cover' })
    }
  }

  return (
    <Section title="Fill" empty={empty} onAdd={text && !empty ? undefined : add} addLabel="Add fill">
      {!empty &&
        rows.map((row, ri) => {
          const { fill, visible, realIndex } = row
          return (
            <div {...reorder.row(ri, 'insp-fillblock')} key={ri}>
              <div className="insp-filltabs">
                {rows.length > 1 && reorder.grip(ri, moveRow)}
                <KindTabs kind={fill.kind} text={text} onChange={(k) => visible && void changeKind(realIndex, fill, k)} />
                <div className="insp-flex1" />
                <IconButton
                  icon={visible ? <Eye size={14} /> : <EyeOff size={14} />}
                  label={visible ? 'Hide fill' : 'Show fill'}
                  onClick={() => toggleHidden(ri)}
                />
                <IconButton
                  icon={<Minus size={14} />}
                  label="Remove fill"
                  onClick={() => {
                    if (!visible) {
                      hiddenStore.set(key, hidden.filter((h) => h.fill !== fill))
                      force((n) => n + 1)
                    } else setFills(fills.filter((_, i) => i !== realIndex))
                  }}
                />
              </div>
              <div style={visible ? undefined : { opacity: 0.45, pointerEvents: 'none' }}>
                {fill.kind === 'solid' && (
                  <ColorInput
                    docId={ctx.docId}
            nodeId={ctx.ids[0]}
                    value={fill.color}
                    onChange={(c, { live }) => replace(realIndex, { kind: 'solid', color: c }, live)}
                  />
                )}
                {fill.kind === 'gradient' && (
                  <div className="insp-fillblock">
                    <GradientEditor ctx={ctx} fill={fill} index={realIndex} onChange={(f, live) => replace(realIndex, f, live)} />
                  </div>
                )}
                {fill.kind === 'image' && (
                  <div className="insp-imgfill">
                    <div className="insp-imgthumb" style={{ backgroundImage: fill.url ? `url("${fill.url}")` : undefined }} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 0 }}>
                      <Select<string>
                        value={fill.size}
                        options={[
                          { value: 'cover', label: 'Fill (cover)' },
                          { value: 'contain', label: 'Fit (contain)' },
                          { value: 'auto', label: 'Original size' }
                        ]}
                        onChange={(s) => replace(realIndex, { ...fill, size: s })}
                        size="sm"
                      />
                      <Button
                        size="sm"
                        onClick={async () => {
                          const url = await pickImageFile()
                          if (url) replace(realIndex, { ...fill, url })
                        }}
                      >
                        Choose image…
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        })}
    </Section>
  )
}
