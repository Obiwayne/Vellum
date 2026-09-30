import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronRight } from 'lucide-react'
import { Popover, type Anchor, type Placement } from './Popover'

export interface MenuItem {
  type?: 'item'
  label: string
  shortcut?: string
  icon?: ReactNode
  /** undefined = no check column for this item; true/false = checkable */
  checked?: boolean
  disabled?: boolean
  danger?: boolean
  onSelect?: () => void
  submenu?: MenuEntry[]
  /** don't close the menu after selecting (toggles) */
  keepOpen?: boolean
}
export type MenuEntry = MenuItem | { type: 'separator' } | { type: 'heading'; label: string }

export interface MenuProps {
  open: boolean
  onClose: () => void
  anchor: Anchor
  items: MenuEntry[]
  placement?: Placement
  offset?: number
  minWidth?: number
  ignore?: Array<HTMLElement | null>
}

const isItem = (e: MenuEntry): e is MenuItem => e.type === undefined || e.type === 'item'
const selectable = (e: MenuEntry): boolean => isItem(e) && !e.disabled

interface PanelProps {
  items: MenuEntry[]
  onDone: () => void
  onBack?: () => void
  minWidth?: number
  /** start with first item active (keyboard-opened submenu) */
  activateFirst?: boolean
}

function MenuPanel({ items, onDone, onBack, minWidth, activateFirst }: PanelProps): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef<Array<HTMLDivElement | null>>([])
  const [active, setActive] = useState<number>(() => (activateFirst ? items.findIndex(selectable) : -1))
  const [sub, setSub] = useState<{ index: number; viaKeyboard: boolean } | null>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasChecks = items.some((i) => isItem(i) && i.checked !== undefined)

  useEffect(() => {
    const t = setTimeout(() => ref.current?.focus({ preventScroll: true }), 0)
    return () => {
      clearTimeout(t)
      if (hoverTimer.current) clearTimeout(hoverTimer.current)
    }
  }, [])

  const choose = useCallback(
    (i: number) => {
      const it = items[i]
      if (!it || !isItem(it) || it.disabled) return
      if (it.submenu) {
        setSub({ index: i, viaKeyboard: false })
        return
      }
      it.onSelect?.()
      if (!it.keepOpen) onDone()
    },
    [items, onDone]
  )

  const move = (dir: 1 | -1): void => {
    if (!items.some(selectable)) return
    let i = active
    for (let n = 0; n < items.length; n++) {
      i = (i + dir + items.length) % items.length
      if (selectable(items[i])) break
    }
    setActive(i)
    itemRefs.current[i]?.scrollIntoView({ block: 'nearest' })
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (sub) return // the submenu handles keys
    switch (e.key) {
      case 'ArrowDown':
        move(1)
        break
      case 'ArrowUp':
        move(-1)
        break
      case 'ArrowRight': {
        const it = items[active]
        if (it && isItem(it) && it.submenu && !it.disabled) setSub({ index: active, viaKeyboard: true })
        break
      }
      case 'ArrowLeft':
        onBack?.()
        break
      case 'Enter':
      case ' ': {
        const it = items[active]
        if (it && isItem(it) && it.submenu) setSub({ index: active, viaKeyboard: true })
        else choose(active)
        break
      }
      case 'Home':
        setActive(items.findIndex(selectable))
        break
      case 'End': {
        const rev = [...items].reverse().findIndex(selectable)
        setActive(rev < 0 ? -1 : items.length - 1 - rev)
        break
      }
      default:
        return
    }
    e.preventDefault()
    e.stopPropagation()
  }

  const enter = (i: number): void => {
    setActive(i)
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    const it = items[i]
    const hasSub = isItem(it) && Boolean(it.submenu) && !it.disabled
    if (hasSub && sub?.index === i) return
    hoverTimer.current = setTimeout(() => setSub(hasSub ? { index: i, viaKeyboard: false } : null), hasSub ? 80 : 150)
  }

  const subItem = sub ? items[sub.index] : undefined
  return (
    <div
      ref={ref}
      className="c-menu"
      role="menu"
      tabIndex={-1}
      style={{ minWidth }}
      onKeyDown={onKeyDown}
      onPointerLeave={() => {
        if (!sub) setActive(-1)
      }}
    >
      {items.map((it, i) => {
        if (it.type === 'separator') return <div key={i} className="c-menu__sep" role="separator" />
        if (it.type === 'heading') return <div key={i} className="c-menu__heading">{it.label}</div>
        const cls = [
          'c-menu__item',
          (active === i || sub?.index === i) && !it.disabled && 'c-menu__item--active',
          it.disabled && 'c-menu__item--disabled',
          it.danger && 'c-menu__item--danger'
        ]
          .filter(Boolean)
          .join(' ')
        return (
          <div
            key={i}
            ref={(el) => {
              itemRefs.current[i] = el
            }}
            className={cls}
            role="menuitem"
            aria-disabled={it.disabled}
            onPointerEnter={() => enter(i)}
            onClick={() => choose(i)}
          >
            {hasChecks && <span className="c-menu__check">{it.checked ? <Check size={14} strokeWidth={2} /> : null}</span>}
            {it.icon && <span className="c-menu__icon">{it.icon}</span>}
            <span className="c-menu__label">{it.label}</span>
            {it.shortcut && <span className="c-menu__shortcut">{it.shortcut}</span>}
            {it.submenu && (
              <span className="c-menu__arrow">
                <ChevronRight size={14} />
              </span>
            )}
          </div>
        )
      })}
      {sub && subItem && isItem(subItem) && subItem.submenu && (
        <Popover
          open
          anchor={itemRefs.current[sub.index]}
          placement="right-start"
          offset={10}
          onClose={() => {
            setSub(null)
            ref.current?.focus({ preventScroll: true })
          }}
          style={{ marginTop: -6 }}
        >
          <MenuPanel
            items={subItem.submenu}
            onDone={onDone}
            activateFirst={sub.viaKeyboard}
            onBack={() => {
              setSub(null)
              ref.current?.focus({ preventScroll: true })
            }}
          />
        </Popover>
      )}
    </div>
  )
}

/** Dropdown menu anchored to an element (or rect/point). Items support submenus, shortcuts, checks. */
export function Menu({ open, onClose, anchor, items, placement = 'bottom-start', offset = 4, minWidth, ignore }: MenuProps): JSX.Element {
  return (
    <Popover open={open} onClose={onClose} anchor={anchor} placement={placement} offset={offset} ignore={ignore}>
      {open && <MenuPanel items={items} onDone={onClose} minWidth={minWidth} />}
    </Popover>
  )
}

export interface ContextMenuProps {
  /** screen position (clientX/clientY); null = closed */
  at: { x: number; y: number } | null
  items: MenuEntry[]
  onClose: () => void
  minWidth?: number
}

export function ContextMenu({ at, items, onClose, minWidth = 220 }: ContextMenuProps): JSX.Element {
  return <Menu open={Boolean(at)} anchor={at} items={items} onClose={onClose} placement="point" offset={0} minWidth={minWidth} />
}

/**
 * Convenience hook:
 *   const ctx = useContextMenu()
 *   <div onContextMenu={(e) => ctx.open(e, items)}>…</div>{ctx.element}
 */
export function useContextMenu(): {
  open: (e: React.MouseEvent | MouseEvent, items: MenuEntry[]) => void
  close: () => void
  element: JSX.Element
} {
  const [state, setState] = useState<{ at: { x: number; y: number }; items: MenuEntry[] } | null>(null)
  const open = useCallback((e: React.MouseEvent | MouseEvent, items: MenuEntry[]) => {
    e.preventDefault()
    e.stopPropagation()
    setState({ at: { x: e.clientX, y: e.clientY }, items })
  }, [])
  const close = useCallback(() => setState(null), [])
  const element = <ContextMenu at={state?.at ?? null} items={state?.items ?? []} onClose={close} />
  return { open, close, element }
}
