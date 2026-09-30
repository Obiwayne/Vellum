import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

/** 'Ctrl+Shift+I' → 'Ctrl + Shift + I' (tooltips / buttons) or unchanged (menus). */
export function formatShortcut(s: string | undefined, spaced = false): string {
  if (!s) return ''
  if (!spaced) return s
  return s
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean)
    .join(' + ')
}

/** Does a KeyboardEvent match a shortcut string like 'Ctrl+Shift+Z', 'Shift+A', 'F', ']' ? */
export function matchShortcut(e: KeyboardEvent | ReactKeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.split('+').map((p) => p.trim().toLowerCase())
  const key = parts.pop() ?? ''
  const want = {
    ctrl: parts.includes('ctrl') || parts.includes('cmd') || parts.includes('mod'),
    shift: parts.includes('shift'),
    alt: parts.includes('alt')
  }
  if ((e.ctrlKey || e.metaKey) !== want.ctrl || e.shiftKey !== want.shift || e.altKey !== want.alt) return false
  const k = e.key.toLowerCase()
  if (key === 'tab') return k === 'tab'
  if (key === 'space') return k === ' '
  if (key === 'esc' || key === 'escape') return k === 'escape'
  if (key === 'enter') return k === 'enter'
  if (/^[a-z]$/.test(key)) return e.code === `Key${key.toUpperCase()}` || k === key
  if (/^[0-9]$/.test(key)) return e.code === `Digit${key}` || k === key
  return k === key
}
