// The file tree the dialog previews, compact like D02: top-level files on one line each group, folders summarised.

const MAX_NAMES = 6

function summarise(names: string[]): string {
  const shown = names.slice(0, MAX_NAMES).join('  ')
  return names.length > MAX_NAMES ? `${shown}  + ${names.length - MAX_NAMES} more` : shown
}

/** `paths` are bundle-relative POSIX paths; `root` is the folder name printed first. */
export function treeLines(paths: string[], root: string): string[] {
  const top: string[] = []
  const dirs = new Map<string, string[]>()
  for (const p of [...paths].sort()) {
    const i = p.indexOf('/')
    if (i < 0) top.push(p)
    else {
      const d = p.slice(0, i)
      dirs.set(d, [...(dirs.get(d) ?? []), p.slice(i + 1)])
    }
  }
  const lines = [`${root}/`]
  // README-like files first, then data files, as in D02
  const docs = top.filter((p) => /\.md$/.test(p) && p !== 'fonts.md')
  const rest = top.filter((p) => !docs.includes(p))
  if (docs.length) lines.push(`  ${docs.join('  ')}`)
  if (rest.length) lines.push(`  ${summarise(rest)}`)
  for (const [d, files] of [...dirs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const png = files.filter((f) => f.endsWith('.png'))
    const other = files.filter((f) => !f.endsWith('.png'))
    // nested folders (assets/images, assets/icons) are counted, not listed
    const nested = new Map<string, number>()
    const direct: string[] = []
    for (const f of other) {
      const j = f.indexOf('/')
      if (j < 0) direct.push(f)
      else nested.set(f.slice(0, j), (nested.get(f.slice(0, j)) ?? 0) + 1)
    }
    const parts = [...direct, ...[...nested.entries()].map(([n, c]) => `${n} ${c}`)]
    const pngText = png.length ? `${parts.length ? ' + ' : ''}${png.length} PNG` : ''
    lines.push(`  ${d}/ ${parts.length ? summarise(parts) : ''}${pngText}`.trimEnd())
  }
  return lines
}
