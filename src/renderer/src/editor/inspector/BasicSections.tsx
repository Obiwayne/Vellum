import { useState } from 'react'
import { Crop, Droplet, Eye, EyeOff, Grip, Scan, SquareRoundCorner } from 'lucide-react'
import { Button, Field, IconButton, Section, Select, Slider, type SelectEntry } from '../../ui'
import { canConstrain, editPlain } from '../../model/ops'
import type { CNode } from '../../model/types'
import { naturalSize } from '../canvas/crop'
import { common, co, fv, isMixed, readBox, writeBox, type Ctx } from './common'

// ------------------------------------------------------------------------------------------ Radius
export function RadiusSection({ ctx }: { ctx: Ctx }): JSX.Element {
  const box = common(ctx.nodes, (n) => readBox(n.style, 'borderRadius'))
  const v = isMixed(box) ? null : box
  const uniform = v ? v.every((x) => x === v[0]) : false
  const [perCorner, setPerCorner] = useState(() => Boolean(v && !uniform))
  const setAll = (n: number, live = false): void =>
    ctx.set(writeBox('borderRadius', [n, n, n, n]), live ? co(ctx, 'radius') : undefined)
  return (
    <Section
      title="Radius"
      actions={
        <IconButton
          icon={<Scan size={14} />}
          label="Individual corners"
          active={perCorner}
          onClick={() => setPerCorner((p) => !p)}
        />
      }
    >
      {!perCorner ? (
        <div className="insp-g3" style={{ alignItems: 'center' }}>
          <div className="insp-span2" style={{ paddingRight: 4 }}>
          <Slider
            value={v && uniform ? Math.min(v[0], 100) : 0}
            min={0}
            max={100}
            onChange={(n) => setAll(n, true)}
          />
          </div>
          <Field
            value={v && uniform ? v[0] : null}
            placeholder="Mixed"
            min={0}
            onChange={(n) => typeof n === 'number' && setAll(n)}
          />
        </div>
      ) : (
        <div className="insp-g4">
          {['↖', '↗', '↘', '↙'].map((l, i) => (
            <Field
              key={l}
              label={<SquareRoundCorner size={12} style={{ transform: `rotate(${i * 90 - 90}deg)` }} />}
              value={v ? v[i] : null}
              placeholder="–"
              min={0}
              onChange={(n) => {
                if (typeof n !== 'number' || !v) return
                const next = [...v]
                next[i] = n
                ctx.set(writeBox('borderRadius', next))
              }}
              onScrub={(n) => {
                if (!v) return
                const next = [...v]
                next[i] = Math.max(0, n)
                ctx.set(writeBox('borderRadius', next), co(ctx, 'radius' + i))
              }}
            />
          ))}
        </div>
      )}
    </Section>
  )
}

// ------------------------------------------------------------------------------------------ Blending
type Blend =
  | 'normal' | 'darken' | 'multiply' | 'color-burn' | 'lighten' | 'screen' | 'plus-lighter' | 'color-dodge'
  | 'overlay' | 'soft-light' | 'hard-light' | 'difference' | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity'

const o = (value: Blend, label: string): SelectEntry<Blend> => ({ value, label })
export const BLEND_OPTIONS: SelectEntry<Blend>[] = [
  o('normal', 'Normal'),
  'separator',
  o('darken', 'Darken'), o('multiply', 'Multiply'), o('color-burn', 'Color Burn'),
  'separator',
  o('lighten', 'Lighten'), o('screen', 'Screen'), o('plus-lighter', 'Plus Lighter'), o('color-dodge', 'Color Dodge'),
  'separator',
  o('overlay', 'Overlay'), o('soft-light', 'Soft Light'), o('hard-light', 'Hard Light'),
  'separator',
  o('difference', 'Difference'), o('exclusion', 'Exclusion'),
  'separator',
  o('hue', 'Hue'), o('saturation', 'Saturation'), o('color', 'Color'), o('luminosity', 'Luminosity')
]

export function BlendingSection({ ctx }: { ctx: Ctx }): JSX.Element {
  const opacity = common(ctx.nodes, (n) => {
    const v = n.style.opacity
    const f = v === undefined ? 1 : typeof v === 'number' ? v : String(v).endsWith('%') ? parseFloat(String(v)) / 100 : parseFloat(String(v))
    return Math.round((Number.isFinite(f) ? f : 1) * 1000) / 10
  })
  const blend = common(ctx.nodes, (n) => String(n.style.mixBlendMode ?? 'normal') as Blend)
  const visible = common(ctx.nodes, (n) => n.visible)
  const setOpacity = (pct: number, live = false): void => {
    const f = Math.min(100, Math.max(0, pct)) / 100
    ctx.set({ opacity: f >= 1 ? null : Math.round(f * 1000) / 1000 }, live ? co(ctx, 'opacity') : undefined)
  }
  return (
    <Section
      title="Blending"
      actions={
        <IconButton
          icon={visible === false ? <EyeOff size={14} /> : <Eye size={14} />}
          label={visible === false ? 'Show' : 'Hide'}
          shortcut="Ctrl+Shift+H"
          onClick={() =>
            ctx.each('Show/hide', (n) => {
              n.visible = visible === false
            })
          }
        />
      }
    >
      <div className="insp-g2">
        <Field
          label={<Grip size={12} />}
          value={fv(opacity)}
          unit="%"
          placeholder="Mixed"
          min={0}
          max={100}
          onChange={(v) => typeof v === 'number' && setOpacity(v)}
          onScrub={(v) => setOpacity(v, true)}
        />
        <Select<Blend>
          value={isMixed(blend) ? null : blend}
          placeholder="Mixed"
          icon={<Droplet size={13} />}
          options={BLEND_OPTIONS}
          onChange={(v) => ctx.set({ mixBlendMode: v === 'normal' ? null : v })}
        />
      </div>
    </Section>
  )
}

// ------------------------------------------------------------------------------------------ Image
/** Image crop (Ctrl+drag a resize handle on the canvas; see canvas/crop.ts). */
export function ImageSection({ ctx }: { ctx: Ctx }): JSX.Element {
  const cropped = ctx.nodes.some((n) => n.style.objectViewBox !== undefined)
  // reset: the whole picture again, at the box's width and the image's own aspect ratio
  const reset = (): void =>
    ctx.each('Reset crop', (n, d) => {
      delete n.style.objectViewBox
      delete n.style.objectPosition
      const nat = naturalSize(n.id)
      const w = typeof n.style.width === 'number' ? n.style.width : null
      if (!nat || w === null) return
      const fit = (m: CNode): void => {
        m.style.height = Math.round((w * nat.nh) / nat.nw)
      }
      if (canConstrain(d, n.id)) editPlain(d, n.id, fit)
      else fit(n)
    })
  return (
    <Section title="Image">
      <div className="insp-g2">
        <Button full icon={<Crop size={14} />} disabled={!cropped} onClick={reset}>
          Reset crop
        </Button>
        <span className="insp-muted" style={{ alignSelf: 'center' }}>
          {cropped ? 'Cropped' : 'Ctrl+drag a handle to crop'}
        </span>
      </div>
    </Section>
  )
}
