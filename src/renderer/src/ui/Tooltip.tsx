import { cloneElement, useEffect, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { formatShortcut } from './shortcut'

export type TooltipSide = 'right' | 'bottom' | 'top' | 'left'

export interface TooltipProps {
  label: string
  /** e.g. 'Ctrl+Shift+I' (rendered as "Ctrl + Shift + I") */
  shortcut?: string
  side?: TooltipSide
  /** ms before showing (default 600; instant while another tooltip was just visible) */
  delay?: number
  disabled?: boolean
  /** single element child; it must accept onPointerEnter/onPointerLeave/onPointerDown */
  children: ReactElement
}

let lastHiddenAt = 0
const WARM_MS = 400

export function Tooltip({ label, shortcut, side = 'bottom', delay = 600, disabled, children }: TooltipProps): JSX.Element {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const anchor = useRef<HTMLElement | null>(null)
  const tipRef = useRef<HTMLDivElement | null>(null)

  const clear = (): void => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  const hide = (): void => {
    clear()
    setPos((p) => {
      if (p) lastHiddenAt = Date.now()
      return null
    })
  }
  useEffect(() => () => clear(), [])

  const show = (): void => {
    const el = anchor.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const gap = 6
    if (side === 'right') setPos({ x: r.right + gap, y: r.top + r.height / 2 })
    else if (side === 'left') setPos({ x: r.left - gap, y: r.top + r.height / 2 })
    else if (side === 'top') setPos({ x: r.left + r.width / 2, y: r.top - gap })
    else setPos({ x: r.left + r.width / 2, y: r.bottom + gap })
  }

  // keep inside viewport
  useEffect(() => {
    const t = tipRef.current
    if (!pos || !t) return
    const r = t.getBoundingClientRect()
    let dx = 0
    if (r.right > window.innerWidth - 4) dx = window.innerWidth - 4 - r.right
    if (r.left < 4) dx = 4 - r.left
    if (dx) t.style.marginLeft = `${dx}px`
  }, [pos])

  const props = children.props as {
    onPointerEnter?: (e: React.PointerEvent<HTMLElement>) => void
    onPointerLeave?: (e: React.PointerEvent<HTMLElement>) => void
    onPointerDown?: (e: React.PointerEvent<HTMLElement>) => void
  }
  const child = cloneElement(children, {
    onPointerEnter: (e: React.PointerEvent<HTMLElement>) => {
      props.onPointerEnter?.(e)
      if (disabled) return
      anchor.current = e.currentTarget
      clear()
      const warm = Date.now() - lastHiddenAt < WARM_MS
      timer.current = setTimeout(show, warm ? 0 : delay)
    },
    onPointerLeave: (e: React.PointerEvent<HTMLElement>) => {
      props.onPointerLeave?.(e)
      hide()
    },
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      props.onPointerDown?.(e)
      hide()
    }
  } as Record<string, unknown>)

  const transform =
    side === 'right'
      ? 'translate(0, -50%)'
      : side === 'left'
        ? 'translate(-100%, -50%)'
        : side === 'top'
          ? 'translate(-50%, -100%)'
          : 'translate(-50%, 0)'

  return (
    <>
      {child}
      {pos &&
        !disabled &&
        createPortal(
          <div ref={tipRef} className="c-tooltip" style={{ left: pos.x, top: pos.y, transform }}>
            <span>{label}</span>
            {shortcut && <span className="c-tooltip__key">{formatShortcut(shortcut, true)}</span>}
          </div>,
          document.body
        )}
    </>
  )
}
