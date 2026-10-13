// @vitest-environment jsdom
import { createElement, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RedlineLayer } from './RedlineLayer'
import { redlines } from '../../model/redlines'
import type { RedlineScene } from './redlineScene'
import type { Camera } from '../../model/types'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLElement
let root: Root
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const cam = (zoom: number): Camera => ({ x: 10, y: 20, zoom })
const draw = (scene: RedlineScene, zoom: number): void => act(() => root.render(createElement(RedlineLayer, { scene, cam: cam(zoom) })))
const sceneOf = (): RedlineScene => redlines({ x: 0, y: 0, width: 100, height: 100 }, { x: 180, y: 20, width: 40, height: 40 })

describe('RedlineLayer', () => {
  it('draws one line and one label per distance, in the redline colour class', () => {
    draw(sceneOf(), 1)
    const lines = host.querySelectorAll('.cv-redline')
    expect(lines).toHaveLength(1)
    expect(lines[0].getAttribute('data-value')).toBe('80')
    expect(host.querySelector('.cv-redline-label')?.textContent).toBe('80')
    expect(host.querySelector('.cv-redline--gap')).not.toBeNull()
  })

  it('places the line with the camera, and keeps the label chip size at any zoom', () => {
    draw(sceneOf(), 2)
    const body = host.querySelector('.cv-redline-body') as HTMLElement
    // world x 100..180 at zoom 2 with camera x 10: left 210, width 160; world y 40 -> 40*2+20 = 100
    expect(body.style.left).toBe('210px')
    expect(body.style.width).toBe('160px')
    expect(body.style.height).toBe('1px')
    expect(body.style.top).toBe('99.5px')
    const label = host.querySelector('.cv-redline-label') as HTMLElement
    expect(label.style.fontSize).toBe('') // size comes from the class, not from the zoom
    expect(label.style.transform).toBe('')
    draw(sceneOf(), 0.25)
    expect((host.querySelector('.cv-redline-body') as HTMLElement).style.width).toBe('20px')
    expect(host.querySelector('.cv-redline-label')?.textContent).toBe('80')
  })

  it('draws a vertical line with a vertical tick pair', () => {
    draw(redlines({ x: 0, y: 0, width: 100, height: 50 }, { x: 10, y: 120, width: 30, height: 30 }), 1)
    const body = host.querySelector('.cv-redline-body') as HTMLElement
    expect(body.style.width).toBe('1px')
    expect(body.style.height).toBe('70px')
    expect(host.querySelectorAll('.cv-redline-tick')).toHaveLength(2)
  })

  it('says "rotated" instead of distances', () => {
    const scene: RedlineScene = { ...redlines({ x: 0, y: 0, width: 10, height: 10, rotated: true }, null), noteAt: { x: 0, y: 0, width: 10, height: 10 } }
    draw(scene, 1)
    expect(host.querySelectorAll('.cv-redline')).toHaveLength(0)
    expect(host.querySelector('.cv-redline-label--note')?.textContent).toBe('rotated')
  })

  it('never takes the pointer', () => {
    draw(sceneOf(), 1)
    expect(host.querySelector('[data-testid="redlines"]')?.className).toBe('cv-redlines')
  })
})
