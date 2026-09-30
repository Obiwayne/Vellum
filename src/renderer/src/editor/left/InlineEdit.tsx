import { useEffect, useRef, useState, type CSSProperties } from 'react'

/** Auto-focused text input: Enter/blur commits, Esc cancels. Key events don't leak to global shortcuts. */
export function InlineEdit({
  value,
  onCommit,
  onCancel,
  className,
  style
}: {
  value: string
  onCommit: (v: string) => void
  onCancel: () => void
  className?: string
  style?: CSSProperties
}): JSX.Element {
  const [v, setV] = useState(value)
  const ref = useRef<HTMLInputElement | null>(null)
  const done = useRef(false)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  const commit = (): void => {
    if (done.current) return
    done.current = true
    const t = v.trim()
    if (t && t !== value) onCommit(t)
    else onCancel()
  }
  return (
    <input
      ref={ref}
      className={['lp-inline-edit', className].filter(Boolean).join(' ')}
      style={style}
      value={v}
      spellCheck={false}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') commit()
        else if (e.key === 'Escape') {
          done.current = true
          onCancel()
        }
      }}
    />
  )
}
