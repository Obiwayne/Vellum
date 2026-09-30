import { useRef, useState } from 'react'
import { ChevronDown, FlipHorizontal2, FlipVertical2, RotateCwSquare } from 'lucide-react'
import { Button, Checkbox, Field, IconButton, Menu, Section, type MenuEntry } from '../../ui'
import { useStore } from '../../model/store'
import { anchoredAxes, isFlowLayout } from '../../model/ops'
import { common, co, displayPos, fv, inFlexParent, isMixed, measuredSize, sizeMode, type Ctx, type SizeMode } from './common'

// ------------------------------------------------------------------------------------------ presets
export const SIZE_PRESETS: Array<{ group: string; items: Array<[string, number, number]> }> = [
  { group: 'Phone', items: [['iPhone 16', 393, 852], ['iPhone 16 Pro Max', 440, 956], ['Android', 412, 917]] },
  { group: 'Tablet', items: [['iPad', 820, 1180], ['iPad Pro', 1024, 1366]] },
  { group: 'Desktop', items: [['Desktop', 1440, 1024], ['MacBook', 1280, 832], ['Full HD', 1920, 1080]] },
  { group: 'Presentation', items: [['Slide 16:9', 1920, 1080], ['Slide 720p', 1280, 720]] },
  { group: 'Smartwatch', items: [['Apple Watch 45mm', 198, 242]] },
  { group: 'Print', items: [['A4', 595, 842], ['Letter', 612, 792]] },
  { group: 'Social media', items: [['Instagram post', 1080, 1080], ['Instagram story', 1080, 1920], ['X post', 1200, 675]] }
]

// ------------------------------------------------------------------------------------------ helpers
const parseDeg = (v: unknown): number => {
  const m = /(-?\d*\.?\d+)deg/.exec(String(v ?? ''))
  return m ? parseFloat(m[1]) : 0
}
const parseScale = (v: unknown): [number, number] => {
  if (v === undefined || v === null || v === '') return [1, 1]
  const p = String(v).trim().split(/\s+/).map(parseFloat)
  return [p[0] ?? 1, p[1] ?? p[0] ?? 1]
}
const fmtScale = (sx: number, sy: number): string | null => (sx === 1 && sy === 1 ? null : `${sx} ${sy}`)

// ------------------------------------------------------------------------------------------ W/H
function SizeField({ ctx, axis }: { ctx: Ctx; axis: 'width' | 'height' }): JSX.Element {
  const btn = useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  const { nodes, doc } = ctx
  const mode = common(nodes, (n) => sizeMode(n.style[axis]))
  const num = common(nodes, (n) => measuredSize(doc, n, axis))
  const value = isMixed(mode) ? null : mode === 'fit' ? 'Fit' : mode === 'fill' ? 'Fill' : fv(num)
  const flexChild = nodes.some((n) => inFlexParent(doc, n))
  const setMode = (m: SizeMode): void => {
    if (m === 'fixed')
      ctx.each('Fixed size', (n) => {
        n.style[axis] = measuredSize(doc, n, axis) || 100
      })
    else ctx.set({ [axis]: m === 'fit' ? 'fit-content' : '100%' })
  }
  const items: MenuEntry[] = [
    { label: 'Fixed', checked: mode === 'fixed', onSelect: () => setMode('fixed') },
    { label: 'Fit', checked: mode === 'fit', onSelect: () => setMode('fit') }
  ]
  if (flexChild) items.push({ label: 'Fill', checked: mode === 'fill', onSelect: () => setMode('fill') })
  return (
    <>
      <Field
        label={axis === 'width' ? 'W' : 'H'}
        value={value}
        placeholder="Mixed"
        type="number"
        min={0}
        keywords={['Fit', 'Fill', 'Fixed']}
        onChange={(v) => {
          if (v === 'Fit') setMode('fit')
          else if (v === 'Fill') setMode('fill')
          else if (v === 'Fixed') setMode('fixed')
          else if (typeof v === 'number') ctx.set({ [axis]: Math.max(0, v) })
        }}
        onScrub={(v) => ctx.set({ [axis]: Math.max(0, v) }, co(ctx, axis))}
        trailing={
          <button ref={btn} type="button" className="insp-field-trail" onClick={() => setOpen((o) => !o)}>
            <ChevronDown size={14} />
          </button>
        }
      />
      <Menu open={open} onClose={() => setOpen(false)} anchor={(btn.current?.closest('.c-field') as HTMLElement | null) ?? btn.current} items={items} minWidth={80} ignore={[btn.current]} />
    </>
  )
}

// ------------------------------------------------------------------------------------------ section
export function LayoutSection({ ctx }: { ctx: Ctx }): JSX.Element {
  const { nodes, doc, docId, ids } = ctx
  const store = useStore.getState
  const titleRef = useRef<HTMLButtonElement | null>(null)
  const [presetsOpen, setPresetsOpen] = useState(false)

  const allFrames = nodes.every((n) => n.type === 'frame')
  const anyFlexChild = nodes.some((n) => inFlexParent(doc, n))
  const allFlexChild = nodes.every((n) => inFlexParent(doc, n))
  const anyFlow = nodes.some((n) => isFlowLayout(n.style))
  const flowChild = nodes.some((n) => inFlexParent(doc, n) && n.style.position !== 'absolute')

  const pos = nodes.map((n) => displayPos(doc, n))
  const x = common(pos, (p) => p.x)
  const y = common(pos, (p) => p.y)
  const rot = common(nodes, (n) => parseDeg(n.style.rotate))
  const absolute = common(nodes, (n) => n.style.position === 'absolute')
  const clip = common(nodes, (n) => n.style.overflow === 'clip' || n.style.overflow === 'hidden')

  const setPos = (axis: 'x' | 'y', v: number, live: boolean): void =>
    ctx.each(
      'Move',
      (n, d) => {
        if (inFlexParent(d, n) && n.style.position !== 'absolute') return
        n[axis] = v
        // an explicit X/Y replaces right/bottom ('auto' left/top) anchoring
        if (anchoredAxes(n)[axis]) {
          delete n.style[axis === 'x' ? 'left' : 'top']
          delete n.style[axis === 'x' ? 'right' : 'bottom']
        }
      },
      live ? co(ctx, axis) : undefined
    )
  const setRot = (v: number, live: boolean): void =>
    ctx.set({ rotate: v ? `${Math.round(v * 100) / 100}deg` : null }, live ? co(ctx, 'rot') : undefined)

  const presetItems: MenuEntry[] = [
    { type: 'heading', label: 'Frame' },
    ...SIZE_PRESETS.map((g) => ({
      label: g.group,
      submenu: g.items.map(([label, w, h]) => ({
        label,
        shortcut: `${w}×${h}`,
        onSelect: () => ctx.set({ width: w, height: h })
      }))
    }))
  ]

  const toggleAbsolute = (on: boolean): void => {
    // keep the node visually in place when leaving the flow
    const measured = new Map(nodes.map((n) => [n.id, displayPos(doc, n)]))
    ctx.each('Absolute position', (n) => {
      if (on) {
        const p = measured.get(n.id)
        if (p) {
          n.x = p.x
          n.y = p.y
        }
        n.style.position = 'absolute'
      } else delete n.style.position
    })
  }

  return (
    <Section
      title={
        allFrames ? (
          <>
            Layout <ChevronDown size={12} />
          </>
        ) : (
          'Layout'
        )
      }
      onTitleClick={
        allFrames
          ? (e) => {
              titleRef.current = e.currentTarget
              setPresetsOpen((o) => !o)
            }
          : undefined
      }
    >
      <div className="insp-g3">
        <Field
          label="X"
          value={fv(x)}
          placeholder="Mixed"
          disabled={flowChild}
          onChange={(v) => typeof v === 'number' && setPos('x', v, false)}
          onScrub={(v) => setPos('x', v, true)}
        />
        <Field
          label="Y"
          value={fv(y)}
          placeholder="Mixed"
          disabled={flowChild}
          onChange={(v) => typeof v === 'number' && setPos('y', v, false)}
          onScrub={(v) => setPos('y', v, true)}
        />
        <Field
          label={<span style={{ fontSize: 11 }}>∠</span>}
          value={fv(rot)}
          unit="°"
          placeholder="Mixed"
          onChange={(v) => typeof v === 'number' && setRot(v, false)}
          onScrub={(v) => setRot(v, true)}
        />
      </div>
      <div className="insp-g3">
        <SizeField ctx={ctx} axis="width" />
        <SizeField ctx={ctx} axis="height" />
        <div className="insp-btnstrip">
          <IconButton
            icon={<RotateCwSquare size={14} />}
            label="Rotate 90°"
            onClick={() =>
              ctx.each('Rotate 90°', (n) => {
                const r = (parseDeg(n.style.rotate) + 90) % 360
                if (r) n.style.rotate = `${r}deg`
                else delete n.style.rotate
              })
            }
          />
          <IconButton
            icon={<FlipHorizontal2 size={14} />}
            label="Flip horizontal"
            shortcut="Shift+H"
            onClick={() =>
              ctx.each('Flip horizontal', (n) => {
                const [sx, sy] = parseScale(n.style.scale)
                const v = fmtScale(-sx, sy)
                if (v) n.style.scale = v
                else delete n.style.scale
              })
            }
          />
          <IconButton
            icon={<FlipVertical2 size={14} />}
            label="Flip vertical"
            shortcut="Shift+V"
            onClick={() =>
              ctx.each('Flip vertical', (n) => {
                const [sx, sy] = parseScale(n.style.scale)
                const v = fmtScale(sx, -sy)
                if (v) n.style.scale = v
                else delete n.style.scale
              })
            }
          />
        </div>
      </div>
      {allFrames && !anyFlow && !allFlexChild && (
        <div className="insp-g2">
          <Button
            full
            shortcut="Shift+A"
            onClick={() => store().transact(docId, 'Add flex', () => ids.forEach((id) => store().addFlex(docId, id)))}
          >
            Add flex
          </Button>
          <Button full onClick={() => store().transact(docId, 'Add grid', () => ids.forEach((id) => store().addGrid(docId, id)))}>
            Add grid
          </Button>
        </div>
      )}
      {anyFlexChild && (
        <Button full shortcut="Shift+A" onClick={() => store().wrapInFlex(docId, ids)}>
          Wrap in flex
        </Button>
      )}
      {anyFlexChild && (
        <Checkbox
          checked={absolute === true}
          label={isMixed(absolute) ? 'Absolute position (mixed)' : 'Absolute position'}
          onChange={toggleAbsolute}
        />
      )}
      {allFrames && !anyFlow && (
        <Checkbox
          checked={clip === true}
          label="Clip content"
          shortcut="Alt+C"
          onChange={(on) => ctx.set({ overflow: on ? 'clip' : null })}
        />
      )}
      <Menu
        open={presetsOpen}
        onClose={() => setPresetsOpen(false)}
        anchor={titleRef.current}
        items={presetItems}
        placement="bottom-start"
        minWidth={134}
        ignore={[titleRef.current]}
      />
    </Section>
  )
}
