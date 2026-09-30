# Creates Vellum shortcuts (with the app icon) that open Vellum without a console window:
# one in the project folder and one on the Desktop. Run after the first build:
#   powershell -ExecutionPolicy Bypass -File scripts\make-shortcuts.ps1
$root = Split-Path -Parent $PSScriptRoot
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
$icon = Join-Path $root 'resources\icon.ico'
if (-not (Test-Path $electron)) { Write-Error "Run npm install first ($electron not found)"; exit 1 }
$shell = New-Object -ComObject WScript.Shell
foreach ($dir in @($root, [Environment]::GetFolderPath('Desktop'))) {
  $lnk = $shell.CreateShortcut((Join-Path $dir 'Vellum.lnk'))
  $lnk.TargetPath = $electron
  $lnk.Arguments = '"' + $root + '"'
  $lnk.WorkingDirectory = $root
  $lnk.IconLocation = "$icon,0"
  $lnk.Description = 'Vellum design tool'
  $lnk.Save()
  Write-Output "Created $(Join-Path $dir 'Vellum.lnk')"
}
