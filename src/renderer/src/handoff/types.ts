// Types of the handoff bundle writer (T62 / H3). The writer is one pure function: Doc + options -> file map.
// See docs/factory/T58-plan.md sections 3, 5, 8 to 11 and docs/factory/T62-plan.md.
import type { BreakpointDelta } from './deltas'
import type { PropDef, StylePatch } from '../model/types'
import type { Measure, NodeSpec, TokenUse } from '../model/devSpec'

export const SCHEMA_ID = 'vellum.handoff/1'
export const STATE_SCHEMA_ID = 'vellum.handoff.state/1'

/** An asset the export will contain. H3 lists it; H4 produces the bytes. */
export interface AssetRecord {
  id: string
  /** bundle-relative path, e.g. `assets/images/hero.jpg` */
  path: string
  kind: 'image' | 'icon' | 'png'
  /** layers that use it */
  nodeIds: string[]
  /** layer name, so a human can find it */
  layerName?: string
  // ---- filled in by the assets pipeline (H4); all optional so H3 alone still works
  mime?: string
  /** size of the file at `path`, in bytes */
  bytes?: number
  /** pixels of the original (images) */
  width?: number
  height?: number
  /** natural pixels per layout pixel; below 1 the image is smaller than its box */
  maxDensity?: number
  /** the same image at other densities (`path` is the original, 1x) */
  variants?: Array<{ path: string; density: number; width: number; height: number }>
  /** `data`: bytes come from the file; `external`: a link that is listed but never fetched */
  source?: 'data' | 'external'
  url?: string
  sha256?: string
  /** icons: a single colour was replaced by currentColor / more than one colour left as drawn */
  recoloured?: boolean
  was?: string
  multiColour?: boolean
  /** images: animated, exported as is */
  animated?: boolean
  /** the bytes could not be produced (see warnings) */
  missing?: boolean
}

/** Files of a bundle: the text H3 writes and the bytes H4 produces. The export writer merges them. */
export type BundleFiles = Record<string, string | Uint8Array>

export type FontSource = 'google' | 'local' | 'system' | 'unknown'

export interface HandoffOptions {
  /** top-level frames to export. Default: every visible top-level frame marked ready for dev (`dev.ready`). */
  frames?: string[]
  /** handoff version, supplied by the caller (kept in version history, not in the document) */
  version: number
  /** ISO timestamp supplied by the caller: the writer never reads a clock */
  exportedAt: string
  /** app version, supplied */
  vellum: string
  /** replaces the document name in the bundle (the name can be a person's name or a client's) */
  projectLabel?: string
  /** measured world rects (bridge/measure); without it the spec says `measured: false` */
  measure?: Measure
  lineCount?: (id: string) => number | null
  /** decimals kept, default 2 */
  precision?: number
  /** print rem beside px in the markdown (base 16) */
  rem?: boolean
  /** token mode used for resolved values; default: the mode in effect at each node */
  mode?: string | null
  /** assets planned by H4; listed in spec.json and the markdown, never read here */
  assets?: AssetRecord[]
  /** extra warnings to list in HANDOFF.md (the assets pipeline adds its own) */
  warnings?: string[]
  /** where a font family comes from; default: generic and system keywords are `system`, the rest `unknown` */
  fontSource?: (family: string) => FontSource
}

export interface HandoffSummary {
  screens: number
  breakpoints: number
  nodes: number
  components: number
  tokens: number
  textStyles: number
  assets: number
  fonts: number
  notes: number
  needsDecision: number
  /** nodes of exported frames that have a fractional size */
  fractional: number
  /** hidden layers left out */
  skippedHidden: number
  /** nodes without a measured rect */
  unmeasured: number
}

export interface HandoffResult {
  /** bundle-relative POSIX path -> text content */
  files: Record<string, string>
  summary: HandoffSummary
  /** human-readable; also listed in HANDOFF.md */
  warnings: string[]
}

/** A NodeSpec plus the developer-facing fields of `CNode.dev`. */
export type DevNodeSpec = Omit<NodeSpec, 'children' | 'tokens' | 'box'> & {
  /** like NodeSpec.box, but an axis that was not measured and has no authored size is left out, never 0 */
  box: Omit<NodeSpec['box'], 'width' | 'height'> & { width?: number; height?: number }
  /** names of the tokens this layer uses; values are in spec.tokens */
  tokens: string[]
  notes?: string[]
  a11y?: { role?: string; label?: string; tab?: number }
  states?: Record<string, StylePatch>
  needsDecision?: string
  children: DevNodeSpec[]
}

export interface BreakpointSpec {
  /** 'Desktop', 'Mobile', a custom name, or 'default' for an untagged frame */
  bp: string
  frameId: string
  /** the frame's size; left out when it was not measured and is not authored (a Fit frame) */
  width?: number
  height?: number
  /** handoff version in which the frame was marked ready; absent when exported without a mark */
  ready?: { at: number }
  /** reserved path of the PNG reference (H4 renders it) */
  png: string
  /** what differs from the base (the widest breakpoint); absent on the base itself */
  delta?: BreakpointDelta
  root: DevNodeSpec
}

export interface ScreenSpec {
  /** id of the largest breakpoint's frame: stable while the screen exists */
  id: string
  name: string
  slug: string
  /** largest first; [0] is the base */
  breakpoints: BreakpointSpec[]
}

export interface ComponentVariantSpec {
  /** main id */
  ref: string
  name: string
  /** variant prop id -> option */
  values: Record<string, string>
  root: DevNodeSpec
}

export type StateBadge = 'drawn' | 'described' | 'missing'

export interface ComponentSpec {
  /** the set frame's id for variant components, else the main's id */
  ref: string
  name: string
  slug: string
  isSet: boolean
  props: PropDef[]
  variants: ComponentVariantSpec[]
  /** screen ids that use it (directly or through another component) */
  usedBy: string[]
  /** dev notes on the main(s), unique */
  notes: string[]
  states: Array<{ state: string; badge: StateBadge }>
  /** looks interactive by name (button, link, input...) */
  interactive: boolean
}

export interface FontSpec {
  family: string
  weights: Array<number | string>
  italic: boolean
  source: FontSource
  /** CSS stack as authored by the first node that uses it */
  stack: string
  /** number of text layers that use it */
  usedBy: number
}

export interface TextStyleSpec {
  id: string
  name: string
  style: Record<string, string | number>
}

export interface HandoffSpec {
  schema: typeof SCHEMA_ID
  handoff: { version: number; exportedAt: string; vellum: string; fileId: string; fileName: string }
  units: { length: 'px'; remBase: number; precision: number }
  modes: string[]
  screens: ScreenSpec[]
  components: ComponentSpec[]
  tokens: TokenUse[]
  textStyles: TextStyleSpec[]
  assets: AssetRecord[]
  fonts: FontSpec[]
}
