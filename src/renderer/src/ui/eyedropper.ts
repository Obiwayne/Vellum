// Eyedropper: picks a colour from the app window. The Chromium EyeDropper API draws no cursor or
// magnifier inside Electron on Windows (the pointer just disappears), so this is our own: it
// captures the window once, shows a crosshair and a magnifier with the hex value over a
// transparent overlay, and samples the capture. Click picks, Esc or right-click cancels.
import { formatColor, parseColor } from './color'

let active = false
/** True while picking: popovers and editor shortcuts leave pointer and Escape to the eyedropper. */
export const isEyedropperActive = (): boolean => active

const LOUPE = 11 // pixels across
const ZOOM = 10 // screen px per pixel
const SIZE = LOUPE * ZOOM

const hex2 = (n: number): string => n.toString(16).padStart(2, '0').toUpperCase()

async function captureWindow(): Promise<ImageData | null> {
  const b64 = await window.canvasApi.capturePage()
  const img = new Image()
  img.src = `data:image/png;base64,${b64}`
  await img.decode()
  const c = document.createElement('canvas')
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(img, 0, 0)
  return ctx.getImageData(0, 0, c.width, c.height)
}

export async function pickScreenColor(): Promise<string | null> {
  if (active) return null
  active = true
  let shot: ImageData | null = null
  try {
    shot = await captureWindow()
  } catch {
    shot = null
  }
  if (!shot) {
    active = false
    return null
  }
  const data = shot
  // the capture is in device pixels
  const sx = data.width / window.innerWidth
  const sy = data.height / window.innerHeight
  const at = (x: number, y: number): [number, number, number] => {
    const px = Math.min(data.width - 1, Math.max(0, Math.floor(x * sx)))
    const py = Math.min(data.height - 1, Math.max(0, Math.floor(y * sy)))
    const i = (py * data.width + px) * 4
    return [data.data[i], data.data[i + 1], data.data[i + 2]]
  }

  const overlay = document.createElement('div')
  overlay.dataset.eyedropper = ''
  overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:transparent'
  const loupe = document.createElement('div')
  loupe.style.cssText =
    'position:fixed;pointer-events:none;display:none;flex-direction:column;align-items:center;gap:6px;left:0;top:0'
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  canvas.style.cssText = `width:${SIZE}px;height:${SIZE}px;border-radius:50%;box-shadow:0 0 0 2px #fff,0 0 0 3px rgba(0,0,0,.35),0 6px 20px rgba(0,0,0,.45);image-rendering:pixelated;background:#000`
  const label = document.createElement('div')
  label.style.cssText =
    'font:500 11px/16px var(--font-mono);padding:2px 6px;border-radius:4px;background:#1c1c1c;color:#fff;box-shadow:0 0 0 1px #444'
  loupe.append(canvas, label)
  overlay.append(loupe)
  document.body.append(overlay)
  const g = canvas.getContext('2d')

  const draw = (x: number, y: number): void => {
    if (!g) return
    const half = Math.floor(LOUPE / 2)
    for (let j = 0; j < LOUPE; j++) {
      for (let i = 0; i < LOUPE; i++) {
        // step one device pixel at a time around the pointer
        const [r, gg, b] = at(x + (i - half) / sx, y + (j - half) / sy)
        g.fillStyle = `rgb(${r},${gg},${b})`
        g.fillRect(i * ZOOM, j * ZOOM, ZOOM, ZOOM)
      }
    }
    g.strokeStyle = 'rgba(0,0,0,.18)'
    g.lineWidth = 1
    for (let k = 1; k < LOUPE; k++) {
      g.beginPath()
      g.moveTo(k * ZOOM + 0.5, 0)
      g.lineTo(k * ZOOM + 0.5, SIZE)
      g.moveTo(0, k * ZOOM + 0.5)
      g.lineTo(SIZE, k * ZOOM + 0.5)
      g.stroke()
    }
    const [r, gg, b] = at(x, y)
    g.strokeStyle = r * 0.3 + gg * 0.59 + b * 0.11 > 140 ? '#000' : '#fff'
    g.lineWidth = 2
    g.strokeRect(half * ZOOM + 1, half * ZOOM + 1, ZOOM - 2, ZOOM - 2)
    label.textContent = `#${hex2(r)}${hex2(gg)}${hex2(b)}`
    // keep the magnifier on screen: below-right of the pointer, flipped near the edges
    const w = SIZE
    const h = SIZE + 28
    const left = x + 18 + w > window.innerWidth ? x - 18 - w : x + 18
    const top = y + 18 + h > window.innerHeight ? y - 18 - h : y + 18
    loupe.style.transform = `translate(${left}px, ${top}px)`
    loupe.style.display = 'flex'
  }

  return new Promise<string | null>((resolve) => {
    const finish = (value: string | null): void => {
      overlay.removeEventListener('pointermove', move)
      overlay.removeEventListener('pointerdown', stop)
      overlay.removeEventListener('pointerup', up)
      overlay.removeEventListener('contextmenu', stop)
      window.removeEventListener('keydown', key, true)
      overlay.remove()
      // popovers ignore the click that ends picking
      setTimeout(() => {
        active = false
      }, 0)
      resolve(value)
    }
    const move = (e: PointerEvent): void => draw(e.clientX, e.clientY)
    const stop = (e: Event): void => {
      e.preventDefault()
      e.stopPropagation()
    }
    // pick on release, so no part of the click reaches the page under the overlay
    const up = (e: PointerEvent): void => {
      stop(e)
      if (e.button !== 0) return finish(null)
      const [r, g2, b] = at(e.clientX, e.clientY)
      const c = parseColor(`#${hex2(r)}${hex2(g2)}${hex2(b)}`)
      finish(c ? formatColor(c) : null)
    }
    const key = (e: KeyboardEvent): void => {
      stop(e)
      if (e.key === 'Escape') finish(null)
    }
    overlay.addEventListener('pointermove', move)
    overlay.addEventListener('pointerdown', stop)
    overlay.addEventListener('pointerup', up)
    overlay.addEventListener('contextmenu', stop)
    window.addEventListener('keydown', key, true)
  })
}
