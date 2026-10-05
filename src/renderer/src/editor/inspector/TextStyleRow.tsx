import { Link2, Plus, Unlink } from 'lucide-react'
import { IconButton, Select, type SelectEntry } from '../../ui'
import { getStore, useStore } from '../../model/store'
import { toast } from '../canvas/toast'
import { common, isMixed, type Ctx } from './common'

/** "None" option value: the node follows no text style. */
const NONE = ''

/** Create a style from the selected text node (exactly one), link the node to it, one undo step. */
export function createTextStyleFromNode(docId: string, id: string): string {
  const s = getStore()
  let sid = ''
  s.transact(docId, 'Create text style', () => {
    sid = s.createTextStyle(docId, 'Text style', id)
    s.applyTextStyle(docId, [id], sid)
  })
  return sid
}

/** Pick a text style for the selection ("None" detaches). Detach and apply are one undo step. */
export function pickTextStyle(docId: string, ids: string[], styleId: string): void {
  const s = getStore()
  if (styleId === NONE) s.detachTextStyle(docId, ids)
  else s.applyTextStyle(docId, ids, styleId)
}

/** Top row of the Text section: which text style the selection follows, plus create / detach. */
export function TextStyleRow({ ctx }: { ctx: Ctx }): JSX.Element {
  const styles = useStore((s) => s.docs[ctx.docId]?.textStyles) ?? []
  const linked = common(ctx.nodes, (n) => (n.textStyle !== undefined && styles.some((x) => x.id === n.textStyle) ? n.textStyle : NONE))
  const mixed = isMixed(linked)
  const current = mixed ? null : (linked as string)
  const following = mixed || current !== NONE
  const options: SelectEntry<string>[] = [{ value: NONE, label: 'None' }]
  if (styles.length) options.push('separator', ...styles.map((x) => ({ value: x.id, label: x.name })))
  const single = ctx.nodes.length === 1
  return (
    <div className="insp-tstyle" data-text-style={mixed ? 'mixed' : current || 'none'}>
      <Select<string>
        value={current}
        placeholder="Mixed"
        icon={<Link2 size={13} className={following ? 'insp-tstyle__on' : undefined} />}
        options={options}
        onChange={(v) => pickTextStyle(ctx.docId, ctx.ids, v)}
        className="insp-tstyle__select"
      />
      {following ? (
        <IconButton icon={<Unlink size={14} />} label="Detach from text style" onClick={() => pickTextStyle(ctx.docId, ctx.ids, NONE)} />
      ) : null}
      <IconButton
        icon={<Plus size={14} />}
        label={single ? 'Create text style from selection' : 'Select one text layer to create a style'}
        disabled={!single}
        onClick={() => {
          createTextStyleFromNode(ctx.docId, ctx.ids[0])
          toast('Text style created')
        }}
      />
    </div>
  )
}
