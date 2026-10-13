// The sentence "Copy prompt" puts on the clipboard (docs/factory/T65-design.md section 4): it only names files that
// are in the exported tree, so a first handoff never points the agent at a CHANGES.md that was not written.

/** `paths` are bundle-relative POSIX paths of everything the export wrote. */
export function promptFor(paths: ReadonlyArray<string>): string {
  const has = (p: string): boolean => paths.includes(p)
  const first = has('HANDOFF.md') ? 'HANDOFF.md' : has('spec.json') ? 'spec.json' : null
  const read = first ? [`Read ${first} first`] : ['Read the files in this folder']
  if (has('CHANGES.md')) read.push('then CHANGES.md')
  const pngs = paths.some((p) => /^screens\/[^/]+\.png$/.test(p))
  const specs = paths.some((p) => /^screens\/[^/]+\.md$/.test(p))
  const verify = pngs ? 'build and verify against screens/*.png' : specs ? 'build from screens/*.md' : 'build from what they describe'
  return `${read.join(', ')}; ${verify}`
}
