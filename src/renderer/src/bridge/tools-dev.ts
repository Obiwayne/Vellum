// MCP tools for developer handoff (T68 / H11): `get_dev_spec` (the NodeSpec of layers: measured box, layout intent,
// tokens, component reference, dev notes) and `export_handoff` (the bundle of src/renderer/src/handoff/ as a file
// map returned inline). Both only read the document, so Dev Mode does not block them. Nothing is written to disk
// here: the app's Export handoff action owns writing (T65), so there is one writer.
import type { HandoffResult } from '../handoff'
import { buildExportBundle, type ExportDeps } from '../handoff/exportFlow'
import { fontSourceFor } from '../handoff/assets/fonts'
import { listVersions, loadVersionDoc } from '../history/versions'
import { GOOGLE_FONTS } from '../editor/inspector/fonts'
import { nodeSpec, type NodeSpec } from '../model/devSpec'
import { version as APP_VERSION } from '../../../../package.json'
import { measureOffscreen } from './measure'
import { arr, getDoc, registerHandler, requireNode, resolveDocId, scoped, str } from './registry'

/** Largest total size (UTF-8 bytes) of the file contents returned inline. Further files are listed, not returned. */
export const DEFAULT_MAX_BYTES = 1_000_000
export const MAX_BYTES_LIMIT = 8_000_000

const bytes = (s: string): number => new TextEncoder().encode(s).length

registerHandler('get_dev_spec', (args) => {
  const docId = resolveDocId(args)
  const doc = getDoc(docId)
  const ids = [...(typeof args.nodeId === 'string' && args.nodeId ? [args.nodeId] : []), ...arr<string>(args.nodeIds).filter((x) => typeof x === 'string')]
  if (!ids.length) throw new Error('Pass nodeId or nodeIds')
  if (ids.length > 50) throw new Error('At most 50 nodes per call')
  const depth = typeof args.depth === 'number' && Number.isInteger(args.depth) && args.depth >= 0 ? args.depth : undefined
  const mode = typeof args.mode === 'string' ? args.mode : undefined
  const specs: NodeSpec[] = []
  for (const id of ids) {
    const n = requireNode(doc, id)
    if (!n.visible) throw new Error(`Node ${id} ("${n.name}") is hidden; hidden layers are not part of a hand-off`)
    const spec = nodeSpec(doc, id, { measure: (x) => measureOffscreen(doc, x), ...(depth !== undefined ? { depth } : {}), ...(mode !== undefined ? { mode } : {}) })
    if (!spec) throw new Error(`Node ${id} cannot be specified`)
    specs.push(spec)
  }
  return scoped(docId, { specs })
})

registerHandler('export_handoff', async (args) => {
  const docId = resolveDocId(args)
  const doc = getDoc(docId)
  const frames = Array.isArray(args.frames) ? arr<unknown>(args.frames).filter((x): x is string => typeof x === 'string') : undefined
  const version = typeof args.version === 'number' && Number.isInteger(args.version) && args.version >= 1 ? args.version : undefined
  const cap = Math.min(typeof args.maxBytes === 'number' && args.maxBytes > 0 ? Math.floor(args.maxBytes) : DEFAULT_MAX_BYTES, MAX_BYTES_LIMIT)
  // the same pipeline as the Export handoff dialog (frames, number, assets, comparison, fonts), so the text files match
  // it byte for byte apart from exportedAt; the number is the next free one unless `version` is given
  const deps: ExportDeps = {
    measure: (x) => measureOffscreen(doc, x),
    engine: { resize: async () => new Uint8Array(), renderPng: async () => new Uint8Array() },
    write: async () => ({ ok: false, error: 'export_handoff writes nothing' }),
    saveVersion: async () => undefined,
    listVersions: () => listVersions(docId),
    loadVersion: (id) => loadVersionDoc(docId, id),
    now: () => new Date().toISOString(),
    vellum: APP_VERSION,
    fontSource: fontSourceFor({ google: GOOGLE_FONTS })
  }
  const bundle = await buildExportBundle(doc, { ...(frames ? { frames } : {}), retina: false, rem: args.rem === true, devNotes: true, kind: 'folder', ...(str(args.projectLabel) !== undefined ? { projectLabel: str(args.projectLabel) } : {}), ...(typeof args.mode === 'string' ? { mode: args.mode } : {}) }, deps, version)
  const built: HandoffResult = { ...bundle.built, warnings: [...new Set([...bundle.selectionWarnings, ...bundle.built.warnings])] }

  // inline up to the cap, most useful files first; the identical CLAUDE.md copy goes last
  const order = (p: string): number =>
    p === 'HANDOFF.md' ? 0 : p.startsWith('tokens/') ? 1 : p.startsWith('components/') ? 2 : p.startsWith('screens/') ? 3 : p === 'fonts.md' ? 4 : p === 'spec.json' ? 5 : p === 'spec.schema.json' ? 6 : p === '.handoff.json' ? 7 : 8
  const paths = Object.keys(built.files).sort((a, b) => order(a) - order(b) || a.localeCompare(b))
  const files: Record<string, string> = {}
  const omitted: string[] = []
  let used = 0
  for (const p of paths) {
    const size = bytes(built.files[p])
    if (used + size <= cap) {
      files[p] = built.files[p]
      used += size
    } else omitted.push(p)
  }
  const warnings = [...built.warnings]
  if (omitted.length) warnings.push(`The size cap (${cap} bytes) was reached: ${omitted.length} file${omitted.length === 1 ? ' is' : 's are'} not returned inline (${omitted.join(', ')}). Use Export handoff in the app to write the whole bundle.`)

  // image and PNG references are planned paths, never bytes: say so
  let spec: { screens?: Array<{ breakpoints?: Array<{ png?: string }> }>; assets?: Array<{ path?: string }> } = {}
  try {
    spec = JSON.parse(built.files['spec.json'] ?? '{}')
  } catch {
    /* an unreadable spec just means no binary list */
  }
  const binary = [
    ...(spec.screens ?? []).flatMap((s) => (s.breakpoints ?? []).map((b) => b.png ?? '')),
    ...(spec.assets ?? []).map((a) => a.path ?? '')
  ].filter(Boolean)
  const skipped = [...new Set(binary)].sort()
  if (skipped.length) warnings.push(`${skipped.length} image/PNG path${skipped.length === 1 ? ' is' : 's are'} listed but not included (binary): use Export handoff in the app to get them.`)

  return scoped(docId, {
    files,
    summary: built.summary,
    warnings,
    inlineBytes: used,
    omitted,
    skippedBinary: skipped
  })
})
