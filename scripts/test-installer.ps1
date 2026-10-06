<#
  Silent install / reinstall / uninstall test for the Windows installer (npm run dist first).

    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-installer.ps1 [-Installer release\Vellum-Setup-0.1.0.exe] [-Out <folder for the log>]

  Everything happens in temp folders: the app is installed with /D=<temp>, the app's data folder is a temp VELLUM_USER_DATA
  (never %APPDATA%\Vellum), and the HKCU uninstall key and the Start Menu / Desktop shortcuts the installer makes are removed
  afterwards. A shortcut that already existed under the same name is backed up first and put back. The script refuses to run
  when a Vellum install is registered, or when a Vellum.exe that is not ours is running, so it cannot touch a real install.

  Checks: per-user install (no admin rights, HKCU entry, nothing in HKLM), files, uninstall entry, Start Menu and Desktop
  shortcuts and their AppUserModelID, a running Vellum is closed by a reinstall, "Run Vellum"
  (runAfterFinish in the config), uninstall removes the app, the shortcuts and the entry but not the data.
  Exit code 0 = all passed.
#>
param(
  [string]$Installer,
  [string]$Out = (Join-Path (Get-Location) '.muster-evidence\test-installer')
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $Installer) {
  $Installer = Get-ChildItem (Join-Path $root 'release') -Filter 'Vellum-Setup-*.exe' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $Installer -or -not (Test-Path $Installer)) { Write-Host 'FAILED: no installer found (npm run dist, or pass -Installer)'; exit 2 }
$Installer = (Resolve-Path $Installer).Path
New-Item -ItemType Directory -Force $Out | Out-Null
$logFile = Join-Path $Out 'test-installer.log'
$results = New-Object System.Collections.ArrayList
function Check([bool]$ok, [string]$label) {
  $line = "$(if ($ok) { 'passed' } else { 'FAILED' }): $label"
  Write-Host $line
  [void]$results.Add($line)
}
function Step([string]$m) { Write-Host "-- $m" }

$appId = (Select-String -Path (Join-Path $root 'electron-builder.yml') -Pattern '^appId:\s*(\S+)').Matches[0].Groups[1].Value
$version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$uninstallRoot = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
$desktop = [Environment]::GetFolderPath('Desktop')
$startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) ''
$work = Join-Path ([IO.Path]::GetTempPath()) ("vellum-installer-test-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$installDir = Join-Path $work 'app'
$dataDir = Join-Path $work 'data'
$backup = Join-Path $work 'shortcut-backup'
New-Item -ItemType Directory -Force $work, $dataDir, $backup | Out-Null

# the shortcut's System.AppUserModel.ID, read through the shell (null when it has none)
function Read-Aumid([string]$lnk) {
  $sh = New-Object -ComObject Shell.Application
  $v = $sh.NameSpace((Split-Path $lnk)).ParseName((Split-Path $lnk -Leaf)).ExtendedProperty('System.AppUserModel.ID')
  if ($v) { [string]$v } else { $null }
}

function Find-Uninstall {
  Get-ChildItem $uninstallRoot -ErrorAction SilentlyContinue | Where-Object { (Get-ItemProperty $_.PSPath).DisplayName -like 'Vellum*' }
}
function Shortcut-Paths {
  $list = @((Join-Path $desktop 'Vellum.lnk'))
  $list += Get-ChildItem ([Environment]::GetFolderPath('Programs')) -Filter 'Vellum*.lnk' -Recurse -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }
  $list | Select-Object -Unique
}
function Ours-Running {
  Get-Process -Name Vellum -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($installDir, [StringComparison]::OrdinalIgnoreCase) }
}
function Foreign-Running {
  Get-Process -Name Vellum -ErrorAction SilentlyContinue | Where-Object { -not $_.Path -or -not $_.Path.StartsWith($installDir, [StringComparison]::OrdinalIgnoreCase) }
}
function Run-Installer([string[]]$extra, [string]$dir) {
  # /D=<dir> must be the last argument and unquoted
  $p = Start-Process -FilePath $Installer -ArgumentList (@('/S') + $extra + @("/D=$dir")) -PassThru -Wait
  return $p.ExitCode
}

$preShortcuts = @(Shortcut-Paths | Where-Object { Test-Path $_ })
$saved = @{}
$exit = 1
try {
  # ---- guards: never touch a real install
  if (Find-Uninstall) { Write-Host 'FAILED: a Vellum uninstall entry already exists; refusing to run (it would be replaced and removed)'; exit 2 }
  if (Foreign-Running) { Write-Host 'FAILED: a Vellum.exe that is not part of this test is running; close it first (the installer closes running copies)'; exit 2 }
  $i = 0
  foreach ($s in $preShortcuts) { $copy = Join-Path $backup "$((++$i)).lnk"; Copy-Item $s $copy; $saved[$s] = $copy }
  Step "installer $Installer, appId $appId, version $version"
  Step "install dir $installDir, data dir $dataDir"
  Set-Content (Join-Path $dataDir 'marker.txt') 'user data that an uninstall must keep'

  # ---- 1. silent install, per user
  $code = Run-Installer @() $installDir
  Check ($code -eq 0) "silent install exits 0 (no admin prompt, ran as a normal user)"
  $exe = Join-Path $installDir 'Vellum.exe'
  Check (Test-Path $exe) 'Vellum.exe is in the install folder'
  Check (Test-Path (Join-Path $installDir 'resources\app.asar')) 'resources\app.asar is installed'
  Check (Test-Path (Join-Path $installDir 'Uninstall Vellum.exe')) 'an uninstaller is installed'
  $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  Check (-not $isAdmin) 'the test itself runs without admin rights, so the install was per user'

  # ---- 2. registry entry
  $key = Find-Uninstall | Select-Object -First 1
  Check ($null -ne $key) 'an uninstall entry exists under HKCU'
  if ($key) {
    $p = Get-ItemProperty $key.PSPath
    Check ($p.DisplayVersion -eq $version) "uninstall entry shows version $($p.DisplayVersion) (package.json $version)"
    Check ($p.UninstallString -like "*$installDir*") "uninstall entry points at the install folder ($($p.UninstallString))"
    Check ([bool]$p.UninstallString) 'uninstall entry has an UninstallString'
    Write-Host "uninstall key name: $($key.PSChildName)"
  }
  Check (-not (Get-ChildItem 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue | Where-Object { (Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue).DisplayName -like 'Vellum*' })) 'nothing registered under HKLM (per user)'

  # ---- 3. shortcuts, with the appId on them
  $desk = Join-Path $desktop 'Vellum.lnk'
  $menu = Shortcut-Paths | Where-Object { $_ -ne $desk -and (Test-Path $_) } | Select-Object -First 1
  Check (Test-Path $desk) 'Desktop shortcut exists'
  Check ([bool]$menu) "Start Menu shortcut exists ($menu)"
  $wsh = New-Object -ComObject WScript.Shell
  foreach ($lnk in @($desk, $menu)) {
    if ($lnk -and (Test-Path $lnk)) {
      Check ($wsh.CreateShortcut($lnk).TargetPath -eq $exe) "shortcut $([IO.Path]::GetFileName($lnk)) targets the installed Vellum.exe"
      $aumid = Read-Aumid $lnk
      Check ($aumid -eq $appId) "shortcut AppUserModelID is '$aumid' (appId '$appId')"
    }
  }

  # ---- 4. a silent install does not start the app; start it so the next step has a running copy to close
  Check (-not [bool](Ours-Running)) 'a silent install does not start the app by itself'
  $env:VELLUM_USER_DATA = $dataDir
  $env:VELLUM_PORT = '29' + (Get-Random -Minimum 400 -Maximum 899)
  $env:VELLUM_NO_UPDATE_CHECK = '1'
  $app = Start-Process -FilePath $exe -PassThru
  Start-Sleep -Seconds 6
  Check ([bool](Ours-Running)) 'the installed app starts'
  Remove-Item Env:VELLUM_USER_DATA, Env:VELLUM_PORT, Env:VELLUM_NO_UPDATE_CHECK
  $before = (Ours-Running | Select-Object -First 1).Id

  # ---- 5. reinstall over the running app: it is closed first
  $code = Run-Installer @() $installDir
  Check ($code -eq 0) 'reinstall over a running app exits 0'
  Start-Sleep -Seconds 2
  Check (-not (Get-Process -Id $before -ErrorAction SilentlyContinue)) "the running Vellum (pid $before) was closed by the installer"
  Check (Test-Path $exe) 'the app is still installed after the reinstall'

  # ---- 6. "Run Vellum" at the end. A silent install does not start the app unless --force-run is passed (what the updater does).
  # That start goes through the shell, so it ignores our VELLUM_USER_DATA and would open the app on the real data folder:
  # not run here. The config is checked instead (it makes the finish page's "Run Vellum" box checked).
  $cfg = Join-Path $root 'electron-builder.yml'
  Check ((Get-Content $cfg -Raw) -match '(?m)^\s*runAfterFinish:\s*true') 'electron-builder.yml has runAfterFinish: true (the finish page offers "Run Vellum")'

  # ---- 7. uninstall (while the app is running): app, shortcuts and entry go, data stays
  $uninst = Join-Path $installDir 'Uninstall Vellum.exe'
  $u = Start-Process -FilePath $uninst -ArgumentList @('/S', "_?=$installDir") -PassThru -Wait
  Check ($u.ExitCode -eq 0) 'silent uninstall exits 0'
  Start-Sleep -Seconds 2
  Check (-not [bool](Ours-Running)) 'uninstall closed the running Vellum'
  Check (-not (Test-Path $exe)) 'Vellum.exe is gone'
  Check (-not (Test-Path (Join-Path $installDir 'resources'))) 'the resources folder is gone'
  Check (-not (Find-Uninstall)) 'the uninstall entry is gone'
  Check (-not (Test-Path $desk)) 'the Desktop shortcut is gone'
  Check (-not ($menu -and (Test-Path $menu))) 'the Start Menu shortcut is gone'
  Check (Test-Path (Join-Path $dataDir 'marker.txt')) 'the data folder and its file are still there'
  $leftover = if (Test-Path $installDir) { (Get-ChildItem $installDir -Force | ForEach-Object Name) -join ', ' } else { '' }
  Write-Host "left in the install folder after a silent uninstall (the uninstaller cannot delete itself while waiting): $leftover"

  $exit = if (($results | Where-Object { $_ -like 'FAILED*' }).Count -eq 0) { 0 } else { 1 }
} catch {
  Check $false "script error: $($_.Exception.Message)"
} finally {
  # ---- cleanup: only what this run made
  Get-Process -Name Vellum -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($installDir, [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 800
  Find-Uninstall | Where-Object { (Get-ItemProperty $_.PSPath).UninstallString -like "*$installDir*" } | ForEach-Object { Remove-Item $_.PSPath -Recurse -Force -ErrorAction SilentlyContinue }
  foreach ($s in (Shortcut-Paths | Where-Object { Test-Path $_ })) {
    try { if ((New-Object -ComObject WScript.Shell).CreateShortcut($s).TargetPath.StartsWith($installDir, [StringComparison]::OrdinalIgnoreCase)) { Remove-Item $s -Force } } catch { }
  }
  foreach ($orig in $saved.Keys) { if (-not (Test-Path $orig)) { Copy-Item $saved[$orig] $orig } }
  Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
  $summary = @("installer: $Installer", "version: $version, appId: $appId", "date: $(Get-Date -Format s)") + $results
  $summary | Set-Content $logFile
  Write-Host "log: $logFile"
}
exit $exit
