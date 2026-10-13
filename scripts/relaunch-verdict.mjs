// The decision of the update test's relaunch check, apart from the PowerShell that gathers the facts, so it can be unit tested.
// `processes` = the VellumInstallTest.exe processes seen after install() ({ pid, path, session }); `installDir` = the folder the
// test installed into. A process counts when its executable lives under that folder; case and slash style are ignored (Windows).
import { realpathSync } from 'node:fs'

const SEP = String.fromCharCode(92)
// Windows reports process paths in the long form, but os.tmpdir() on a runner is an 8.3 path (C:\Users\RUNNER~1\...): expand the
// expected folder to its real long path when it exists, else compare it as given.
const longPath = (p) => {
  try {
    return realpathSync.native(String(p))
  } catch {
    return String(p ?? '')
  }
}
const norm = (p) => {
  let s = String(p ?? '').split('/').join(SEP).toLowerCase()
  while (s.endsWith(SEP)) s = s.slice(0, -1)
  return s
}

export function relaunchVerdict({ processes, installDir }) {
  const list = Array.isArray(processes) ? processes : []
  const dir = norm(longPath(installDir))
  const inFolder = list.filter((p) => dir !== '' && (norm(p?.path) + SEP).startsWith(dir + SEP))
  const ok = inFolder.length > 0
  const seen = list.map((p) => `pid=${p?.pid} session=${p?.session} path=${p?.path || '(unreadable)'}`).join('; ') || 'none'
  return {
    ok,
    label: 'the new version was started again from the same folder (force-run)',
    detail: ok ? '' : `no process runs from ${installDir}; processes seen: ${seen}`
  }
}
