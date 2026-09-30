// Icon picker: search the bundled Lucide icon set and insert one as an editable SVG layer.
import { createElement, useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Modal, Segmented } from '../../ui'
import { insertSvgMarkup } from '../canvas/actions'
import './iconpicker.css'

type IconComp = ComponentType<{ size?: number; strokeWidth?: number; color?: string }>
type IconEntry = { name: string; label: string; words: string; C: IconComp }

let cache: IconEntry[] | null = null

/** The icon set is loaded when the picker first opens (it is large). */
async function loadIcons(): Promise<IconEntry[]> {
  if (cache) return cache
  const mod = await import('lucide-react')
  const list: IconEntry[] = []
  for (const [name, C] of Object.entries(mod.icons as Record<string, IconComp>)) {
    // "ArrowUpRight" → "arrow up right"
    const words = name
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
      .replace(/([A-Za-z])(\d)/g, '$1 $2')
      .toLowerCase()
    list.push({ name, label: words.replace(/ /g, '-'), words, C })
  }
  list.sort((a, b) => a.name.localeCompare(b.name))
  cache = list
  return list
}

const SIZES = ['16', '20', '24', '32', '48'] as const
const STROKES = ['1', '1.5', '2', '2.5'] as const
const MAX_SHOWN = 400

/** Static SVG markup for an icon, with the colour baked in (currentColor would follow the parent). */
function iconMarkup(e: IconEntry, size: number, stroke: number, color: string): string {
  const svg = renderToStaticMarkup(createElement(e.C, { size, strokeWidth: stroke, color }))
  return svg.replace(/^<svg/, `<svg data-name="${e.label}"`).replace(/\sclass="[^"]*"/, '')
}

export function IconPicker({ docId, open, onClose }: { docId: string; open: boolean; onClose: () => void }): JSX.Element {
  const [icons, setIcons] = useState<IconEntry[]>(cache ?? [])
  const [q, setQ] = useState('')
  const [size, setSize] = useState<(typeof SIZES)[number]>('24')
  const [stroke, setStroke] = useState<(typeof STROKES)[number]>('2')
  const [color, setColor] = useState('#111111')
  const search = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) return
    if (!cache) void loadIcons().then(setIcons)
    // the modal mounts in a portal after this effect: focus once it is in the DOM
    const t = setTimeout(() => search.current?.select(), 30)
    return () => clearTimeout(t)
  }, [open])

  const matches = useMemo(() => {
    const terms = q.toLowerCase().trim().split(/[\s-]+/).filter(Boolean)
    if (!terms.length) return icons
    const scored: Array<[number, IconEntry]> = []
    for (const e of icons) {
      const w = e.words.split(' ')
      if (!terms.every((t) => w.some((x) => x.startsWith(t)))) continue
      // exact first word and shorter names first
      scored.push([(w[0] === terms[0] ? 0 : 100) + w.length, e])
    }
    return scored.sort((a, b) => a[0] - b[0]).map((x) => x[1])
  }, [icons, q])

  const insert = (e: IconEntry, keepOpen: boolean): void => {
    if (insertSvgMarkup(docId, iconMarkup(e, Number(size), Number(stroke), color)) && !keepOpen) onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Icons" width={560} height={560}>
      <div className="ip">
        <div className="ip-bar">
          <input
            ref={search}
            autoFocus
            className="ip-search"
            placeholder={icons.length ? `Search ${icons.length} icons…` : 'Loading icons…'}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && matches[0]) insert(matches[0], e.shiftKey)
            }}
          />
          <label className="ip-color" title="Icon colour">
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
            <span style={{ background: color }} />
          </label>
        </div>
        <div className="ip-opts">
          <span>Size</span>
          <Segmented value={size} onChange={setSize} options={SIZES.map((s) => ({ value: s, label: s }))} />
          <span>Stroke</span>
          <Segmented value={stroke} onChange={setStroke} options={STROKES.map((s) => ({ value: s, label: s }))} />
        </div>
        <div className="ip-grid">
          {matches.slice(0, MAX_SHOWN).map((e) => (
            <button key={e.name} className="ip-cell" title={`${e.label} (Shift+click to keep the picker open)`} onClick={(ev) => insert(e, ev.shiftKey)}>
              <e.C size={22} strokeWidth={Number(stroke)} />
              <span>{e.label}</span>
            </button>
          ))}
          {icons.length > 0 && !matches.length && <div className="ip-empty">No icons match “{q}”.</div>}
        </div>
        <div className="ip-foot">
          {matches.length > MAX_SHOWN ? `Showing ${MAX_SHOWN} of ${matches.length}. Type to narrow down.` : `${matches.length} icon${matches.length === 1 ? '' : 's'}`} · Lucide (ISC
          licence) · Enter inserts the first match
        </div>
      </div>
    </Modal>
  )
}
