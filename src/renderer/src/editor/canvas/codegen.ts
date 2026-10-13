// Code for a set of layers in the formats the editor copies and the Dev Mode Spec panel shows. One place,
// so "Copy as" (actions.copyAs), Ctrl+C in Dev Mode and the code tabs always agree.
import { nodeToHtml, nodeToJsx, styleToCss } from '../../model/html'
import { nodeToTailwindJsx } from '../../bridge/tools-render'
import type { Doc } from '../../model/types'

export const CODE_LABEL = { html: 'HTML', jsx: 'JSX', css: 'CSS', tailwind: 'Tailwind', react: 'React' } as const
export type CodeFormat = keyof typeof CODE_LABEL

/** "Hero card / v2" → "HeroCardV2" (a valid component name). */
export function componentName(name: string): string {
  const s = name.replace(/[^A-Za-z0-9]+(.)?/g, (_m, c: string | undefined) => (c ? c.toUpperCase() : '')).replace(/^[^A-Za-z]+/, '')
  return s ? s[0].toUpperCase() + s.slice(1) : 'Design'
}

/**
 * The layers `ids` (already top-most, in tree order) as code. Tailwind is JSX with the same classes as
 * get_jsx (tokens become `bg-primary` / `p-(--gap)` references); React is a component with inline styles.
 */
export function codeFor(doc: Doc, ids: string[], format: CodeFormat): string {
  const live = ids.filter((id) => doc.nodes[id])
  if (!live.length) return ''
  if (format === 'html') return live.map((id) => nodeToHtml(doc, id)).join('\n')
  if (format === 'jsx') return live.map((id) => nodeToJsx(doc, id, 'inline-styles')).join('\n')
  if (format === 'tailwind') return live.map((id) => nodeToTailwindJsx(doc, id, '', true)).join('\n')
  if (format === 'react') {
    const many = live.length > 1
    const body = live.map((id) => nodeToJsx(doc, id, 'inline-styles', many ? '      ' : '    ')).join('\n')
    const jsx = many ? `    <>\n${body}\n    </>` : body
    return `export default function ${componentName(doc.nodes[live[0]].name)}() {\n  return (\n${jsx}\n  )\n}\n`
  }
  return live.map((id) => styleToCss(doc.nodes[id].style).replace(/; /g, ';\n') + ';').join('\n\n')
}
