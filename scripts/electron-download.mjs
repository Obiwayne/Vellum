// Fetches Electron's binary when node_modules/electron/dist is missing. `npm ci` (with or without --ignore-scripts) does not
// download it, and electron-builder (electronDist: node_modules/electron/dist) fails without it. Does nothing when it is there.
// Usage: npm run electron:download
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

const pkg = dirname(createRequire(import.meta.url).resolve('electron/package.json'))
const ready = () => existsSync(join(pkg, 'path.txt')) && existsSync(join(pkg, 'dist'))

if (ready()) {
  console.log('electron: binary already present')
} else {
  console.log('electron: downloading the binary…')
  const r = spawnSync(process.execPath, [join(pkg, 'install.js')], { stdio: 'inherit' })
  if (r.status !== 0 || !ready()) {
    console.error('electron: the download failed (node_modules/electron/dist is still missing)')
    process.exit(r.status || 1)
  }
  console.log('electron: binary downloaded')
}
