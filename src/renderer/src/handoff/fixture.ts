// Test fixture for the bundle writer: one small "checkout" file that exercises flex, a fractional size, two
// modes, tokens that reference tokens, a text style, a component set with variants, an instance, dev notes, a
// state rule, a two-breakpoint screen, and every canary the safety tests look for. Not imported by app code.
import type { CNode, Doc } from '../model/types'
import * as ops from '../model/ops'
import * as comp from '../model/components'
import * as variants from '../model/variants'
import { setDev } from '../model/dev'

export const CANARY = {
  hidden: 'CANARY_HIDDEN_LAYER',
  hiddenChild: 'CANARY_HIDDEN_CHILD',
  otherPage: 'CANARY_OTHER_PAGE',
  unchosen: 'CANARY_UNCHOSEN_FRAME',
  comment: 'CANARY_COMMENT_BODY',
  commenter: 'CANARY_COMMENTER_NAME',
  profile: 'Alice Canary-Person',
  thumbnail: 'CANARY_THUMBNAIL_BYTES',
  unusedToken: '--canary-unused-token'
}

export interface Fixture {
  doc: Doc
  ids: { desktop: string; mobile: string; unchosen: string; button: string; buttonSet: string; card: string; heading: string; instance: string; hidden: string; locked: string }
}

export function checkoutFixture(): Fixture {
  const doc = ops.makeDoc('file-checkout', CANARY.profile)
  doc.modes = ['Light', 'Dark']
  doc.thumbnail = `data:image/png;base64,${CANARY.thumbnail}`
  doc.tokens = [
    { name: '--color-brand', value: '#2563EB', modes: { Dark: '#60A5FA' } },
    { name: '--color-brand-hover', value: 'var(--color-brand)', modes: { Dark: '#93C5FD' } },
    { name: '--color-surface', value: '#FFFFFF', modes: { Dark: '#111827' } },
    { name: '--color-text', value: 'oklch(0.2 0.02 250)', modes: { Dark: '#F9FAFB' } },
    { name: '--space-4', value: '16px' },
    { name: '--text-xl', value: '28px' },
    { name: CANARY.unusedToken, value: '#FF00FF' }
  ]
  const page1 = doc.pages[0]
  const page2 = ops.makePage(doc, 'Secret page')
  void page2
  const root = page1.rootId
  const add = (partial: Parameters<typeof ops.makeNode>[1], parent: string): CNode => {
    const n = ops.makeNode(doc, partial, false)
    ops.insertNode(doc, n, parent)
    return n
  }

  const frame = (name: string, parent: string, style: Record<string, string | number>, extra: Partial<CNode> = {}): CNode =>
    add({ type: 'frame', name, style, ...extra }, parent)

  // ---- text style
  doc.textStyles = [{ id: 'ts-h1', name: 'Heading/H1', style: { fontFamily: 'Inter, sans-serif', fontSize: 'var(--text-xl)', fontWeight: 700, lineHeight: '36px' } }]

  // ---- the Button component set (kept on the same page, not ready, so it is only exported where used)
  const main = frame('Button', root, { display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', width: 160, height: 44, paddingLeft: 16, paddingRight: 16, backgroundColor: 'var(--color-brand)', borderRadius: 8 }, { x: 2000, y: 0 })
  add({ type: 'text', name: 'Label', text: 'Buy', style: { fontFamily: 'Inter, sans-serif', fontSize: 16, fontWeight: 600, color: '#FFFFFF' } }, main.id)
  comp.createComponent(doc, main.id, 'Button')
  const second = variants.createVariant(doc, main.id, undefined, 'Button / Large')
  const setId = doc.nodes[main.id].component?.set ?? ''
  doc.nodes[second].style.height = 56
  setDev(doc, main.id, { notes: 'Primary call to action.\n\nOnly one per screen.', states: { hover: { backgroundColor: 'var(--color-brand-hover)' } } })

  // ---- the desktop screen
  const desktop = frame('Checkout', root, { display: 'flex', flexDirection: 'column', gap: 16, padding: 24, width: 1280, height: 800, backgroundColor: 'var(--color-surface)' }, { x: 0, y: 0 })
  const heading = add({ type: 'text', name: 'Title', text: 'Pay now', style: { fontFamily: 'Inter, sans-serif', fontSize: 'var(--text-xl)', fontWeight: 700, lineHeight: '36px', color: 'var(--color-text)' } }, desktop.id)
  doc.nodes[heading.id].textStyle = 'ts-h1'
  const card = frame('Card', desktop.id, { display: 'flex', flexDirection: 'row', gap: 'var(--space-4)', width: 347.5, height: 52, backgroundColor: 'var(--color-surface)', borderRadius: 12, border: '1px solid #E5E7EB' })
  add({ type: 'text', name: 'Amount', text: 'Total 42.00', style: { fontFamily: 'Inter, sans-serif', fontSize: 16, fontWeight: 400, color: 'var(--color-text)' } }, card.id)
  setDev(doc, card.id, { notes: 'Collapses to a single column under 640px.', needsDecision: 'Is the card tappable?', role: 'region', label: 'Order total' })
  const instance = comp.createInstance(doc, main.id, desktop.id)
  const locked = add({ type: 'rect', name: 'Locked divider', style: { width: 400, height: 1, backgroundColor: '#E5E7EB' }, locked: true }, desktop.id)
  const hidden = add({ type: 'text', name: CANARY.hidden, text: CANARY.hidden, style: { fontSize: 12 }, visible: false }, desktop.id)
  const hiddenGroup = frame('Hidden group', desktop.id, { width: 10, height: 10 }, { visible: false })
  add({ type: 'text', name: 'inside', text: CANARY.hiddenChild, style: {} }, hiddenGroup.id)
  setDev(doc, desktop.id, { ready: { at: 1 }, screen: { name: 'Checkout', bp: 'Desktop' } })

  // ---- the mobile breakpoint
  const mobile = frame('Checkout mobile', root, { display: 'flex', flexDirection: 'column', gap: 12, padding: 16, width: 390, height: 844, backgroundColor: 'var(--color-surface)' }, { x: 0, y: 1000 })
  const mobileTitle = add({ type: 'text', name: 'Title', text: 'Pay now', style: { fontFamily: 'Inter, sans-serif', fontSize: 'var(--text-xl)', fontWeight: 700, lineHeight: '36px', color: 'var(--color-text)' } }, mobile.id)
  doc.nodes[mobileTitle.id].textStyle = 'ts-h1'
  setDev(doc, mobile.id, { ready: { at: 1 }, screen: { name: 'Checkout', bp: 'Mobile' } })

  // ---- a frame that is not chosen
  const unchosen = frame('Scratch', root, { width: 300, height: 300 }, { x: 0, y: 2000 })
  add({ type: 'text', name: 'Scratch text', text: CANARY.unchosen, style: {} }, unchosen.id)

  // ---- another page
  const otherRoot = doc.pages[1].rootId
  const secret = add({ type: 'frame', name: 'Secret', style: { width: 200, height: 200 } }, otherRoot)
  add({ type: 'text', name: 'Secret text', text: CANARY.otherPage, style: {} }, secret.id)

  // ---- a comment thread on the desktop frame
  doc.comments = [
    {
      id: 'c1',
      number: 1,
      pageId: page1.id,
      nodeId: desktop.id,
      ox: 4,
      oy: 4,
      x: 0,
      y: 0,
      status: 'open',
      createdAt: 1,
      updatedAt: 1,
      messages: [{ id: 'm1', author: 'user', authorName: CANARY.commenter, body: CANARY.comment, createdAt: 1 }]
    }
  ]
  return {
    doc,
    ids: { desktop: desktop.id, mobile: mobile.id, unchosen: unchosen.id, button: main.id, buttonSet: setId, card: card.id, heading: heading.id, instance, hidden: hidden.id, locked: locked.id }
  }
}
