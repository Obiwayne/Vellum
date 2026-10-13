// Inspector "Dev" sections (Design mode only): dev notes, interaction states, accessibility. Everything is written
// through setDev (model/dev.ts), one undo step per edit, and read back by the handoff bundle. T58 plan section 7,
// screen D03. Dev Mode shows the same data read-only in the Spec panel.
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Button, Field, Section, Select } from '../../ui'
import { useStore, getStore } from '../../model/store'
import { textContrast } from '../../model/contrast'
import { KNOWN_STATES, ROLES, canonicalState, drawnStateDeltas, inferRole, missingCoreStates, stateProp, stateTarget } from '../../model/devState'
import type { CNode, Doc, StylePatch } from '../../model/types'
import { toast } from '../canvas/toast'
import { ColorInput } from './ColorInput'

/** Properties a state rule usually changes. `color` ones get the colour picker with the token list. */
export const STATE_PROPS: Array<{ key: string; label: string; color?: boolean }> = [
  { key: 'backgroundColor', label: 'Fill', color: true },
  { key: 'color', label: 'Text colour', color: true },
  { key: 'borderColor', label: 'Border colour', color: true },
  { key: 'outlineColor', label: 'Outline colour', color: true },
  { key: 'opacity', label: 'Opacity' },
  { key: 'boxShadow', label: 'Shadow' },
  { key: 'transform', label: 'Transform' },
  { key: 'textDecorationLine', label: 'Underline' }
]

const ratioText = (r: number): string => `${r.toFixed(2).replace(/\.?0+$/, '')}:1`
const flag = (aa: boolean, aaa: boolean): string => (aaa ? 'AAA' : aa ? 'AA' : 'fails AA')

function useNode(docId: string, id: string): { doc: Doc; node: CNode } | null {
  const doc = useStore((s) => s.docs[docId])
  const node = doc?.nodes[id]
  return doc && node ? { doc, node } : null
}

/** Dev notes: written for the developer, kept out of every copy and export of the design. */
function NotesSection({ docId, node }: { docId: string; node: CNode }): JSX.Element {
  const setDev = useStore((s) => s.setDev)
  const [text, setText] = useState(node.dev?.notes ?? '')
  const [question, setQuestion] = useState(node.dev?.needsDecision ?? '')
  // follow undo/redo and selection changes
  useEffect(() => setText(node.dev?.notes ?? ''), [node.id, node.dev?.notes])
  useEffect(() => setQuestion(node.dev?.needsDecision ?? ''), [node.id, node.dev?.needsDecision])
  return (
    <Section title="Dev notes">
      <div className="insp-dev__block">
        <textarea
          className="insp-dev__notes"
          rows={4}
          value={text}
          placeholder="Behaviour, data, edge cases for the developer"
          aria-label="Dev notes"
          onChange={(e) => {
            setText(e.target.value)
            setDev(docId, [node.id], { notes: e.target.value }, { coalesce: `dev-notes:${node.id}` })
          }}
        />
        <Field
          label="?"
          type="text"
          value={question}
          placeholder="Open question for the developer"
          title="Needs decision: listed in HANDOFF.md"
          onChange={(v) => {
            const t = String(v)
            setQuestion(t)
            setDev(docId, [node.id], { needsDecision: t.trim() ? t : null })
          }}
        />
      </div>
    </Section>
  )
}

type Draft = { state: string; prop: string; value: string }

/** Interaction states: drawn (a State variant), described (rules on the layer) and the ones still missing. */
function StatesSection({ docId, node }: { docId: string; node: CNode }): JSX.Element | null {
  const doc = useStore((s) => s.docs[docId])
  const setDev = useStore((s) => s.setDev)
  const makeState = useStore((s) => s.makeStateProperty)
  const [draft, setDraft] = useState<Draft | null>(null)
  if (!doc) return null
  const setId = node.componentSet ? node.id : node.component?.set && doc.nodes[node.component.set]?.componentSet ? node.component.set : null
  const isMain = Boolean(node.component || node.componentSet)
  const drawn = setId ? drawnStateDeltas(doc, setId) : []
  const hasStateProp = Boolean(stateProp(doc, node.componentSet ? node.id : node.component ? node.id : ''))
  const described = Object.entries(node.dev?.states ?? {})
  const seen = new Set(drawn.map((d) => d.state))
  for (const [k] of described) seen.add(canonicalState(k))
  const missing = isMain ? missingCoreStates(seen) : []
  const nothing = !drawn.length && !described.length && !missing.length

  const writePatch = (state: string, patch: StylePatch): void => setDev(docId, [node.id], { states: { [state]: patch } })
  const dropState = (state: string): void => setDev(docId, [node.id], { states: { [state]: null } })
  const addRule = (): void => {
    if (!draft || !draft.state || !draft.prop || !draft.value.trim()) return
    const key = canonicalState(draft.state)
    const current = (node.dev?.states ?? {})[key] ?? {}
    writePatch(key, { ...current, [draft.prop]: draft.value.trim() })
    setDraft(null)
  }
  const prop = STATE_PROPS.find((p) => p.key === draft?.prop)

  return (
    <Section title="States" onAdd={() => setDraft(draft ? null : { state: 'hover', prop: 'backgroundColor', value: '' })} addLabel="Add state rule">
      <div className="insp-dev__block" data-testid="dev-states">
        {nothing && <div className="insp-dev__hint">No states yet. Add a rule for hover, pressed, focus or disabled.</div>}
        {drawn.map((d) => (
          <div key={`drawn:${d.state}`} className="insp-dev__row" data-badge="drawn">
            <span className="insp-dev__name">{d.state}</span>
            <span className="insp-dev__what" title={d.changes.map((c) => `${c.layer || 'Layer'}: ${Object.keys(c.patch).join(', ')}`).join('\n')}>
              {`State=${d.option}${d.changes.length ? ` · ${d.changes.reduce((n, c) => n + Object.keys(c.patch).length, 0)} changed` : ''}`}
            </span>
            <span className="insp-dev__badge insp-dev__badge--drawn">drawn</span>
          </div>
        ))}
        {described.map(([state, patch]) => (
          <div key={`described:${state}`} className="insp-dev__rule">
            <div className="insp-dev__row" data-badge="described">
              <span className="insp-dev__name">{state}</span>
              <span className="insp-dev__what insp-dev__what--mono" title={stateTarget(state).css || stateTarget(state).attr}>
                {stateTarget(state).css || stateTarget(state).attr || ''}
              </span>
              <span className="insp-dev__badge insp-dev__badge--described">described</span>
              <button type="button" className="insp-dev__x" aria-label={`Remove ${state}`} onClick={() => dropState(state)}>
                <X size={12} />
              </button>
            </div>
            {Object.entries(patch).map(([k, v]) => (
              <div key={k} className="insp-dev__prop">
                <span>{STATE_PROPS.find((p) => p.key === k)?.label ?? k}</span>
                <span className="insp-dev__what insp-dev__what--mono">{String(v)}</span>
                <button
                  type="button"
                  className="insp-dev__x"
                  aria-label={`Remove ${k} from ${state}`}
                  onClick={() => {
                    const rest = { ...patch }
                    delete rest[k]
                    if (Object.keys(rest).length) writePatch(state, rest)
                    else dropState(state)
                  }}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        ))}
        {missing.map((s) => (
          <div key={`missing:${s}`} className="insp-dev__row" data-badge="missing">
            <span className="insp-dev__name">{s}</span>
            <span className="insp-dev__what insp-dev__hintline">Not specified</span>
            <span className="insp-dev__badge insp-dev__badge--missing">missing</span>
          </div>
        ))}
        {draft && (
          <div className="insp-dev__draft" data-testid="dev-state-draft">
            <Select<string>
              value={draft.state}
              size="sm"
              options={[...KNOWN_STATES.filter((s) => s !== 'default').map((s) => ({ value: s as string, label: s }))]}
              onChange={(v) => setDraft({ ...draft, state: v })}
            />
            <Select<string> value={draft.prop} size="sm" options={STATE_PROPS.map((p) => ({ value: p.key, label: p.label }))} onChange={(v) => setDraft({ ...draft, prop: v, value: '' })} />
            {prop?.color ? (
              <ColorInput docId={docId} nodeId={node.id} value={draft.value || '#000000'} onChange={(c) => setDraft({ ...draft, value: c })} />
            ) : (
              <Field type="text" size="sm" value={draft.value} placeholder={prop?.key === 'opacity' ? '0.5' : 'value'} onChange={(v) => setDraft({ ...draft, value: String(v) })} />
            )}
            <div className="insp-dev__actions">
              <Button size="sm" onClick={addRule} disabled={!draft.value.trim()}>
                Add rule
              </Button>
              <Button size="sm" onClick={() => setDraft(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        {isMain && !hasStateProp && (
          <Button
            size="sm"
            full
            title="Set this component up with a State property (default, hover) to draw states as variants"
            onClick={() => {
              const r = makeState(docId, node.id)
              if (!r.ok) toast(r.reason)
              else toast('State property ready: restyle the hover variant')
            }}
          >
            Make State property
          </Button>
        )}
      </div>
    </Section>
  )
}

/** Role, label, focus order and, for text and images, contrast and alt text. */
function AccessibilitySection({ docId, node }: { docId: string; node: CNode }): JSX.Element {
  const doc = useStore((s) => s.docs[docId]) as Doc
  const setDev = useStore((s) => s.setDev)
  const inferred = inferRole(doc, node.id)
  const [label, setLabel] = useState(node.dev?.label ?? '')
  useEffect(() => setLabel(node.dev?.label ?? ''), [node.id, node.dev?.label])
  const contrast = node.type === 'text' ? textContrast(doc, node.id) : null
  const missingAlt = node.type === 'image' && node.attrs?.alt === undefined
  return (
    <Section title="Accessibility">
      <div className="insp-dev__block" data-testid="dev-a11y">
        <div className="insp-dev__field">
          <span className="insp-dev__flabel">Role</span>
          <Select<string>
            value={node.dev?.role ?? (inferred ? '' : null)}
            size="sm"
            placeholder="None"
            options={[{ value: '', label: inferred ? `${inferred} (inferred)` : 'None' }, 'separator', ...ROLES.map((r) => ({ value: r as string, label: r }))]}
            onChange={(v) => setDev(docId, [node.id], { role: v || null })}
          />
        </div>
        <Field
          label="Label"
          type="text"
          value={label}
          placeholder="Accessible name"
          onChange={(v) => {
            const t = String(v)
            setLabel(t)
            setDev(docId, [node.id], { label: t.trim() ? t : null })
          }}
        />
        <Field
          label="Focus order"
          title="Position in the tab order; 0 goes back to reading order"
          type="number"
          min={0}
          step={1}
          precision={0}
          value={node.dev?.tab ?? null}
          placeholder="Reading order"
          onChange={(v) => {
            const n = typeof v === 'number' ? Math.round(v) : parseInt(String(v), 10)
            setDev(docId, [node.id], { tab: Number.isFinite(n) && n > 0 ? n : null })
          }}
        />
        {contrast &&
          (contrast.ok ? (
            contrast.results.map((r) => (
              <div key={r.mode} className="insp-dev__row" data-testid="dev-contrast" data-pass={r.aa}>
                <span className="insp-dev__name">Contrast{contrast.results.length > 1 ? ` · ${r.mode}` : ''}</span>
                <span className="insp-dev__what insp-dev__what--mono" title={`${r.fg} on ${r.bg}${r.large ? ' (large text)' : ''}`}>
                  {ratioText(r.ratio)}
                </span>
                <span className={['insp-dev__badge', r.aa ? 'insp-dev__badge--drawn' : 'insp-dev__badge--missing'].join(' ')}>{flag(r.aa, r.aaa)}</span>
              </div>
            ))
          ) : (
            contrast.reason !== 'hidden' && (
              <div className="insp-dev__hint" data-testid="dev-contrast-skipped">
                Contrast not computed: {contrast.reason}.
              </div>
            )
          ))}
        {missingAlt && (
          <div className="insp-dev__hint insp-dev__hint--warn" data-testid="dev-alt-missing">
            No alt text. Set it in the image section, or an empty alt when the image is decorative.
            <Button
              size="sm"
              onClick={() => getStore().updateNode(docId, node.id, { attrs: { ...(node.attrs ?? {}), alt: '' } })}
              title="Mark as decorative (alt text empty on purpose)"
            >
              Mark decorative
            </Button>
          </div>
        )}
      </div>
    </Section>
  )
}

/** The three Dev sections for one selected layer. */
export function DevSections({ docId, id }: { docId: string; id: string }): JSX.Element | null {
  const ctx = useNode(docId, id)
  if (!ctx) return null
  return (
    <>
      <NotesSection docId={docId} node={ctx.node} />
      <StatesSection docId={docId} node={ctx.node} />
      <AccessibilitySection docId={docId} node={ctx.node} />
    </>
  )
}
