@echo off
rem Launch Vellum (builds first if needed). Double-click this file.
cd /d "%~dp0"
if not exist node_modules call npm install
if not exist mcp\dist\index.js (cd mcp && call npm install && call npm run build && cd ..)
if not exist out\main\index.js call npx electron-vite build
start "" /b npx electron-vite preview
