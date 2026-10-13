// T62 test station: cases the build station's tests leave open (components from another page, hidden layers
// inside components, duplicate names, stack neutrality, absolute paths, hostile text, an opted-out comment).
import { describe, expect, it } from 'vitest'
import * as ops from '../model/ops'
import * as comp from '../model/components'
import { setDev } from '../model/dev'
import type { CNode, Doc } from '../model/types'
import { buildHandoff, type HandoffOptions } from './index'
import { CANARY, checkoutFixture } from './fixture'

const base: HandoffOptions = { version: 1, exportedAt: '2026-10-13T12:00:00Z', vellum: '1.0.0', projectLabel: 'Acme' }
const build = (doc: Doc, over: Partial<HandoffOptions> = {}) => buildHandoff(doc, { ...base, ...over })

function small() {
  const doc = ops.makeDoc('f', 'File')
  const page2 = ops.makePage(doc, 'Library')
  const root = doc.pages[0].rootId
  const add = (partial: Parameters<typeof ops.makeNode>[1], parent: string): CNode => {
    const n = ops.makeNode(doc, partial, false)
    ops.insertNode(doc, n, parent)
    return n
  }
  return { doc, root, lib: page2.rootId, add }
}

describe('components from another page', () => {
  it('a main on another page is pulled in only when an exported frame uses it, without its hidden layers', () => {
    const { doc, root, lib, add } = small()
    const main = add({ type: 'frame', name: 'Badge', style: { width: 60, height: 20, backgroundColor: '#FF0000' } }, lib)
    add({ type: 'text', name: 'Label', text: 'New', style: { fontSize: 12 } }, main.id)
    add({ type: 'text', name: 'HiddenInMain', text: 'CANARY_HIDDEN_IN_MAIN', style: {}, visible: false }, main.id)
    const unused = add({ type: 'frame', name: 'UnusedWidget', style: { width: 5, height: 5 } }, lib)
    comp.createComponent(doc, main.id, 'Badge')
    comp.createComponent(doc, unused.id, 'UnusedWidget')
    const screen = add({ type: 'frame', name: 'Home', style: { width: 400, height: 300 } }, root)
    comp.createInstance(doc, main.id, screen.id)
    setDev(doc, screen.id, { ready: { at: 1 } })
    const r = build(doc)
    expect(Object.keys(r.files)).toContain('components/badge.md')
    expect(Object.keys(r.files).some((p) => /unused/i.test(p))).toBe(false)
    const all = Object.values(r.files).join('\n')
    expect(all).not.toContain('CANARY_HIDDEN_IN_MAIN')
    expect(all).not.toContain('UnusedWidget')
    expect(all).not.toContain('Library')
  })
})

describe('naming', () => {
  it('two frames with the same name get -2, in document order, and never collide', () => {
    const { doc, root, add } = small()
    for (let i = 0; i < 3; i++) {
      const f = add({ type: 'frame', name: 'Home', style: { width: 100 + i, height: 100 }, x: i * 200 }, root)
      setDev(doc, f.id, { ready: { at: 1 } })
    }
    const r = build(doc)
    const screens = Object.keys(r.files).filter((p) => p.startsWith('screens/'))
    expect(screens).toEqual(['screens/home-2.md', 'screens/home-3.md', 'screens/home.md'])
    // and rebuilding gives the same assignment
    expect(Object.keys(build(doc).files)).toEqual(Object.keys(r.files))
  })
})

describe('stack neutrality and metadata', () => {
  const { doc } = checkoutFixture()
  const r = build(doc)

  it('no markdown file assumes a framework', () => {
    for (const [p, text] of Object.entries(r.files)) {
      if (!p.endsWith('.md')) continue
      expect(text, p).not.toMatch(/className=|useState|import React|from 'react'|<template>|ngIf|@Component/)
    }
  })

  it('no absolute path, drive letter, user folder or file URL appears anywhere', () => {
    for (const [p, text] of Object.entries(r.files)) {
      expect(text, p).not.toMatch(/[A-Za-z]:\\|\/Users\/|\/home\/|file:\/\/|\\\\/)
    }
  })

  it('the exportedAt and version come from the options, not a clock', () => {
    const a = build(doc, { exportedAt: '2001-02-03T04:05:06Z', version: 7 })
    const spec = JSON.parse(a.files['spec.json'])
    expect(spec.handoff).toMatchObject({ version: 7, exportedAt: '2001-02-03T04:05:06Z' })
    expect(a.files['spec.json']).not.toContain(String(new Date().getFullYear() + 1))
  })

  it('comments stay out whatever the options are', () => {
    const withExtras = build(doc, { ...({ comments: true, includeComments: true } as object) })
    expect(Object.keys(withExtras.files).some((p) => /comment/i.test(p))).toBe(false)
    expect(Object.values(withExtras.files).join('\n')).not.toContain(CANARY.comment)
  })
})

describe('hostile text', () => {
  // FINDING (T62 test station): a layer name or needs-decision text with a newline is written raw into the
  // markdown, so "# Injected heading" and "![x](http://evil)" become real lines of the screen file.
  // `it.fails` keeps the suite green while the builder fixes it; flip to `it` when it passes.
  it.fails('layer names and needs-decision stay on one line and cannot start a heading or an image', () => {
    const { doc, root, add } = small()
    const f = add({ type: 'frame', name: 'Hero\n# Injected heading\n![x](http://evil)', style: { width: 100, height: 100 } }, root)
    add({ type: 'text', name: '<script>alert(1)</script>', text: 'a\u0000b‮c', style: {} }, f.id)
    setDev(doc, f.id, { ready: { at: 1 }, notes: '```\n# not a real heading\n</script>\n```', needsDecision: 'x\r\ny' })
    const r = build(doc)
    expect(Object.keys(r.files).filter((p) => p.startsWith('screens/'))).toHaveLength(1)
    const md = r.files[Object.keys(r.files).find((p) => p.startsWith('screens/')) as string]
    // the layer name must not become a heading of its own
    expect(md.split('\n').filter((l) => l.startsWith('# Injected'))).toHaveLength(0)
    for (const text of Object.values(r.files)) {
      expect(text).not.toMatch(/\u0000|\r/)
    }
    expect(() => JSON.parse(r.files['spec.json'])).not.toThrow()
  })
})

describe('locked and nested', () => {
  it('a locked frame with children exports its children and no lock flag', () => {
    const { doc, root, add } = small()
    const f = add({ type: 'frame', name: 'Outer', style: { width: 100, height: 100 } }, root)
    const lockedGroup = add({ type: 'frame', name: 'Padlocked group', style: { width: 50, height: 50 }, locked: true }, f.id)
    add({ type: 'text', name: 'Inside group', text: 'Still here', style: {} }, lockedGroup.id)
    setDev(doc, f.id, { ready: { at: 1 } })
    const r = build(doc)
    const all = Object.values(r.files).join('\n')
    expect(all).toContain('Still here')
    expect(all).not.toMatch(/"locked"|\blocked\b|🔒/i)
  })
})
