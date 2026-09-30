// Theme token helpers: grouping by name prefix, CSS import/export, unique names.
import type { Token } from '../../model/types'

export type TokenGroup =
  | 'color'
  | 'font'
  | 'text'
  | 'weight'
  | 'tracking'
  | 'leading'
  | 'spacing'
  | 'radius'
  | 'breakpoint'
  | 'container'
  | 'opacity'
  | 'other'

/** Display order + labels + name prefix + default value for new tokens. Order of `prefix` matching matters (weight before font). */
export const GROUPS: { id: TokenGroup; label: string; prefix: string; sample: string }[] = [
  { id: 'color', label: 'Color', prefix: '--color-', sample: '#3E7FE0' },
  { id: 'font', label: 'Font family', prefix: '--font-', sample: 'Inter' },
  { id: 'text', label: 'Font size', prefix: '--text-', sample: '16px' },
  { id: 'weight', label: 'Font weight', prefix: '--font-weight-', sample: '400' },
  { id: 'tracking', label: 'Letter spacing', prefix: '--tracking-', sample: '0em' },
  { id: 'leading', label: 'Line height', prefix: '--leading-', sample: '150%' },
  { id: 'spacing', label: 'Spacing', prefix: '--spacing-', sample: '4px' },
  { id: 'radius', label: 'Radius', prefix: '--radius-', sample: '6px' },
  { id: 'breakpoint', label: 'Breakpoint', prefix: '--breakpoint-', sample: '768px' },
  { id: 'container', label: 'Container', prefix: '--container-', sample: '448px' },
  { id: 'opacity', label: 'Opacity', prefix: '--opacity-', sample: '50%' },
  { id: 'other', label: 'Other', prefix: '--', sample: '0' }
]

export function groupOf(name: string): TokenGroup {
  if (name.startsWith('--font-weight-')) return 'weight'
  for (const g of GROUPS) {
    if (g.id === 'weight' || g.id === 'other') continue
    if (name.startsWith(g.prefix)) return g.id
  }
  return 'other'
}

export function groupTokens(tokens: Token[]): { id: TokenGroup; label: string; tokens: Token[] }[] {
  return GROUPS.map((g) => ({ id: g.id, label: g.label, tokens: tokens.filter((t) => groupOf(t.name) === g.id) })).filter(
    (g) => g.tokens.length > 0
  )
}

/** "--color-gray-50" → "color-gray-50" */
export const displayName = (name: string): string => name.replace(/^--/, '')

/** Normalise user input into a custom property name. */
export function normalizeName(input: string): string {
  const s = input
    .trim()
    .replace(/^-+/, '')
    .replace(/\s+/g, '-')
    .replace(/[^\w-]/g, '')
  return s ? `--${s}` : ''
}

export function uniqueName(tokens: Token[], base: string): string {
  const names = new Set(tokens.map((t) => t.name))
  if (!names.has(base)) return base
  let i = 2
  while (names.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}

export function tokensToCss(tokens: Token[]): string {
  return `:root {\n${tokens.map((t) => `  ${t.name}: ${t.value};`).join('\n')}\n}\n`
}

/** Parse every `--name: value;` declaration out of CSS text (comments stripped). */
export function cssToTokens(css: string): Token[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out: Token[] = []
  const re = /(--[\w-]+)\s*:\s*([^;{}]+?)\s*(?:;|(?=}))/g
  let m: RegExpExecArray | null
  while ((m = re.exec(clean))) {
    const existing = out.find((t) => t.name === m![1])
    if (existing) existing.value = m[2].trim()
    else out.push({ name: m[1], value: m[2].trim() })
  }
  return out
}

/** Pick a file from disk and return its text (null when cancelled). */
export function pickTextFile(accept = '.css,text/css'): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = () => {
      const f = input.files?.[0]
      if (!f) return resolve(null)
      f.text().then(resolve, () => resolve(null))
    }
    input.click()
  })
}

export function downloadText(filename: string, text: string, type = 'text/css'): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
