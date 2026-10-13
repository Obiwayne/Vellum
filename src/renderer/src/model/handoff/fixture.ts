// Test fixture for the bundle writer: one small checkout design that touches every part of the bundle, plus
// the canaries that must never reach it (T62). Built with the model's own operations, so it stays valid.
import * as ops from '../ops'
import * as comp from '../components'
import * as variants from '../variants'
import * as props from '../properties'
import * as styles from '../textStyles'
import { setDev, setReady, setScreen } from '../dev'
import type { CNode, Doc, WorldRect } from '../types'

export const CANARY = {
  hidden: 'CANARY-HIDDEN-LAYER',
  otherPage: 'CANARY-OTHER-PAGE',
  otherFrame: 'CANARY-UNCHOSEN-FRAME',
  comment: 'CANARY-COMMENT-TEXT',
  docName: 'CANARY-PERSON-NAME',
  thumbnail: 'data:image/png;base64,CANARYTHUMBNAIL',
  hiddenInComponent: 'CANARY-HIDDEN-IN-COMPONENT',
  dataUrl: 'data:image/png;base64,CANARYIMAGEBYTES'
} as const

export interface Fixture {
  doc: Doc
  /** the two chosen top-level frames: desktop and mobile of one screen */
  desktop: string
  mobile: string
  unchosen: string
  otherPage: string
  ids: Record<string, string>
  /** measured rects for every node of the chosen frames and mains, as the canvas would report them */
  measure: (id: string) => WorldRect | null
}

export function checkoutDoc(): Fixture {
  const doc = ops.makeDoc('file-1', CANARY.docName)
  doc.modes = ['Light', 'Dark']
  doc.thumbnail = CANARY.thumbnail
  doc.tokens = [
    { name: '--color-bg', value: '#FFFFFF', modes: { Dark: '#0B0F19' } },
    { name: '--color-text', value: 'var(--color-ink)', modes: { Dark: '#F9FAFB' } },
    { name: '--color-ink', value: '#111827' },
    { name: '--color-primary', value: 'oklch(0.55 0.2 260)', modes: { Dark: 'oklch(0.7 0.15 260)' } },
    { name: '--space-4', value: '16px' },
    { name: '--unused', value: '#FF00FF' },
    { name: '--font-body', value: 'Inter' }
  ]
  const page1 = doc.pages[0].rootId
  const add = (partial: Parameters<typeof ops.makeNode>[1], parent: string): CNode => {
    const n = ops.makeNode(doc, partial, false)
    ops.insertNode(doc, n, parent)
    return n
  }
  const ids: Record<string, string> = {}

  // a text style
  const heading = styles.createTextStyle(doc, 'Heading/H1', { fontFamily: 'Inter', fontSize: 32, fontWeight: 700, lineHeight: '1.25' })

  // ---- component: Button, with a State variant property
  const library = add({ type: 'frame', name: 'Library', x: 2000, y: 0, style: { width: 600, height: 200 } }, page1)
  const button = add(
    {
      type: 'frame',
      name: 'Button',
      x: 0,
      y: 0,
      style: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: '12px 20px',
        width: 'fit-content',
        height: 'fit-content',
        backgroundColor: 'var(--color-primary)',
        borderRadius: 8,
        boxShadow: '0px 1px 2px 0px rgba(0,0,0,0.25)'
      }
    },
    library.id
  )
  const label = add({ type: 'text', name: 'Label', text: 'Buy now', style: { color: '#FFFFFF', fontSize: 16, fontWeight: 600, fontFamily: 'Inter', lineHeight: 'normal' } }, button.id)
  add({ type: 'text', name: 'Secret badge', text: CANARY.hiddenInComponent, style: { fontSize: 8 } }, button.id).visible = false
  comp.createComponent(doc, button.id, 'Button')
  const hover = variants.createVariant(doc, button.id, undefined, 'State=hover')
  const setId = doc.nodes[button.id].component!.set!
  const stateProp = doc.nodes[setId].componentSet!.props[0].id
  variants.renameVariantProp(doc, setId, stateProp, 'State')
  variants.renameVariantOption(doc, setId, stateProp, 'Default', 'default')
  variants.renameVariantOption(doc, setId, stateProp, 'Variant 2', 'hover')
  doc.nodes[hover].style.backgroundColor = '#1D4ED8'
  const labelProp = props.addProp(doc, button.id, { name: 'Label', type: 'text', default: 'Buy now' })
  props.bindProp(doc, label.id, 'text', labelProp)
  setDev(doc, button.id, { states: { disabled: { opacity: 0.5 } }, role: 'button' })

  // ---- the screen: desktop (flex + grid + constraint + fractional) and mobile
  const desktop = add(
    {
      type: 'frame',
      name: 'Checkout Desktop',
      x: 0,
      y: 0,
      attrs: { 'data-mode': 'Light' },
      style: { width: 1280, height: 800, backgroundColor: 'var(--color-bg)', display: 'flex', flexDirection: 'column', gap: 24, padding: 'var(--space-4)' }
    },
    page1
  )
  const title = add({ type: 'text', name: 'Title', text: 'Checkout', style: { fontFamily: 'Inter', fontSize: 32, fontWeight: 700, lineHeight: '1.25', color: 'var(--color-text)' } }, desktop.id)
  title.textStyle = heading
  const summary = add(
    { type: 'frame', name: 'Summary', style: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16, padding: '16px', width: '100%', maxWidth: 640, height: 'fit-content' } },
    desktop.id
  )
  const item = add({ type: 'frame', name: 'Item', style: { width: '100%', height: 52.5, backgroundColor: '#F3F4F6', border: '1px solid #E5E7EB', borderRadius: 6 } }, summary.id)
  add({ type: 'text', name: 'Price', text: 'EUR 24.00', style: { fontSize: 14, color: 'var(--color-text)' } }, item.id)
  const badge = add({ type: 'rect', name: 'Sale badge', x: 0, y: 12, style: { position: 'absolute', right: 24, left: 'auto', width: 48, height: 24, backgroundColor: '#DC2626' } }, desktop.id)
  const buy = comp.createInstance(doc, button.id, desktop.id)
  doc.nodes[buy].name = 'Buy button'
  props.setInstanceProp(doc, buy, labelProp, 'Pay EUR 24.00')
  add({ type: 'text', name: 'Hidden promo', text: CANARY.hidden, style: { fontSize: 12 } }, desktop.id).visible = false
  const locked = add({ type: 'rect', name: 'Locked backdrop', x: 0, y: 0, style: { width: 1280, height: 800, backgroundColor: '#F9FAFB', position: 'absolute' } }, desktop.id)
  locked.locked = true
  const photo = add({ type: 'image', name: 'Hero photo', attrs: { src: CANARY.dataUrl }, style: { width: 320, height: 180, objectFit: 'cover' } }, desktop.id)
  photo.attrs = { src: CANARY.dataUrl }

  const mobile = add(
    {
      type: 'frame',
      name: 'Checkout Mobile',
      x: 1400,
      y: 0,
      style: { width: 390, height: 844, backgroundColor: 'var(--color-bg)', display: 'flex', flexDirection: 'column', gap: 16, padding: 16 }
    },
    page1
  )
  add({ type: 'text', name: 'Title', text: 'Checkout', style: { fontFamily: 'Inter', fontSize: 24, fontWeight: 700, color: 'var(--color-text)' } }, mobile.id)
  const buyM = comp.createInstance(doc, button.id, mobile.id)
  doc.nodes[buyM].name = 'Buy button'

  const unchosen = add({ type: 'frame', name: CANARY.otherFrame, x: 0, y: 2000, style: { width: 100, height: 100 } }, page1)
  add({ type: 'text', name: 'Unchosen text', text: CANARY.otherFrame, style: { fontSize: 12 } }, unchosen.id)

  // ---- a second page
  const p2 = ops.makePage(doc, 'Secret Archive')
  const other = add({ type: 'frame', name: CANARY.otherPage, x: 0, y: 0, style: { width: 100, height: 100 } }, p2.rootId)
  add({ type: 'text', name: 'Other text', text: CANARY.otherPage, style: { fontSize: 12 } }, other.id)

  // ---- a comment
  doc.comments = [
    {
      id: 'c1',
      number: 1,
      pageId: doc.pages[0].id,
      nodeId: desktop.id,
      ox: 0,
      oy: 0,
      x: 0,
      y: 0,
      status: 'open',
      messages: [{ id: 'm1', author: 'user', authorName: CANARY.docName, body: CANARY.comment, createdAt: 1 }],
      createdAt: 1,
      updatedAt: 1
    }
  ]

  // ---- dev info
  setScreen(doc, desktop.id, { name: 'Checkout', bp: 'Desktop' })
  setScreen(doc, mobile.id, { name: 'Checkout', bp: 'Mobile' })
  setReady(doc, [desktop.id, mobile.id], 3)
  setDev(doc, buy, { notes: 'Disabled until the form is valid.\n\nShow a spinner while the payment is pending.', role: 'button', label: 'Pay now', tab: 2 })
  setDev(doc, summary.id, { needsDecision: 'What happens with more than 4 items?' })
  setDev(doc, buy, { states: { hover: { backgroundColor: 'var(--color-primary)' } } })

  Object.assign(ids, { button: button.id, hover, title: title.id, summary: summary.id, item: item.id, badge: badge.id, buy, buyM, locked: locked.id, photo: photo.id, label: label.id, set: setId, stateProp, labelProp })

  // ---- measured rects: world coords; flow children are laid out top to bottom
  const rects = new Map<string, WorldRect>()
  const put = (id: string, x: number, y: number, w: number, h: number): void => void rects.set(id, { x, y, width: w, height: h })
  put(desktop.id, 0, 0, 1280, 800)
  put(title.id, 16, 16, 120.5, 40)
  put(summary.id, 16, 80, 640, 100.5)
  put(item.id, 32, 96, 303.75, 52.5)
  put(doc.nodes[item.id].children[0], 40, 104, 70, 17)
  put(badge.id, 1208, 12, 48, 24)
  put(buy, 16, 200, 116, 44)
  put(photo.id, 16, 260, 320, 180)
  put(locked.id, 0, 0, 1280, 800)
  put(mobile.id, 1400, 0, 390, 844)
  put(buyM, 1416, 100, 116, 44)
  put(button.id, 2000, 0, 116, 44)
  put(label.id, 2020, 12, 76, 20)
  put(hover, 2200, 0, 116, 44)
  put(doc.nodes[hover].children[0], 2220, 12, 76, 20)
  put(setId, 2000, 0, 400, 200)
  for (const inst of [buy, buyM]) {
    const base = rects.get(inst)!
    for (const c of doc.nodes[inst].children) put(c, base.x + 20, base.y + 12, 76, 20)
  }
  put(doc.nodes[desktop.id].children.find((c) => doc.nodes[c].name === 'Title')!, 16, 16, 120.5, 40)
  for (const c of doc.nodes[mobile.id].children) if (!rects.has(c)) put(c, 1416, 16, 120, 30)

  return { doc, desktop: desktop.id, mobile: mobile.id, unchosen: unchosen.id, otherPage: other.id, ids, measure: (id) => rects.get(id) ?? null }
}
