// Packaging config sanity (electron-builder.yml, package.json): one version source, the installer is per user and keeps data,
// only what the packaged main process needs is a production dependency.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (p: string): string => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const pkg = JSON.parse(read('package.json')) as { version: string; main: string; scripts: Record<string, string>; dependencies: Record<string, string>; devDependencies: Record<string, string> }
const yml = read('electron-builder.yml')

// The packed app (npm run pack -> release/win-unpacked, or the installer test build in release-test/): what is inside app.asar.
// Skipped when nothing is packed here; with VELLUM_REQUIRE_PACK=1 (the CI job that packs) a missing pack is a failure.
const packedDir = ['release', 'release-test'].map((d) => join(d, 'win-unpacked', 'resources')).find((d) => existsSync(join(d, 'app.asar')))
describe('packed app.asar', () => {
  it.runIf(!packedDir && Boolean(process.env.VELLUM_REQUIRE_PACK))('there is a packed app to check (VELLUM_REQUIRE_PACK is set)', () => {
    throw new Error('no release/win-unpacked/resources/app.asar or release-test/...: run npm run pack (or dist:test) before this test')
  })

  it('the CI package job packs and then runs this file with VELLUM_REQUIRE_PACK=1, and the smoke test', () => {
    const ci = read('.github/workflows/ci.yml')
    expect(ci).toMatch(/^ {2}package:$/m)
    expect(ci).toMatch(/npm run pack/)
    expect(ci).toMatch(/VELLUM_REQUIRE_PACK: '1'/)
    expect(ci).toMatch(/node scripts\/smoke-packaged\.mjs/)
  })

  it.skipIf(!packedDir)('contains electron-updater (the installed build needs it, or its update check is broken) and the app', async () => {
    const asarModule = '@electron/asar' // a variable: the package comes with electron-builder and is not typed for this project
    const asar = (await import(/* @vite-ignore */ asarModule)) as { listPackage: (p: string) => string[] }
    const files = asar.listPackage(join(packedDir!, 'app.asar')).map((f) => f.replaceAll('\\', '/'))
    expect(files).toContain('/node_modules/electron-updater/package.json')
    expect(files).toContain('/package.json')
    expect(files.some((f) => f.startsWith('/out/main/'))).toBe(true)
    // default_app.asar (copied from electronDist) is only run by Electron when there is no app.asar: that is why it may stay
    expect(existsSync(join(packedDir!, 'app.asar'))).toBe(true)
  })
})

describe('AppUserModelID', () => {
  it('an installed build runs under the installer appId, so pins made from its shortcuts keep working', () => {
    const builderAppId = /^appId: (\S+)/m.exec(yml)?.[1]
    expect(builderAppId).toBe('com.vellum.app')
    const main = read('src/main/index.ts')
    expect(main).toContain(`const APP_ID = app.isPackaged ? '${builderAppId}' :`)
    expect(main).toMatch(/app\.setAppUserModelId\(APP_ID\)/)
  })
})

describe('installer test script', () => {
  const script = read('scripts/test-installer.ps1')
  it('is wired to an npm script and a CI job', () => {
    expect(pkg.scripts['test:installer']).toMatch(/scripts\/test-installer\.ps1/)
    const ci = read('.github/workflows/ci.yml')
    expect(ci).toMatch(/installer:/)
    expect(ci).toMatch(/npm run test:installer/)
  })
  it('only works in temp folders and refuses to run over a real install', () => {
    expect(script).toMatch(/\/D=\$dir/)
    expect(script).toMatch(/VELLUM_USER_DATA/)
    expect(script).toMatch(/refusing to run/)
    expect(script).not.toMatch(/\$env:APPDATA/i)
  })
  it('tests a build with its own appId and product name, so it can never meet or remove a real install', () => {
    expect(pkg.scripts['test:installer']).toContain('com.vellum.app.installertest')
    expect(pkg.scripts['dist:test']).toContain('--config.appId=com.vellum.app.installertest')
    expect(pkg.scripts['dist:test']).toContain('--config.productName=VellumInstallTest')
    expect(pkg.scripts['dist:test']).toContain('--publish never')
    expect(script).toMatch(/refusing to run/)
    expect(script).toMatch(/already installed or registered/)
  })
  it('checks the behaviours the installer promises', () => {
    for (const what of ['AppUserModelID', 'HKLM', 'reinstall over a running app', 'data folder and its file are still there', 'runAfterFinish']) expect(script).toContain(what)
  })
})

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
