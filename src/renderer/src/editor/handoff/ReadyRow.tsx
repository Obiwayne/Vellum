// The "Ready for dev" row at the top of a top-level frame's inspector (Design mode), outside the Dev section (T69):
// a switch, and the amber "Changed since v3" line when the frame was edited after it was marked.
import { useStore } from '../../model/store'
import { canMark, readyStatus } from '../../handoff/ready'
import { toggleReady } from '../../handoff/readyActions'
import './export-handoff.css'

export function ReadyRow({ docId, id }: { docId: string; id: string }): JSX.Element | null {
  const doc = useStore((s) => s.docs[docId])
  const devMode = useStore((s) => s.editors[docId]?.devMode === true)
  if (!doc || !canMark(doc, id) || devMode) return null
  const status = readyStatus(doc, id)
  const at = doc.nodes[id].dev?.ready?.at
  return (
    <div className="insp-ready" data-testid="ready-row">
      <span className="insp-ready__label">
        <button
          type="button"
          role="switch"
          aria-checked={status !== null}
          aria-label="Ready for dev"
          className="insp-switch"
          onClick={() => void toggleReady(docId, [id])}
        />
        <span>Ready for dev</span>
      </span>
      {status === 'changed' && <span className="insp-ready__changed">Changed since v{at}</span>}
      {status === 'ready' && at !== undefined && <span className="eh-muted">Marked at v{at}</span>}
    </div>
  )
}
