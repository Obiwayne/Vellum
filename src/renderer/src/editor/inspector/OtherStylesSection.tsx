// Other styles: every CSS property on the selection that no other inspector section edits
// (transform, aspect-ratio, z-index, margins, custom properties… often written by agents),
// shown as editable `property: value` rows.
import { useState } from 'react'
import { Minus, X } from 'lucide-react'
import { Field, IconButton, Section } from '../../ui'
import type { CNode, Doc, StylePatch } from '../../model/types'
import { isFlowLayout, isGrid } from '../../model/ops'
import { cssValue, toCamel, toKebab } from '../../model/html'
import { common, isMixed, type Ctx } from './common'

// ------------------------------------------------------------------------------------------ handled keys
// Keys the other sections read and write, grouped by section. A key only counts as handled when that
// section is actually shown for the node (see handledStyleKeys).

/** Layout: W/H, X/Y anchoring, rotation, flips, absolute position (+ the frame default box-sizing). */
const LAYOUT_KEYS = ['width', 'height', 'left', 'top', 'right', 'bottom', 'position', 'rotate', 'scale', 'boxSizing']
/** Blending: opacity + blend mode. Filters. */
const BLENDING_KEYS = ['opacity', 'mixBlendMode', 'filter']
/** Grid item: column/row span (only inside a grid). */
const GRID_ITEM_KEYS = ['gridColumn', 'gridRow']
/** Flex and grid containers: direction, alignment, wrap, gaps, tracks, auto flow. */
const FLOW_KEYS = [
  'display',
  'flexDirection',
  'flexWrap',
  'alignItems',
  'justifyContent',
  'justifyItems',
  'gap',
  'rowGap',
  'columnGap',
  'gridTemplateColumns',
  'gridTemplateRows',
  'gridAutoFlow'
]
/** Padding (Flex / Grid sections). */
const PADDING_KEYS = ['padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']
/** Clip content (Layout / Flex / Grid on frames). */
const CLIP_KEYS = ['overflow']
/** Radius: shorthand + corners. */
const RADIUS_KEYS = ['borderRadius', 'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius']
/** Fill layers. */
const FILL_KEYS = ['background', 'backgroundColor', 'backgroundImage', 'backgroundSize', 'backgroundPosition', 'backgroundRepeat']
const OUTLINE_KEYS = ['outline', 'outlineStyle', 'outlineWidth', 'outlineOffset', 'outlineColor']
/** Border: all sides or one side, shorthand + longhands. */
const BORDER_KEYS = ['', 'Top', 'Right', 'Bottom', 'Left'].flatMap((side) =>
  ['', 'Width', 'Style', 'Color'].map((part) => `border${side}${part}`)
)
const BOX_SHADOW_KEYS = ['boxShadow']
const BACKDROP_KEYS = ['backdropFilter']
/** Text: fill colour, typography, formatting popover, vertical align, underline, stroke, text shadow. */
const TEXT_KEYS = [
  'color',
  'fontFamily',
  'fontWeight',
  'fontSize',
  'lineHeight',
  'letterSpacing',
  'textAlign',
  'textTransform',
  'whiteSpace',
  'textWrap',
  'wordBreak',
  'textOverflow',
  'overflow',
  'display',
  'flexDirection',
  'justifyContent',
  'WebkitLineClamp',
  'WebkitBoxOrient',
  'textDecoration',
  'textDecorationLine',
  'textDecorationColor',
  'textDecorationThickness',
  'textUnderlineOffset',
  'WebkitTextStrokeWidth',
  'WebkitTextStrokeColor',
  'paintOrder',
  'textShadow'
]

/** Style keys of `n` that another inspector section already edits. */
export function handledStyleKeys(doc: Doc, n: CNode): Set<string> {
  const keys = [...LAYOUT_KEYS, ...BLENDING_KEYS]
  if (n.parent && isGrid(doc.nodes[n.parent])) keys.push(...GRID_ITEM_KEYS)
  if (n.type === 'text') keys.push(...TEXT_KEYS)
  else {
    keys.push(...FILL_KEYS, ...RADIUS_KEYS, ...OUTLINE_KEYS, ...BORDER_KEYS, ...BOX_SHADOW_KEYS)
    if (isFlowLayout(n.style)) keys.push(...FLOW_KEYS, ...PADDING_KEYS)
    if (n.type === 'frame') keys.push(...CLIP_KEYS)
    if (n.type === 'frame' || n.type === 'rect') keys.push(...BACKDROP_KEYS)
  }
  return new Set(keys)
}

/** Keys no other section edits, across the selection (first seen first). */
function otherKeys(doc: Doc, nodes: CNode[]): string[] {
  const out = new Set<string>()
  for (const n of nodes) {
    const handled = handledStyleKeys(doc, n)
    for (const k of Object.keys(n.style)) if (!handled.has(k)) out.add(k)
  }
  return [...out]
}

// ------------------------------------------------------------------------------------------ parsing
const PROP_RE = /^-?[a-zA-Z][a-zA-Z0-9-]*$/
const CUSTOM_PROP_RE = /^--[\w-]+$/

/** 'z-index' / 'zIndex' / '-webkit-mask-image' / '--x' → style key, or null when invalid. */
export function styleKeyOf(input: string): string | null {
  const s = input.trim().replace(/:$/, '')
  if (CUSTOM_PROP_RE.test(s)) return s
  if (!PROP_RE.test(s)) return null
  return toCamel(s)
}

/** Text as typed → stored value ('' removes; unitless numbers become numbers, as when importing HTML). */
function parseValue(text: string): string | number | null {
  const v = text.trim().replace(/;$/, '').replace(/\s*!important$/i, '').trim()
  if (!v) return null
  return /^-?\d*\.?\d+$/.test(v) ? parseFloat(v) : v
}

// ------------------------------------------------------------------------------------------ section
function NewStyleRow({ onAdd, onCancel }: { onAdd: (key: string, value: string | number) => void; onCancel: () => void }): JSX.Element {
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [valueEl, setValueEl] = useState<HTMLInputElement | null>(null)
  const key = styleKeyOf(name)
  const bad = name.trim() !== '' && !key
  const commit = (): void => {
    const v = parseValue(value)
    if (key && v !== null) onAdd(key, v)
  }
  const keys = (next: () => void) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation()
    if (e.key === 'Enter') next()
    if (e.key === 'Escape') onCancel()
  }
  return (
    <div className="insp-otherrow">
      <div className={['c-field c-field--sm', bad && 'insp-invalid'].filter(Boolean).join(' ')}>
        <input
          className="c-field__input c-field__input--mono"
          placeholder="property"
          value={name}
          autoFocus
          spellCheck={false}
          title={bad ? 'Not a valid CSS property name' : undefined}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={keys(() => key && valueEl?.focus())}
        />
      </div>
      <div className="c-field c-field--sm">
        <input
          ref={setValueEl}
          className="c-field__input c-field__input--mono"
          placeholder="value"
          value={value}
          spellCheck={false}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={keys(commit)}
        />
      </div>
      <IconButton icon={<X size={14} />} label="Cancel" onClick={onCancel} />
    </div>
  )
}

export function OtherStylesSection({ ctx }: { ctx: Ctx }): JSX.Element {
  const [adding, setAdding] = useState(false)
  const keys = otherKeys(ctx.doc, ctx.nodes)
  const setKey = (key: string, v: string | number | null): void => ctx.set({ [key]: v } as StylePatch)
  if (!keys.length && !adding) return <Section title="Other styles" empty onAdd={() => setAdding(true)} addLabel="Add style" />
  return (
    <Section title="Other styles" onAdd={() => setAdding(true)} addLabel="Add style">
      {keys.map((k) => {
        const v = common(ctx.nodes, (n) => n.style[k])
        const name = toKebab(k)
        return (
          <div className="insp-otherrow" key={k}>
            <span className="insp-otherrow__name" title={name}>
              {name}
            </span>
            <Field
              type="text"
              mono
              size="sm"
              value={isMixed(v) ? null : v === undefined ? '' : cssValue(k, v)}
              placeholder="Mixed"
              title={isMixed(v) ? undefined : `${name}: ${v === undefined ? '' : cssValue(k, v)}`}
              onChange={(t) => setKey(k, parseValue(String(t)))}
            />
            <IconButton icon={<Minus size={14} />} label="Remove style" onClick={() => setKey(k, null)} />
          </div>
        )
      })}
      {adding && (
        <NewStyleRow
          onCancel={() => setAdding(false)}
          onAdd={(key, value) => {
            setKey(key, value)
            setAdding(false)
          }}
        />
      )}
    </Section>
  )
}
