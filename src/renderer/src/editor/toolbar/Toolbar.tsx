// Vertical tool strip (40px). Tool keys are handled by editor/shortcuts.ts.
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Diamond, Hand, ImagePlus, Shapes, MessageCirclePlus, MousePointer2, PenTool, Scan, Square, VectorSquare } from 'lucide-react'
import { Button, IconButton, Modal } from '../../ui'
import { useStore } from '../../model/store'
import type { Tool } from '../../model/types'
import { createImageFromFile, insertSvgMarkup } from '../canvas/actions'
import { toolbarHooks } from '../shortcuts'
import { IconPicker } from './IconPicker'

interface ToolDef {
  tool: Tool
  label: string
  shortcut: string
  icon: ReactNode
}

const ICON = { size: 20, strokeWidth: 1.5 }

export const TOOL_GROUPS: ToolDef[][] = [
  [
    { tool: 'move', label: 'Move', shortcut: 'V', icon: <MousePointer2 {...ICON} /> },
    { tool: 'pan', label: 'Pan', shortcut: 'H', icon: <Hand {...ICON} /> }
  ],
  [
    { tool: 'frame', label: 'Frame', shortcut: 'F', icon: <Scan {...ICON} /> },
    { tool: 'rect', label: 'Rectangle', shortcut: 'R', icon: <Square {...ICON} /> },
    { tool: 'pen', label: 'Pen', shortcut: 'P', icon: <PenTool {...ICON} /> },
    {
      tool: 'text',
      label: 'Text',
      shortcut: 'T',
      icon: <span style={{ fontSize: 16, lineHeight: '20px', fontWeight: 400, letterSpacing: -0.3 }}>Aa</span>
    },
    { tool: 'comment', label: 'Comment', shortcut: 'C', icon: <MessageCirclePlus {...ICON} /> }
  ],
  [
    { tool: 'shader', label: 'Shaders', shortcut: 'S', icon: <Diamond {...ICON} /> },
    { tool: 'image', label: 'Create image', shortcut: 'Ctrl+Shift+I', icon: <ImagePlus {...ICON} /> },
    { tool: 'svg', label: 'Create SVG', shortcut: 'Ctrl+Shift+J', icon: <VectorSquare {...ICON} /> },
    { tool: 'icon', label: 'Icons', shortcut: 'Shift+I', icon: <Shapes {...ICON} /> }
  ]
]

export function Toolbar({ docId }: { docId: string }): JSX.Element {
  const tool = useStore((s) => s.editors[docId]?.tool ?? 'move')
  const setTool = useStore((s) => s.setTool)
  const [svgOpen, setSvgOpen] = useState(false)
  const [iconsOpen, setIconsOpen] = useState(false)

  const createImage = useCallback(() => createImageFromFile(docId), [docId])
  const createSvg = useCallback(() => setSvgOpen(true), [])
  const openIcons = useCallback(() => setIconsOpen(true), [])

  useEffect(() => {
    toolbarHooks.createImage = createImage
    toolbarHooks.createSvg = createSvg
    toolbarHooks.openIcons = openIcons
    return () => {
      if (toolbarHooks.openIcons === openIcons) toolbarHooks.openIcons = undefined
      if (toolbarHooks.createImage === createImage) toolbarHooks.createImage = undefined
      if (toolbarHooks.createSvg === createSvg) toolbarHooks.createSvg = undefined
    }
  }, [createImage, createSvg, openIcons])

  const onTool = (t: Tool): void => {
    if (t === 'image') createImage()
    else if (t === 'svg') createSvg()
    else if (t === 'icon') openIcons()
    else setTool(docId, t)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 4, gap: 4 }}>
      {TOOL_GROUPS.map((g, gi) => (
        <div key={gi} style={{ display: 'contents' }}>
          {gi > 0 && <div style={{ width: 16, height: 1, background: 'var(--hairline)', margin: '6px 0' }} />}
          {g.map((t) => (
            <IconButton
              key={t.tool}
              size={32}
              icon={t.icon}
              label={t.label}
              shortcut={t.shortcut}
              tooltipSide="right"
              active={tool === t.tool}
              onClick={() => onTool(t.tool)}
            />
          ))}
        </div>
      ))}
      <SvgDialog docId={docId} open={svgOpen} onClose={() => setSvgOpen(false)} />
      <IconPicker docId={docId} open={iconsOpen} onClose={() => setIconsOpen(false)} />
    </div>
  )
}

function SvgDialog({ docId, open, onClose }: { docId: string; open: boolean; onClose: () => void }): JSX.Element {
  const [text, setText] = useState('')
  useEffect(() => {
    if (open) setText('')
  }, [open])
  const submit = (): void => {
    if (insertSvgMarkup(docId, text)) onClose()
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create SVG"
      width={440}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!text.trim()}>
            Insert
          </Button>
        </>
      }
    >
      <textarea
        className="cv-svg-textarea"
        autoFocus
        placeholder={'Paste SVG markup, e.g. <svg viewBox="0 0 24 24">…</svg>'}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            submit()
          }
        }}
      />
    </Modal>
  )
}
