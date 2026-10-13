// The decision of the update test's relaunch check, apart from the PowerShell that gathers the facts, so it can be unit tested.
// `started` = how many VellumInstallTest.exe processes run from the install folder after install(); `seen` = a readable list of
// what the script saw (processes, their sessions), logged either way so a failure on a runner explains itself.
export function relaunchVerdict({ started, seen }) {
  const ok = Number(started) > 0
  const label = 'the new version was started again from the same folder (force-run)'
  return { ok, label, detail: ok ? '' : `no ${'VellumInstallTest'}.exe process runs from the install folder; processes seen: ${seen || 'none'}` }
}
