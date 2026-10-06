// Crash recovery state: designs that have unsaved changes left over from a crash (offered for restore) and files
// that had to be read from their backup. The prompt lives in shell/RecoveryPrompt.tsx; persist.ts fills it at start.
import { create } from 'zustand'
import type { Doc } from './types'
import { useStore } from './store'

export interface RecoveryItem {
  doc: Doc
  /** the saved design exists (its changes since the last save are what is offered) */
  existing: boolean
}

interface RecoveryState {
  items: RecoveryItem[]
  /** plain sentences about files restored from their backup */
  notices: string[]
}

export const useRecovery = create<RecoveryState>(() => ({ items: [], notices: [] }))

const api = (): Window['canvasApi'] | undefined => (typeof window !== 'undefined' ? window.canvasApi : undefined)

/** Put the recovered design in place of the saved one; persist.ts then saves it, which deletes the recovery copy. */
export function restoreRecovery(id: string): void {
  const item = useRecovery.getState().items.find((i) => i.doc.id === id)
  if (!item) return
  useRecovery.setState((s) => ({ items: s.items.filter((i) => i.doc.id !== id) }))
  useStore.setState((s) => ({
    docs: { ...s.docs, [id]: item.doc },
    recents: s.recents.includes(id) ? s.recents : [id, ...s.recents]
  }))
}

/** Throw the unsaved copy away. */
export function discardRecovery(id: string): void {
  useRecovery.setState((s) => ({ items: s.items.filter((i) => i.doc.id !== id) }))
  void api()?.discardRecovery(id)
}

/** The window's X: decide later. The copies stay on disk and are offered again at the next start. */
export function postponeRecovery(): void {
  useRecovery.setState({ items: [], notices: [] })
}

export function dismissNotices(): void {
  useRecovery.setState({ notices: [] })
}

/** "Welcome" is the name of a design; an index or profile list gets a general sentence. */
export function restoredNotice(file: string, docs: Record<string, Doc>): string {
  const m = /^files\/([^/]+)\.json$/.exec(file)
  if (m) return `${docs[m[1]]?.name ? `"${docs[m[1]].name}"` : 'A design'} could not be read and was restored from its last backup. Changes since that backup may be missing.`
  if (file === 'index.json') return 'The list of recent files could not be read and was restored from its last backup.'
  if (file === 'profiles.json') return 'The list of profiles could not be read and was restored from its last backup.'
  return `${file} could not be read and was restored from its last backup.`
}
