@echo off
rem Launch Vellum. The first run, and the first run after the code changes, installs and builds (a
rem console shows while that happens); otherwise the app opens on its own and this window closes at once.
cd /d "%~dp0"
if not exist node_modules call npm install
rem Rebuild when a build is missing or any of its sources is newer than it (after a git pull or an edit).
powershell -NoProfile -Command "$b=Get-Item 'mcp\dist\index.js' -EA SilentlyContinue; if(-not $b -or (Get-ChildItem 'mcp\src' -Recurse -File | Where-Object LastWriteTime -gt $b.LastWriteTime | Select-Object -First 1)){exit 1}" || (cd mcp && call npm install && call npm run build && cd ..)
powershell -NoProfile -Command "$b=Get-Item 'out\renderer\index.html' -EA SilentlyContinue; if(-not $b -or (Get-ChildItem 'src','package.json','electron.vite.config.ts' -Recurse -File | Where-Object LastWriteTime -gt $b.LastWriteTime | Select-Object -First 1)){exit 1}" || call npx electron-vite build
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
