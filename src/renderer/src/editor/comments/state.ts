// Comment UI state that is not part of the document: which thread card is open, the draft being
// written with the Comment tool, and whether resolved threads are shown.
import { create } from 'zustand'
import { getStore, type CommentAnchor, type CommentAuthor } from '../../model/store'
import { useProfiles } from '../../profile/profile'
import type { CNode, CommentThread, Doc, WorldRect } from '../../model/types'
import { measure } from '../canvas/geometry'

interface CommentUi {
  /** thread whose card is open (per app; the card only shows on its own doc + page) */
  openId: string | null
  /** new comment being written: where the pin goes */
  draft: { docId: string; anchor: CommentAnchor } | null
  showResolved: boolean
}

export const useCommentUi = create<CommentUi>(() => ({ openId: null, draft: null, showResolved: false }))

export const openThread = (id: string | null): void => useCommentUi.setState({ openId: id, draft: null })
export const closeDraft = (): void => useCommentUi.setState({ draft: null })

/** The comment author for things typed in the app: the open profile's name. */
export function currentAuthor(): CommentAuthor {
  const st = useProfiles.getState().state
  const name = st?.profiles.find((p) => p.id === st.currentId)?.name?.trim()
  return { kind: 'user', name: name || 'You' }
}

/** Where a thread's pin sits (world coords): on its node when it is rendered, else where it was made. */
export function pinWorld(t: CommentThread, rect: WorldRect | null | undefined): { x: number; y: number } {
  if (!t.nodeId || !rect) return { x: t.x, y: t.y }
  return {
    x: rect.x + Math.max(0, Math.min(t.ox, rect.width)),
    y: rect.y + Math.max(0, Math.min(t.oy, rect.height))
  }
}

/** Short description of the node a thread is attached to ("Text “Get started”", "Frame Hero"). */
export function nodeLabel(n: CNode | undefined): string {
  if (!n) return 'Canvas'
  if (n.type === 'text') {
    const t = (n.text ?? '').replace(/\s+/g, ' ').trim()
    return `“${t.length > 32 ? `${t.slice(0, 31)}…` : t || n.name}”`
  }
  return n.name
}

export function threadsOnPage(doc: Doc | undefined, pageId: string | undefined): CommentThread[] {
  return (doc?.comments ?? []).filter((t) => t.pageId === pageId)
}

/** Open a thread: switch to its page, bring its pin into view and select the node it is on. */
export function revealThread(docId: string, threadId: string): void {
  const s = getStore()
  const doc = s.docs[docId]
  const t = doc?.comments?.find((c) => c.id === threadId)
  if (!doc || !t) return
  if (s.editors[docId]?.pageId !== t.pageId && doc.pages.some((p) => p.id === t.pageId)) s.setActivePage(docId, t.pageId)
  if (t.nodeId && doc.nodes[t.nodeId]) s.select(docId, [t.nodeId])
  if (t.status === 'resolved') useCommentUi.setState({ showResolved: true })
  openThread(t.id)
  // center the pin once the page has rendered
  requestAnimationFrame(() => {
    const st = getStore()
    const ed = st.editors[docId]
    const vp = document.querySelector<HTMLElement>('.cv-viewport')
    if (!ed || !vp) return
    const p = pinWorld(t, t.nodeId ? measure(t.nodeId, docId) : null)
    const r = vp.getBoundingClientRect()
    const z = ed.camera.zoom
    st.setCamera(docId, { x: Math.round(r.width / 2 - p.x * z - 140), y: Math.round(r.height / 2 - p.y * z) })
  })
}

export function relativeTime(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(ts).toLocaleDateString()
}
