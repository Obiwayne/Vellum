// Theme mode for frames: the frame (and everything inside it) uses that mode's token values.
import { Section, Select } from '../../ui'
import { getStore, useStore } from '../../model/store'
import { MODE_ATTR, effectiveMode, modesOf, nodeMode } from '../../model/modes'
import { common, isMixed, type Ctx } from './common'

const INHERIT = '__inherit__'

export function ModeSection({ ctx }: { ctx: Ctx }): JSX.Element | null {
  const doc = useStore((s) => s.docs[ctx.docId])
  const modes = modesOf(doc)
  if (!doc || !modes.length) return null
  const val = common(ctx.nodes, (n) => nodeMode(doc, n) ?? INHERIT)
  const inherited = ctx.nodes[0]?.parent ? effectiveMode(doc, ctx.nodes[0].parent) ?? modes[0] : modes[0]
  const set = (m: string): void =>
    getStore().mutate(ctx.docId, 'Set theme mode', (d) => {
      for (const id of ctx.ids) {
        const n = d.nodes[id]
        if (!n) continue
        if (m === INHERIT) {
          if (n.attrs) delete n.attrs[MODE_ATTR]
        } else (n.attrs ??= {})[MODE_ATTR] = m
      }
    })
  return (
    <Section title="Theme mode">
      <Select<string>
        value={isMixed(val) ? '' : val}
        placeholder="Mixed"
        options={[{ value: INHERIT, label: `Inherit (${inherited})` }, ...modes.map((m) => ({ value: m, label: m }))]}
        onChange={set}
      />
    </Section>
  )
}
