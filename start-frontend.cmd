@echo off
cd /d "%~dp0"
if not exist "node_modules\.bin\vite.cmd" (
  echo Run npm.cmd ci first. See README.md.
  exit /b 1
)
npm.cmd run dev -- %*
