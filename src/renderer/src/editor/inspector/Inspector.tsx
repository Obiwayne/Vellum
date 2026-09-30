// Right inspector (280px): top bar, then sections for the current selection (or the page).
import { useState } from 'react'
import { Button, Section } from '../../ui'
import { activePage, useStore } from '../../model/store'
import { isFlex } from '../../model/ops'
import { useCtx } from './common'
import { TopBar } from './TopBar'
import { ColorInput } from './ColorInput'
import { ConnectAgentModal, watchBridgeActivity } from './ConnectAgentModal'
import { LayoutSection } from './LayoutSection'
import { FlexSection } from './FlexSection'
import { BlendingSection, RadiusSection } from './BasicSections'
import { FillSection } from './FillSection'
import {
  BorderSection,
  ExportSection,
  FiltersSection,
  OutlineSection,
  PlaceholderSection,
  ShadowSection
} from './EffectSections'
import { StrokeSection, TextSection, UnderlineSection } from './TextSection'
import './inspector.css'

const EMPTY: string[] = []

function PageInspector({ docId }: { docId: string }): JSX.Element | null {
  const page = useStore((s) => activePage(s, docId))
  const setPageBackground = useStore((s) => s.setPageBackground)
  const [modal, setModal] = useState(false)
  if (!page) return null
  return (
    <>
      <Section title="Page">
        {/* setPageBackground coalesces by itself, so live drags are one undo step */}
        <ColorInput docId={docId} value={page.background} onChange={(c) => setPageBackground(docId, page.id, c)} />
      </Section>
      <Section title="MCP">
        <Button full onClick={() => setModal(true)}>
          Connect your agent
        </Button>
      </Section>
      <ConnectAgentModal open={modal} onClose={() => setModal(false)} />
    </>
  )
}

function SelectionInspector({ docId, ids }: { docId: string; ids: string[] }): JSX.Element | null {
  const doc = useStore((s) => s.docs[docId])
  const ctx = useCtx(docId, doc, ids)
  if (!ctx.nodes.length) return null
  const allText = ctx.nodes.every((n) => n.type === 'text')
  const allFlex = ctx.nodes.every((n) => isFlex(n))
  const key = ids.join(',')
  if (allText)
    return (
      <div key={key}>
        <LayoutSection ctx={ctx} />
        <BlendingSection ctx={ctx} />
        <FillSection ctx={ctx} text />
        <TextSection ctx={ctx} />
        <UnderlineSection ctx={ctx} />
        <StrokeSection ctx={ctx} />
        <ShadowSection ctx={ctx} text />
        <FiltersSection ctx={ctx} />
        <ExportSection ctx={ctx} />
      </div>
    )
  return (
    <div key={key}>
      <LayoutSection ctx={ctx} />
      {allFlex && <FlexSection ctx={ctx} />}
      <RadiusSection ctx={ctx} />
      <BlendingSection ctx={ctx} />
      <FillSection ctx={ctx} />
      <OutlineSection ctx={ctx} />
      <BorderSection ctx={ctx} />
      <ShadowSection ctx={ctx} />
      <ShadowSection ctx={ctx} inset />
      <FiltersSection ctx={ctx} />
      <PlaceholderSection title="Guides" />
      <PlaceholderSection title="Video" />
      <ExportSection ctx={ctx} />
    </div>
  )
}

export function Inspector({ docId }: { docId: string }): JSX.Element {
  watchBridgeActivity()
  const selection = useStore((s) => s.editors[docId]?.selection ?? EMPTY)
  const hasDoc = useStore((s) => Boolean(s.docs[docId]))
  return (
    <div className="insp">
      <TopBar docId={docId} />
      <div className="insp-scroll">
        {hasDoc && (selection.length ? <SelectionInspector docId={docId} ids={selection} /> : <PageInspector docId={docId} />)}
      </div>
    </div>
  )
}
