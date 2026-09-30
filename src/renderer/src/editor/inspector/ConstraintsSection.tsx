// Constraints for positioned children of a frame: how they follow the parent's size. Plain CSS
// (left/right/width, top/bottom/height; see "constraints" in model/ops.ts), converted from the
// measured box so a change never moves the node.
import { AlignCenterHorizontal, AlignCenterVertical } from 'lucide-react'
import { Section, Select, type SelectEntry } from '../../ui'
import { axisConstraint, setConstraint, type Constraint, type ConstraintAxis } from '../../model/ops'
import { common, isMixed, type Ctx } from './common'

const H_OPTIONS: SelectEntry<Constraint>[] = [
  { value: 'start', label: 'Left' },
  { value: 'end', label: 'Right' },
  { value: 'both', label: 'Left & right' },
  { value: 'center', label: 'Center' },
  { value: 'scale', label: 'Scale' }
]
const V_OPTIONS: SelectEntry<Constraint>[] = [
  { value: 'start', label: 'Top' },
  { value: 'end', label: 'Bottom' },
  { value: 'both', label: 'Top & bottom' },
  { value: 'center', label: 'Center' },
  { value: 'scale', label: 'Scale' }
]

export function ConstraintsSection({ ctx }: { ctx: Ctx }): JSX.Element {
  const h = common(ctx.nodes, (n) => axisConstraint(n, 'h'))
  const v = common(ctx.nodes, (n) => axisConstraint(n, 'v'))
  const set = (axis: ConstraintAxis, c: Constraint): void =>
    ctx.each('Constraints', (n, d) => setConstraint(d, n.id, axis, c))
  return (
    <Section title="Constraints">
      <div className="insp-g2">
        <Select<Constraint>
          value={isMixed(h) ? null : h}
          placeholder="Mixed"
          icon={<AlignCenterVertical size={13} />}
          options={H_OPTIONS}
          onChange={(c) => set('h', c)}
        />
        <Select<Constraint>
          value={isMixed(v) ? null : v}
          placeholder="Mixed"
          icon={<AlignCenterHorizontal size={13} />}
          options={V_OPTIONS}
          onChange={(c) => set('v', c)}
        />
      </div>
    </Section>
  )
}
