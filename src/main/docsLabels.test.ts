// The install / update / data docs name buttons, menu items and settings. Each label the docs use must still exist in the app's source, and
// each command the docs show must still exist in package.json / the installer config: a renamed button or script fails here.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (p: string): string => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const readme = read('README.md')
const security = read('docs/SECURITY.md')
const mcp = read('docs/MCP.md')
const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> }
const builder = read('electron-builder.yml')

const UI: Array<[label: string, source: string]> = [
  ['Check for updates automatically', 'src/renderer/src/dashboard/SettingsPage.tsx'],
  ['Check for Updates…', 'src/renderer/src/shell/commands.ts'],
  ['Restart to update', 'src/renderer/src/shell/updates.tsx'],
  ['Update and restart', 'src/renderer/src/shell/updates.tsx'],
  ['Later', 'src/renderer/src/shell/updates.tsx'],
  ['Retry', 'src/renderer/src/shell/updates.tsx'],
  ['is ready to install', 'src/renderer/src/shell/updates.tsx'],
  ['Connect your agent', 'src/renderer/src/dashboard/ConnectAgentModal.tsx']
]

describe('labels used in the docs exist in the app', () => {
  it.each(UI)('%s', (label, file) => {
    expect(read(file)).toContain(label)
  })
  it('the install, update and data sections of the README use them', () => {
    for (const label of ['Check for updates automatically', 'Check for Updates…', 'Restart to update', 'Update and restart', 'Later', 'Retry', 'ready to install', 'Connect your agent']) {
      expect(readme, label).toContain(label)
    }
  })
})

describe('commands and settings the docs rely on', () => {
  it('installer behaviour the README promises is in the installer config', () => {
    expect(builder).toMatch(/perMachine: false/) // "for your user only, no administrator prompt"
    expect(builder).toMatch(/runAfterFinish: true/) // "offers Run Vellum"
    expect(builder).toMatch(/createDesktopShortcut: true/)
    expect(builder).toMatch(/createStartMenuShortcut: true/)
    expect(builder).toMatch(/deleteAppDataOnUninstall: false/) // "your files are kept"
    expect(builder).toMatch(/allowToChangeInstallationDirectory: true/) // "you can pick another folder"
    expect(readme).toContain('%LOCALAPPDATA%\\Programs\\Vellum')
    expect(readme).toContain('Vellum-Setup-<version>.exe /S')
  })
  it('the README names the data folder and the update env var, and the packaged MCP command', () => {
    expect(readme).toContain('%APPDATA%\\Vellum')
    expect(readme).toContain('VELLUM_NO_UPDATE_CHECK=1')
    expect(readme).toContain('claude mcp add vellum -e ELECTRON_RUN_AS_NODE=1 --')
    expect(mcp).toContain('ELECTRON_RUN_AS_NODE=1')
  })
  it('the SECURITY section documents the update test hook, signing and the per-user install', () => {
    expect(security).toContain('## Installer, updates and the packaged MCP server')
    for (const word of ['VELLUM_UPDATE_URL', 'only in packaged builds', 'not code-signed', 'win.publisherName', 'Restart to update', 'ELECTRON_RUN_AS_NODE', 'per user']) {
      expect(security, word).toContain(word)
    }
    expect(read('src/main/updater.ts')).toContain('process.env.VELLUM_UPDATE_URL') // the hook it describes
  })
  it('the npm scripts the docs and tests mention exist', () => {
    for (const s of ['test:update', 'dist:update-test', 'test:installer', 'pack', 'dist']) expect(pkg.scripts[s], s).toBeTruthy()
    expect(security).toContain('npm run test:update')
  })
})

describe('docs text is clean', () => {
  it.each(['README.md', 'docs/ARCHITECTURE.md', 'docs/BUGS.md', 'docs/CANVAS.md', 'docs/COMPONENTS.md', 'docs/FOUNDATION.md', 'docs/INSPECTOR.md', 'docs/LEFT_DASHBOARD.md', 'docs/MCP.md', 'docs/SECURITY.md'])(
    '%s is valid UTF-8 with no U+FFFD replacement characters',
    (file) => {
      let text: string
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(file))
      } catch {
        throw new Error(`${file} is not valid UTF-8`)
      }
      expect(text.includes('\uFFFD')).toBe(false)
    }
  )

  it('the README describes crash recovery with the real prompt wording', () => {
    expect(readme).toContain('Crash recovery')
    expect(readme).toContain('Restore unsaved changes?')
    expect(read('src/renderer/src/shell/RecoveryPrompt.tsx')).toContain('Restore unsaved changes?')
    expect(read('src/renderer/src/shell/RecoveryPrompt.tsx')).toContain('Restore them?')
  })

  it('the restore prompt names the design once and does not repeat "Restore unsaved changes"', () => {
    const code = read('src/renderer/src/shell/RecoveryPrompt.tsx') // read() turns line ends into \n
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
    const src = code.join(' ')
    expect(src.match(/Restore unsaved changes/g)).toHaveLength(1) // the title only, never the body
    expect(src).not.toMatch(/Restore unsaved changes to/)
  })
})
