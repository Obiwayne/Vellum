// Left-panel Comments tab: every thread in the file grouped by page; click one to jump to it.
import { useState } from 'react'
import { Segmented } from '../../ui'
import { useStore } from '../../model/store'
import { nodeLabel, relativeTime, revealThread, useCommentUi } from './state'
import './comments.css'

type Filter = 'open' | 'resolved' | 'all'

export function CommentsPanel({ docId }: { docId: string }): JSX.Element {
  const doc = useStore((s) => s.docs[docId])
  const openId = useCommentUi((s) => s.openId)
  const [filter, setFilter] = useState<Filter>('open')
  const all = doc?.comments ?? []
  const openCount = all.filter((t) => t.status === 'open').length
  const list = all.filter((t) => filter === 'all' || t.status === filter)

  const setF = (f: Filter): void => {
    setFilter(f)
    useCommentUi.setState({ showResolved: f !== 'open' })
  }

  return (
    <div className="cm-panel">
      <div className="lp-tabs">
        <Segmented
          full
          value={filter}
          onChange={setF}
          options={[
            { value: 'open', label: `Open${openCount ? ` ${openCount}` : ''}` },
            { value: 'resolved', label: 'Resolved' },
            { value: 'all', label: 'All' }
          ]}
        />
      </div>
      <div className="cm-panel__list">
        {!list.length ? (
          <div className="cm-empty">
            {filter === 'open' ? (
              <>
                Press <b>C</b> and click any layer to leave a comment, for example “change this button to say Get started”.
                Then ask your AI:
                <code>Address my open Vellum comments</code>
              </>
            ) : (
              'Nothing here yet.'
            )}
          </div>
        ) : (
          doc?.pages.map((p) => {
            const onPage = list.filter((t) => t.pageId === p.id).sort((a, b) => a.number - b.number)
            if (!onPage.length) return null
            return (
              <div key={p.id}>
                {doc.pages.length > 1 && <div className="cm-panel__page">{p.name}</div>}
                {onPage.map((t) => {
                  const node = t.nodeId ? doc.nodes[t.nodeId] : undefined
                  const last = t.messages[t.messages.length - 1]
                  const replies = t.messages.length - 1
                  return (
                    <button
                      key={t.id}
                      className={`cm-row${t.status === 'resolved' ? ' cm-row--resolved' : ''}${t.id === openId ? ' cm-row--active' : ''}`}
                      onClick={() => revealThread(docId, t.id)}
                    >
                      <span className="cm-row__num">{t.number}</span>
                      <span className="cm-row__main">
                        <div className="cm-row__node">{t.nodeId ? (node ? nodeLabel(node) : 'Deleted layer') : 'Canvas'}</div>
                        <div className="cm-row__body">{t.messages[0]?.body}</div>
                        <div className="cm-row__meta">
                          <span>{relativeTime(t.updatedAt)}</span>
                          {replies > 0 && <span>{replies === 1 ? '1 reply' : `${replies} replies`}</span>}
                          {last?.author === 'agent' && <span className="cm-row__ai">AI replied</span>}
                        </div>
                      </span>
                    </button>
                  )
                })}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
