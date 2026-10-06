// Packaging config sanity (electron-builder.yml, package.json): one version source, the installer is per user and keeps data,
// only what the packaged main process needs is a production dependency.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
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
    expect(pkg.scripts.pack).toBe("npm run build && npm run build:mcp && electron-builder --dir")
    expect(pkg.scripts.dist).toBe("npm run build && npm run build:mcp && electron-builder")
    expect(pkg.scripts["build:mcp"]).toBe("node scripts/build-mcp-bundle.mjs")
  })

  it('ships only what the main process requires at run time (everything else is bundled by Vite into out/)', () => {
    expect(Object.keys(pkg.dependencies).sort()).toEqual(['electron-updater', 'ws']) // electron-updater is loaded at run time by the installed build only
    expect(pkg.devDependencies['electron-builder']).toBeTruthy()
    expect(pkg.devDependencies.electron).toBeTruthy()
  })

  it('the built main bundle requires no other package than ws and electron-updater (guards the line above)', () => {
    let built = ''
    try {
      built = read('out/main/index.js')
    } catch {
      return // no build in this checkout: the packaged-app smoke test covers it
    }
    const external = [...built.matchAll(/require\("([^".][^"]*)"\)/g)].map((m) => m[1]).filter((m) => !/^(electron|node:.*|path|fs|fs\/promises|os|crypto|child_process|url|net|http|https|util|stream|zlib|events|buffer|tls|dns|readline)$/.test(m))
    expect([...new Set(external)].sort()).toEqual(['electron-updater', 'ws'])
  })
})

describe('app version', () => {
  it('APP_VERSION (the What is new dialog) equals the package.json version: a mismatch fails here', async () => {
    const whatsNew = '../renderer/src/editor/left/WhatsNew' // a variable path: this node-side test must not pull the React file into the node typecheck
    const { APP_VERSION } = (await import(/* @vite-ignore */ whatsNew)) as { APP_VERSION: string }
    expect(APP_VERSION).toBe(pkg.version)
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('no other file of the app hard-codes the version (it would drift from package.json)', () => {
    const hits: string[] = []
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const f = join(dir, e.name)
        if (e.isDirectory()) walk(f)
        else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.ts$/.test(e.name) && read(f).includes(`'${pkg.version}'`)) hits.push(f)
      }
    }
    walk('src')
    expect(hits).toEqual([])
  })
})

describe('MCP bundle in the package', () => {
  it('electron-builder.yml copies the MCP bundle next to the app, outside the asar', () => {
    expect(yml).toMatch(/^extraResources:/m)
    expect(yml).toContain('- from: resources-out/mcp\n    to: mcp')
    expect(yml).toMatch(/outside the asar/i)
  })
})
