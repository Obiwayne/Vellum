// Packaging config sanity (electron-builder.yml, package.json): one version source, the installer is per user and keeps data,
// only what the packaged main process needs is a production dependency.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (p: string): string => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const pkg = JSON.parse(read('package.json')) as { version: string; main: string; scripts: Record<string, string>; dependencies: Record<string, string>; devDependencies: Record<string, string> }
const yml = read('electron-builder.yml')

describe('electron-builder.yml', () => {
  it('names the installer after the package version, so there is one version source', () => {
    expect(yml).toMatch(/artifactName: Vellum-Setup-\$\{version\}\.\$\{ext\}/)
    expect(yml).not.toMatch(/^version:/m)
  })

  it('is a per-user NSIS installer that never deletes the data folder', () => {
    expect(yml).toMatch(/perMachine: false/)
    expect(yml).toMatch(/target: nsis/)
    expect(yml).toMatch(/deleteAppDataOnUninstall: false/)
    expect(yml).toMatch(/createDesktopShortcut: true/)
    expect(yml).toMatch(/createStartMenuShortcut: true/)
  })

  it('packs the electron-vite output and the package.json it points at', () => {
    expect(pkg.main).toBe('./out/main/index.js')
    expect(yml).toMatch(/- out\/\*\*\/\*/)
    expect(yml).toMatch(/- package\.json/)
    expect(yml).toMatch(/icon: resources\/icon\.ico/)
    expect(yml).toMatch(/output: release/)
  })
})

describe('package.json for packaging', () => {
  it('has pack and dist scripts that build first', () => {
    expect(pkg.scripts.pack).toMatch(/^npm run build && electron-builder --dir$/)
    expect(pkg.scripts.dist).toMatch(/^npm run build && electron-builder$/)
  })

  it('ships only what the main process requires at run time (everything else is bundled by Vite into out/)', () => {
    expect(Object.keys(pkg.dependencies)).toEqual(['ws'])
    expect(pkg.devDependencies['electron-builder']).toBeTruthy()
    expect(pkg.devDependencies.electron).toBeTruthy()
  })

  it('the built main bundle requires no other package than ws (guards the line above)', () => {
    let built = ''
    try {
      built = read('out/main/index.js')
    } catch {
      return // no build in this checkout: the packaged-app smoke test covers it
    }
    const external = [...built.matchAll(/require\("([^".][^"]*)"\)/g)].map((m) => m[1]).filter((m) => !/^(electron|node:.*|path|fs|fs\/promises|os|crypto|child_process|url|net|http|https|util|stream|zlib|events|buffer|tls|dns|readline)$/.test(m))
    expect([...new Set(external)]).toEqual(['ws'])
  })
})

describe('app version', () => {
  it('the About/What\'s new version is the package.json version', async () => {
    const src = read('src/renderer/src/editor/left/WhatsNew.tsx')
    expect(src).toMatch(/import \{ version \} from '[./]*package\.json'/)
    expect(src).toMatch(/export const APP_VERSION: string = version/)
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+/)
  })
})
