@echo off
rem Vellum remote connector: lets claude.ai (web, desktop app, phone) use Vellum through a tunnel. See docs/REMOTE.md.
rem Keep this window open while you want remote access; Vellum itself must be open too.
rem Admin page (login codes, approvals): http://127.0.0.1:29181
cd /d "%~dp0"
powershell -NoProfile -Command "$b=Get-Item 'mcp\dist\remote\index.js' -EA SilentlyContinue; if(-not $b -or (Get-ChildItem 'mcp\src' -Recurse -File | Where-Object LastWriteTime -gt $b.LastWriteTime | Select-Object -First 1)){exit 1}" || (cd mcp && call npm install && call npm run build && cd ..)
title Vellum remote connector
node mcp\dist\remote\index.js
