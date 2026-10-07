// Plugin settings: prefs.plugins[id] in the profile's index.json.
import { useStore } from '../model/store'

type PluginPrefs = Record<string, Record<string, unknown> | undefined>

const allPrefs = (prefs: Record<string, unknown>): PluginPrefs => (prefs.plugins as PluginPrefs | undefined) ?? {}

const NONE: Record<string, unknown> = Object.freeze({}) as Record<string, unknown>

/** A plugin's saved settings. */
export function usePluginPrefs<T extends object>(id: string): T {
  return useStore((s) => (allPrefs(s.prefs)[id] ?? NONE) as T)
}

/** Merge settings into a plugin's saved ones. */
export function setPluginPrefs(id: string, patch: Record<string, unknown>): void {
  const s = useStore.getState()
  const all = allPrefs(s.prefs)
  s.setPref('plugins', { ...all, [id]: { ...all[id], ...patch } })
}

/** Plugins are on unless turned off in Manage plugins. */
export const isPluginEnabled = (prefs: Record<string, unknown>, id: string): boolean => allPrefs(prefs)[id]?.enabled !== false
