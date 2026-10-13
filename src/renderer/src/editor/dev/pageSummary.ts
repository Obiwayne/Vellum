// Dev Mode Spec panel with nothing selected: what is on this page and how much of it is ready for dev.
// Pure data, so the panel stays a renderer.
import type { Doc } from '../../model/types'

export interface ScreenLine {
  id: string
  name: string
  /** `dev.screen` tag, when the frame is a breakpoint of a named screen */
  screen?: { name: string; bp: string }
  /** handoff version the frame was marked ready in */
  readyAt?: number
  /** has dev notes / states / an open question the developer should read */
  hasNotes: boolean
  needsDecision?: string
}

export interface PageSummary {
  pageName: string
  screens: ScreenLine[]
  readyCount: number
  componentCount: number
  tokenCount: number
  modes: string[]
}

/** Top-level frames of the page in layer order, plus file facts. Hidden frames are listed (they are the designer's call). */
export function pageSummary(doc: Doc, pageId: string): PageSummary | null {
  const page = doc.pages.find((p) => p.id === pageId)
  if (!page) return null
  const root = doc.nodes[page.rootId]
  const screens: ScreenLine[] = []
  for (const id of root?.children ?? []) {
    const n = doc.nodes[id]
    if (!n || n.type !== 'frame') continue
    screens.push({
      id,
      name: n.name,
      screen: n.dev?.screen,
      readyAt: n.dev?.ready?.at,
      hasNotes: Boolean(n.dev?.notes || (n.dev?.states && Object.keys(n.dev.states).length)),
      needsDecision: n.dev?.needsDecision
    })
  }
  const componentCount = Object.values(doc.nodes).filter((n) => n.component && !n.componentSet).length
  return {
    pageName: page.name,
    screens,
    readyCount: screens.filter((s) => s.readyAt !== undefined).length,
    componentCount,
    tokenCount: doc.tokens.length,
    modes: doc.modes ?? []
  }
}
