// Builds the two installers the real update test needs, for the TEST product only (own appId, product name and updater cache
// folder, so it never meets a real Vellum install or its data): release-update/old = the current version, release-update/new =
// the next patch version with its latest.yml. The new version only exists in the build (electron-builder extraMetadata);
// package.json is not touched.   Usage: node scripts/build-update-test.mjs   (npm run dist:update-test)
import { spawnSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const current = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const [maj, min, pat] = current.split('.').map((n) => parseInt(n, 10))
const next = `${maj}.${min}.${pat + 1}`
const common = [
  '--win',
  'nsis',
  '--publish',
  'never',
  '--config.appId=com.vellum.app.installertest',
  '--config.productName=VellumInstallTest',
  '--config.extraMetadata.name=vellum-installtest' // the updater cache folder is "<name>-updater": its own, not the real "vellum-updater"
]
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: true })
  if (r.status !== 0) {
    console.error(`FAILED: ${cmd} ${args.join(' ')}`)
    process.exit(r.status ?? 1)
  }
}
rmSync(join(root, 'release-update'), { recursive: true, force: true })
run('npm', ['run', 'build'])
run('npm', ['run', 'build:mcp'])
run('npx', ['electron-builder', ...common, `--config.directories.output=release-update/old`])
run('npx', ['electron-builder', ...common, `--config.extraMetadata.version=${next}`, `--config.directories.output=release-update/new`])
console.log(`built ${current} (release-update/old) and ${next} (release-update/new)`)
