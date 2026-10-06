import { useEffect, useRef, useState, type ReactNode } from 'react'
import { LayoutGrid, Menu as MenuIcon, Pipette, X } from 'lucide-react'
import { IconButton } from './Button'
import { Popover, type Anchor } from './Popover'
import {
  cssRgba,
  formatColor,
  hslToRgb,
  hsvToRgb,
  parseColor,
  rgbToHsl,
  rgbToHsv,
  toHex6,
  tokenRef,
  type HSV,
  type RGBA
} from './color'

export { pickScreenColor } from './eyedropper'
import { pickScreenColor } from './eyedropper'

// ------------------------------------------------------------------------------------------------
// Swatch

export function Swatch({ color, size = 14, onClick }: { color: string; size?: number; onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void }): JSX.Element {
  return (
    <button type="button" className="c-swatch" style={{ width: size, height: size }} onClick={onClick} tabIndex={-1}>
      <span style={{ background: color }} />
    </button>
  )
}

// ------------------------------------------------------------------------------------------------
// drag helper

function useDrag(onPos: (x: number, y: number) => void, onEnd?: () => void): {
  ref: React.MutableRefObject<HTMLDivElement | null>
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void
  onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void
} {
  const ref = useRef<HTMLDivElement | null>(null)
  const active = useRef(false)
  const emit = (e: React.PointerEvent): void => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    onPos(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)))
  }
  return {
    ref,
    onPointerDown: (e) => {
      if (e.button !== 0) return
      e.currentTarget.setPointerCapture(e.pointerId)
      active.current = true
      emit(e)
    },
    onPointerMove: (e) => {
      if (active.current) emit(e)
    },
    onPointerUp: () => {
      if (!active.current) return
      active.current = false
      onEnd?.()
    }
  }
}

// ------------------------------------------------------------------------------------------------
// numeric triple row

function NumRow({ values, labels, max, onChange }: { values: number[]; labels: string[]; max: number[]; onChange: (v: number[]) => void }): JSX.Element {
  return (
    <div>
      <div className="c-picker__numrow">
        {values.map((v, i) => (
          <NumCell key={i} value={Math.round(v)} max={max[i]} onCommit={(n) => onChange(values.map((x, j) => (j === i ? n : x)))} />
        ))}
      </div>
      <div className="c-picker__numlabels">
        {labels.map((l) => (
          <span key={l}>{l}</span>
        ))}
      </div>
    </div>
  )
}

function NumCell({ value, max, onCommit }: { value: number; max: number; onCommit: (n: number) => void }): JSX.Element {
  const [draft, setDraft] = useState(String(value))
  const [focus, setFocus] = useState(false)
  useEffect(() => {
    if (!focus) setDraft(String(value))
  }, [value, focus])
  const commit = (): void => {
    const n = parseFloat(draft)
    if (Number.isFinite(n)) onCommit(Math.min(max, Math.max(0, n)))
    else setDraft(String(value))
  }
  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => {
        setFocus(true)
        e.target.select()
      }}
      onBlur={() => {
        setFocus(false)
        commit()
      }}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') commit()
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault()
          const n = Math.min(max, Math.max(0, value + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1)))
          onCommit(n)
        }
      }}
    />
  )
}

// ------------------------------------------------------------------------------------------------
// ColorPicker

export interface ColorPickerProps {
  /** any CSS colour */
  value: string
  /** called continuously while dragging (live=true) and on discrete edits (live=false) */
  onChange: (color: string, opts: { live: boolean }) => void
  /** colour when the picker opened (left half of the Previous/New preview) */
  previous?: string
  onClose?: () => void
}

/** sRGB colour picker panel: SV square, alpha + hue strips, Previous/New, HSL/RGB rows, hex + alpha. */
export function ColorPicker({ value, onChange, previous, onClose }: ColorPickerProps): JSX.Element {
  const initial = parseColor(value) ?? { r: 0, g: 0, b: 0, a: 1 }
  const [hsv, setHsv] = useState<HSV>(() => rgbToHsv(initial))
  const [alpha, setAlpha] = useState(initial.a)
  const lastEmitted = useRef<string>(formatColor(initial))
  const prevColor = useRef(previous ?? value)

  // external value changes (undo, other edits) resync unless they are our own echo
  useEffect(() => {
    const c = parseColor(value)
    if (!c) return
    const f = formatColor(c)
    if (f === lastEmitted.current) return
    lastEmitted.current = f
    const next = rgbToHsv(c)
    setHsv((h) => ({ h: next.s === 0 || next.v === 0 ? h.h : next.h, s: next.s, v: next.v }))
    setAlpha(c.a)
  }, [value])

  const rgba: RGBA = hsvToRgb(hsv, alpha)
  const emit = (h: HSV, a: number, live: boolean): void => {
    setHsv(h)
    setAlpha(a)
    const f = formatColor(hsvToRgb(h, a))
    lastEmitted.current = f
    onChange(f, { live })
  }
  const setRgba = (c: RGBA, live = false): void => {
    const n = rgbToHsv(c)
    emit({ h: n.s === 0 ? hsv.h : n.h, s: n.s, v: n.v }, c.a, live)
  }
  const end = (): void => onChange(lastEmitted.current, { live: false })

  const sv = useDrag((x, y) => emit({ h: hsv.h, s: x * 100, v: (1 - y) * 100 }, alpha, true), end)
  const hue = useDrag((_x, y) => emit({ ...hsv, h: y * 360 }, alpha, true), end)
  const alp = useDrag((_x, y) => emit(hsv, Math.round((1 - y) * 100) / 100, true), end)

  const hueColor = cssRgba(hsvToRgb({ h: hsv.h, s: 100, v: 100 }))
  const opaque = cssRgba({ ...rgba, a: 1 })
  const hsl = rgbToHsl(rgba)

  const [hexDraft, setHexDraft] = useState<string | null>(null)
  const hexText = `${toHex6(rgba)} / ${Math.round(alpha * 100)}%`
  const commitHex = (text: string): void => {
    setHexDraft(null)
    const [h, a] = text.split('/').map((s) => s.trim())
    const c = parseColor(h.startsWith('#') ? h : `#${h}`) ?? parseColor(h)
    if (!c) return
    const pa = a !== undefined ? parseFloat(a) : NaN
    setRgba({ ...c, a: Number.isFinite(pa) ? Math.min(1, Math.max(0, pa / 100)) : c.a < 1 ? c.a : alpha })
  }

  return (
    <div className="c-picker">
      <div className="c-picker__tabs">
        <button type="button" className="c-picker__tab c-picker__tab--active">
          sRGB
        </button>
        <button type="button" className="c-picker__tab" disabled title="Display P3 is not supported yet">
          Display P3
        </button>
        <div style={{ flex: 1 }} />
        <IconButton
          icon={<Pipette size={14} />}
          label="Pick colour"
          onClick={async () => {
            const c = await pickScreenColor()
            const p = c && parseColor(c)
            if (p) setRgba({ ...p, a: alpha })
          }}
        />
        <IconButton icon={<MenuIcon size={14} />} label="Options" disabled />
        {onClose && <IconButton icon={<X size={14} />} label="Close" onClick={onClose} />}
      </div>
      <div className="c-picker__main">
        <div
          ref={sv.ref}
          className="c-picker__sv"
          style={{
            background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueColor})`
          }}
          onPointerDown={sv.onPointerDown}
          onPointerMove={sv.onPointerMove}
          onPointerUp={sv.onPointerUp}
        >
          <div className="c-picker__handle" style={{ left: `${hsv.s}%`, top: `${100 - hsv.v}%`, background: opaque }} />
        </div>
        <div
          ref={alp.ref}
          className="c-picker__strip"
          style={{
            background: `linear-gradient(to bottom, ${opaque}, transparent), conic-gradient(#ccc 25%, #fff 0 50%, #ccc 0 75%, #fff 0) 0 0 / 8px 8px`
          }}
          onPointerDown={alp.onPointerDown}
          onPointerMove={alp.onPointerMove}
          onPointerUp={alp.onPointerUp}
        >
          <div className="c-picker__bar" style={{ top: `${(1 - alpha) * 100}%` }} />
        </div>
        <div
          ref={hue.ref}
          className="c-picker__strip"
          style={{ background: 'linear-gradient(to bottom, #f00, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00)' }}
          onPointerDown={hue.onPointerDown}
          onPointerMove={hue.onPointerMove}
          onPointerUp={hue.onPointerUp}
        >
          <div className="c-picker__bar" style={{ top: `${(hsv.h / 360) * 100}%` }} />
        </div>
        <div className="c-picker__side">
          <div className="c-picker__compare">
            <button
              type="button"
              style={{ background: prevColor.current }}
              title="Restore previous"
              onClick={() => {
                const p = parseColor(prevColor.current)
                if (p) setRgba(p)
              }}
            />
            <button type="button" style={{ background: cssRgba(rgba) }} />
          </div>
          <div className="c-picker__compare-labels">
            <span>Previous</span>
            <span>New</span>
          </div>
          <div className="c-picker__nums">
            <NumRow
              values={[hsl.h, hsl.s, hsl.l]}
              labels={['H', 'S', 'L']}
              max={[360, 100, 100]}
              onChange={([h, s, l]) => setRgba(hslToRgb({ h, s, l }, alpha))}
            />
            <NumRow
              values={[rgba.r, rgba.g, rgba.b]}
              labels={['R', 'G', 'B']}
              max={[255, 255, 255]}
              onChange={([r, g, b]) => setRgba({ r, g, b, a: alpha })}
            />
          </div>
          <div className="c-field" style={{ marginTop: 'auto' }}>
            <input
              className="c-field__input"
              style={{ textAlign: 'center' }}
              value={hexDraft ?? hexText}
              spellCheck={false}
              onFocus={(e) => e.target.select()}
              onChange={(e) => setHexDraft(e.target.value)}
              onBlur={() => hexDraft !== null && commitHex(hexDraft)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter' && hexDraft !== null) commitHex(hexDraft)
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

/** ColorPicker inside a Popover. */
export function ColorPickerPopover({
  open,
  anchor,
  onClose,
  ...picker
}: ColorPickerProps & { open: boolean; anchor: Anchor; onClose: () => void }): JSX.Element {
  return (
    <Popover open={open} anchor={anchor} onClose={onClose} placement="left-start" offset={12}>
      {open && <ColorPicker {...picker} onClose={onClose} />}
    </Popover>
  )
}

// ------------------------------------------------------------------------------------------------
// ColorRow

export interface ColorRowProps {
  /** CSS colour or 'var(--token)' */
  value: string
  onChange: (color: string, opts: { live: boolean }) => void
  /** token button click (token picker is provided by the caller) */
  onTokenClick?: (anchor: HTMLElement) => void
  showToken?: boolean
  showEyedropper?: boolean
  /** resolve var(--x) for the swatch (e.g. from doc tokens) */
  resolveToken?: (name: string) => string | undefined
  /** extra trailing content (e.g. a remove '−' button) */
  trailing?: ReactNode
}

/** Inspector colour row: [swatch HEX 100%] [token] [eyedropper]. Swatch opens the picker. */
export function ColorRow({ value, onChange, onTokenClick, showToken = true, showEyedropper = true, resolveToken, trailing }: ColorRowProps): JSX.Element {
  const rowRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [previous, setPrevious] = useState(value)
  const token = tokenRef(value)
  const resolved = token ? resolveToken?.(token) ?? '' : value
  const c = parseColor(resolved)
  const [hexDraft, setHexDraft] = useState<string | null>(null)
  const [alphaDraft, setAlphaDraft] = useState<string | null>(null)
  const hex = c ? toHex6(c) : ''
  const pct = c ? `${Math.round(c.a * 100)}%` : ''

  const commitHex = (text: string): void => {
    setHexDraft(null)
    const typed = text.trim()
    // a token reference or an oklch()/oklab() literal is written as typed (converting it to hex would change the value)
    const ref = tokenRef(typed)
    if (ref && resolveToken && parseColor(resolveToken(ref) ?? '')) return onChange(typed, { live: false })
    if (/^okl(?:ch|ab)\(/i.test(typed) && parseColor(typed)) return onChange(typed, { live: false })
    const p = parseColor(text.startsWith('#') ? text : `#${text}`) ?? parseColor(text)
    if (p) onChange(formatColor({ ...p, a: p.a < 1 ? p.a : c?.a ?? 1 }), { live: false })
  }
  const commitAlpha = (text: string): void => {
    setAlphaDraft(null)
    const n = parseFloat(text)
    if (!c || !Number.isFinite(n)) return
    onChange(formatColor({ ...c, a: Math.min(100, Math.max(0, n)) / 100 }), { live: false })
  }
  const key = (commit: (t: string) => void, draft: string | null) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation()
    if (e.key === 'Enter' && draft !== null) commit(draft)
    if (e.key === 'Escape') (e.target as HTMLInputElement).blur()
  }

  return (
    <div className="c-colorrow" ref={rowRef}>
      <div className="c-colorrow__field">
        <Swatch
          color={resolved || 'transparent'}
          onClick={() => {
            setPrevious(resolved || value)
            setOpen((o) => !o)
          }}
        />
        {token ? (
          <span className="c-colorrow__token" title={token}>
            {token.replace(/^--(color-)?/, '')}
          </span>
        ) : (
          <>
            <input
              className="c-colorrow__hex"
              value={hexDraft ?? hex}
              spellCheck={false}
              onFocus={(e) => e.target.select()}
              onChange={(e) => setHexDraft(e.target.value)}
              onBlur={() => hexDraft !== null && commitHex(hexDraft)}
              onKeyDown={key(commitHex, hexDraft)}
            />
            <input
              className="c-colorrow__alpha"
              value={alphaDraft ?? pct}
              spellCheck={false}
              onFocus={(e) => e.target.select()}
              onChange={(e) => setAlphaDraft(e.target.value)}
              onBlur={() => alphaDraft !== null && commitAlpha(alphaDraft)}
              onKeyDown={key(commitAlpha, alphaDraft)}
            />
          </>
        )}
      </div>
      {showToken && (
        <IconButton
          icon={<LayoutGrid size={14} />}
          label="Tokens"
          onClick={(e) => onTokenClick?.(e.currentTarget)}
          disabled={!onTokenClick}
        />
      )}
      {showEyedropper && (
        <IconButton
          icon={<Pipette size={14} />}
          label="Pick colour"
          onClick={async () => {
            const picked = await pickScreenColor()
            if (picked) onChange(picked, { live: false })
          }}
        />
      )}
      {trailing}
      <ColorPickerPopover
        open={open}
        anchor={rowRef.current}
        onClose={() => setOpen(false)}
        value={resolved || '#000000'}
        previous={previous}
        onChange={onChange}
      />
    </div>
  )
}
