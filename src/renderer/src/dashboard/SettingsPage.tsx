import { useRef, useState } from 'react'
import { Button, Checkbox, ColorPickerPopover, Select } from '../ui'
import { getStore, useStore } from '../model/store'
import { Avatar } from '../profile/parts'
import { AUTO_LOCK_OPTIONS, refreshProfiles, useCurrentProfile } from '../profile/profile'
import { EditProfileModal } from '../profile/ProfileModals'

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
  const profile = useCurrentProfile()
  const [name, setName] = useState(String(prefs.userName ?? DEFAULT_USER_NAME))
  const [editOpen, setEditOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const swatchRef = useRef<HTMLButtonElement | null>(null)
  const pageColor = typeof prefs.defaultPageColor === 'string' ? prefs.defaultPageColor : '#282828'
  const bool = (k: string, def: boolean): boolean => (typeof prefs[k] === 'boolean' ? (prefs[k] as boolean) : def)

  return (
    <div className="db-settings">
      {profile && (
        <div className="db-settings__row">
          <div className="db-settings__who">
            <Avatar name={profile.name} avatar={profile.avatar} color={profile.color} size={32} />
            <div>
              <div className="db-settings__label">{profile.name}</div>
              <div className="db-settings__hint">
                {profile.hasPassword
                  ? 'Protected with a password. Files are encrypted on this PC.'
                  : 'No password. Files are stored as plain JSON.'}
              </div>
            </div>
          </div>
          <Button onClick={() => setEditOpen(true)}>Edit profile…</Button>
          <EditProfileModal open={editOpen} onClose={() => setEditOpen(false)} />
        </div>
      )}
      {profile?.hasPassword && (
        <div className="db-settings__row">
          <div>
            <div className="db-settings__label">Auto-lock after</div>
            <div className="db-settings__hint">Lock this profile when Vellum has been idle this long.</div>
          </div>
          <Select
            value={String(profile.autoLockMinutes ?? 0)}
            options={AUTO_LOCK_OPTIONS}
            style={{ width: 140 }}
            onChange={(v) => {
              void window.canvasApi?.profiles.update({ autoLockMinutes: Number(v) }).then(() => refreshProfiles())
            }}
          />
        </div>
      )}
      {!profile && (
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
      )}
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
