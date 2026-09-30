// Selection colours: each distinct colour in the selection (and everything inside it) once, with a
// use count. Editing a row replaces that colour everywhere in the selection as one undo step.
import { useMemo } from 'react'
import { Section } from '../../ui'
import { getStore } from '../../model/store'
import { co, type Ctx } from './common'
import { collectColors, replaceColor } from './colors'
import { ColorInput } from './ColorInput'

export function SelectionColorsSection({ ctx }: { ctx: Ctx }): JSX.Element | null {
  const { doc, docId, ids, nodes } = ctx
  const key = ids.join(',')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const uses = useMemo(() => collectColors(doc, ids), [doc, key])
  // a single childless node with one colour is already covered by Fill / Border / …
  const hasChildren = nodes.some((n) => n.children.length > 0)
  if (!uses.length || (!hasChildren && uses.length < 2)) return null
  const replace = (from: string, to: string, live: boolean): void => {
    if (from === to) return
    getStore().mutate(docId, 'Replace colour', (d) => replaceColor(d, ids, from, to), live ? co(ctx, 'selcolors') : undefined)
  }
  return (
    <Section title="Selection colors">
      {/* rows are keyed by position so the open picker survives the row's colour changing mid-drag */}
      {uses.map((u, i) => (
        <ColorInput
          key={i}
          docId={docId}
          value={u.key}
          showEyedropper={false}
          onChange={(c, { live }) => replace(u.key, c, live)}
          trailing={
            <span className="insp-selcolor__count" title={`Used ${u.count} time${u.count === 1 ? '' : 's'}`}>
              {u.count}
            </span>
          }
        />
      ))}
    </Section>
  )
}
