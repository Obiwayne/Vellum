// Renders document nodes as real DOM. Each NodeView subscribes to its own node object, so a change
// re-renders only the affected node (memoized by node reference).
import { memo, useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react'
import { getStore, useStore } from '../../model/store'
import { computeNodeStyle } from '../../model/html'
import { cleanAttrs, sanitizeSvgMarkup } from '../../model/sanitize'
import { isFlowLayout } from '../../model/ops'
import { MODE_ATTR } from '../../model/modes'
import type { CNode } from '../../model/types'
import { commitTextEditing, textEditing } from './actions'
import { notifyLayout } from './geometry'

interface Props {
  docId: string
  id: string
  /** parent lays out children in flow (flex/grid) — passed so layout changes re-render children */
  parentFlow: boolean
  topLevel: boolean
}

function renderStyle(docId: string, node: CNode, topLevel: boolean): CSSProperties {
  const doc = getStore().docs[docId]
  const s = (doc ? computeNodeStyle(doc, node.id) : { ...node.style }) as Record<string, unknown>
  if (topLevel) {
    s.position = 'absolute'
    s.left = node.x
    s.top = node.y
  }
  return s as CSSProperties
}

export const NodeView = memo(function NodeView({ docId, id, topLevel }: Props): JSX.Element | null {
  const node = useStore((s) => s.docs[docId]?.nodes[id])
  // a frame with a theme mode renders its mode's token values: re-render when tokens/modes change
  const hasMode = Boolean(node?.attrs?.[MODE_ATTR])
  useStore((s) => (hasMode ? s.docs[docId]?.tokens : null))
  useStore((s) => (hasMode ? s.docs[docId]?.modes : null))
  if (!node) return null
  const style = renderStyle(docId, node, topLevel)
  switch (node.type) {
    case 'text':
      return <TextNode docId={docId} node={node} style={style} />
    case 'image':
      return (
        <img
          data-node-id={id}
          style={style}
          src={cleanAttrs(node.attrs).src}
          alt={node.attrs?.alt ?? ''}
          draggable={false}
          onLoad={notifyLayout}
        />
      )
    case 'svg':
      return <SvgNode node={node} style={style} />
    default: {
      const flow = isFlowLayout(node.style)
      return (
        <div data-node-id={id} data-component-set={node.componentSet ? '' : undefined} style={node.componentSet ? { ...style, outline: '1px dashed #9747ff', outlineOffset: 0 } : style}>
          {node.children.map((c) => (
            <NodeView key={c} docId={docId} id={c} parentFlow={flow} topLevel={false} />
          ))}
        </div>
      )
    }
  }
})

const SVG_SKIP = new Set(['tag', 'style', 'class', 'xmlns', 'width', 'height', 'data-node-id', 'data-name'])

function SvgNode({ node, style }: { node: CNode; style: CSSProperties }): JSX.Element {
  const ref = useRef<SVGSVGElement | null>(null)
  const applied = useRef<string[]>([])
  const markup = useMemo(() => sanitizeSvgMarkup(node.svg), [node.svg])
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    for (const k of applied.current) el.removeAttribute(k)
    const keys: string[] = []
    // cleaned: no on* handlers or script URLs, even from old or hand-edited files
    for (const [k, v] of Object.entries(cleanAttrs(node.attrs))) {
      if (SVG_SKIP.has(k)) continue
      try {
        el.setAttribute(k, v)
        keys.push(k)
      } catch {
        /* invalid attribute name */
      }
    }
    applied.current = keys
  }, [node.attrs])
  return (
    <svg
      ref={ref}
      data-node-id={node.id}
      style={style}
      xmlns="http://www.w3.org/2000/svg"
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  )
}

function TextNode({ docId, node, style }: { docId: string; node: CNode; style: CSSProperties }): JSX.Element {
  const editing = useStore((s) => s.editors[docId]?.editingTextId === node.id)
  if (!editing) {
    return (
      <div key="view" data-node-id={node.id} style={style}>
        {node.text}
      </div>
    )
  }
  return <TextEditor key="edit" docId={docId} node={node} style={style} />
}

function TextEditor({ docId, node, style }: { docId: string; node: CNode; style: CSSProperties }): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  const nodeRef = useRef(node)
  nodeRef.current = node

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.textContent = node.text ?? ''
    el.focus({ preventScroll: true })
    const range = document.createRange()
    range.selectNodeContents(el)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
    let done = false
    const commit = (): void => {
      if (done) return
      done = true
      if (textEditing.current?.commit === commit) textEditing.current = null
      const s = getStore()
      const text = (el.innerText ?? '').replace(/\n$/, '')
      const n = nodeRef.current
      s.setEditingText(docId, null)
      if (!text.trim()) {
        if (textEditing.justCreated === n.id && s.canUndo(docId)) s.undo(docId)
        else s.deleteNodes(docId, [n.id])
      } else if (text !== n.text) {
        s.setText(docId, n.id, text)
      }
      if (textEditing.justCreated === n.id) textEditing.justCreated = null
    }
    textEditing.current = { id: node.id, commit }
    return () => {
      // Unmounted without an explicit commit (editing id cleared elsewhere): keep the text. Deferred
      // and guarded by isConnected so StrictMode's effect re-run doesn't commit an empty new node.
      setTimeout(() => {
        if (!done && !el.isConnected) commit()
      }, 0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      ref={ref}
      data-node-id={node.id}
      data-editing="true"
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck={false}
      style={{ ...style, userSelect: 'text', cursor: 'text', outline: 'none', minWidth: 2, caretColor: 'currentColor' }}
      onInput={notifyLayout}
      onBlur={() => commitTextEditing()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          commitTextEditing()
        }
      }}
    />
  )
}
