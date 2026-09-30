import { useRef, useState } from 'react'
import { Checkbox, ColorPickerPopover } from '../ui'
import { getStore, useStore } from '../model/store'

export const DEFAULT_USER_NAME = 'You'

/** Pref keys owned by the dashboard/left panel (other panels may read them). */
export const PREF = {
  userName: 'userName',
  defaultPageColor: 'defaultPageColor',
  scrollWheelZooms: 'scrollWheelZooms',
  snapToPixel: 'snapToPixel',
  showPixelGrid: 'showPixelGrid',
  dashboardView: 'dashboardView',
  agentsCardDismissed: 'agentsCardDismissed'
} as const

export function SettingsPage(): JSX.Element {
  const prefs = useStore((s) => s.prefs)
  const setPref = (k: string, v: unknown): void => getStore().setPref(k, v)
  const [name, setName] = useState(String(prefs.userName ?? DEFAULT_USER_NAME))
  const [pickerOpen, setPickerOpen] = useState(false)
  const swatchRef = useRef<HTMLButtonElement | null>(null)
  const pageColor = typeof prefs.defaultPageColor === 'string' ? prefs.defaultPageColor : '#282828'
  const bool = (k: string, def: boolean): boolean => (typeof prefs[k] === 'boolean' ? (prefs[k] as boolean) : def)

  return (
    <div className="db-settings">
      <div className="db-settings__row">
        <div>
          <div className="db-settings__label">Your name</div>
          <div className="db-settings__hint">Shown in the sidebar and on your files.</div>
        </div>
        <input
          className="db-input"
          value={name}
          spellCheck={false}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => setPref(PREF.userName, name.trim() || DEFAULT_USER_NAME)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
        />
      </div>
      <div className="db-settings__row">
        <div>
          <div className="db-settings__label">Default page color</div>
          <div className="db-settings__hint">Canvas color for new files and pages.</div>
        </div>
        <button type="button" ref={swatchRef} className="db-color" onClick={() => setPickerOpen(true)}>
          <span className="db-color__sw" style={{ background: pageColor }} />
          <span className="db-mono">{pageColor.replace('#', '').toUpperCase()}</span>
        </button>
        <ColorPickerPopover
          open={pickerOpen}
          anchor={swatchRef.current}
          onClose={() => setPickerOpen(false)}
          value={pageColor}
          previous={pageColor}
          onChange={(c) => setPref(PREF.defaultPageColor, c)}
        />
      </div>
      <div className="db-settings__row">
        <div>
          <div className="db-settings__label">Scroll wheel zooms</div>
          <div className="db-settings__hint">Mouse wheel zooms the canvas instead of panning.</div>
        </div>
        <Checkbox checked={bool(PREF.scrollWheelZooms, false)} onChange={(v) => setPref(PREF.scrollWheelZooms, v)} />
      </div>
      <div className="db-settings__row">
        <div>
          <div className="db-settings__label">Snap to pixel</div>
          <div className="db-settings__hint">Round positions and sizes to whole pixels while dragging.</div>
        </div>
        <Checkbox checked={bool(PREF.snapToPixel, true)} onChange={(v) => setPref(PREF.snapToPixel, v)} />
      </div>
      <div className="db-settings__row">
        <div>
          <div className="db-settings__label">Show pixel grid</div>
          <div className="db-settings__hint">Show a pixel grid when zoomed in far.</div>
        </div>
        <Checkbox checked={bool(PREF.showPixelGrid, true)} onChange={(v) => setPref(PREF.showPixelGrid, v)} />
      </div>
    </div>
  )
}
