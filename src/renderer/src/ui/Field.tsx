import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

export interface FieldProps {
  /** leading label: short text ("X", "W") or an icon. Dragging it scrubs numeric values. */
  label?: ReactNode
  value: number | string | null | undefined
  /** commit (Enter, blur, arrow keys, end of scrub) */
  onChange: (value: number | string) => void
  /** live updates while scrubbing (defaults to onChange) */
  onScrub?: (value: number) => void
  onScrubStart?: () => void
  onScrubEnd?: () => void
  /** 'number' (default when value is a number) parses input; 'text' passes strings through */
  type?: 'number' | 'text'
  /** suffix shown after numbers, e.g. '%', '°' */
  unit?: string
  min?: number
  max?: number
  /** scrub/arrow step (default 1) */
  step?: number
  /** decimals shown (default 2, trailing zeros trimmed) */
  precision?: number
  /** shown when value is null/undefined (e.g. "Mixed", "Auto") */
  placeholder?: string
  /** numeric input also accepts these words as-is (e.g. ['Fit', 'Fill', 'Auto']) */
  keywords?: string[]
  mono?: boolean
  size?: 'sm' | 'md'
  disabled?: boolean
  trailing?: ReactNode
  className?: string
  style?: CSSProperties
  inputStyle?: CSSProperties
  title?: string
  selectOnFocus?: boolean
}

const clampN = (v: number, min?: number, max?: number): number =>
  Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v))

function fmt(v: number | string | null | undefined, unit: string | undefined, precision: number): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  const s = Number.isInteger(v) ? String(v) : String(parseFloat(v.toFixed(precision)))
  return unit ? `${s}${unit}` : s
}

/** Evaluate "10", "10px", "10%", "5+3*2" (simple arithmetic, no eval). */
export function parseNumberExpr(input: string): number | null {
  const s = input.replace(/px|%|°/g, '').replace(/\s+/g, '')
  if (!s) return null
  if (!/^[-+*/().\d]+$/.test(s)) return null
  let i = 0
  const peek = (): string => s[i]
  const num = (): number => {
    if (peek() === '(') {
      i++
      const v = expr()
      if (peek() === ')') i++
      return v
    }
    if (peek() === '-') {
      i++
      return -num()
    }
    if (peek() === '+') {
      i++
      return num()
    }
    const m = /^\d*\.?\d+/.exec(s.slice(i))
    if (!m) throw new Error('bad')
    i += m[0].length
    return parseFloat(m[0])
  }
  const term = (): number => {
    let v = num()
    while (peek() === '*' || peek() === '/') {
      const op = s[i++]
      const r = num()
      v = op === '*' ? v * r : v / r
    }
    return v
  }
  const expr = (): number => {
    let v = term()
    while (peek() === '+' || peek() === '-') {
      const op = s[i++]
      const r = term()
      v = op === '+' ? v + r : v - r
    }
    return v
  }
  try {
    const v = expr()
    return i === s.length && Number.isFinite(v) ? v : null
  } catch {
    return null
  }
}

/** Inspector input: optional scrub label, numeric parsing, ↑/↓ ±1 (Shift ±10), Enter commits, Esc reverts. */
export function Field({
  label,
  value,
  onChange,
  onScrub,
  onScrubStart,
  onScrubEnd,
  type,
  unit,
  min,
  max,
  step = 1,
  precision = 2,
  placeholder,
  keywords,
  mono,
  size = 'md',
  disabled,
  trailing,
  className,
  style,
  inputStyle,
  title,
  selectOnFocus = true
}: FieldProps): JSX.Element {
  const numeric = type ? type === 'number' : typeof value === 'number' || value === null || value === undefined
  const display = fmt(value, unit, precision)
  const [draft, setDraft] = useState(display)
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const skipBlurCommit = useRef(false)

  useEffect(() => {
    if (!focused) setDraft(display)
  }, [display, focused])

  const current = (): number => (typeof value === 'number' ? value : parseNumberExpr(String(value ?? '')) ?? 0)

  const commit = (text: string): void => {
    if (!numeric) {
      if (text !== (value ?? '')) onChange(text)
      return
    }
    const kw = keywords?.find((k) => k.toLowerCase() === text.trim().toLowerCase())
    if (kw) {
      if (kw !== value) onChange(kw)
      return
    }
    const n = parseNumberExpr(text)
    if (n === null) {
      setDraft(display)
      return
    }
    const v = clampN(n, min, max)
    if (v !== value) onChange(v)
    else setDraft(display)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    e.stopPropagation() // keep canvas shortcuts from firing while typing
    if (e.key === 'Enter') {
      commit(draft)
      inputRef.current?.select()
    } else if (e.key === 'Escape') {
      setDraft(display)
      skipBlurCommit.current = true
      inputRef.current?.blur()
    } else if (numeric && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      const base = parseNumberExpr(draft) ?? current()
      const d = (e.shiftKey ? 10 : 1) * step * (e.key === 'ArrowUp' ? 1 : -1)
      const v = clampN(Math.round((base + d) * 1e6) / 1e6, min, max)
      setDraft(fmt(v, unit, precision))
      onChange(v)
      requestAnimationFrame(() => inputRef.current?.select())
    }
  }

  // --- scrub on label
  const scrub = useRef<{ startX: number; start: number; last: number; moved: boolean } | null>(null)
  const onLabelDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!numeric || disabled || e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    scrub.current = { startX: e.clientX, start: current(), last: current(), moved: false }
  }
  const onLabelMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const s = scrub.current
    if (!s) return
    const dx = e.clientX - s.startX
    if (!s.moved && Math.abs(dx) < 2) return
    if (!s.moved) {
      s.moved = true
      onScrubStart?.()
      document.body.style.cursor = 'ew-resize'
    }
    const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1
    const v = clampN(Math.round((s.start + dx * step * mult) * 100) / 100, min, max)
    if (v === s.last) return
    s.last = v
    setDraft(fmt(v, unit, precision))
    ;(onScrub ?? onChange)(v)
  }
  const onLabelUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    const s = scrub.current
    scrub.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    if (!s) return
    if (s.moved) {
      document.body.style.cursor = ''
      if (onScrub) onChange(s.last)
      onScrubEnd?.()
    } else {
      inputRef.current?.focus()
    }
  }

  const cls = ['c-field', size === 'sm' && 'c-field--sm', disabled && 'c-field--disabled', className]
    .filter(Boolean)
    .join(' ')
  return (
    <div className={cls} style={style} title={title}>
      {label !== undefined && (
        <div
          className={['c-field__label', numeric && 'c-field__label--scrub'].filter(Boolean).join(' ')}
          onPointerDown={onLabelDown}
          onPointerMove={onLabelMove}
          onPointerUp={onLabelUp}
          onPointerCancel={onLabelUp}
        >
          {label}
        </div>
      )}
      <input
        ref={inputRef}
        className={['c-field__input', mono && 'c-field__input--mono'].filter(Boolean).join(' ')}
        style={inputStyle}
        value={draft}
        placeholder={placeholder}
        disabled={disabled}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => {
          setFocused(true)
          if (selectOnFocus) e.target.select()
        }}
        onBlur={() => {
          setFocused(false)
          if (skipBlurCommit.current) skipBlurCommit.current = false
          else commit(draft)
        }}
        onKeyDown={onKeyDown}
      />
      {trailing && <div className="c-field__trailing">{trailing}</div>}
    </div>
  )
}
