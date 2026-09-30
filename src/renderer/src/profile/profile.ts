// Renderer side of local profiles: which profile is open, the startup gate, lock / switch and the
// idle auto-lock. All key handling happens in the main process (src/main/vault.ts); the renderer
// only ever sees names, pictures and whether a profile has a password.
import { create } from 'zustand'
import type { ProfileInfo, ProfilesState } from '@shared/api'
import { flushAndStop, initPersistence } from '../model/persist'

interface ProfileStore {
  /** null until the first state() call returns */
  state: ProfilesState | null
  /** true once the open profile's files are loaded and the dashboard may show */
  entered: boolean
}

export const useProfiles = create<ProfileStore>(() => ({ state: null, entered: false }))

const api = (): Window['canvasApi'] | undefined => (typeof window !== 'undefined' ? window.canvasApi : undefined)

export async function refreshProfiles(): Promise<ProfilesState | null> {
  const a = api()
  if (!a) return null
  const state = await a.profiles.state()
  useProfiles.setState({ state })
  return state
}

export function currentProfile(): ProfileInfo | null {
  const st = useProfiles.getState().state
  return st?.profiles.find((p) => p.id === st.currentId) ?? null
}

/** The open profile (re-renders when it changes). */
export function useCurrentProfile(): ProfileInfo | null {
  return useProfiles((s) => s.state?.profiles.find((p) => p.id === s.state?.currentId) ?? null)
}

/** Load the open profile's files and show the app. */
export async function enterProfile(): Promise<void> {
  await refreshProfiles()
  await initPersistence()
  useProfiles.setState({ entered: true })
  installAutoLock()
}

/**
 * Startup: reuse a profile that is already open (renderer reload), open a lone unprotected
 * profile directly, otherwise leave the picker up. Without the Electron API (plain browser) the
 * app runs in memory as before.
 */
export async function startProfiles(): Promise<void> {
  const a = api()
  if (!a) {
    await initPersistence()
    useProfiles.setState({ entered: true })
    return
  }
  const st = await refreshProfiles()
  if (!st) return
  if (st.currentId) return enterProfile()
  if (st.autoOpen && st.profiles.length === 1 && !st.profiles[0].hasPassword) {
    const r = await a.profiles.open(st.profiles[0].id)
    if (r.ok) return enterProfile()
  }
}

/** Lock the open profile and return to the picker. Reloading drops every design from memory. */
export async function lockAndReload(): Promise<void> {
  const a = api()
  if (!a) return
  await flushAndStop()
  await a.profiles.lock()
  window.location.reload()
}

/** After deleting the open profile: stop writing and go back to the picker. */
export async function leaveAfterDelete(): Promise<void> {
  await flushAndStop()
  window.location.reload()
}

// ------------------------------------------------------------------------------------------------
// idle auto-lock (protected profiles only)

let lastActivity = Date.now()
/** Count as activity (user input, or an agent working through the MCP bridge). */
export function markActivity(): void {
  lastActivity = Date.now()
}

let autoLockInstalled = false
function installAutoLock(): void {
  if (autoLockInstalled) return
  autoLockInstalled = true
  for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel'] as const) {
    window.addEventListener(ev, markActivity, { passive: true, capture: true })
  }
  lastActivity = Date.now()
  setInterval(() => {
    const p = currentProfile()
    const mins = p?.autoLockMinutes ?? 0
    if (!p?.hasPassword || mins <= 0) return
    if (Date.now() - lastActivity >= mins * 60_000) void lockAndReload()
  }, 15_000)
}

export const AUTO_LOCK_OPTIONS = [
  { value: '0', label: 'Off' },
  { value: '5', label: '5 minutes' },
  { value: '15', label: '15 minutes' },
  { value: '30', label: '30 minutes' },
  { value: '60', label: '60 minutes' }
]

/** Square crop (centred), downscaled to `size` px, as a small data URL. */
export function imageFileToAvatar(file: File, size = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const side = Math.min(img.naturalWidth, img.naturalHeight)
      if (!side) return reject(new Error('That image is empty'))
      const out = Math.min(size, side)
      const c = document.createElement('canvas')
      c.width = c.height = out
      const g = c.getContext('2d')
      if (!g) return reject(new Error('Canvas unavailable'))
      g.imageSmoothingQuality = 'high'
      g.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, out, out)
      resolve(c.toDataURL('image/webp', 0.9))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Couldn’t read that image'))
    }
    img.src = url
  })
}
