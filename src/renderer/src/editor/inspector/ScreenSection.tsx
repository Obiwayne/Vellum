// Inspector "Screen" section for a top-level frame (T58 plan section 6.2, screen D03): which screen this frame
// belongs to and at which breakpoint. Frames with the same screen name export as one screen with one section,
// one reference PNG and one delta table per breakpoint. Written through store.setScreen (dev.screen).
import { useEffect, useMemo, useState } from 'react'
import { Field, Section, Select } from '../../ui'
import { numericSize } from '../../model/ops'
import { BREAKPOINT_NAMES, BREAKPOINT_WIDTHS, isTopLevelFrame, screensOf, suggestBreakpoint } from '../../model/dev'
import { useStore } from '../../model/store'
import './screen.css'

const CUSTOM = '__custom__'

export function ScreenSection({ docId, id }: { docId: string; id: string }): JSX.Element | null {
  const doc = useStore((s) => s.docs[id ? docId : ''])
  const setScreen = useStore((s) => s.setScreen)
  const node = doc?.nodes[id]
  const tag = node?.dev?.screen
  const [name, setName] = useState(tag?.name ?? '')
  const [custom, setCustom] = useState(tag && !BREAKPOINT_NAMES.includes(tag.bp as never) ? tag.bp : '')
  useEffect(() => setName(tag?.name ?? ''), [id, tag?.name])
  useEffect(() => setCustom(tag && !BREAKPOINT_NAMES.includes(tag.bp as never) ? tag.bp : ''), [id, tag?.bp, tag])
  const siblings = useMemo(() => (doc ? screensOf(doc).find((s) => s.name.toLowerCase() === (tag?.name ?? '').trim().toLowerCase()) : undefined), [doc, tag?.name])
  if (!doc || !node || !isTopLevelFrame(doc, id)) return null

  const width = numericSize(node.style.width as string | number | undefined) ?? 0
  const guess = width ? suggestBreakpoint(width) : 'Desktop'
  const isNamed = tag && BREAKPOINT_NAMES.includes(tag.bp as never)
  const choice = !tag ? null : isNamed ? tag.bp : CUSTOM

  const write = (nextName: string, bp: string): void => {
    const n = nextName.trim()
    if (!n) {
      setScreen(docId, id, null)
      return
    }
    setScreen(docId, id, { name: n, bp: bp.trim() || guess })
  }

  return (
    <Section title="Screen">
      <div className="insp-scr__block" data-testid="screen-section">
        <Field
          label="Name"
          type="text"
          value={name}
          placeholder={node.name}
          title="Frames with the same screen name are exported as one screen with several breakpoints. Empty removes the tag."
          onChange={(v) => {
            const t = String(v)
            setName(t)
            write(t, tag?.bp ?? guess)
          }}
        />
        <div className="insp-scr__field">
          <span className="insp-scr__flabel">Breakpoint</span>
          <Select<string>
            value={choice}
            size="sm"
            placeholder="Not a screen"
            options={[
              ...BREAKPOINT_NAMES.map((b) => ({ value: b as string, label: `${b} · ${BREAKPOINT_WIDTHS[b]}` })),
              { value: CUSTOM, label: 'Custom…' }
            ]}
            onChange={(v) => write(name || node.name, v === CUSTOM ? custom || `${width || 0}` : v)}
          />
        </div>
        {choice === CUSTOM && (
          <Field
            label="Label"
            type="text"
            value={custom}
            placeholder="Wide, Small tablet, 600"
            onChange={(v) => {
              const t = String(v)
              setCustom(t)
              write(name || node.name, t)
            }}
          />
        )}
        {!tag && (
          <div className="insp-scr__hint">
            Not tagged: this frame is exported as its own screen. Name it and pick a breakpoint to group it with its other sizes. Looks like {guess} ({width || '?'} px).
          </div>
        )}
        {tag && siblings && siblings.frames.length > 1 && (
          <div className="insp-scr__hint" data-testid="screen-siblings">
            {siblings.frames.length} breakpoints: {siblings.frames.map((f) => `${f.bp}${f.id === id ? ' (this)' : ''}`).join(', ')}. The widest is the base the others are compared with.
          </div>
        )}
      </div>
    </Section>
  )
}
