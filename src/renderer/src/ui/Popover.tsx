import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { isEyedropperActive } from './eyedropper'

export type Placement =
  | 'bottom-start'
  | 'bottom-end'
  | 'bottom'
  | 'top-start'
  | 'top-end'
  | 'right-start'
  | 'left-start'
  | 'point'

/** Something to anchor to: an element, a rect, or a point (context menus). */
export type Anchor = HTMLElement | DOMRect | { x: number; y: number } | null

export interface PopoverProps {
  open: boolean
  onClose: () => void
  anchor: Anchor
  placement?: Placement
  offset?: number
  className?: string
  style?: CSSProperties
  children: ReactNode
  /** close when pointer goes down outside (default true) */
  closeOnOutside?: boolean
  /** elements that don't count as "outside" (e.g. the trigger button) */
  ignore?: Array<HTMLElement | null>
  /** autofocus the popover container (default false) */
  autoFocus?: boolean
}

function anchorRect(a: Anchor): DOMRect | null {
  if (!a) return null
  if (a instanceof HTMLElement) return a.getBoundingClientRect()
  if (a instanceof DOMRect) return a
  return new DOMRect(a.x, a.y, 0, 0)
}

/** Compute a fixed position for a box of size (w,h) near rect r, flipped/clamped into the viewport. */
export function placeBox(r: DOMRect, w: number, h: number, placement: Placement, offset: number): { left: number; top: number } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  let left = r.left
  let top = r.bottom + offset
  switch (placement) {
    case 'bottom-end':
      left = r.right - w
      break
    case 'bottom':
      left = r.left + r.width / 2 - w / 2
      break
    case 'top-start':
      top = r.top - offset - h
      break
    case 'top-end':
      left = r.right - w
      top = r.top - offset - h
      break
    case 'right-start':
      left = r.right + offset
      top = r.top
      break
    case 'left-start':
      left = r.left - offset - w
      top = r.top
      break
    case 'point':
      left = r.left
      top = r.top
      break
  }
  // flip vertically
  if (top + h > vh - 4 && (placement.startsWith('bottom') || placement === 'point')) {
    const flipped = placement === 'point' ? r.top - h : r.top - offset - h
    top = flipped >= 4 ? flipped : Math.max(4, vh - 4 - h)
  }
  if (top < 4) top = placement.startsWith('top') ? r.bottom + offset : 4
  if (top + h > vh - 4) top = Math.max(4, vh - 4 - h)
  // flip horizontally
  if (left + w > vw - 4) {
    if (placement === 'right-start') left = r.left - offset - w
    else if (placement === 'point') left = r.left - w
    else left = vw - 4 - w
  }
  if (left < 4) left = placement === 'left-start' ? r.right + offset : 4
  return { left: Math.round(left), top: Math.round(top) }
}

let popoverSeq = 0
const stack: number[] = []

/** True while any Popover/Menu is open (global shortcuts should usually ignore keys then). */
export const isPopoverOpen = (): boolean => stack.length > 0

/** Anchored floating panel (portal). Click outside / Esc closes. */
export function Popover({
  open,
  onClose,
  anchor,
  placement = 'bottom-start',
  offset = 4,
  className,
  style,
  children,
  closeOnOutside = true,
  ignore,
  autoFocus
}: PopoverProps): JSX.Element | null {
  const ref = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const el = ref.current
    const r = anchorRect(anchor)
    if (!el || !r) return
    setPos(placeBox(r, el.offsetWidth, el.offsetHeight, placement, offset))
    if (autoFocus) el.focus()
  }, [open, anchor, placement, offset])

  const order = useRef(0)
  if (open && !order.current) order.current = ++popoverSeq
  if (!open) order.current = 0
  useEffect(() => {
    if (!open) return
    stack.push(order.current)
    const mine = order.current
    const down = (e: PointerEvent): void => {
      if (!closeOnOutside || isEyedropperActive()) return
      const t = e.target as Node
      if (ref.current?.contains(t)) return
      if (anchor instanceof HTMLElement && anchor.contains(t)) return
      if (ignore?.some((i) => i?.contains(t))) return
      // clicks inside popovers opened after this one (nested menus/pickers) don't close it
      const other = (t as Element).closest?.('.c-popover') as HTMLElement | null
      if (other && Number(other.dataset.order ?? 0) > mine) return
      onCloseRef.current()
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && stack[stack.length - 1] === mine && !isEyedropperActive()) {
        e.stopPropagation()
        e.preventDefault()
        onCloseRef.current()
      }
    }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key, true)
      const i = stack.indexOf(mine)
      if (i >= 0) stack.splice(i, 1)
    }
  }, [open, anchor, closeOnOutside, ignore])

  if (!open) return null
  return createPortal(
    <div
      ref={ref}
      tabIndex={-1}
      data-order={order.current}
      className={['c-popover', className].filter(Boolean).join(' ')}
      style={{ ...style, left: pos?.left ?? -9999, top: pos?.top ?? -9999, visibility: pos ? 'visible' : 'hidden' }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </div>,
    document.body
  )
}
