// Open/close state of the Export handoff dialog, and the app wiring of the export flow (handoff/exportFlow.ts):
// measuring through the offscreen layout, images through the canvas, writing through the main process, the named
// version through version history.
import { create } from 'zustand'
import { getStore } from '../../model/store'
import { measureOffscreen } from '../../bridge/measure'
import { canvasEngine } from '../../handoff/assets'
import { fontSourceFor } from '../../handoff/assets/fonts'
import type { ExportDeps } from '../../handoff/exportFlow'
import { renderNodePng } from '../inspector/exporting'
import { GOOGLE_FONTS } from '../inspector/fonts'
import { listVersions, loadVersionDoc, saveNamedVersion } from '../../history/versions'
import { version as APP_VERSION } from '../../../../../package.json'

interface ExportDialogState {
  docId: string | null
  open: (docId: string) => void
  close: () => void
}

export const useExportHandoff = create<ExportDialogState>((set) => ({
  docId: null,
  open: (docId) => set({ docId }),
  close: () => set({ docId: null })
}))

/** Open the dialog for the active file (menu command, top-bar button). */
export function openExportHandoff(docId: string | null | undefined): void {
  if (docId && getStore().docs[docId]) useExportHandoff.getState().open(docId)
}

/** The platform side of the export flow for one file. */
export function appExportDeps(docId: string, localFonts?: string[]): ExportDeps {
  const doc = (): NonNullable<ReturnType<typeof getStore>['docs'][string]> => getStore().docs[docId]
  return {
    measure: (id) => measureOffscreen(doc(), id),
    engine: canvasEngine(doc(), renderNodePng),
    write: async (args) => {
      const api = window.canvasApi
      if (!api?.handoffExport) return { ok: false, error: 'Exporting needs the Vellum app.' }
      return api.handoffExport(args)
    },
    saveVersion: (name, record) => {
      // the frames this export carried go into the document first, so the snapshot holds them
      getStore().recordHandoff(docId, record.version, record.frames)
      return saveNamedVersion(docId, name)
    },
    listVersions: () => listVersions(docId),
    loadVersion: (versionId) => loadVersionDoc(docId, versionId),
    now: () => new Date().toISOString(),
    vellum: APP_VERSION,
    fontSource: fontSourceFor({ google: GOOGLE_FONTS, local: localFonts })
  }
}
