// Right inspector (280px): top bar, then sections for the current selection (or the page).
import { useState } from 'react'
import { Button, Section } from '../../ui'
import { activePage, useStore } from '../../model/store'
import { canConstrain, isFlex, isGrid } from '../../model/ops'
import { useCtx } from './common'
import { TopBar } from './TopBar'
import { ColorInput } from './ColorInput'
import { ConnectAgentModal, watchBridgeActivity } from './ConnectAgentModal'
import { LayoutSection } from './LayoutSection'
import { FlexSection } from './FlexSection'
import { GridItemSection, GridSection } from './GridSection'
import { ModeSection } from './ModeSection'
import { BlendingSection, ImageSection, RadiusSection } from './BasicSections'
import { ComponentSection } from './ComponentSection'
import { ConstraintsSection } from './ConstraintsSection'
import { FillSection } from './FillSection'
import {
  BorderSection,
  ExportSection,
  BackgroundBlurSection,
  FiltersSection,
  OutlineSection,
  PlaceholderSection,
  ShadowSection
} from './EffectSections'
import { StrokeSection, TextSection, UnderlineSection } from './TextSection'
import { SelectionColorsSection } from './SelectionColorsSection'
import { OtherStylesSection } from './OtherStylesSection'
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
  const allGrid = ctx.nodes.every((n) => isGrid(n))
  const allGridItems = ctx.nodes.every((n) => n.parent && isGrid(doc?.nodes[n.parent]) && n.style.position !== 'absolute')
  const constrainable = ctx.nodes.every((n) => doc && canConstrain(doc, n.id))
  const key = ids.join(',')
  if (allText)
    return (
      <div key={key}>
        <ComponentSection docId={docId} ids={ids} />
        <LayoutSection ctx={ctx} />
        {constrainable && <ConstraintsSection ctx={ctx} />}
        {allGridItems && <GridItemSection ctx={ctx} />}
        <BlendingSection ctx={ctx} />
        <FillSection ctx={ctx} text />
        <TextSection ctx={ctx} />
        <UnderlineSection ctx={ctx} />
        <StrokeSection ctx={ctx} />
        <ShadowSection ctx={ctx} text />
        <FiltersSection ctx={ctx} />
        <SelectionColorsSection ctx={ctx} />
        <OtherStylesSection ctx={ctx} />
        <ExportSection ctx={ctx} />
      </div>
    )
  return (
    <div key={key}>
      <ComponentSection docId={docId} ids={ids} />
      <LayoutSection ctx={ctx} />
      {constrainable && <ConstraintsSection ctx={ctx} />}
      {allGridItems && <GridItemSection ctx={ctx} />}
      {allFlex && <FlexSection ctx={ctx} />}
      {allGrid && <GridSection ctx={ctx} />}
      {ctx.nodes.every((n) => n.type === 'frame') && <ModeSection ctx={ctx} />}
      {ctx.nodes.every((n) => n.type === 'image') && <ImageSection ctx={ctx} />}
      <RadiusSection ctx={ctx} />
      <BlendingSection ctx={ctx} />
      <FillSection ctx={ctx} />
      <OutlineSection ctx={ctx} />
      <BorderSection ctx={ctx} />
      <ShadowSection ctx={ctx} />
      <ShadowSection ctx={ctx} inset />
      <FiltersSection ctx={ctx} />
      {ctx.nodes.every((n) => n.type === 'frame' || n.type === 'rect') && <BackgroundBlurSection ctx={ctx} />}
      <SelectionColorsSection ctx={ctx} />
      <OtherStylesSection ctx={ctx} />
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
