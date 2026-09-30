// Screen-space comment layer over the canvas: numbered pins that follow the node they are on, the
// open thread card (messages, reply, resolve, delete) and the composer for a new comment.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ArrowUp, Check, RotateCcw, Sparkles, Trash2, X } from 'lucide-react'
import { activePage, getStore, useStore } from '../../model/store'
import type { CommentThread, WorldRect } from '../../model/types'
import { LAYOUT_EVENT, measure } from '../canvas/geometry'
import { closeDraft, currentAuthor, nodeLabel, openThread, pinWorld, relativeTime, threadsOnPage, useCommentUi } from './state'
import './comments.css'

const CARD_W = 300

/** Stops canvas gestures and keeps focus handling (textareas) working inside comment UI. */
const shield = {
  onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
  onDoubleClick: (e: React.MouseEvent) => e.stopPropagation(),
  onContextMenu: (e: React.MouseEvent) => e.stopPropagation(),
  'data-editing': 'comment'
}

export function CommentsLayer({ docId }: { docId: string }): JSX.Element | null {
  const doc = useStore((s) => s.docs[docId])
  const page = useStore((s) => activePage(s, docId))
  const cam = useStore((s) => s.editors[docId]?.camera)
  const tool = useStore((s) => s.editors[docId]?.tool)
  const show = useStore((s) => s.prefs['canvas.showComments'] !== false)
  const { openId, draft, showResolved } = useCommentUi()
  const [tick, setTick] = useState(0)
  const [rects, setRects] = useState<Map<string, WorldRect>>(new Map())
  const [size, setSize] = useState({ w: 0, h: 0 })
  const layer = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const on = (): void => setTick((t) => t + 1)
    window.addEventListener(LAYOUT_EVENT, on)
    window.addEventListener('resize', on)
    document.fonts?.addEventListener?.('loadingdone', on)
    const el = layer.current
    const ro = el ? new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight })) : null
    if (el && ro) ro.observe(el)
    return () => {
      window.removeEventListener(LAYOUT_EVENT, on)
      window.removeEventListener('resize', on)
      document.fonts?.removeEventListener?.('loadingdone', on)
      ro?.disconnect()
    }
  }, [])

  const threads = threadsOnPage(doc, page?.id)
  const visible = threads.filter((t) => t.status === 'open' || showResolved || t.id === openId)

  useLayoutEffect(() => {
    const m = new Map<string, WorldRect>()
    for (const t of threads) {
      if (!t.nodeId || m.has(t.nodeId)) continue
      const r = measure(t.nodeId, docId)
      if (r) m.set(t.nodeId, r)
    }
    setRects(m)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, page?.id, tick])

  // a card for a thread that is gone (deleted, other file) closes itself
  useEffect(() => {
    if (openId && !doc?.comments?.some((t) => t.id === openId) && !Object.values(getStore().docs).some((d) => d.comments?.some((t) => t.id === openId)))
      openThread(null)
  }, [doc, openId])

  if (!doc || !page || !cam) return <div ref={layer} className="cm-layer" />
  const on = show || tool === 'comment'
  const toScreen = (p: { x: number; y: number }): { x: number; y: number } => ({ x: p.x * cam.zoom + cam.x, y: p.y * cam.zoom + cam.y })
  const screenOf = (t: CommentThread): { x: number; y: number } => toScreen(pinWorld(t, t.nodeId ? rects.get(t.nodeId) : null))

  const open = on ? visible.find((t) => t.id === openId) : undefined
  const draftHere = draft && draft.docId === docId && draft.anchor.pageId === page.id ? draft : null

  return (
    <div ref={layer} className="cm-layer">
      {on &&
        visible.map((t) => {
          const p = screenOf(t)
          const last = t.messages[t.messages.length - 1]
          return (
            <button
              key={t.id}
              {...shield}
              className={`cm-pin${t.status === 'resolved' ? ' cm-pin--resolved' : ''}${t.id === openId ? ' cm-pin--active' : ''}`}
              style={{ left: p.x, top: p.y - 26 }}
              title={t.messages[0]?.body}
              onClick={() => openThread(t.id === openId ? null : t.id)}
            >
              {t.number}
              {last?.author === 'agent' && t.status === 'open' && <span className="cm-pin__agent" title="The AI replied" />}
            </button>
          )
        })}
      {open && <ThreadCard docId={docId} thread={open} at={screenOf(open)} size={size} />}
      {draftHere && <Composer docId={docId} at={toScreen({ x: draftHere.anchor.x, y: draftHere.anchor.y })} size={size} />}
    </div>
  )
}

function cardPos(at: { x: number; y: number }, size: { w: number; h: number }, h = 220): { left: number; top: number } {
  let left = at.x + 34
  if (size.w && left + CARD_W > size.w - 8) left = Math.max(8, at.x - CARD_W - 12)
  let top = at.y - 30
  if (size.h) top = Math.max(8, Math.min(top, size.h - h - 8))
  return { left, top }
}

/** Enter sends, Shift+Enter is a new line, Escape cancels. */
function onComposeKey(e: ReactKeyboardEvent<HTMLTextAreaElement>, send: () => void, cancel: () => void): void {
  e.stopPropagation()
  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
    e.preventDefault()
    send()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    cancel()
  }
}

function useAutoGrow(value: string): React.MutableRefObject<HTMLTextAreaElement | null> {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(140, el.scrollHeight)}px`
  }, [value])
  return ref
}

function Composer({ docId, at, size }: { docId: string; at: { x: number; y: number }; size: { w: number; h: number } }): JSX.Element {
  const [text, setText] = useState('')
  const ref = useAutoGrow(text)
  useEffect(() => ref.current?.focus(), [ref])
  const send = (): void => {
    const d = useCommentUi.getState().draft
    if (!d || !text.trim()) return
    const id = getStore().addComment(docId, d.anchor, text, currentAuthor())
    if (id) openThread(id)
  }
  return (
    <>
      <div className="cm-pin cm-pin--draft" style={{ left: at.x, top: at.y - 26 }} />
      <div {...shield} className="cm-card cm-card--composer" style={cardPos(at, size, 60)}>
        <div className="cm-reply">
          <textarea
            ref={ref}
            rows={1}
            value={text}
            placeholder="Add a comment for the AI…"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => onComposeKey(e, send, closeDraft)}
          />
          <button className="cm-send" disabled={!text.trim()} onClick={send} title="Post (Enter)">
            <ArrowUp size={14} />
          </button>
        </div>
      </div>
    </>
  )
}

function ThreadCard({
  docId,
  thread,
  at,
  size
}: {
  docId: string
  thread: CommentThread
  at: { x: number; y: number }
  size: { w: number; h: number }
}): JSX.Element {
  const node = useStore((s) => (thread.nodeId ? s.docs[docId]?.nodes[thread.nodeId] : undefined))
  const [text, setText] = useState('')
  const ref = useAutoGrow(text)
  const list = useRef<HTMLDivElement | null>(null)
  const resolved = thread.status === 'resolved'

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight })
  }, [thread.messages.length])
  useEffect(() => {
    setText('')
    ref.current?.focus()
  }, [thread.id, ref])

  const send = (): void => {
    if (getStore().replyComment(docId, thread.id, text, currentAuthor())) setText('')
  }
  const toggle = (): void => {
    getStore().setCommentStatus(docId, thread.id, resolved ? 'open' : 'resolved')
    if (!resolved && !useCommentUi.getState().showResolved) openThread(null)
  }

  return (
    <div {...shield} className="cm-card" style={cardPos(at, size, 260)} onWheel={(e) => e.stopPropagation()}>
      <div className="cm-card__head">
        <span className="cm-card__num">#{thread.number}</span>
        <button
          className="cm-card__node"
          disabled={!node}
          title={node ? 'Select this layer' : 'The layer this was pinned to is gone'}
          onClick={() => node && getStore().select(docId, [node.id])}
        >
          {thread.nodeId ? (node ? nodeLabel(node) : 'Deleted layer') : 'Canvas'}
        </button>
        <span className="cm-spacer" />
        <button className="cm-icon" title={resolved ? 'Reopen' : 'Resolve'} onClick={toggle}>
          {resolved ? <RotateCcw size={14} /> : <Check size={14} />}
        </button>
        <button className="cm-icon" title="Delete thread" onClick={() => getStore().deleteComment(docId, thread.id)}>
          <Trash2 size={14} />
        </button>
        <button className="cm-icon" title="Close" onClick={() => openThread(null)}>
          <X size={14} />
        </button>
      </div>
      {resolved && <div className="cm-card__resolved">Resolved</div>}
      <div ref={list} className="cm-card__msgs">
        {thread.messages.map((m) => (
          <div key={m.id} className="cm-msg">
            <div className="cm-msg__meta">
              {m.author === 'agent' ? (
                <span className="cm-msg__agent">
                  <Sparkles size={11} /> {m.authorName}
                </span>
              ) : (
                <span className="cm-msg__who">{m.authorName}</span>
              )}
              <span className="cm-msg__time">{relativeTime(m.createdAt)}</span>
            </div>
            <div className="cm-msg__body">{m.body}</div>
          </div>
        ))}
      </div>
      <div className="cm-reply">
        <textarea
          ref={ref}
          rows={1}
          value={text}
          placeholder="Reply…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => onComposeKey(e, send, () => openThread(null))}
        />
        <button className="cm-send" disabled={!text.trim()} onClick={send} title="Reply (Enter)">
          <ArrowUp size={14} />
        </button>
      </div>
    </div>
  )
}
