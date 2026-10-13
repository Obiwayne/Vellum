// Dev Mode right panel: the measured spec of the selected layer (or a page summary), code tabs and click-to-copy.
// Read-only: it shows model/devSpec.ts data and never calls an editing action.
import { useMemo, useState } from 'react'
import { Segmented } from '../../ui'
import { activePage, useStore } from '../../model/store'
import { nodeSpec } from '../../model/devSpec'
import type { DevInfo, Doc } from '../../model/types'
import { writeText } from '../canvas/actions'
import { CODE_LABEL, codeFor, type CodeFormat } from '../canvas/codegen'
import { measure } from '../canvas/geometry'
import { pageSummary } from './pageSummary'
import { specSections, type SpecRow } from './specView'
import './dev.css'

const EMPTY: string[] = []
const TABS: CodeFormat[] = ['css', 'tailwind', 'react', 'html']

function Row({ row }: { row: SpecRow }): JSX.Element {
  return (
    <div className="dev-row">
      <button type="button" className="dev-row__main" title="Click to copy" onClick={() => void writeText(row.copy ?? row.value, `Copied ${row.label.toLowerCase()}`)}>
        <span className="dev-row__label">{row.label}</span>
        <span className="dev-row__value">
          {row.swatch && <i className="dev-swatch" style={{ background: row.swatch }} />}
          {row.value}
        </span>
      </button>
      {row.token && <span className="dev-token">{row.token}</span>}
      {row.modes?.map((m) => (
        <div key={m.mode} className="dev-mode">
          <span>{m.mode}</span>
          <span className="dev-row__value">
            {m.swatch && <i className="dev-swatch" style={{ background: m.swatch }} />}
            {m.value}
          </span>
        </div>
      ))}
    </div>
  )
}

function CodeTabs({ doc, ids }: { doc: Doc; ids: string[] }): JSX.Element {
  const [tab, setTab] = useState<CodeFormat>('css')
  const code = useMemo(() => codeFor(doc, ids, tab), [doc, ids, tab])
  return (
    <section className="dev-sec">
      <h3 className="dev-sec__title">Code</h3>
      <Segmented<CodeFormat> value={tab} onChange={setTab} full options={TABS.map((t) => ({ value: t, label: CODE_LABEL[t] }))} />
      <button type="button" className="dev-code" title="Click to copy" onClick={() => void writeText(code, `Copied as ${CODE_LABEL[tab]}`)}>
        <pre>{code}</pre>
      </button>
    </section>
  )
}

/** The Dev section in its read-only form (it is edited in Design mode). */
export function DevInfoView({ dev }: { dev: DevInfo | undefined }): JSX.Element | null {
  if (!dev || !Object.keys(dev).length) return null
  const lines: Array<[string, string]> = []
  if (dev.ready) lines.push(['Ready', `Handoff v${dev.ready.at}`])
  if (dev.screen) lines.push(['Screen', `${dev.screen.name} · ${dev.screen.bp}`])
  if (dev.role) lines.push(['Role', dev.role])
  if (dev.label) lines.push(['Label', dev.label])
  if (dev.tab !== undefined) lines.push(['Focus order', String(dev.tab)])
  if (dev.needsDecision) lines.push(['Needs decision', dev.needsDecision])
  return (
    <section className="dev-sec dev-sec--dev" data-testid="dev-info">
      <h3 className="dev-sec__title">Dev notes</h3>
      {dev.notes && <p className="dev-notes">{dev.notes}</p>}
      {lines.map(([k, v]) => (
        <div key={k} className="dev-row">
          <div className="dev-row__main dev-row__main--static">
            <span className="dev-row__label">{k}</span>
            <span className="dev-row__value">{v}</span>
          </div>
        </div>
      ))}
      {dev.states &&
        Object.entries(dev.states).map(([state, patch]) => (
          <div key={state} className="dev-row">
            <div className="dev-row__main dev-row__main--static">
              <span className="dev-row__label">On {state}</span>
              <span className="dev-row__value">{Object.entries(patch).map(([k, v]) => `${k}: ${v}`).join('; ')}</span>
            </div>
          </div>
        ))}
    </section>
  )
}

function PageSummary({ docId }: { docId: string }): JSX.Element | null {
  const doc = useStore((s) => s.docs[docId])
  const page = useStore((s) => activePage(s, docId))
  const select = useStore((s) => s.select)
  const sum = doc && page ? pageSummary(doc, page.id) : null
  if (!sum) return null
  return (
    <div className="dev-panel" data-testid="dev-page-summary">
      <section className="dev-sec">
        <h3 className="dev-sec__title">{sum.pageName}</h3>
        <p className="dev-muted">
          {sum.screens.length} frame{sum.screens.length === 1 ? '' : 's'} · {sum.readyCount} ready · {sum.componentCount} component{sum.componentCount === 1 ? '' : 's'} · {sum.tokenCount} token
          {sum.tokenCount === 1 ? '' : 's'}
          {sum.modes.length > 1 ? ` · modes ${sum.modes.join(', ')}` : ''}
        </p>
        {sum.screens.map((s) => (
          <button key={s.id} type="button" className="dev-screen" onClick={() => select(docId, [s.id])}>
            <i className={['dev-dot', s.readyAt !== undefined && 'dev-dot--ready'].filter(Boolean).join(' ')} />
            <span className="dev-screen__name">{s.name}</span>
            <span className="dev-muted">{s.screen ? `${s.screen.name} · ${s.screen.bp}` : s.readyAt !== undefined ? `v${s.readyAt}` : 'not ready'}</span>
          </button>
        ))}
      </section>
      <p className="dev-hint">Select a layer to see its measurements, tokens and code.</p>
    </div>
  )
}

export function SpecPanel({ docId }: { docId: string }): JSX.Element {
  const doc = useStore((s) => s.docs[docId])
  const selection = useStore((s) => s.editors[docId]?.selection ?? EMPTY)
  const id = selection[0]
  const spec = useMemo(() => (doc && id ? nodeSpec(doc, id, { depth: 0, measure: (nid) => measure(nid, docId) }) : null), [doc, id, docId])
  if (!doc || !id || !spec) return <PageSummary docId={docId} />
  const sections = specSections(spec)
  return (
    <div className="dev-panel" data-testid="dev-spec">
      <header className="dev-head">
        <span className="dev-head__name">{spec.name}</span>
        <span className="dev-head__type">{spec.component ? 'Instance' : spec.type}</span>
      </header>
      {selection.length > 1 && <p className="dev-muted dev-pad">{selection.length} layers selected; showing the first.</p>}
      {sections.map((s) => (
        <section key={s.id} className="dev-sec">
          <h3 className="dev-sec__title">{s.title}</h3>
          {s.rows.map((r, i) => (
            <Row key={`${r.label}:${i}`} row={r} />
          ))}
        </section>
      ))}
      <DevInfoView dev={doc.nodes[id]?.dev} />
      <CodeTabs doc={doc} ids={selection} />
    </div>
  )
}
