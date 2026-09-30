@echo off
rem Launch Vellum. First run installs and builds (a console shows while that happens);
rem after that the app opens on its own and this window closes immediately.
cd /d "%~dp0"
if not exist node_modules call npm install
if not exist mcp\dist\index.js (cd mcp && call npm install && call npm run build && cd ..)
if not exist out\main\index.js call npx electron-vite build
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
