// Tiny transient notice shown at the bottom of the canvas (e.g. "Copied as HTML").
let el: HTMLDivElement | null = null
let timer: ReturnType<typeof setTimeout> | null = null

export function toast(message: string, ms = 1800): void {
  if (!el) {
    el = document.createElement('div')
    el.className = 'cv-toast'
    document.body.appendChild(el)
  }
  el.textContent = message
  el.classList.add('cv-toast--show')
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => el?.classList.remove('cv-toast--show'), ms)
}
