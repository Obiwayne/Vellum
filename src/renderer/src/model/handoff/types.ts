// Types of the handoff bundle (docs/factory/T58-plan.md section 3, T62-plan.md). `spec.json` is `Handoff`.
import type { Doc, PropDef, StylePatch } from '../types'
import type { Measure, NodeSpec, TokenUse } from '../devSpec'

export const SCHEMA_ID = 'vellum.handoff/1'
export const STATE_SCHEMA_ID = 'vellum.handoff.state/1'

/** An exported asset (from the H4 pipeline). H3 only references it. */
export interface AssetRecord {
  id: string
  /** bundle-relative POSIX path, e.g. `assets/images/hero.jpg` */
  path: string
  kind: 'image' | 'icon'
  /** nodes that use the asset */
  nodeIds: string[]
  bytes?: number
  sha256?: string
}

export interface HandoffOptions {
  /** top-level frame ids chosen by the caller: the whitelist */
  frames: string[]
  /** handoff version, supplied by the caller */
  version: number
  /** ISO timestamp supplied by the caller: the writer never reads a clock */
  exportedAt: string
  /** app version */
  vellum: string
  /** replaces the file name in the bundle */
  projectLabel?: string
  measure?: Measure
  lineCount?: (id: string) => number | null
  precision?: number
  /** print rem beside px in markdown */
  rem?: boolean
  mode?: string | null
  assets?: AssetRecord[]
  /** the exporter will write PNG references (H4): HANDOFF.md then asks the agent to compare against them */
  renders?: boolean
}

export interface HandoffSummary {
  screens: number
  breakpoints: number
  nodes: number
  components: number
  tokens: number
  textStyles: number
  fonts: number
  notes: number
  skippedHidden: number
  fractional: number
  needsDecision: number
  unmeasured: number
}

export interface HandoffResult {
  /** POSIX relative path -> UTF-8 text */
  files: Record<string, string>
  summary: HandoffSummary
  warnings: string[]
}

/** A NodeSpec with the doc's dev info folded in. */
export type HandoffNode = Omit<NodeSpec, 'children' | 'style'> & {
  style: { authored: Record<string, string | number>; resolved: Record<string, string> }
  /** dev notes, paragraphs split on blank lines */
  notes?: string[]
  a11y?: { role?: string; label?: string; tab?: number; alt?: string }
  states?: Record<string, StylePatch>
  needsDecision?: string
  assets?: string[]
  children: HandoffNode[]
}

export interface BreakpointSpec {
  name: string
  width: number
  height: number
  frameId: string
  /** reserved reference render (written by H4) */
  png: string
  root: HandoffNode
}

export interface ScreenSpec {
  id: string
  name: string
  slug: string
  /** markdown spec path */
  doc: string
  ready?: { at: number }
  breakpoints: BreakpointSpec[]
}

export interface ComponentVariantSpec {
  id: string
  name: string
  /** variant prop id -> option */
  values: Record<string, string>
  root: HandoffNode
}

export interface ComponentSpec {
  id: string
  name: string
  slug: string
  doc: string
  /** a set of variants (true) or a lone main */
  set: boolean
  props: PropDef[]
  variants: ComponentVariantSpec[]
  /** ids of the screens (or components) whose nodes instantiate it */
  usedBy: string[]
}

export interface TokenSpec {
  name: string
  type: TokenUse['type']
  values: TokenUse['values']
  /** how many emitted nodes and text styles reference it directly */
  usage: number
}

export interface TextStyleSpec {
  id: string
  name: string
  style: Record<string, string | number>
}

export interface FontSpec {
  family: string
  css: string
  weights: Array<number | string>
  italic: boolean
  source: 'google' | 'local' | 'system'
  usedBy: number
}

export interface Handoff {
  schema: typeof SCHEMA_ID
  handoff: { version: number; exportedAt: string; vellum: string; fileId: string; fileName: string }
  units: { length: 'px'; remBase: number; precision: number }
  modes: string[]
  screens: ScreenSpec[]
  components: ComponentSpec[]
  tokens: TokenSpec[]
  textStyles: TextStyleSpec[]
  fonts: FontSpec[]
  assets: AssetRecord[]
}

export type { Doc }
